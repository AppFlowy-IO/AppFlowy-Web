/** @jest-environment node */
import * as Y from 'yjs';

import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { collabFullSyncBatch, CollabFullSyncBatchResult } from '@/application/services/js-services/http/collab-api';
import { Types } from '@/application/types';

import { ensureDurableRowSource } from '../durable-row-source';

jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));

const identity = { databaseId: 'database', sourceViewId: 'view', rowId: 'row', rowVersion: 'version' };

function fixture(encoding = 0) {
  const row = new Y.Doc({ guid: identity.rowId });

  row.getMap('data').set(
    'data',
    new Y.Map([
      ['id', identity.rowId],
      ['database_id', identity.databaseId],
    ])
  );
  row.getMap('data').set('meta', new Y.Map([['document-empty', true]]));
  const source = {
    object_id: identity.rowId,
    collab_version: identity.rowVersion,
    version: encoding,
    doc_state: Array.from(encoding === 0 ? Y.encodeStateAsUpdate(row) : Y.encodeStateAsUpdateV2(row)),
  };
  const expected = row.toJSON();

  row.destroy();
  const controller = new AbortController();
  const owner: AtomicCreationOwner = {
    serverUrl: 'server',
    userId: 'user',
    workspaceId: 'workspace',
    assertCurrent: jest.fn(),
  };
  const result: CollabFullSyncBatchResult = {
    objectId: identity.rowId,
    collabType: Types.DatabaseRow,
    collabVersion: identity.rowVersion,
    missingUpdate: new Uint8Array([0, 0]),
    serverStateVector: new Uint8Array([0]),
  };
  const options = { owner, restoreId: 'restore', signal: controller.signal, deadline: Date.now() + 30_000 };

  jest.mocked(collabFullSyncBatch).mockResolvedValue([result]);
  return { source, expected, controller, owner, result, options };
}

beforeEach(() => jest.resetAllMocks());

it.each([0, 1])(
  'synchronizes exactly the accepted Row with its version and restore marker (encoding %s)',
  async (encoding) => {
    const f = fixture(encoding);

    await ensureDurableRowSource(identity, f.source, f.options);
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
    const [workspaceId, items, options] = jest.mocked(collabFullSyncBatch).mock.calls[0];

    expect(workspaceId).toBe('workspace');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        objectId: 'row',
        collabType: Types.DatabaseRow,
        collabVersion: 'version',
        databaseRestoreId: 'restore',
      })
    );
    expect(options).toEqual(expect.objectContaining({ atomicCreationOwner: f.owner, signal: f.controller.signal }));
    expect(options!.timeoutMs).toBeGreaterThan(0);
    expect(options!.timeoutMs).toBeLessThanOrEqual(30_000);
    const sent = new Y.Doc();

    try {
      Y.applyUpdate(sent, items[0].docState);
      // materialize the shared root before comparing Y.Doc.toJSON()
      sent.getMap('data');
      expect(sent.toJSON()).toEqual(f.expected);
      expect(items[0].stateVector).toEqual(Y.encodeStateVector(sent));
    } finally {
      sent.destroy();
    }
  }
);

it.each(['source-object', 'source-version', 'row-id', 'parent', 'partial-history'])(
  'rejects %s mismatch before any send',
  async (kind) => {
    const f = fixture();

    if (kind === 'source-object') f.source.object_id = 'other';
    else if (kind === 'source-version') f.source.collab_version = 'other';
    else {
      const row = new Y.Doc();

      try {
        Y.applyUpdate(row, new Uint8Array(f.source.doc_state));
        const before = Y.encodeStateVector(row);
        const data = row.getMap('data').get('data') as Y.Map<string>;

        data.set(kind === 'parent' ? 'database_id' : 'id', 'other');
        f.source.doc_state = Array.from(Y.encodeStateAsUpdate(row, kind === 'partial-history' ? before : undefined));
      } finally {
        row.destroy();
      }
    }

    await expect(ensureDurableRowSource(identity, f.source, f.options)).rejects.toThrow();
    expect(collabFullSyncBatch).not.toHaveBeenCalled();
  }
);

it.each(['empty', 'duplicate', 'object', 'type', 'version', 'item-error'])(
  'does not accept %s response as a durable acknowledgment',
  async (kind) => {
    const f = fixture();
    const result = { ...f.result };

    if (kind === 'object') result.objectId = 'other';
    if (kind === 'type') result.collabType = Types.Database;
    if (kind === 'version') result.collabVersion = 'other';
    if (kind === 'item-error') result.error = 'Permission denied';
    jest
      .mocked(collabFullSyncBatch)
      .mockResolvedValue(kind === 'empty' ? [] : kind === 'duplicate' ? [result, result] : [result]);
    await expect(ensureDurableRowSource(identity, f.source, f.options)).rejects.toThrow();
  }
);

it.each(['owner', 'abort', 'deadline'])('rejects %s changes while the normal sync request is held', async (kind) => {
  const f = fixture();
  let finish!: (results: CollabFullSyncBatchResult[]) => void;

  jest.mocked(collabFullSyncBatch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = ensureDurableRowSource(identity, f.source, f.options);

  expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
  if (kind === 'owner')
    jest.mocked(f.owner.assertCurrent).mockImplementation(() => {
      throw new Error('Owner changed');
    });
  if (kind === 'abort') f.controller.abort(new Error('Cancelled'));
  if (kind === 'deadline') f.options.deadline = Date.now() - 1;
  finish([f.result]);
  await expect(pending).rejects.toThrow();
});

it('keeps legacy unversioned Rows unversioned while still sending the restore marker', async () => {
  const f = fixture();
  const unversioned = { ...identity, rowVersion: undefined };

  jest.mocked(collabFullSyncBatch).mockResolvedValue([{ ...f.result, collabVersion: undefined }]);
  await ensureDurableRowSource(unversioned, { ...f.source, collab_version: null }, f.options);
  expect(jest.mocked(collabFullSyncBatch).mock.calls[0][1][0].collabVersion).toBeUndefined();
});
