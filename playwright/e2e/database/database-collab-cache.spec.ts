/**
 * Database Collab Cache Identity
 *
 * BDD regression coverage for the databaseId/viewId IndexedDB cache split:
 * - embedded database blocks should load through the canonical databaseId cache;
 * - legacy viewId IndexedDB updates should be merged into that canonical cache;
 * - sibling database views should resolve to the same database collab object.
 */
import { expect, Page, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { getSlashMenuItemName } from '../../support/i18n-constants';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import {
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  SlashCommandSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  getCurrentDatabaseInfo,
  seedPrimaryRows,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';

type ActiveDatabaseIdentity = {
  databaseId: string;
  docGuid: string;
  rowOrderIds: string[];
  viewId: string;
};

type DatabaseBlockState = {
  databaseId: string | null;
  viewIds: string[];
};

const ignoredPageErrors = [
  'Minified React error',
  'View not found',
  'No workspace or service found',
  'ResizeObserver loop',
  'Failed to fetch',
  'NetworkError',
];

function ignoreKnownPageErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (ignoredPageErrors.some((message) => err.message.includes(message))) {
      return;
    }
  });
}

async function getActiveDatabaseIdentity(page: Page): Promise<ActiveDatabaseIdentity> {
  await waitForDatabaseTestContext(page);

  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const view = database?.get('views')?.get(ctx.activeViewId);
    const rowOrders = view?.get('row_orders')?.toJSON?.() ?? [];

    return {
      databaseId: database?.get('id') || doc.guid,
      docGuid: doc.guid,
      rowOrderIds: rowOrders.map((row: { id: string }) => row.id),
      viewId: ctx.activeViewId,
    };
  });
}

async function getDatabaseBlockState(page: Page, docViewId: string): Promise<DatabaseBlockState[]> {
  return page.evaluate((currentDocViewId) => {
    const testWindow = window as Window & {
      __TEST_EDITORS__?: Record<
        string,
        {
          children?: Array<{
            type?: string;
            data?: {
              database_id?: string;
              view_id?: string;
              view_ids?: string[];
            };
          }>;
        }
      >;
    };
    const editor = testWindow.__TEST_EDITORS__?.[currentDocViewId];

    return (editor?.children ?? [])
      .filter((node) => node?.type === 'grid')
      .map((node) => ({
        databaseId: node.data?.database_id ?? null,
        viewIds: Array.isArray(node.data?.view_ids)
          ? node.data.view_ids
          : node.data?.view_id
          ? [node.data.view_id]
          : [],
      }));
  }, docViewId);
}

async function waitForEmbeddedDatabaseBlockIdentity(page: Page, docViewId: string) {
  let blockState: DatabaseBlockState | null = null;

  await expect
    .poll(
      async () => {
        const blocks = await getDatabaseBlockState(page, docViewId);

        blockState = blocks[0] ?? null;
        return Boolean(blockState?.databaseId && blockState.viewIds.length > 0);
      },
      { timeout: 15000, message: 'Waiting for embedded database block view_ids and database_id' }
    )
    .toBe(true);

  return blockState as DatabaseBlockState;
}

async function closeViewModalIfOpen(page: Page) {
  const dialog = page.locator('[role="dialog"]').last();

  if (!(await dialog.isVisible().catch(() => false))) {
    return;
  }

  await page.keyboard.press('Escape');

  if (await dialog.isVisible().catch(() => false)) {
    await page.mouse.click(10, 10);
  }

  await expect(dialog).toBeHidden({ timeout: 10000 });
}

async function insertEmbeddedGridDatabase(page: Page, docViewId: string) {
  const editor = page.locator(`#editor-${docViewId}`);

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await editor.pressSequentially('/', { delay: 50 });

  const slashPanel = SlashCommandSelectors.slashPanel(page);

  await expect(slashPanel).toBeVisible({ timeout: 10000 });
  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });
  await waitForDatabaseTestContext(page);
  await closeViewModalIfOpen(page);

  const embeddedGrid = editor.locator('[data-testid="database-grid"]').first();

  await expect(embeddedGrid).toBeVisible({ timeout: 30000 });
  await waitForDatabaseTestContext(page);
  await waitForEmbeddedDatabaseBlockIdentity(page, docViewId);
}

async function appendLegacyViewIdCacheRows(page: Page, rowIds: string[]) {
  return page.evaluate(async (ids) => {
    const win = window as any;
    const Y = win.Y;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const sourceDoc = ctx.databaseDoc;
    const viewId = ctx.activeViewId;
    const sourceDatabase = sourceDoc.getMap('data').get('database');
    const databaseId = sourceDatabase?.get('id') || sourceDoc.guid;
    const legacyDoc = new Y.Doc({ guid: viewId });

    function openYjsDatabase(name: string, version?: number): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = typeof version === 'number' ? indexedDB.open(name, version) : indexedDB.open(name);

        request.onupgradeneeded = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains('updates')) {
            db.createObjectStore('updates', { autoIncrement: true });
          }

          if (!db.objectStoreNames.contains('custom')) {
            db.createObjectStore('custom');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Opening IndexedDB ${name} was blocked`));
      });
    }

    async function ensureYjsDatabase(name: string): Promise<IDBDatabase> {
      let db = await openYjsDatabase(name);

      if (db.objectStoreNames.contains('updates') && db.objectStoreNames.contains('custom')) {
        return db;
      }

      const nextVersion = db.version + 1;

      db.close();
      db = await openYjsDatabase(name, nextVersion);
      return db;
    }

    async function appendUpdate(name: string, update: Uint8Array): Promise<void> {
      const db = await ensureYjsDatabase(name);

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('updates', 'readwrite');

        tx.objectStore('updates').add(update);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }

    Y.applyUpdate(legacyDoc, Y.encodeStateAsUpdate(sourceDoc));

    const legacyDatabase = legacyDoc.getMap('data').get('database');
    const legacyView = legacyDatabase?.get('views')?.get(viewId);
    const rowOrders = legacyView?.get('row_orders');

    if (!rowOrders) {
      throw new Error('Cannot write legacy cache rows: row_orders was not found');
    }

    legacyDoc.transact(() => {
      ids.forEach((id) => rowOrders.push([{ id, height: 36 }]));
    });

    await appendUpdate(viewId, Y.encodeStateAsUpdate(legacyDoc));
    legacyDoc.destroy();

    return {
      databaseId,
      rowOrderCount: rowOrders.length,
      viewId,
    };
  }, rowIds);
}

async function expectActiveRowsToContain(page: Page, rowIds: string[]) {
  await expect
    .poll(
      () =>
        page.evaluate((expectedRowIds) => {
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
          const doc = ctx?.databaseDoc;
          const database = doc?.getMap('data').get('database');
          const view = database?.get('views')?.get(ctx.activeViewId);
          const rowOrders = view?.get('row_orders')?.toJSON?.() ?? [];
          const actualIds = rowOrders.map((row: { id: string }) => row.id);

          return expectedRowIds.every((rowId) => actualIds.includes(rowId));
        }, rowIds),
      { timeout: 30000, message: 'Waiting for legacy row orders to appear in canonical database doc' }
    )
    .toBe(true);
}

async function readYjsUpdateCount(page: Page, dbName: string): Promise<number> {
  return page.evaluate(async (name) => {
    function openDatabase(): Promise<IDBDatabase | null> {
      return new Promise((resolve) => {
        const request = indexedDB.open(name);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }

    const databases = await indexedDB.databases?.();

    if (databases && !databases.some((db) => db.name === name)) {
      return 0;
    }

    const db = await openDatabase();

    if (!db) {
      return 0;
    }

    if (!db.objectStoreNames.contains('updates')) {
      db.close();
      return 0;
    }

    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction('updates', 'readonly');
      const request = tx.objectStore('updates').count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    });

    db.close();
    return count;
  }, dbName);
}

async function expectYjsCacheToExist(page: Page, dbName: string) {
  await expect
    .poll(() => readYjsUpdateCount(page, dbName), {
      timeout: 15000,
      message: `Waiting for IndexedDB Yjs cache ${dbName}`,
    })
    .toBeGreaterThan(0);
}

async function addViewToDatabase(page: Page, viewType: 'Board' | 'Calendar' | 'Grid') {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });

  const menu = page.locator('[data-slot="dropdown-menu-content"]');

  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('[role="menuitem"]').filter({ hasText: viewType }).click({ force: true });
}

async function switchToDatabaseView(page: Page, viewType: string) {
  await DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType }).click({ force: true });
  await waitForDatabaseTestContext(page);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Feature: Database Collab IndexedDB Cache Identity', () => {
  test.beforeEach(async ({ page }) => {
    ignoreKnownPageErrors(page);
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('Scenario: embedded database reload merges legacy viewId cache into the canonical databaseId cache', async ({
    page,
    request,
  }) => {
    // Given: a signed-in user has a document with an embedded grid database.
    await signInAndWaitForApp(page, request, generateRandomEmail());
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    const docViewId = await createDocumentPageAndNavigate(page);

    await insertEmbeddedGridDatabase(page, docViewId);

    const beforeLegacyWrite = await getActiveDatabaseIdentity(page);

    expect(beforeLegacyWrite.databaseId).not.toBe('');
    expect(beforeLegacyWrite.viewId).not.toBe('');
    expect(beforeLegacyWrite.docGuid).toBe(beforeLegacyWrite.databaseId);
    await expectYjsCacheToExist(page, beforeLegacyWrite.databaseId);

    // And: an older client has written local-only row order updates into the legacy viewId cache.
    const legacyRowIds = Array.from({ length: 8 }, () => uuidv4());
    const legacyWrite = await appendLegacyViewIdCacheRows(page, legacyRowIds);

    expect(legacyWrite.databaseId).toBe(beforeLegacyWrite.databaseId);
    expect(legacyWrite.viewId).toBe(beforeLegacyWrite.viewId);

    let staleDatabaseFetchCount = 0;

    // If the canonical cache migration works, reopening the embedded block should not need
    // a stale page-view fetch for the database view.
    const databaseViewIdPattern = escapeRegExp(beforeLegacyWrite.viewId);

    await page.route(new RegExp(`/api/workspace/[^/]+/page-view/${databaseViewIdPattern}(?:\\?|$)`), async (route) => {
      staleDatabaseFetchCount += 1;
      await route.continue();
    });

    // When: the user reopens the document page containing the embedded database.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(`#editor-${docViewId}`)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(`#editor-${docViewId} [data-testid="database-grid"]`).first()).toBeVisible({
      timeout: 30000,
    });
    await waitForDatabaseTestContext(page);

    const afterReload = await getActiveDatabaseIdentity(page);
    const blockAfterReload = await waitForEmbeddedDatabaseBlockIdentity(page, docViewId);

    // Then: the embedded database is still attached to the canonical databaseId cache.
    expect(blockAfterReload.databaseId).toBe(beforeLegacyWrite.databaseId);
    expect(blockAfterReload.viewIds).toContain(beforeLegacyWrite.viewId);
    expect(afterReload.databaseId).toBe(beforeLegacyWrite.databaseId);
    expect(afterReload.viewId).toBe(beforeLegacyWrite.viewId);
    expect(afterReload.docGuid).toBe(beforeLegacyWrite.databaseId);

    // And: the local-only legacy row orders have been merged instead of being replaced by server state.
    await expectActiveRowsToContain(page, legacyRowIds);
    expect(staleDatabaseFetchCount).toBe(0);
  });

  test('Scenario: sibling database views resolve to the same canonical databaseId cache', async ({
    page,
    request,
  }) => {
    // Given: a signed-in user has a grid database with persisted rows.
    await signInAndWaitForApp(page, request, generateRandomEmail());
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await createDatabaseView(page, 'Grid', 7000);
    await waitForGridReady(page);
    await seedPrimaryRows(page, ['cache-grid-row-a', 'cache-grid-row-b']);

    const gridInfo = await getCurrentDatabaseInfo(page);
    const gridIdentity = await getActiveDatabaseIdentity(page);

    expect(gridIdentity.docGuid).toBe(gridInfo.databaseId);

    // When: the user adds and opens another view of the same database.
    await addViewToDatabase(page, 'Board');
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board', { timeout: 30000 });
    await waitForDatabaseTestContext(page);

    const boardInfo = await getCurrentDatabaseInfo(page);
    const boardIdentity = await getActiveDatabaseIdentity(page);

    // Then: both views use the same database collab object and cache key.
    expect(boardInfo.databaseId).toBe(gridInfo.databaseId);
    expect(boardInfo.viewId).not.toBe(gridInfo.viewId);
    expect(boardIdentity.databaseId).toBe(gridInfo.databaseId);
    expect(boardIdentity.docGuid).toBe(gridInfo.databaseId);

    // When: switching back to the grid view after another view has been opened.
    await switchToDatabaseView(page, 'Grid');
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await expect(DatabaseGridSelectors.grid(page)).toContainText('cache-grid-row-a', { timeout: 20000 });
    await expect(DatabaseGridSelectors.grid(page)).toContainText('cache-grid-row-b', { timeout: 20000 });

    const gridAfterSwitch = await getActiveDatabaseIdentity(page);

    // Then: the grid view is still backed by the same canonical databaseId cache.
    expect(gridAfterSwitch.databaseId).toBe(gridInfo.databaseId);
    expect(gridAfterSwitch.docGuid).toBe(gridInfo.databaseId);
  });
});
