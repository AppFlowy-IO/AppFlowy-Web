/* eslint-disable import/default, import/no-named-as-default-member -- protobufjs is CommonJS; Node ESM needs its default export. */
import { resolve } from 'node:path';

import { APIRequestContext, expect } from '@playwright/test';
import protobuf from 'protobufjs';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '../../src/application/database-yjs/const';
import { YjsDatabaseKey } from '../../src/application/types';

import { apiGet, apiHeaders } from './dashboard-shared-helpers';
import { TestConfig } from './test-config';

import type { CreateDefaultDatabaseViewRequest, AtomicCreationReceipt } from '../../src/application/atomic-creation/types';
import type { YDatabase, YDatabaseField, YDatabaseFieldSetting } from '../../src/application/types';

// Playwright and Jest both run from the repository root.
const schema = protobuf.loadSync(resolve('src/proto/collab.proto'));
const syncRequest = schema.lookupType('collab.CollabBatchSyncRequest');
const syncResponse = schema.lookupType('collab.CollabBatchSyncResponse');
const ORIGINAL_RESTORE_ID = '00000000-0000-0000-0000-000000000000';
const ATTEMPTS = 8;
const TIMEOUT_MS = 30_000;
const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 250 * attempt));

interface DatabaseSyncResult {
  objectId: string;
  collabType: number;
  compression: number;
  missingUpdate: Uint8Array;
  collabVersion: string;
  error: string;
  messageId?: unknown;
}

/** Sync a fresh fixture's original branch, retaining its exact update on explicit backpressure. */
export async function syncFixtureDatabase(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  update = new Uint8Array(),
  version = ''
): Promise<DatabaseSyncResult> {
  const payload = Buffer.from(syncRequest.encode(syncRequest.create({
    items: [{ objectId: databaseId, collabType: 1, compression: 0, sv: Uint8Array.of(0),
      docState: update, collabVersion: version, databaseRestoreId: ORIGINAL_RESTORE_ID }],
    responseCompression: 0,
  })).finish());
  const deadline = Date.now() + TIMEOUT_MS;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (Date.now() >= deadline) break;
    const response = await request.post(`${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/full-sync/batch`, {
      headers: { ...apiHeaders(token), 'Content-Type': 'application/octet-stream', 'client-version': 'web' },
      data: payload,
      timeout: Math.max(1, deadline - Date.now()),
      failOnStatusCode: false,
    });

    if (!response.ok()) throw new Error(`Fixture database sync failed: HTTP ${response.status()}`);
    const decoded = syncResponse.decode(await response.body()) as unknown as { results: DatabaseSyncResult[] };
    const result = decoded.results[0];

    if (decoded.results.length !== 1 || result.objectId !== databaseId || result.collabType !== 1) {
      throw new Error('Fixture database sync returned a different object');
    }

    if (result.error === 'retry_later') {
      if (attempt < ATTEMPTS) await pause(attempt);
      continue;
    }

    if (result.error) throw new Error(`Fixture database sync failed: ${result.error}`);
    if (result.compression !== 0) throw new Error('Fixture database sync returned unexpected compression');
    if (update.length && !result.messageId) throw new Error('Fixture database sync has no durable acknowledgement');
    return result;
  }

  throw new Error('Fixture database sync remained busy');
}

export interface FixtureField {
  name: string;
  type: number;
  typeOptionData: Record<string, unknown>;
}

/** Seed fields with the same CRDT mutation used by clients, then verify an independent server read. */
export async function createFixtureFields(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  specs: FixtureField[]
): Promise<Record<string, string>> {
  if (!specs.length) return {};
  const initial = await syncFixtureDatabase(request, token, workspaceId, databaseId);
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, initial.missingUpdate);
    const database = doc.getMap('data').get('database') as YDatabase | undefined;

    if (database?.get(YjsDatabaseKey.id) !== databaseId || doc.store.pendingStructs || doc.store.pendingDs) {
      throw new Error('Fixture database source is incomplete');
    }

    const before = Y.encodeStateVector(doc);
    const fieldIds: Record<string, string> = {};
    const timestamp = String(Math.floor(Date.now() / 1000));

    doc.transact(() => {
      for (const spec of specs) {
        const id = uuidv4();
        const field = new Y.Map<unknown>() as YDatabaseField;
        const options = new Y.Map();

        fieldIds[spec.name] = id;
        field.set(YjsDatabaseKey.id, id);
        field.set(YjsDatabaseKey.name, spec.name);
        field.set(YjsDatabaseKey.type, spec.type);
        field.set(YjsDatabaseKey.is_primary, false);
        field.set(YjsDatabaseKey.icon, '');
        field.set(YjsDatabaseKey.created_at, timestamp);
        field.set(YjsDatabaseKey.last_modified, timestamp);
        options.set(String(spec.type), new Y.Map(Object.entries(spec.typeOptionData)));
        field.set(YjsDatabaseKey.type_option, options);
        database.get(YjsDatabaseKey.fields).set(id, field);
        database.get(YjsDatabaseKey.views).forEach((view) => {
          view.get(YjsDatabaseKey.field_orders).push([{ id }]);
          const setting = new Y.Map<unknown>() as YDatabaseFieldSetting;

          setting.set(YjsDatabaseKey.visibility, 0);
          setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
          view.get(YjsDatabaseKey.field_settings).set(id, setting);
        });
      }
    });
    await syncFixtureDatabase(request, token, workspaceId, databaseId, Y.encodeStateAsUpdate(doc, before), initial.collabVersion);
    await expect.poll(async () => {
      const fields = await apiGet<{ id: string; name: string }[]>(request, token,
        `/api/workspace/${workspaceId}/database/${databaseId}/fields`);

      return specs.every(({ name }) => fields.some((field) => field.id === fieldIds[name] && field.name === name));
    }, { timeout: TIMEOUT_MS, message: 'seeded fields must be readable before creating rows' }).toBe(true);
    return fieldIds;
  } finally {
    doc.destroy();
  }
}

/** Atomic view creation can safely repeat its immutable command on explicit RetryLater. */
export async function createFixtureView(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  command: CreateDefaultDatabaseViewRequest
): Promise<AtomicCreationReceipt<'database-view'>['result']> {
  const payload = JSON.stringify(command);
  const deadline = Date.now() + TIMEOUT_MS;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (Date.now() >= deadline) break;
    const response = await request.post(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/v2/page-view/database-view/default`, {
      headers: apiHeaders(token), data: payload, timeout: Math.max(1, deadline - Date.now()), failOnStatusCode: false,
    });
    const body = await response.json();

    if (!response.ok()) throw new Error(`Fixture view creation failed: HTTP ${response.status()}`);
    if (body.code === -5 || body.code === 1079) {
      if (attempt < ATTEMPTS) await pause(attempt);
      continue;
    }

    if (body.code !== 0) throw new Error(`Fixture view creation failed: ${body.code} ${body.message}`);
    const receipt = body.data as AtomicCreationReceipt<'database-view'>;

    if (receipt.request_id !== command.request_id || receipt.result.view_id !== command.view.view_id ||
      receipt.result.database_id !== command.view.database_id) throw new Error('Fixture view creation returned a different identity');
    return receipt.result;
  }

  throw new Error('Fixture view creation remained busy');
}
