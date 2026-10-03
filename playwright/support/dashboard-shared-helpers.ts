/**
 * Small helpers every dashboard support module and step file shares, kept in
 * one place so the copies cannot drift: the Cloud API calls, the server copy
 * of a database document, key-order-free JSON, equal row widths, the
 * "Escape until it is gone" loop and the CSS-variable colour probe.
 *
 * Nothing here imports the other dashboard support modules, so any of them
 * can import it.
 */
import { APIRequestContext, APIResponse, expect, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';

import { DASHBOARD_GRID_COLUMNS } from '../../src/application/database-yjs/dashboard-geometry';
import { Types } from '../../src/application/types';

import { TestConfig } from './test-config';

/** How long a widget may take to show what a step waits for. */
export const WIDGET_TIMEOUT_MS = 30_000;
export const WIDGET_TIMEOUT = { timeout: WIDGET_TIMEOUT_MS };

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Browser storage
// ---------------------------------------------------------------------------

/**
 * The prefix of the delta cursor the app keeps per database in localStorage
 * (`RID_CACHE_PREFIX` in src/application/database-blob/index.ts). The cursor
 * belongs to the rows in IndexedDB: without them it makes the next walk a
 * delta that returns no row, and the app then repairs the gap with a second,
 * full walk after the widget has reported its load complete.
 */
const DATABASE_BLOB_RID_PREFIX = 'af_database_blob_rid:';

/**
 * Forget every database this browser cached: delete IndexedDB and the delta
 * cursors that describe it, while no page of the app runs (a static file of
 * the origin). The session stays signed in.
 */
export async function clearCachedDatabaseStorage(page: Page) {
  await page.goto(new URL('/appflowy.svg', page.url()).toString());
  const remaining = await page.evaluate(async (ridPrefix) => {
    const names = (await indexedDB.databases()).map((database) => database.name).filter(Boolean) as string[];

    await Promise.all(
      names.map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error(`deleting ${name} is blocked`));
          })
      )
    );
    const cursorKeys = () =>
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '').filter((key) =>
        key.startsWith(ridPrefix)
      );

    cursorKeys().forEach((key) => localStorage.removeItem(key));
    return { databases: (await indexedDB.databases()).length, cursors: cursorKeys().length };
  }, DATABASE_BLOB_RID_PREFIX);

  expect(remaining.databases, 'IndexedDB still holds databases').toBe(0);
  expect(remaining.cursors, 'localStorage still holds database delta cursors').toBe(0);
}

// ---------------------------------------------------------------------------
// Cloud API
// ---------------------------------------------------------------------------

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };

export function apiHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * The server's "Too many requests" code. It rejects a request at the
 * permission check while the workspace's permission mapping reloads (for
 * example right after a database was created), before doing anything, so the
 * request can be sent again.
 */
const API_BUSY_CODE = 1079;
const API_BUSY_ATTEMPTS = 6;

/** Send a request, again after a short pause while the server answers "busy". */
async function sendUntilNotBusy<T>(send: () => Promise<APIResponse>) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await send();
    const text = await response.text();
    const body = parseJson<ApiEnvelope<T>>(text);

    if (body?.code !== API_BUSY_CODE || attempt >= API_BUSY_ATTEMPTS) return { response, text, body };
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
}

export async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const { response, text, body } = await sendUntilNotBusy<T>(() =>
    request.get(`${TestConfig.apiUrl}${path}`, {
      headers: apiHeaders(token),
      failOnStatusCode: false,
    })
  );

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API GET ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data;
}

export async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const { response, text, body } = await sendUntilNotBusy<T>(() =>
    request.post(`${TestConfig.apiUrl}${path}`, {
      headers: apiHeaders(token),
      data: typeof data === 'string' ? data : JSON.stringify(data),
      failOnStatusCode: false,
    })
  );

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

export async function apiPatch<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const { response, text, body } = await sendUntilNotBusy<T>(() =>
    request.patch(`${TestConfig.apiUrl}${path}`, {
      headers: apiHeaders(token),
      data: typeof data === 'string' ? data : JSON.stringify(data),
      failOnStatusCode: false,
    })
  );

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API PATCH ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

/** The access token the signed-in browser holds (the same one the app sends). */
export async function browserAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      return (
        JSON.parse(localStorage.getItem('token') ?? '{}').access_token || localStorage.getItem('af_auth_token') || ''
      );
    } catch {
      return localStorage.getItem('af_auth_token') || '';
    }
  });

  if (!token) throw new Error('No auth token in the page');
  return token as string;
}

export interface ServerDatabaseAccess {
  token: string;
  workspaceId: string;
}

/**
 * Read the server's copy of a database document. `read` gets the decoded
 * `database` map; the document is destroyed when it returns.
 */
export async function readServerDatabaseDoc<T>(
  request: APIRequestContext,
  access: ServerDatabaseAccess,
  databaseId: string,
  read: (database: Y.Map<unknown> | undefined) => T
): Promise<T> {
  const collab = await apiGet<{ doc_state: number[] }>(
    request,
    access.token,
    `/api/workspace/v1/${access.workspaceId}/collab/${databaseId}?collab_type=${Types.Database}`
  );
  const doc = new Y.Doc({ guid: databaseId });

  try {
    Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
    return read(doc.getMap('data').get('database') as Y.Map<unknown> | undefined);
  } finally {
    doc.destroy();
  }
}

/** A Yjs value as plain JSON (`Y.Map` and `Y.Array` through `toJSON`). */
export function plainYjs(value: unknown): unknown {
  return value instanceof Y.AbstractType ? (value.toJSON() as unknown) : value;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * JSON with object keys sorted and BigInts as numbers. The server stores
 * these values as Yrs `Any` maps, which re-encode object keys in arbitrary
 * order; arrays keep theirs.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return Number(item);
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }

    return item;
  });
}

/** The widths of `count` widgets sharing a row equally; the last one takes the remainder. */
export function equalRowWidths(count: number, columns = DASHBOARD_GRID_COLUMNS): number[] {
  if (count <= 0) return [];
  const width = Math.floor(columns / count);

  return Array.from({ length: count }, (_, index) => (index === count - 1 ? columns - width * (count - 1) : width));
}

// ---------------------------------------------------------------------------
// Pointer and keyboard
// ---------------------------------------------------------------------------

/**
 * Press Escape until `locator` is hidden (a nested editor inside a popover
 * needs one press per layer), then assert it is.
 */
export async function pressEscapeUntilHidden(page: Page, locator: Locator, attempts = 4) {
  for (let attempt = 0; attempt < attempts && (await locator.isVisible()); attempt += 1) {
    await page.keyboard.press('Escape');
  }

  await expect(locator).toBeHidden();
}

/** The computed colour of a CSS variable, for comparing with computed styles. */
export async function resolveColor(page: Page, variable: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('div');

    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;

    probe.remove();
    return color;
  }, variable);
}

/** The computed background colour of a CSS variable. */
export async function resolveBackgroundColor(page: Page, variable: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;

    probe.remove();
    return color;
  }, variable);
}
