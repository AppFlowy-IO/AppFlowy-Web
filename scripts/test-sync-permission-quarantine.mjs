// CHROMIUM_PATH=/snap/bin/chromium node scripts/test-sync-permission-quarantine.mjs
// Uses a fresh browser context and real IndexedDB; no backend or authenticated
// application is started. This tests the production storage/orchestration, not
// server authorization or connected editor acceptance.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import * as Y from 'yjs';

const seedDoc = new Y.Doc();

seedDoc.getMap('draft').set('body', 'unsent user changes');
const payload = Array.from(Y.encodeStateAsUpdate(seedDoc));

seedDoc.destroy();
const scratch = await mkdtemp(join(tmpdir(), 'appflowy-permission-component-'));
const server = await createServer({ configFile: false, cacheDir: scratch,
  resolve: { alias: { '@': `${process.cwd()}/src`, src: `${process.cwd()}/src` } },
  optimizeDeps: { entries: [], include: ['dexie', 'yjs', 'y-indexeddb', 'uuid'] },
  server: { host: '127.0.0.1', port: 0, watch: null },
});

await server.listen();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext();
const page = await context.newPage();
const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');

try {
  // Route the fixture assets through Node so confined system Chromium builds
  // need no direct loopback-network permission. IndexedDB still runs in Chromium.
  await context.route(`${baseUrl}/**`, async (route) => {
    if (route.request().url().endsWith('/permission-component-harness')) {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Permission storage component</title>' });
      return;
    }

    const response = await fetch(route.request().url());

    await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || 'text/javascript',
      body: Buffer.from(await response.arrayBuffer()) });
  });
  const initialize = async (target = page) => {
    await target.goto(`${baseUrl}/permission-component-harness`);
    await target.evaluate(async (payload) => {
      const outbox = await import('/src/application/sync-outbox/index.ts');
      const { db } = await import('/src/application/db/index.ts');
      const scope = { serverUrl: 'https://component.invalid', userId: 'component-user', workspaceId: 'component-workspace' };
      const fixture = { outbox, db, scope, payload: new Uint8Array(payload), sends: [], allowed: false };

      window.fixture = fixture;
      outbox.setCurrentSession(scope);
      const config = { ...scope, isReady: () => true,
        send: (message) => fixture.sends.push(message),
        checkPermission: async () => fixture.allowed ? 'allowed' : 'denied',
      };

      fixture.config = config;
      outbox.configureDrain(config);
    }, payload);
  };

  await initialize();
  await page.evaluate(async () => {
    const f = window.fixture;

    await f.outbox.enqueueOutboxUpdate({ objectId: 'document', collabType: 0, payload: f.payload });
  });
  await page.waitForFunction(async () => (await window.fixture.db.sync_outbox.toArray())[0]?.permissionBlocked);
  assert.equal(await page.evaluate(() => window.fixture.sends.length), 0);
  const original = await page.evaluate(async () => Array.from((await window.fixture.db.sync_outbox.toArray())[0].payload));

  // Reload destroys every memory-only flag and request cache; IndexedDB survives.
  await initialize();
  await page.evaluate(async () => {
    const f = window.fixture;

    f.allowed = true;
    await f.outbox.resumePermissionBlockedSync();
    f.outbox.startDrainAll();
  });
  assert.equal(await page.evaluate(() => window.fixture.sends.length), 0);
  assert.deepEqual(await page.evaluate(async () => Array.from((await window.fixture.db.sync_outbox.toArray())[0].payload)), original);
  assert.equal(await page.evaluate(() => window.fixture.outbox.mayUploadCollab('document', 0, 'component-workspace')), false);
  await page.evaluate(() => window.fixture.outbox.retryPermissionBlockedSync());
  await page.waitForFunction(async () => await window.fixture.db.sync_outbox.count() === 0);
  assert.equal(await page.evaluate(() => window.fixture.sends.length), 1);

  // A denial before manifest reconstruction must survive reload as well.
  await page.evaluate(() => window.fixture.outbox.blockPermissionSync('manifest', 'component-workspace'));
  await initialize();
  await page.evaluate(async () => {
    const f = window.fixture;

    f.allowed = true;
    await f.outbox.enqueueOutboxUpdate({ objectId: 'manifest', collabType: 0, payload: f.payload }, { source: 'manifest' });
  });
  assert.equal(await page.evaluate(() => window.fixture.sends.length), 0);
  assert.equal(await page.evaluate(async () => (await window.fixture.db.sync_outbox.toArray())[0].permissionBlocked), true);
  await page.evaluate(() => {
    const f = window.fixture;

    f.outbox.configureDrain({ ...f.config, checkPermission: () => new Promise((resolve) => { f.resolvePermission = resolve; }) });
    f.retry = f.outbox.retryPermissionBlockedSync();
  });
  await page.waitForFunction(() => Boolean(window.fixture.resolvePermission));
  const sibling = await context.newPage();

  await initialize(sibling);
  await sibling.evaluate(() => window.fixture.outbox.blockPermissionSync('manifest', 'component-workspace'));
  await page.evaluate(async () => { window.fixture.resolvePermission('allowed'); await window.fixture.retry; });
  assert.equal(await page.evaluate(async () => (await window.fixture.db.sync_outbox.toArray())[0].permissionBlocked), true);
  assert.equal(await page.evaluate(() => window.fixture.sends.length), 0);
  await page.evaluate(async () => {
    const { db, openCollabDBWithProvider, openRowCollabDBWithProvider, closeCollabDB, collabIndexedDBExists,
      listCollabIndexedDBNames } = await import('/src/application/db/index.ts');
    const { setCollabStorageWorkspace, collabStorageKey } = await import('/src/application/db/collab-storage-scope.ts');
    const { publishDatabaseCacheEpoch, readDatabaseCacheEpoch } = await import('/src/application/db/database-storage-fence.ts');
    const verify = (condition, message) => { if (!condition) throw new Error(message); };
    const select = (serverUrl = 'https://origin-a.invalid', userId = 'actor-a', workspaceId = 'workspace-a') => {
      window.__APP_CONFIG__ = { APPFLOWY_BASE_URL: serverUrl };
      localStorage.setItem('token', JSON.stringify({ access_token: 'fixture', refresh_token: 'fixture',
        expires_at: 9999999999, user: { id: userId } }));
      setCollabStorageWorkspace({ serverUrl, userId, workspaceId });
    };

    // Real legacy bytes remain present, but are never attributed to a new session.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('legacy-document');

      request.onupgradeneeded = () => {
        request.result.createObjectStore('updates', { autoIncrement: true });
        request.result.createObjectStore('custom');
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('updates', 'readwrite');

        transaction.objectStore('updates').add(window.fixture.payload);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    await db.collab_snapshots.put({ objectId: 'row', update: window.fixture.payload,
      stateVector: new Uint8Array(), updatedAt: 1, byteLength: window.fixture.payload.byteLength });
    select();
    verify(!(await collabIndexedDBExists('legacy-document')), 'unscoped legacy database must not be adopted');
    const first = await openCollabDBWithProvider('document');
    const firstRow = await openRowCollabDBWithProvider('row');

    verify(firstRow.doc.getMap('draft').size === 0, 'unknown-origin shared rows must not be adopted');
    first.doc.getMap('draft').set('body', 'actor-a retained local edit');
    firstRow.doc.getMap('draft').set('body', 'actor-a retained row edit');
    // Switch while providers remain open: retirement must flush prior writes.
    publishDatabaseCacheEpoch('database', 'restore-a');
    const firstKey = collabStorageKey('document');

    for (const [serverUrl, userId, workspaceId] of [
      ['https://origin-b.invalid', 'actor-a', 'workspace-a'],
      ['https://origin-a.invalid', 'actor-b', 'workspace-a'],
      ['https://origin-a.invalid', 'actor-a', 'workspace-b'],
    ]) {
      select(serverUrl, userId, workspaceId);
      const doc = await openCollabDBWithProvider('document');
      const row = await openRowCollabDBWithProvider('row');

      verify(doc.doc.guid === 'document' && row.doc.guid === 'row', 'wire identity must stay canonical');
      verify(doc.doc.getMap('draft').size === 0 && row.doc.getMap('draft').size === 0, 'another context observed local content');
      verify(readDatabaseCacheEpoch('database') === null, 'another context observed restore authority');
      verify(collabStorageKey('document') !== firstKey, 'storage identities collided');
    }

    select();
    const recovered = await openCollabDBWithProvider('document');
    const recoveredRow = await openRowCollabDBWithProvider('row');

    verify(recovered.doc.getMap('draft').get('body') === 'actor-a retained local edit', 'original document edit lost');
    verify(recoveredRow.doc.getMap('draft').get('body') === 'actor-a retained row edit', 'original row edit lost');
    verify((await listCollabIndexedDBNames()).has('document'), 'scoped enumeration lost canonical identity');
    verify((await indexedDB.databases()).some(({ name }) => name === 'legacy-document'), 'legacy database was deleted');
    verify(Boolean(await db.collab_snapshots.get('row')), 'legacy shared row was deleted');
    await closeCollabDB('document');
    await closeCollabDB('row');
    // Exercise the actual realtime handler with the real storage adapter:
    // closing/destroying a revoked document must not purge its pending edits.
    const { initSync, handleMessage } = await import('/src/application/services/js-services/sync-protocol.ts');
    const session = { serverUrl: 'https://origin-a.invalid', userId: 'actor-a', workspaceId: 'workspace-a' };

    window.fixture.outbox.setCurrentSession(session);
    window.fixture.outbox.configureDrain({ ...session, isReady: () => false,
      send: () => { throw new Error('Unexpected revoked send'); }, checkPermission: async () => 'allowed' });
    const socketDoc = await openCollabDBWithProvider('socket-revoked');
    const sync = { doc: socketDoc.doc, collabType: 0, emit: () => undefined };

    let revokedConsumerDestroyed = false;

    socketDoc.doc.on('destroy', () => { revokedConsumerDestroyed = true; });
    initSync(sync);
    socketDoc.doc.getMap('draft').set('body', 'socket revocation retains local work');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await db.sync_outbox.toArray()).some((row) => row.objectId === 'socket-revoked')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    handleMessage(sync, { objectId: 'socket-revoked', accessChanged: { canRead: false, canWrite: false } });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await db.sync_outbox.toArray()).some((row) => row.objectId === 'socket-revoked' && row.permissionBlocked)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const retained = (await db.sync_outbox.toArray()).find((row) => row.objectId === 'socket-revoked');

    verify(retained?.permissionBlocked && retained.payload.byteLength > 0, 'socket revoke discarded unsent local work');
    verify(await collabIndexedDBExists('socket-revoked'), 'socket revoke deleted saved collaboration data');
    verify(revokedConsumerDestroyed, 'socket revoke left its protected consumer live');
    const beforeSignOut = await db.sync_outbox.toArray();
    const { invalidToken } = await import('/src/application/session/token.ts');

    invalidToken();
    const afterSignOut = await db.sync_outbox.toArray();

    verify(afterSignOut.length === beforeSignOut.length, 'sign-out erased retained edits');
    verify(localStorage.getItem('token') === null, 'sign-out failed to clear authentication');
  });
  console.log('PASS real Chromium IndexedDB: scoped document/row persistence, server/account/workspace isolation, canonical IDs, restore fences, retained legacy bytes, original-context recovery, socket-revocation retention, logout retention');
  console.log('PASS real Chromium IndexedDB: denial, reload, broad regrant, explicit retry, exact bytes, HTTP guard, manifest reconstruction, cross-tab denial fence');
} finally {
  await context.close();
  await browser.close();
  await server.close();
  await rm(scratch, { recursive: true, force: true });
}
