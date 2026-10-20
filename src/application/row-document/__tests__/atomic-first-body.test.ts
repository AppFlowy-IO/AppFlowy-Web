/** @jest-environment node */
import * as Y from 'yjs';

import * as atomic from '@/application/atomic-creation';
import { ERROR_CODE } from '@/application/constants';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import {
  captureDatabaseStorageFence,
  getCachedProviderDoc,
  matchesDatabaseStorageFence,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import { isDatabaseStorageFenceCurrent } from '@/application/db/database-storage-fence';
import { getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { Types, YDoc, YjsEditorKey } from '@/application/types';

import { decodeCurrentRowPageCollab, prepareAtomicRowFirstBody } from '../atomic-first-body';
import { compileFirstBodyActions, createFirstBodyDraft } from '../first-body-actions';

jest.mock('@/application/atomic-creation', () => ({
  captureAtomicCreationOwner: jest.fn(),
  assertAtomicCreationAvailable: jest.fn(),
  atomicRead: jest.fn(),
  findPendingAtomicCreation: jest.fn(),
  recoverAtomicCreation: jest.fn(),
  runAtomicCreation: jest.fn(),
}));
jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(),
  matchesDatabaseStorageFence: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
}));
jest.mock('@/application/db/database-storage-fence', () => ({
  isDatabaseStorageFenceCurrent: jest.fn(),
  withDatabaseStorageFence: (_doc: unknown, _fence: unknown, apply: () => void) => apply(),
}));
jest.mock('@/application/services/js-services/cache', () => ({ getOrCreateRowSubDoc: jest.fn() }));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));
const NIL = '00000000-0000-0000-0000-000000000000';
const ids = {
  workspace: 'workspace',
  database: 'database',
  view: 'view',
  row: '11111111-1111-4111-8111-111111111111',
  document: getMetaIdMap('11111111-1111-4111-8111-111111111111').get(RowMetaKey.DocumentId)!,
};
const state = (doc: Y.Doc) => ({
  object_id: doc.guid,
  doc_state: Array.from(Y.encodeStateAsUpdate(doc)),
  version: 0,
  collab_version: null,
});

function setup() {
  const databaseDoc = new Y.Doc({ guid: ids.database }) as YDoc;
  const rowDoc = new Y.Doc({ guid: ids.row }) as YDoc;
  const remoteDatabase = new Y.Doc({ guid: ids.database });
  const dbRoot = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rows = new Y.Array();

  rows.push([{ id: ids.row }]);
  view.set('row_orders', rows);
  views.set(ids.view, view);
  dbRoot.set('views', views);
  dbRoot.set('id', ids.database);
  remoteDatabase.getMap('data').set('database', dbRoot);
  const remoteRow = new Y.Doc({ guid: ids.row });
  const data = new Y.Map();
  const meta = new Y.Map();

  data.set('id', ids.row);
  data.set('database_id', ids.database);
  meta.set(getMetaIdMap(ids.row).get(RowMetaKey.IsDocumentEmpty)!, false);
  remoteRow.getMap('data').set('data', data);
  remoteRow.getMap('data').set('meta', meta);
  const remoteDocument = createFirstBodyDraft(ids.document);
  const body = remoteDocument.getMap(YjsEditorKey.data_section).get('document');
  const texts = body.get('meta').get('text_map') as Y.Map<Y.Text>;

  Array.from(texts.values())[0].insert(0, 'committed body');
  const cached = new Y.Doc({ guid: ids.document }) as YDoc;
  const receipt = {
    request_id: 'request',
    outcome: 'applied',
    result: {
      document_id: ids.document,
      row_id: ids.row,
      database_id: ids.database,
      database_restore_id: NIL,
      row_version: null,
      document_version: null,
      update_batch_id: 'batch',
    },
  } as atomic.AtomicCreationReceipt<'row-document'>;

  (atomic.captureAtomicCreationOwner as jest.Mock).mockImplementation((workspaceId, check) => ({
    workspaceId,
    serverUrl: 'server',
    userId: 'user',
    assertCurrent: () => check?.(),
  }));
  (atomic.findPendingAtomicCreation as jest.Mock).mockResolvedValue(undefined);
  jest.mocked(collabFullSyncBatch).mockResolvedValue([
    {
      objectId: ids.row,
      collabType: Types.DatabaseRow,
      missingUpdate: new Uint8Array([0, 0]),
      serverStateVector: new Uint8Array([0]),
    },
  ]);
  (atomic.atomicRead as jest.Mock).mockImplementation((_owner, path: string) => {
    if (path.endsWith('restore-state')) return Promise.resolve({ database_restore_id: null, version: null });
    const target = path.split('/').pop();

    return Promise.resolve(
      state(target === ids.database ? remoteDatabase : target === ids.row ? remoteRow : remoteDocument)
    );
  });
  (captureDatabaseStorageFence as jest.Mock).mockResolvedValue({
    databaseId: ids.database,
    epoch: null,
    cacheEpoch: null,
  });
  (matchesDatabaseStorageFence as jest.Mock).mockResolvedValue(true);
  (isDatabaseStorageFenceCurrent as jest.Mock).mockReturnValue(true);
  (getOrCreateRowSubDoc as jest.Mock).mockResolvedValue(cached);
  const documentProvider = { get: jest.fn(), set: jest.fn() };
  const rowProvider = { get: jest.fn(), set: jest.fn(), whenPersisted: jest.fn().mockResolvedValue(undefined) };

  (openCollabDBWithProvider as jest.Mock).mockResolvedValue({ doc: cached, provider: documentProvider });
  (openRowCollabDBWithProvider as jest.Mock).mockResolvedValue({ doc: rowDoc, provider: rowProvider });
  (getCachedProviderDoc as jest.Mock).mockImplementation((id) => (id === ids.document ? cached : rowDoc));
  (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ hydrate, owner }) => hydrate(receipt, owner));
  const input = {
    workspaceId: ids.workspace,
    documentId: ids.document,
    source: { database_id: ids.database, database_view_id: ids.view, row_id: ids.row },
    databaseDoc,
    rowDoc,
    name: 'row',
    assertWritable: jest.fn(),
  };

  return { input, cached, remoteDatabase, remoteRow, remoteDocument, receipt, rows, documentProvider, rowProvider };
}

describe('atomic row-page activation', () => {
  beforeEach(() => jest.resetAllMocks());

  it('opening a draft does not POST, mutate Row, create a cache or bind a provider', async () => {
    const { input } = setup();
    const session = await prepareAtomicRowFirstBody(input);

    session.admit();
    expect(atomic.runAtomicCreation).not.toHaveBeenCalled();
    expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
    expect(input.rowDoc.getMap(YjsEditorKey.data_section).size).toBe(0);
    session.dispose();
  });

  function makeRemoteBodyEmpty(f: ReturnType<typeof setup>) {
    const texts = f.remoteDocument.getMap('data').get('document').get('meta').get('text_map') as Y.Map<Y.Text>;

    for (const text of texts.values()) text.delete(0, text.length);
    (f.remoteRow.getMap('data').get('meta') as Y.Map<unknown>)
      .set(getMetaIdMap(ids.row).get(RowMetaKey.IsDocumentEmpty)!, true);
  }

  it('creates the server schema on open without authored actions or a local blank document', async () => {
    const f = setup();

    makeRemoteBodyEmpty(f);
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
      await expect(session.createEmpty()).resolves.toBe(f.cached);
      expect(atomic.runAtomicCreation).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'row-document',
        request: expect.objectContaining({ contribution: { kind: 'default_schema', schema_version: 'v1' } }),
      }));
      expect(f.cached.getMap('data').toJSON()).toEqual(f.remoteDocument.getMap('data').toJSON());
      const meta = f.input.rowDoc.getMap('data').get('meta') as Y.Map<unknown>;

      expect(meta.get(getMetaIdMap(ids.row).get(RowMetaKey.IsDocumentEmpty)!)).toBe(true);
      expect(f.rowProvider.whenPersisted).toHaveBeenCalledTimes(1);
    } finally {
      session.dispose();
    }
  });

  it('retains an existing authored document when schema creation races another client', async () => {
    const f = setup();
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(session.createEmpty()).resolves.toBe(f.cached);
      expect(f.cached.getMap('data').toJSON()).toEqual(f.remoteDocument.getMap('data').toJSON());
      const meta = f.input.rowDoc.getMap('data').get('meta') as Y.Map<unknown>;

      expect(meta.get(getMetaIdMap(ids.row).get(RowMetaKey.IsDocumentEmpty)!)).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it('accepts the server empty default when an initial Desktop row omits its content flag', async () => {
    const f = setup();

    makeRemoteBodyEmpty(f);
    const emptyKey = getMetaIdMap(ids.row).get(RowMetaKey.IsDocumentEmpty)!;

    (f.remoteRow.getMap('data').get('meta') as Y.Map<unknown>).delete(emptyKey);
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(session.createEmpty()).resolves.toBe(f.cached);
      expect((f.input.rowDoc.getMap('data').get('meta') as Y.Map<unknown>).has(emptyKey)).toBe(false);
      expect(f.cached.getMap('data').toJSON()).toEqual(f.remoteDocument.getMap('data').toJSON());
    } finally {
      session.dispose();
    }
  });

  it('shares one initialization across simultaneous row detail and side peek opens', async () => {
    const f = setup();

    makeRemoteBodyEmpty(f);
    const first = await prepareAtomicRowFirstBody(f.input);
    const second = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(Promise.all([first.createEmpty(), second.createEmpty(), first.createEmpty()]))
        .resolves.toEqual([f.cached, f.cached, f.cached]);
      expect(atomic.runAtomicCreation).toHaveBeenCalledTimes(1);
      expect(f.rowProvider.whenPersisted).toHaveBeenCalledTimes(1);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('retries schema creation with the same request after an ambiguous failure', async () => {
    const f = setup();

    makeRemoteBodyEmpty(f);
    (atomic.runAtomicCreation as jest.Mock).mockRejectedValueOnce(new Error('response lost'));
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(session.createEmpty()).rejects.toThrow('response lost');
      expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
      await expect(session.createEmpty()).resolves.toBe(f.cached);
      const calls = (atomic.runAtomicCreation as jest.Mock).mock.calls;

      expect(calls[1][0].request).toEqual(calls[0][0].request);
    } finally {
      session.dispose();
    }
  });

  it.each(['default_schema', 'default_actions'] as const)(
    'recovers the original %s recipe when opening after a remount',
    async (kind) => {
      const f = setup();

      makeRemoteBodyEmpty(f);
      const record = {
        requestJson: JSON.stringify({ contribution: { kind, schema_version: 'v1', ...(kind === 'default_actions' ? { actions: [] } : {}) } }),
        state: 'committed',
      };

      (atomic.findPendingAtomicCreation as jest.Mock).mockResolvedValue(record);
      (atomic.recoverAtomicCreation as jest.Mock).mockImplementation(async ({ onPrepared, hydrate, owner }) => {
        await onPrepared(record);
        return hydrate(f.receipt, owner);
      });
      const session = await prepareAtomicRowFirstBody(f.input);

      try {
        if (kind === 'default_schema') await expect(session.createEmpty()).resolves.toBe(f.cached);
        else await expect(session.createEmpty()).rejects.toThrow('has not activated this body');
        expect(atomic.runAtomicCreation).not.toHaveBeenCalled();
        expect(atomic.recoverAtomicCreation).toHaveBeenCalledWith(expect.objectContaining({ record }));
      } finally {
        session.dispose();
      }
    }
  );

  it('keeps schema initialization fenced if the source is destroyed or restored', async () => {
    for (const mode of ['destroy', 'restore']) {
      const f = setup();

      makeRemoteBodyEmpty(f);
      const session = await prepareAtomicRowFirstBody(f.input);

      if (mode === 'destroy') f.input.rowDoc.destroy();
      else (isDatabaseStorageFenceCurrent as jest.Mock).mockReturnValue(false);
      await expect(session.createEmpty()).rejects.toThrow('source or restore generation');
      expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
      session.dispose();
    }
  });

  it('recovers a row restored in the inline view despite a stale linked-view tombstone', async () => {
    const f = setup();
    const root = f.remoteDatabase.getMap('data').get('database') as Y.Map<unknown>;
    const views = root.get('views') as Y.Map<Y.Map<unknown>>;
    const inlineOrders = new Y.Array();

    f.rows.delete(0, f.rows.length);
    f.rows.push([{ id: ids.row, is_deleted: true }]);
    inlineOrders.push([{ id: ids.row }]);
    views.set('inline', new Y.Map([['row_orders', inlineOrders]]));
    root.set('metas', new Y.Map([['iid', 'inline']]));
    const record = {
      requestJson: JSON.stringify({ contribution: { kind: 'default_schema', schema_version: 'v1' } }),
      state: 'committed',
    };

    (atomic.findPendingAtomicCreation as jest.Mock).mockResolvedValue(record);
    (atomic.recoverAtomicCreation as jest.Mock).mockImplementation(async ({ onPrepared, hydrate, owner }) => {
      await onPrepared(record);
      return hydrate(f.receipt, owner);
    });
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(session.createEmpty()).resolves.toBe(f.cached);
      expect(f.cached.getMap('data').toJSON()).toEqual(f.remoteDocument.getMap('data').toJSON());
      expect(atomic.runAtomicCreation).not.toHaveBeenCalled();
      expect(atomic.recoverAtomicCreation).toHaveBeenCalledWith(expect.objectContaining({ record }));
    } finally {
      session.dispose();
    }
  });

  it('waits for separately held normal Row and Database sync before publishing the first body', async () => {
    jest.useFakeTimers();
    const f = setup();

    f.rows.delete(0, f.rows.length);
    const localDatabase = new Y.Doc();

    Y.applyUpdate(localDatabase, Y.encodeStateAsUpdate(f.remoteDatabase));
    const localRoot = localDatabase.getMap('data').get('database') as Y.Map<unknown>;
    const localViews = localRoot.get('views') as Y.Map<Y.Map<unknown>>;

    (localViews.get(ids.view)!.get('row_orders') as Y.Array<unknown>).push([{ id: ids.row }]);
    let rowSynced = false;
    const originalRead = (atomic.atomicRead as jest.Mock).getMockImplementation()!;

    (atomic.atomicRead as jest.Mock).mockImplementation((owner, path) => {
      if (path.endsWith(`/${ids.row}`) && !rowSynced) return Promise.reject({ code: ERROR_CODE.RECORD_NOT_FOUND });
      return originalRead(owner, path);
    });
    const submit = jest.fn();

    (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ beforeSubmit, hydrate, owner }) => {
      await beforeSubmit?.(owner);
      submit();
      return hydrate(f.receipt, owner);
    });
    const session = await prepareAtomicRowFirstBody(f.input);
    const publication = session.publish(compileFirstBodyActions(f.remoteDocument));

    void publication.catch(() => undefined);
    try {
      await jest.advanceTimersByTimeAsync(0);
      expect(submit).not.toHaveBeenCalled();
      rowSynced = true;
      await jest.advanceTimersToNextTimerAsync();
      expect(submit).not.toHaveBeenCalled();
      // Deliver the normal database sync update independently of the Row body.
      Y.applyUpdate(f.remoteDatabase, Y.encodeStateAsUpdate(localDatabase));
      await jest.advanceTimersToNextTimerAsync();
      await expect(publication).resolves.toBe(f.cached);
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      session.dispose();
      localDatabase.destroy();
      jest.useRealTimers();
    }
  });

  it.each(['ready', 'item-error', 'retired-row', 'restore-changed'])(
    'waits for the durable Row acknowledgment before atomic publication (%s)',
    async (outcome) => {
      jest.useFakeTimers();
      const f = setup();
      const submit = jest.fn();
      let finish!: (results: Awaited<ReturnType<typeof collabFullSyncBatch>>) => void;

      jest.mocked(collabFullSyncBatch).mockImplementation(
        () => new Promise((resolve) => {
          finish = resolve;
        })
      );
      (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ beforeSubmit, hydrate, owner }) => {
        await beforeSubmit(owner);
        submit();
        return hydrate(f.receipt, owner);
      });
      const session = await prepareAtomicRowFirstBody(f.input);
      const opening = session.createEmpty();

      void opening.catch(() => undefined);
      try {
        await jest.advanceTimersByTimeAsync(0);
        // Cache GETs already returned a complete Row, but no document may be published yet.
        expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
        expect(submit).not.toHaveBeenCalled();
        expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
        if (outcome === 'retired-row') f.input.rowDoc.destroy();
        if (outcome === 'restore-changed') jest.mocked(isDatabaseStorageFenceCurrent).mockReturnValue(false);
        finish([
          {
            objectId: ids.row,
            collabType: Types.DatabaseRow,
            missingUpdate: new Uint8Array([0, 0]),
            serverStateVector: new Uint8Array([0]),
            ...(outcome === 'item-error' ? { error: 'Not enough permissions' } : {}),
          },
        ]);
        if (outcome === 'ready') {
          await expect(opening).resolves.toBe(f.cached);
          expect(submit).toHaveBeenCalledTimes(1);
        } else {
          await expect(opening).rejects.toThrow();
          expect(submit).not.toHaveBeenCalled();
          expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
        }
      } finally {
        session.dispose();
        jest.useRealTimers();
      }
    }
  );

  it('hydrates independent current Database/Row/Document before canonical activation', async () => {
    const { input, cached, remoteDocument } = setup();
    const session = await prepareAtomicRowFirstBody(input);
    const result = await session.publish(compileFirstBodyActions(remoteDocument));

    expect(result).toBe(cached);
    expect(cached.getMap(YjsEditorKey.data_section).toJSON()).toEqual(
      remoteDocument.getMap(YjsEditorKey.data_section).toJSON()
    );
    expect(input.rowDoc.getMap(YjsEditorKey.data_section).get('meta')).toBeInstanceOf(Y.Map);
    expect(cached.object_id).toBe(ids.document);
    expect(atomic.runAtomicCreation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'row-document', logicalTarget: ids.document })
    );
    session.dispose();
  });

  it('publishes a hidden template body only through its current exact database registry', async () => {
    const f = setup();

    f.rows.delete(0, f.rows.length);
    const root = f.remoteDatabase.getMap('data').get('database') as Y.Map<unknown>;

    root.set('metas', new Y.Map([['row_templates', JSON.stringify([
      { template_id: ids.row, name: 'Template', doc_view_id: ids.document },
    ])]]));
    const submitted = jest.fn();

    (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ beforeSubmit, hydrate, owner }) => {
      await beforeSubmit(owner);
      submitted();
      return hydrate(f.receipt, owner);
    });
    const session = await prepareAtomicRowFirstBody(f.input);

    try {
      await expect(session.publish(compileFirstBodyActions(f.remoteDocument))).resolves.toBe(f.cached);
      expect(submitted).toHaveBeenCalledTimes(1);
      expect(f.rows.length).toBe(0);
    } finally {
      session.dispose();
    }
  });

  it('bounds a held source read and refuses its late completion before POST', async () => {
    jest.useFakeTimers();
    const f = setup();
    const session = await prepareAtomicRowFirstBody(f.input);
    const submit = jest.fn();
    let release!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const originalRead = (atomic.atomicRead as jest.Mock).getMockImplementation()!;

    (atomic.atomicRead as jest.Mock).mockImplementation((owner, path) =>
      path.endsWith(`/${ids.row}`) ? held : originalRead(owner, path)
    );
    (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ beforeSubmit }) => {
      await beforeSubmit();
      submit();
    });
    const publication = session.publish(compileFirstBodyActions(f.remoteDocument));

    void publication.catch(() => undefined);
    try {
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(publication).rejects.toThrow();
      release(state(f.remoteRow));
      await jest.advanceTimersByTimeAsync(0);
      expect(submit).not.toHaveBeenCalled();
      expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      jest.useRealTimers();
    }
  });

  it.each(['permission', 'identity', 'restore'])(
    'rejects %s changes in source readiness before POST',
    async (failure) => {
      const f = setup();
      const session = await prepareAtomicRowFirstBody(f.input);
      const submit = jest.fn();
      const originalRead = (atomic.atomicRead as jest.Mock).getMockImplementation()!;

      (atomic.atomicRead as jest.Mock).mockImplementation((owner, path) => {
        if (failure === 'permission' && path.endsWith(`/${ids.row}`))
          return Promise.reject(new Error('permission denied'));
        if (failure === 'restore' && path.endsWith('restore-state'))
          return Promise.resolve({ database_restore_id: 'new-restore', version: null });
        return originalRead(owner, path);
      });
      if (failure === 'identity')
        (f.remoteRow.getMap('data').get('data') as Y.Map<unknown>).set('database_id', 'other-database');
      (atomic.runAtomicCreation as jest.Mock).mockImplementation(async ({ beforeSubmit }) => {
        await beforeSubmit();
        submit();
      });
      await expect(session.publish(compileFirstBodyActions(f.remoteDocument))).rejects.toThrow();
      expect(submit).not.toHaveBeenCalled();
      expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
      session.dispose();
    }
  );

  it('rejects a deleted source-row membership without touching canonical storage', async () => {
    const { input, rows, remoteDocument } = setup();
    const session = await prepareAtomicRowFirstBody(input);

    rows.delete(0, 1);
    await expect(session.publish(compileFirstBodyActions(remoteDocument))).rejects.toThrow('source view');
    expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
    expect(input.rowDoc.getMap(YjsEditorKey.data_section).size).toBe(0);
    session.dispose();
  });

  it('does not merge current Row bytes into an older live row version', async () => {
    const { input, remoteDocument } = setup();

    input.rowDoc.version = 'old-row-version';
    const session = await prepareAtomicRowFirstBody(input);

    await expect(session.publish(compileFirstBodyActions(remoteDocument))).rejects.toThrow('another version');
    expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
    expect(input.rowDoc.getMap(YjsEditorKey.data_section).size).toBe(0);
    session.dispose();
  });

  it('retains pending creation when current Row metadata cannot be persisted', async () => {
    const { input, remoteDocument, rowProvider } = setup();
    const session = await prepareAtomicRowFirstBody(input);

    rowProvider.whenPersisted.mockRejectedValue(new Error('row cache write failed'));
    await expect(session.publish(compileFirstBodyActions(remoteDocument))).rejects.toThrow('row cache write failed');
    expect(rowProvider.whenPersisted).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it('rejects a changed Database version before exposing the detached draft', async () => {
    const { input } = setup();

    input.databaseDoc.version = 'old-database-version';
    await expect(prepareAtomicRowFirstBody(input)).rejects.toThrow('restore');
    expect(getOrCreateRowSubDoc).not.toHaveBeenCalled();
    expect(atomic.runAtomicCreation).not.toHaveBeenCalled();
  });

  it('retains the exact pending command and does not mint a second request on retry', async () => {
    const { input, remoteDocument, cached } = setup();
    const record = { requestJson: 'immutable', state: 'committed' };

    (atomic.findPendingAtomicCreation as jest.Mock).mockResolvedValue(record);
    (atomic.recoverAtomicCreation as jest.Mock).mockResolvedValue(cached);
    const session = await prepareAtomicRowFirstBody(input);

    expect(await session.pending!()).toBe(cached);
    await session.publish(compileFirstBodyActions(remoteDocument));
    expect(atomic.runAtomicCreation).not.toHaveBeenCalled();
    expect(atomic.recoverAtomicCreation).toHaveBeenCalledWith(expect.objectContaining({ record }));
    session.dispose();
  });

  it('refuses a restore, destroyed source or stale cache branch', async () => {
    for (const mode of ['restore', 'destroy', 'cache', 'empty-cache']) {
      const { input, cached, remoteDocument } = setup();
      const session = await prepareAtomicRowFirstBody(input);

      if (mode === 'restore') (isDatabaseStorageFenceCurrent as jest.Mock).mockReturnValue(false);
      if (mode === 'destroy') input.databaseDoc.destroy();
      if (mode === 'cache' || mode === 'empty-cache') {
        cached.version = 'old';
        if (mode === 'cache') cached.getMap(YjsEditorKey.data_section).set('document', new Y.Map());
      }

      await expect(session.publish(compileFirstBodyActions(remoteDocument))).rejects.toThrow();
      expect(input.rowDoc.getMap(YjsEditorKey.data_section).size).toBe(0);
      session.dispose();
    }
  });

  it('refuses a persisted version mismatch without replacing empty cache storage', async () => {
    const { input, cached, remoteDocument, documentProvider } = setup();
    const session = await prepareAtomicRowFirstBody(input);

    documentProvider.get.mockResolvedValue('retired-version');
    await expect(session.publish(compileFirstBodyActions(remoteDocument))).rejects.toThrow('persisted');
    expect(documentProvider.set).not.toHaveBeenCalled();
    expect(cached.getMap(YjsEditorKey.data_section).size).toBe(0);
    session.dispose();
  });

  it('rejects wrong identity, version and incomplete update encoding', () => {
    const { remoteDocument } = setup();
    const encoded = state(remoteDocument);

    expect(() => decodeCurrentRowPageCollab({ ...encoded, object_id: 'other' }, ids.document)).toThrow();
    expect(() => decodeCurrentRowPageCollab({ ...encoded, collab_version: 'other' }, ids.document, null)).toThrow();
    expect(() => decodeCurrentRowPageCollab({ ...encoded, doc_state: [500] }, ids.document)).toThrow();
    expect(() => decodeCurrentRowPageCollab({ ...encoded, version: 7 }, ids.document)).toThrow();
  });
});
