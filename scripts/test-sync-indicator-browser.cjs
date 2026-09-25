// Uses production outbox/receipt modules and real Chromium IndexedDB in an isolated browser context.
// The transport is controlled here; server persistence is tested by the Worker SQLx suite.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('vite'))('esbuild');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:31999';

async function main() {
  const bundle = await build({
    stdin: {
      contents: `
        import Dexie from 'dexie';
        import * as Y from 'yjs';
        import { db } from '@/application/db';
        import { syncOutboxSchema } from '@/application/db/tables/sync_outbox';
        import * as outbox from '@/application/sync-outbox';
        import * as receipts from '@/application/sync-outbox/receipts';
        import * as status from '@/application/sync-status/store';
        import { collab } from '@/proto/messages';
        const objectId = '11111111-1111-4111-8111-111111111111';
        const session = { userId: 'receipt-browser-user', workspaceId: 'receipt-browser-workspace' };
        const sent = [];
        const doc = new Y.Doc({ guid: objectId });
        window.receiptTest = { Dexie, db, syncOutboxSchema, outbox, receipts, status, sent, objectId, session,
          async start(send = true) {
            outbox.setCurrentSession(session);
            outbox.configureDrain({ ...session, trackReceipts: true, isReady: () => send,
              send: (message) => sent.push(message) });
            status.setSyncConnected(true);
            status.markSyncReady(objectId);
            outbox.startDrainAll();
          },
          async edit(value) {
            doc.getMap('root').set('value', value);
            return outbox.enqueueOutboxUpdate({ objectId, collabType: 0, payload: Y.encodeStateAsUpdate(doc) });
          },
          receipt(stage, syncIds, counter) {
            return receipts.receiveSyncReceipt(session.workspaceId, { objectId, syncReceipt: {
              stage: collab.SyncReceipt.Stage[stage], syncIds, messageIds: [{ timestamp: 42, counter }] } });
          },
          currentStatus: () => status.getSyncStatus(objectId),
        };
      `,
      resolveDir: root,
      loader: 'ts',
    },
    absWorkingDir: root,
    tsconfig: path.join(root, 'tsconfig.json'),
    bundle: true,
    format: 'iife',
    write: false,
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED': '"false"',
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route(`${origin}/**`, (route) => {
      const script = route.request().url().endsWith('/harness.js');
      return route.fulfill({
        contentType: script ? 'application/javascript' : 'text/html',
        body: script ? bundle.outputFiles[0].text : '<!doctype html><script src="/harness.js"></script>',
      });
    });
    const open = async () => {
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => !!window.receiptTest);
      return page;
    };
    const statusIs = (page, expected) =>
      page.waitForFunction((value) => window.receiptTest.currentStatus() === value, expected);
    const first = await open();

    // Upgrade a previous outbox without losing pending edits or their existing stable identity.
    await first.evaluate(async () => {
      const h = window.receiptTest;
      const previous = new h.Dexie(h.db.name);
      previous.version(12).stores(h.syncOutboxSchema);
      await previous.table('sync_outbox').add({
        ...h.session,
        objectId: h.objectId,
        collabType: 0,
        syncId: 'upgrade-pending',
        payload: new Uint8Array([0, 0]),
        createdAt: Date.now(),
      });
      previous.close();
      await h.start();
    });
    await first.waitForFunction(() => window.receiptTest.sent.length > 0);
    assert.equal(await first.evaluate(() => window.receiptTest.db.verno), 13);
    await first.evaluate(() => window.receiptTest.receipt('ACCEPTED', ['upgrade-pending'], 1));
    await statusIs(first, 'synced');
    assert.equal(await first.evaluate(() => window.receiptTest.db.sync_outbox.count()), 1);
    assert.equal(
      await first.evaluate(async () => (await window.receiptTest.db.sync_receipts.get('upgrade-pending')).savedAt),
      0
    );
    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 1));
    await statusIs(first, 'synced');
    console.log(
      'PASS: schema upgrade preserves edits, immediate acceptance shows synced, and saved evidence retires payloads'
    );

    await first.evaluate(() => window.receiptTest.edit('first edit'));
    await statusIs(first, 'syncing');
    const original = await first.evaluate(async () => (await window.receiptTest.db.sync_outbox.toArray())[0].syncId);
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 2), original);
    await statusIs(first, 'synced');
    assert.equal(await first.evaluate(() => window.receiptTest.db.sync_outbox.count()), 1);

    const second = await open();
    await second.evaluate(() => window.receiptTest.start(false));
    await statusIs(second, 'synced');
    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 2));
    await statusIs(first, 'synced');
    assert.equal(await second.evaluate(() => window.receiptTest.currentStatus()), 'synced');
    await second.evaluate(() => window.receiptTest.receipts.refreshSyncReceipts());
    await statusIs(second, 'synced');
    assert.equal(await second.evaluate(() => window.receiptTest.db.sync_outbox.count()), 0);
    console.log('PASS: a late/suspended tab recovers missed acceptance and saved notifications');

    await first.evaluate(() => window.receiptTest.edit('survive reload'));
    const retained = await first.evaluate(async () => (await window.receiptTest.db.sync_outbox.toArray())[0].syncId);
    await first.reload();
    await first.waitForFunction(() => !!window.receiptTest);
    await first.evaluate(() => window.receiptTest.start());
    await first.waitForFunction(() => window.receiptTest.sent.length > 0);
    const replayed = await first.evaluate(() =>
      window.receiptTest.sent.flatMap((message) => message.collabMessage.update?.syncIds ?? [])
    );
    assert(replayed.includes(retained));
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 3), retained);
    await first.evaluate(() => window.receiptTest.edit('newer edit'));
    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 3));
    await statusIs(first, 'syncing');
    const newer = await first.evaluate(async () => (await window.receiptTest.db.sync_outbox.toArray())[0].syncId);
    assert.notEqual(newer, retained);
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 4), newer);
    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 4));
    await statusIs(first, 'synced');
    console.log('PASS: reload resends stable identities and old receipts cannot retire newer edits');

    await first.evaluate(() => window.receiptTest.edit('missing proof'));
    const unproven = await first.evaluate(async () => (await window.receiptTest.db.sync_outbox.toArray())[0].syncId);
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 5), unproven);
    await first.evaluate(async () => {
      const h = window.receiptTest;
      await h.db.sync_outbox.clear();
      await h.receipts.refreshSyncReceipts();
    });
    assert.equal(await first.evaluate(() => window.receiptTest.currentStatus()), 'synced');
    assert.equal(
      await first.evaluate(async (id) => (await window.receiptTest.db.sync_receipts.get(id)).savedAt, unproven),
      0
    );
    await first.evaluate((id) => window.receiptTest.receipt('RETRY', [id], 5), unproven);
    await statusIs(first, 'syncing');
    console.log('PASS: missing IndexedDB payload is never interpreted as server persistence');

    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 5));
    await statusIs(first, 'synced');
    // Abort the production cleanup transaction through a real IndexedDB/Dexie hook.
    const rollback = await first.evaluate(async () => {
      const h = window.receiptTest;

      await h.edit('cleanup transaction failure');
      const pending = (await h.db.sync_outbox.toArray())[0];
      await h.receipt('ACCEPTED', [pending.syncId], 6);
      const failDelete = () => {
        throw new Error('deliberate cleanup failure');
      };

      h.db.sync_outbox.hook('deleting', failDelete);
      await h.receipt('SAVED', [], 6);
      const failed = { count: await h.db.sync_outbox.count(), status: h.currentStatus() };
      h.db.sync_outbox.hook('deleting').unsubscribe(failDelete);
      await h.receipts.refreshSyncReceipts();
      return { failed, recovered: { count: await h.db.sync_outbox.count(), status: h.currentStatus() } };
    });
    assert.deepEqual(rollback, { failed: { count: 1, status: 'synced' }, recovered: { count: 0, status: 'synced' } });
    console.log('PASS: actual cleanup rollback retains the edit and receipt recovery finishes it');

    await first.evaluate(() => window.receiptTest.edit('server requests repair'));
    const rejected = await first.evaluate(async () => (await window.receiptTest.db.sync_outbox.toArray())[0].syncId);
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 7), rejected);
    await statusIs(first, 'synced');
    await first.evaluate((id) => window.receiptTest.receipt('RETRY', [id], 7), rejected);
    await statusIs(first, 'syncing');
    await first.evaluate(() => window.receiptTest.receipts.refreshSyncReceipts());
    await statusIs(first, 'syncing');
    assert.equal(await first.evaluate(() => window.receiptTest.db.sync_outbox.count()), 1);
    await first.reload();
    await first.waitForFunction(() => !!window.receiptTest);
    await first.evaluate(() => window.receiptTest.start());
    await statusIs(first, 'syncing');
    await first.evaluate((id) => window.receiptTest.receipt('ACCEPTED', [id], 8), rejected);
    await statusIs(first, 'synced');
    assert.equal(await first.evaluate(() => window.receiptTest.db.sync_outbox.count()), 1);
    await first.evaluate(() => window.receiptTest.receipt('SAVED', [], 8));
    assert.equal(await first.evaluate(() => window.receiptTest.db.sync_outbox.count()), 0);
    console.log('PASS: rejection clears cached acceptance across reload and resync restores synced before snapshot');
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
