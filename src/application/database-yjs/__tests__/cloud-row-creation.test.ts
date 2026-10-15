import { toBase64 } from 'lib0/buffer';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { atomicRead } from '@/application/services/js-services/http/atomic-creation-api';
import {
  postDefaultRowCreation,
  postRowCreation,
} from '@/application/services/js-services/http/atomic-row-creation-api';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { createRow as openCachedRow } from '@/application/services/js-services/cache';
import { Types, YDatabaseCell, YDoc } from '@/application/types';

import { cloneDatabaseCell } from '../cell.clone';
import { FieldType } from '../database.type';
import { CloudRowCreationIntent, createCloudRow, prepareDefaultRowRequest } from '../creation/create-row';
import { decodeCreatedRowCollab, encodeCreationCollab } from '../creation/encoded-collab';
import type { CreateDatabaseRowRequest } from '../creation/row-template-graph-types';
import { CreatedRowReceipt, DefaultRowRequest } from '../creation/row-creation-types';
import { readPersistedDatabaseSource } from '../creation/source-readiness';
import { initialDatabaseRow } from '../row';

const mockAvailable = jest.fn();
const mockOwner = jest.fn();
jest.mock('@/application/atomic-creation/owner', () => ({
  captureAtomicCreationOwner: (workspaceId: string, guard: () => void) => ({
    workspaceId,
    assertCurrent: () => {
      mockOwner();
      guard();
    },
  }),
  assertAtomicCreationAvailable: (owner: { assertCurrent(): void }) => {
    mockAvailable();
    owner.assertCurrent();
  },
}));
jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async (databaseId: string) => ({ databaseId, epoch: null, cacheEpoch: null })),
  matchesDatabaseStorageFence: jest.fn(async () => true),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, apply: () => void) => {
    apply();
    return true;
  }),
}));
jest.mock('@/application/db/database-storage-fence', () => ({
  isDatabaseStorageFenceCurrent: () => true,
  withDatabaseStorageFence: (_doc: unknown, _fence: unknown, apply: () => void) => apply(),
}));
jest.mock('@/application/services/js-services/http/atomic-creation-api', () => ({ atomicRead: jest.fn() }));
jest.mock('@/application/services/js-services/http/atomic-row-creation-api', () => ({
  postDefaultRowCreation: jest.fn(),
  postRowCreation: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));
jest.mock('@/application/services/js-services/cache', () => ({ createRow: jest.fn() }));
jest.mock('../creation/source-readiness', () => ({
  ...jest.requireActual('../creation/source-readiness'),
  readPersistedDatabaseSource: jest.fn(),
}));

function fixture() {
  const databaseId = uuidv4();
  const sourceViewId = uuidv4();
  const rowId = uuidv4();
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  databaseDoc.getMap('data').set('database', database);
  database.set('id', databaseId);
  database.set('views', views);
  views.set(sourceViewId, view);
  view.set('id', sourceViewId);
  view.set('row_orders', new Y.Array());
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(databaseDoc));
  const rowDoc = new Y.Doc({ guid: rowId }) as YDoc;

  initialDatabaseRow(rowId, databaseId, rowDoc);
  const canonical = new Y.Doc({ guid: rowId }) as YDoc;
  const local = new Y.Doc({ guid: rowId }) as YDoc;
  const registerRow = jest.fn(async () => local);
  const assertCurrent = jest.fn();
  const intent: CloudRowCreationIntent = {
    databaseDoc,
    databaseId,
    sourceViewId,
    rowId,
    rowDoc,
    rowKey: `${databaseId}_rows_${rowId}`,
    workspaceId: uuidv4(),
    position: { kind: 'end' },
    registerRow,
    assertCurrent,
  };
  const snapshot = (doc: Y.Doc, id: string, type: Types) => ({
    objectId: id,
    collabType: type,
    missingUpdate: Y.encodeStateAsUpdate(doc),
    serverStateVector: Y.encodeStateVector(doc),
  });

  jest.mocked(openCachedRow).mockResolvedValue(local);
  jest.mocked(readPersistedDatabaseSource).mockImplementation(async () => Y.encodeStateAsUpdate(databaseDoc));
  jest.mocked(atomicRead).mockResolvedValue({ database_restore_id: null, version: null });
  jest
    .mocked(collabFullSyncBatch)
    .mockImplementation(async (_workspace, items) =>
      items.map((item) =>
        item.collabType === Types.Database
          ? snapshot(remote, databaseId, Types.Database)
          : snapshot(canonical, rowId, Types.DatabaseRow)
      )
    );
  const commit = (request: Pick<DefaultRowRequest, 'request_id' | 'database_restore_id'>): CreatedRowReceipt => {
    const vector = Y.encodeStateVector(remote);
    const target = (remote.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<Y.Array<{ id: string }>>>>)
      .get('views')!
      .get(sourceViewId)!
      .get('row_orders')!;

    target.push([{ id: rowId }]);
    Y.applyUpdate(canonical, Y.encodeStateAsUpdate(rowDoc));
    return {
      request_id: request.request_id,
      outcome: 'applied',
      result: {
        row_id: rowId,
        database_id: databaseId,
        database_restore_id: request.database_restore_id,
        database_version: null,
        database_update_v1: toBase64(Y.encodeStateAsUpdate(remote, vector)),
        update_batch_id: uuidv4(),
      },
      activation: { row_encoded_collab_v1: encodeCreationCollab(canonical) },
    };
  };

  jest.mocked(postDefaultRowCreation).mockImplementation(async (_owner, _database, request) => commit(request));
  return {
    intent,
    databaseDoc,
    remote,
    rowDoc,
    local,
    canonical,
    commit,
    registerRow,
    assertCurrent,
    orders: () => (view.get('row_orders') as Y.Array<unknown>).toArray(),
    cleanup: () => [databaseDoc, remote, rowDoc, local, canonical].forEach((doc) => doc.destroy()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable.mockReset();
  mockOwner.mockReset();
});

it.each([
  ['Desktop Text', BigInt(0), undefined],
  ['legacy string Text', '0', undefined],
  ['lazy select', FieldType.MultiSelect, undefined],
  ['legacy lazy Text', FieldType.Number, '0'],
])(
  'duplicates %s cells through the raw seeded contract and positions every eligible view',
  async (_label, type, sourceType) => {
    const f = fixture();
    const source = new Y.Doc();
    const sourceCell = source.getMap('cell') as YDatabaseCell;
    const seeded = new Y.Doc();

    try {
      sourceCell.set('field_type', typeof type === 'bigint' ? Number(type) : type);
      if (typeof type === 'bigint') {
        // A Desktop i64 is decoded by Yjs, but cannot be inserted with Map.set.
        (sourceCell._map.get('field_type')!.content as unknown as { arr: unknown[] }).arr[0] = type;
      }
      if (sourceType !== undefined) sourceCell.set('source_field_type', sourceType);
      sourceCell.set('data', 'Raw source value');
      sourceCell.set('rich_text', '{"v":2,"future":"preserved"}');
      const row = f.rowDoc.getMap('data').get('data') as Y.Map<Y.Map<unknown>>;

      row.get('cells')!.set('name', cloneDatabaseCell(FieldType.RichText, sourceCell));
      f.intent.preserveCellStorage = true;
      const anchor = uuidv4();

      f.intent.position = { kind: 'after', row_id: anchor };
      const database = f.databaseDoc.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<unknown>>>;
      const views = database.get('views')!;
      const otherViewId = uuidv4();
      const missingAnchorId = uuidv4();

      [otherViewId, missingAnchorId].forEach((id) => {
        const view = new Y.Map<unknown>();

        view.set('row_orders', new Y.Array());
        views.set(id, view);
      });
      [f.intent.sourceViewId, otherViewId].forEach((id) => {
        (views.get(id)!.get('row_orders') as Y.Array<unknown>).push([{ id: anchor, height: 36 }]);
      });
      Y.applyUpdate(f.remote, Y.encodeStateAsUpdate(f.databaseDoc));
      jest.mocked(postRowCreation).mockImplementation(async (_owner, path, payload) => {
        expect(path).toBe(`database/${f.intent.databaseId}/row`);
        const request = payload as CreateDatabaseRowRequest;

        expect(request.row.document).toBeUndefined();
        expect(request.document_name).toBeUndefined();
        expect(request.position).toEqual(f.intent.position);
        expect(request.position_view_ids).toEqual([f.intent.sourceViewId, otherViewId]);
        Y.applyUpdate(seeded, decodeCreatedRowCollab(request.row.collab).state);
        const cells = (seeded.getMap('data').get('data') as Y.Map<Y.Map<Y.Map<unknown>>>).get('cells')!;

        expect(cells.get('name')!.toJSON()).toMatchObject({
          field_type: Number(type),
          ...(sourceType === undefined ? {} : { source_field_type: Number(sourceType) }),
          data: 'Raw source value',
          rich_text: '{"v":2,"future":"preserved"}',
        });
        return f.commit(request);
      });

      await expect(createCloudRow(f.intent)).resolves.toBe(f.intent.rowId);
      expect(postRowCreation).toHaveBeenCalledTimes(1);
      expect(postDefaultRowCreation).not.toHaveBeenCalled();
      expect(sourceCell.get('field_type')).toBe(type);
    } finally {
      source.destroy();
      seeded.destroy();
      f.cleanup();
    }
  }
);

it('keeps row storage, membership, and binding untouched until the server commits', async () => {
  const f = fixture();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });

  jest.mocked(postDefaultRowCreation).mockImplementation(async (_owner, _database, request) => {
    entered();
    await held;
    return f.commit(request);
  });
  try {
    const creation = createCloudRow(f.intent);

    await pending;
    expect(f.orders()).toEqual([]);
    expect(openCachedRow).not.toHaveBeenCalled();
    expect(f.registerRow).not.toHaveBeenCalled();
    release();
    await expect(creation).resolves.toBe(f.intent.rowId);
    expect(f.orders()).toEqual([{ id: f.intent.rowId }]);
    expect(f.local.getMap('data').get('data')).toBeInstanceOf(Y.Map);
    expect(f.registerRow).toHaveBeenCalledTimes(1);
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(1); // Source coverage only; inline Row avoids another fetch.
  } finally {
    release();
    f.cleanup();
  }
});

it.each(['offline', 'permission denied'])('does not expose a partial row after %s refusal', async (reason) => {
  const f = fixture();

  if (reason === 'offline')
    mockAvailable.mockImplementation(() => {
      throw new Error(reason);
    });
  else jest.mocked(postDefaultRowCreation).mockRejectedValue(new Error(reason));
  try {
    await expect(createCloudRow(f.intent)).rejects.toThrow(reason);
    expect(f.orders()).toEqual([]);
    expect(openCachedRow).not.toHaveBeenCalled();
    expect(f.registerRow).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

it.each(['already_applied', 'missing', 'malformed'])('hydrates current authority for %s activation', async (kind) => {
  const f = fixture();

  jest.mocked(postDefaultRowCreation).mockImplementation(async (_owner, _database, request) => {
    const receipt = f.commit(request);

    if (kind === 'already_applied') receipt.outcome = 'already_applied';
    if (kind === 'missing') delete receipt.activation;
    if (kind === 'malformed') receipt.activation = { row_encoded_collab_v1: 'AAAA' };
    return receipt;
  });
  try {
    await createCloudRow(f.intent);
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(2);
    expect(f.orders()).toHaveLength(1);
    expect(f.registerRow).toHaveBeenCalledTimes(1);
  } finally {
    f.cleanup();
  }
});

it.each(['identity', 'restore', 'owner', 'destroy'])('rejects %s changes before local activation', async (kind) => {
  const f = fixture();

  jest.mocked(postDefaultRowCreation).mockImplementation(async (_owner, _database, request) => {
    const receipt = f.commit(request);

    if (kind === 'identity') receipt.result.row_id = uuidv4();
    if (kind === 'restore') f.databaseDoc.databaseRestoreId = uuidv4();
    if (kind === 'owner')
      f.assertCurrent.mockImplementation(() => {
        throw new Error('owner retired');
      });
    if (kind === 'destroy') f.databaseDoc.destroy();
    return receipt;
  });
  try {
    await expect(createCloudRow(f.intent)).rejects.toThrow();
    expect(openCachedRow).not.toHaveBeenCalled();
    expect(f.registerRow).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

it('freezes only resolved cells and presentation, leaving schema and actor metadata to the server', () => {
  const f = fixture();

  try {
    const request = prepareDefaultRowRequest(f.intent, uuidv4());

    expect(request.cells).toEqual({});
    expect(request).toMatchObject({
      schema_version: 'v1',
      row_id: f.intent.rowId,
      height: 36,
      visibility: true,
      position: { kind: 'end' },
    });
    expect(JSON.stringify(request)).not.toMatch(/doc_state|created_at|created_by|row_orders/);
  } finally {
    f.cleanup();
  }
});

it('reports a confirmed commit separately when local activation cannot finish, without resubmitting', async () => {
  const f = fixture();

  jest.mocked(openCachedRow).mockRejectedValueOnce(new Error('local cache is unavailable'));
  try {
    await expect(createCloudRow(f.intent)).rejects.toMatchObject({
      rowId: f.intent.rowId,
      user_error: { reason: 'ATOMIC_ROW_CREATED_RELOAD' },
    });
    expect(postDefaultRowCreation).toHaveBeenCalledTimes(1);
    expect(f.orders()).toEqual([]);
    expect(f.registerRow).not.toHaveBeenCalled();
    // A new gesture is not enrolled in an implicit durable recovery queue.
    expect(
      (f.remote.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<Y.Array<unknown>>>>)
        .get('views')
        ?.get(f.intent.sourceViewId)
        ?.get('row_orders')?.length
    ).toBe(1);
  } finally {
    f.cleanup();
  }
});

it('checks the remote restore boundary after commit before publishing the activation', async () => {
  const f = fixture();

  jest
    .mocked(atomicRead)
    .mockResolvedValueOnce({ database_restore_id: null, version: null })
    .mockResolvedValueOnce({ database_restore_id: uuidv4(), version: null });
  try {
    await expect(createCloudRow(f.intent)).rejects.toMatchObject({
      rowId: f.intent.rowId,
      user_error: { reason: 'ATOMIC_ROW_CREATED_RELOAD' },
    });
    expect(atomicRead).toHaveBeenCalledTimes(2);
    expect(f.orders()).toEqual([]);
    expect(openCachedRow).not.toHaveBeenCalled();
    expect(f.registerRow).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});
