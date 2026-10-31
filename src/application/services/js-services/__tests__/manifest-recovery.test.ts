import { createHash } from 'crypto';
import * as Y from 'yjs';

import { deleteCollabDB } from '@/application/db';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import { Types, YDoc } from '@/application/types';
import { collab } from '@/proto/messages';

import { deleteSetDigest } from '../delete-set-digest';
import { confirmManifestSync, handleMessage, initSync, SyncContext } from '../sync-protocol';

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn(async () => undefined) }));
jest.mock('@/application/sync-outbox', () => ({
  enqueueOutboxUpdate: jest.fn(async () => true),
  deleteOutboxByObjectId: jest.fn(async () => undefined),
  shouldRouteUpdateThroughOutbox: () => false,
  waitForDrain: async () => true,
}));

const contexts: SyncContext[] = [];
const docs: YDoc[] = [];
const createDoc = (): YDoc => {
  const doc = new Y.Doc();

  docs.push(doc);
  return doc;
};
const fixture = () => {
  const doc = createDoc();
  const server = createDoc();
  const emit = jest.fn();
  const confirmed = jest.fn();
  const ready = jest.fn(() => true);

  doc.getText('title').insert(0, 'retained row');
  const ctx: SyncContext = { doc, collabType: Types.DatabaseRow, emit, onManifestSync: confirmed, canRetry: ready };

  contexts.push(ctx);
  initSync(ctx);
  emit.mockClear();
  const manifest = (peer = server): collab.ICollabMessage => ({
    objectId: doc.guid, collabType: Types.DatabaseRow,
    syncRequest: {
      stateVector: Y.encodeStateVector(peer),
      deleteSet: { digest: deleteSetDigest(peer) },
      version: doc.version,
      databaseRestoreId: doc.databaseRestoreId,
    },
  });
  const dropUpload = () => {
    handleMessage(ctx, manifest());
    expect(emit.mock.calls[0][0].collabMessage.update.payload.byteLength).toBeGreaterThan(2);
    expect(confirmed).not.toHaveBeenCalled();
    emit.mockClear();
  };

  return { doc, server, ctx, emit, confirmed, ready, manifest, dropUpload };
};

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => {
  contexts.splice(0).forEach((ctx) => ctx._cleanup?.());
  docs.splice(0).forEach((doc) => doc.destroy());
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('coalesces repeated missing-state responses and backs off even if retry manifests are lost', () => {
  const f = fixture();

  f.dropUpload();
  jest.advanceTimersByTime(30_000);
  f.dropUpload();
  jest.advanceTimersByTime(29_999);
  expect(f.emit).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(f.emit.mock.calls[0][0].collabMessage.syncRequest.stateVector).toEqual(Y.encodeStateVector(f.doc));
  // Repeated server silence cannot cause an immediate loop or abandon recovery.
  jest.advanceTimersByTime(15 * 60_000);
  expect(f.emit.mock.calls.length).toBeGreaterThan(2);
  expect(f.emit.mock.calls.length).toBeLessThanOrEqual(5);
  expect(f.confirmed).not.toHaveBeenCalled();
});

test('does not fill the offline queue, then retries retained work when transport becomes ready', () => {
  const f = fixture();

  f.dropUpload();
  f.ready.mockReturnValue(false);
  jest.advanceTimersByTime(10 * 60_000);
  expect(f.emit).not.toHaveBeenCalled();
  f.ready.mockReturnValue(true);
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
});

test('pauses on write denial and wakes once when write access returns', () => {
  const f = fixture();
  const access = (canWrite: boolean) => handleMessage(f.ctx, {
    objectId: f.doc.guid, accessChanged: { canRead: true, canWrite },
  });

  f.dropUpload();
  access(false);
  handleMessage(f.ctx, f.manifest());
  jest.advanceTimersByTime(10 * 60_000);
  expect(f.emit).not.toHaveBeenCalled();
  access(true);
  expect(f.emit).toHaveBeenCalledTimes(1);
  access(true);
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(f.confirmed).not.toHaveBeenCalled();
});

test.each(['cleanup', 'destroy', 'revoke'] as const)('cancels retries and stale handlers on %s', (action) => {
  const f = fixture();

  f.dropUpload();
  if (action === 'cleanup') f.ctx._cleanup?.();
  if (action === 'destroy') f.doc.destroy();
  if (action === 'revoke') {
    // Even an inconsistent canWrite=true must not wake a revoked document.
    handleMessage(f.ctx, { objectId: f.doc.guid, accessChanged: { canRead: false, canWrite: true } });
    expect(deleteCollabDB).toHaveBeenCalledWith(f.doc.guid, { destroyDoc: false });
  }

  handleMessage(f.ctx, f.manifest());
  jest.advanceTimersByTime(20 * 60_000);
  expect(f.emit).not.toHaveBeenCalled();
  expect(enqueueOutboxUpdate).not.toHaveBeenCalled();
});

test('a peer with all the bytes cannot confirm server acceptance', () => {
  const f = fixture();

  f.dropUpload();
  handleMessage(f.ctx, f.manifest(f.doc), false);
  expect(f.confirmed).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
  confirmManifestSync(f.ctx, f.manifest(f.doc).syncRequest!);
  expect(f.confirmed).toHaveBeenCalledTimes(1);
  f.emit.mockClear();
  jest.advanceTimersByTime(20 * 60_000);
  expect(f.emit).not.toHaveBeenCalled();
});

test('coverage of an older local revision does not retire newer edits', () => {
  const f = fixture();

  f.dropUpload();
  Y.applyUpdate(f.server, Y.encodeStateAsUpdate(f.doc));
  const earlier = f.manifest();

  f.doc.getText('title').insert(0, 'new ');
  handleMessage(f.ctx, earlier);
  expect(f.confirmed).not.toHaveBeenCalled();
  f.emit.mockClear();
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
  Y.applyUpdate(f.server, Y.encodeStateAsUpdate(f.doc));
  handleMessage(f.ctx, f.manifest());
  expect(f.confirmed).toHaveBeenCalledTimes(1);
});

test('equal state vectors cannot hide a dropped deletion, and matching delete metadata stops retries', () => {
  const f = fixture();

  Y.applyUpdate(f.server, Y.encodeStateAsUpdate(f.doc));
  f.doc.getText('title').delete(0, 4);
  expect(Y.encodeStateVector(f.doc)).toEqual(Y.encodeStateVector(f.server));
  f.dropUpload();
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
  handleMessage(f.ctx, f.manifest());
  const update = f.emit.mock.calls.find(([message]) => message.collabMessage?.update)![0].collabMessage.update;

  Y.applyUpdate(f.server, update.payload);
  handleMessage(f.ctx, f.manifest());
  expect(f.server.getText('title').toString()).toBe(f.doc.getText('title').toString());
  expect(f.confirmed).toHaveBeenCalledTimes(1);
  f.emit.mockClear();
  jest.advanceTimersByTime(20 * 60_000);
  expect(f.emit).not.toHaveBeenCalled();
});

test('legacy manifests without delete metadata never falsely confirm deletion coverage', () => {
  const f = fixture();

  f.doc.getText('title').delete(0, 4);
  f.dropUpload();
  Y.applyUpdate(f.server, Y.encodeStateAsUpdate(f.doc));
  const legacy = f.manifest();

  delete legacy.syncRequest!.deleteSet;
  handleMessage(f.ctx, legacy);
  expect(f.confirmed).not.toHaveBeenCalled();
});

test('does not claim convergence while Yjs still has unresolved dependencies', () => {
  const f = fixture();
  const author = createDoc();
  const updates: Uint8Array[] = [];

  author.on('update', (update: Uint8Array) => updates.push(update));
  author.getText('other').insert(0, 'a');
  author.getText('other').insert(1, 'b');
  Y.applyUpdate(f.doc, updates[1]);
  expect(f.doc.store.pendingStructs).toBeTruthy();
  f.dropUpload();
  confirmManifestSync(f.ctx, f.manifest(f.doc).syncRequest!);
  expect(f.confirmed).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
  Y.applyUpdate(f.doc, updates[0]);
  expect(f.doc.store.pendingStructs).toBeFalsy();
  confirmManifestSync(f.ctx, f.manifest(f.doc).syncRequest!);
  expect(f.confirmed).toHaveBeenCalledTimes(1);
});

test.each(['version', 'databaseRestoreId'] as const)('rejects stale %s confirmation', (field) => {
  const f = fixture();

  f.doc[field] = '11111111-1111-4111-8111-111111111111';
  f.dropUpload();
  const stale = f.manifest(f.doc).syncRequest!;

  stale[field] = '22222222-2222-4222-8222-222222222222';
  confirmManifestSync(f.ctx, stale);
  expect(f.confirmed).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(f.emit).toHaveBeenCalledTimes(1);
  confirmManifestSync(f.ctx, f.manifest(f.doc).syncRequest!);
  expect(f.confirmed).toHaveBeenCalledTimes(1);
});

test('canonical deletion digest matches the server byte format and ignores client insertion order', () => {
  const first = createDoc();
  const second = createDoc();

  first.clientID = 1;
  first.getText('text').insert(0, 'abc');
  first.getText('text').delete(0, 1);
  first.getText('text').delete(0, 2); // adjacent ranges must coalesce to (0, 3)
  second.clientID = 9;
  second.getText('text').insert(0, 'xyz');
  second.getText('text').delete(2, 1);
  const left = createDoc();
  const right = createDoc();

  for (const doc of [first, second]) Y.applyUpdate(left, Y.encodeStateAsUpdate(doc));
  for (const doc of [second, first]) Y.applyUpdate(right, Y.encodeStateAsUpdate(doc));
  // Server format: u64le client count, sorted u64le client + u64le range-byte
  // length + v1 range count/clock/length. Independent of Yjs encoding order.
  const serverBytes = Buffer.from(
    '0200000000000000' + '01000000000000000300000000000000010003' +
    '09000000000000000300000000000000010201', 'hex'
  );
  const expected = new Uint8Array(createHash('sha256').update(serverBytes).digest());

  expect(deleteSetDigest(left)).toEqual(expected);
  expect(deleteSetDigest(right)).toEqual(expected);
  expect(deleteSetDigest(createDoc())).toEqual(new Uint8Array(createHash('sha256').update(Buffer.alloc(8)).digest()));
});

test('generated protobuf preserves server delete-set and restore fields and accepts legacy manifests', () => {
  const f = fixture();
  const request = f.manifest().syncRequest!;

  request.databaseRestoreId = '11111111-1111-4111-8111-111111111111';
  const decoded = collab.SyncRequest.decode(collab.SyncRequest.encode(request).finish());

  expect(Array.from(decoded.deleteSet!.digest!)).toEqual(Array.from(request.deleteSet!.digest!));
  expect(decoded.databaseRestoreId).toBe(request.databaseRestoreId);
  // Field 2 (bytes state_vector), length 1, empty Yjs vector; legacy wire fixture.
  const legacy = collab.SyncRequest.decode(Uint8Array.of(0x12, 0x01, 0x00));

  expect(Array.from(legacy.stateVector)).toEqual([0]);
  expect(legacy.deleteSet).toBeNull();
});
