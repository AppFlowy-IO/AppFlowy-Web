import { waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { atomicRead, AtomicCreationOwner } from '@/application/atomic-creation';
import { captureDatabaseStorageFence, getCachedProviderDoc, openCollabDBWithProvider, openRowCollabDBWithProvider, publishWithDatabaseStorageFence } from '@/application/db';
// The epoch key carries the account and workspace scope; publish it the way storage does.
import { publishDatabaseCacheEpoch } from '@/application/db/database-storage-fence';
import { Types, View, ViewLayout, YDoc, YjsEditorKey } from '@/application/types';

import { collabFullSyncBatch, CollabFullSyncBatchResult } from '../collab-api';
import { verifyCreatedPage } from '../created-page-hydration';
import { prepareDefaultPage } from '../page-default-creation';

jest.mock('@/application/atomic-creation', () => ({ atomicRead: jest.fn() }));
jest.mock('../collab-api', () => ({ collabFullSyncBatch: jest.fn() }));
jest.mock('@/application/db', () => ({ captureDatabaseStorageFence: jest.fn(), getCachedProviderDoc: jest.fn(), openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(), publishWithDatabaseStorageFence: jest.fn() }));
jest.mock('@/application/services/js-services/cache', () => ({ getCachedRowDoc: jest.fn() }));

const owner: AtomicCreationOwner = { workspaceId: 'workspace', userId: 'user', serverUrl: 'https://test', assertCurrent: jest.fn() };
const parent = (extra: Partial<View> = {}): View => ({ view_id: 'parent', name: '', layout: ViewLayout.Document,
  is_space: true, extra: null, children: [], icon: null, is_private: false, is_published: false, ...extra });
const ids = () => { let id = 0; return () => `identity-${++id}`; };
const documents: Y.Doc[] = [];
function doc(id: string): YDoc { const value = new Y.Doc({ guid: id }) as YDoc; documents.push(value); return value; }
function result(value: YDoc, collabType: Types): CollabFullSyncBatchResult {
  return { objectId: value.guid, collabType, collabVersion: value.version,
    missingUpdate: Y.encodeStateAsUpdate(value), serverStateVector: Y.encodeStateVector(value) };
}
function databasePage(layout = ViewLayout.Grid) {
  const prepared = prepareDefaultPage('workspace', parent(), { layout, name: 'Database' }, ids(), 'Asia/Shanghai');

  if (prepared.kind !== 'database') throw new Error('Expected Database');
  const expected = prepared.request.database;
  const remote = doc(expected.database_id);
  const database = new Y.Map<unknown>();
  const views = new Y.Map<Y.Map<unknown>>();
  const mounted = [expected.view_id, ...(expected.responses_view_id ? [expected.responses_view_id] : [])];
  const orders = new Y.Array<unknown>();

  database.set('id', expected.database_id);
  database.set('fields', new Y.Map([['primary', new Y.Map([['is_primary', true]])]]));
  database.set('views', views);
  database.set('metas', new Y.Map([['iid', 'inline']]));
  views.set('inline', new Y.Map<unknown>([['id', 'inline'], ['database_id', expected.database_id], ['row_orders', orders]]));
  for (const [index, id] of mounted.entries()) views.set(id, new Y.Map<unknown>([
    ['id', id], ['database_id', expected.database_id], ['layout', index ? 0 : expected.layout], ['row_orders', new Y.Array()],
  ]));
  remote.getMap(YjsEditorKey.data_section).set('database', database);
  const folder = parent({ view_id: prepared.request.container_id,
    extra: { is_database_container: true, database_id: expected.database_id },
    children: mounted.map((view_id, index) => parent({ view_id, layout: index ? ViewLayout.Grid : layout,
      extra: { database_id: expected.database_id } })) });
  const rows: YDoc[] = [];
  const addRow = (id: string, deleted = false) => {
    orders.push([{ id, is_deleted: deleted }]);
    if (deleted) return;
    const row = doc(id);

    row.getMap(YjsEditorKey.data_section).set('data', new Y.Map<unknown>([
      ['id', id], ['database_id', expected.database_id], ['cells', new Y.Map()],
    ]));
    row.getMap(YjsEditorKey.data_section).set('meta', new Y.Map());
    rows.push(row);
    return row;
  };

  return { prepared, folder, remote, database, views, orders, rows, addRow };
}
function documentPage() {
  const prepared = prepareDefaultPage('workspace', parent(), { layout: ViewLayout.Document }, ids());

  if (prepared.kind !== 'document') throw new Error('Expected Document');
  const remote = doc(prepared.request.view_id);
  const blocks = new Y.Map<unknown>();
  const body = new Y.Map<unknown>([['page_id', 'server-root'], ['blocks', blocks]]);
  const children = new Y.Map<unknown>([['root-children', new Y.Array()], ['paragraph-children', new Y.Array()]]);
  const texts = new Y.Map<unknown>([['paragraph-text', new Y.Text()]]);

  body.set('meta', new Y.Map<unknown>([['children_map', children], ['text_map', texts]]));
  blocks.set('server-root', new Y.Map<unknown>([['id', 'server-root'], ['ty', 'page'], ['parent', ''], ['children', 'root-children']]));
  blocks.set('paragraph', new Y.Map<unknown>([['id', 'paragraph'], ['ty', 'paragraph'], ['parent', 'server-root'],
    ['children', 'paragraph-children'], ['external_type', 'text'], ['external_id', 'paragraph-text']]));
  remote.getMap(YjsEditorKey.data_section).set('document', body);
  (children.get('root-children') as Y.Array<unknown>).push(['paragraph']);
  return { prepared, folder: parent({ view_id: prepared.request.view_id }), remote, blocks, children, texts, rows: [] };
}
let providers: Map<string, { doc: YDoc; provider: { set: jest.Mock } }>;
function serve(fixture: ReturnType<typeof databasePage> | ReturnType<typeof documentPage>) {
  jest.mocked(atomicRead).mockImplementation(async (_owner, url) =>
    url.endsWith('restore-state') ? { database_restore_id: null, version: null } as never : fixture.folder as never);
  jest.mocked(collabFullSyncBatch).mockImplementation(async (_workspace, items) => items.map((item) => {
    const current = item.collabType === Types.DatabaseRow ? fixture.rows.find((row) => row.guid === item.objectId) : fixture.remote;

    if (!current) throw new Error('Current row missing');
    return result(current, item.collabType);
  }));
}
beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  providers = new Map();
  jest.mocked(getCachedProviderDoc).mockImplementation((id) => providers.get(id)?.doc);
  jest.mocked(captureDatabaseStorageFence).mockImplementation(async (databaseId) => ({ databaseId, epoch: null, cacheEpoch: null }));
  jest.mocked(publishWithDatabaseStorageFence).mockImplementation(async (_fence, publish) => { publish(); return true; });
  const open = async (id: string) => {
    if (!providers.has(id)) providers.set(id, { doc: doc(id), provider: { set: jest.fn(async () => {}) } });
    return providers.get(id) as never;
  };

  jest.mocked(openCollabDBWithProvider).mockImplementation(open);
  jest.mocked(openRowCollabDBWithProvider).mockImplementation(open);
});
afterEach(() => { documents.splice(0).forEach((document) => document.destroy()); });

it('hydrates the canonical Document whose server block root differs from the collab ID', async () => {
  const fixture = documentPage();

  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).resolves.toEqual({ view_id: fixture.remote.guid });
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).toJSON()).toEqual(fixture.remote.getMap(YjsEditorKey.data_section).toJSON());
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
  expect(collabFullSyncBatch).toHaveBeenCalledWith('workspace', [expect.objectContaining({
    docState: new Uint8Array(), stateVector: new Uint8Array([0]),
  })], expect.objectContaining({ atomicCreationOwner: owner }));
});

it.each(['root', 'child', 'text'])('rejects an incomplete current Document %s before touching canonical caches', async (part) => {
  const fixture = documentPage();

  if (part === 'root') fixture.blocks.delete('server-root');
  if (part === 'child') fixture.blocks.delete('paragraph');
  if (part === 'text') fixture.texts.delete('paragraph-text');
  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow();
  expect(openCollabDBWithProvider).not.toHaveBeenCalled();
});

it('requires the Form Responses companion in Folder and content', async () => {
  const fixture = databasePage(ViewLayout.Form);

  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).resolves.toMatchObject({ database_id: fixture.remote.guid });
  fixture.folder.children.pop();
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('missing');
});

it('reads active canonical rows in one batch, excluding deleted original seeds and recovering new rows', async () => {
  const fixture = databasePage();

  fixture.addRow(fixture.prepared.request.database.initial_row_ids[0], true);
  fixture.addRow('new-current-row');
  fixture.addRow('another-current-row');
  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).resolves.toMatchObject({ database_id: fixture.remote.guid });
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(2);
  expect(providers.get(fixture.remote.guid)!.doc.databaseRestoreId).toBeUndefined();
  expect(jest.mocked(collabFullSyncBatch).mock.calls[1][1].map((item) => item.objectId)).toEqual(['new-current-row', 'another-current-row']);
  expect(openRowCollabDBWithProvider).toHaveBeenCalledTimes(2);
  expect(providers.get('new-current-row')!.doc.getMap(YjsEditorKey.data_section).toJSON()).toEqual(fixture.rows[0].getMap(YjsEditorKey.data_section).toJSON());
});

it('rejects a missing canonical active row even if the selected view happens to have no row orders', async () => {
  const fixture = databasePage();

  fixture.orders.push([{ id: 'missing' }]);
  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('row missing');
  expect(openCollabDBWithProvider).not.toHaveBeenCalled();
});

it('opens row caches while the database cache is still loading', async () => {
  const fixture = databasePage();

  fixture.addRow('row');
  serve(fixture);
  const open = jest.mocked(openCollabDBWithProvider).getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });

  jest.mocked(openCollabDBWithProvider).mockImplementation(async (...args) => {
    await held;
    return open(...args);
  });
  const pending = verifyCreatedPage(owner, fixture.prepared);

  try {
    await waitFor(() => expect(openRowCollabDBWithProvider).toHaveBeenCalledWith('row', { awaitSync: true }));
    expect(providers.get('row')!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
  } finally {
    release();
    await pending;
  }

  expect(providers.get('row')!.doc.getMap(YjsEditorKey.data_section).toJSON()).toEqual(fixture.rows[0].getMap(YjsEditorKey.data_section).toJSON());
});

it('rejects a current row owned by a different database', async () => {
  const fixture = databasePage();
  const row = fixture.addRow('row')!;

  row.getMap(YjsEditorKey.data_section).get('data').set('database_id', 'different');
  serve(fixture);
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('different owner');
});

it('preserves same-version local Document edits while merging current server bytes', async () => {
  const fixture = documentPage();

  serve(fixture);
  await verifyCreatedPage(owner, fixture.prepared);
  const cached = providers.get(fixture.remote.guid)!.doc;
  const cachedText = cached.getMap(YjsEditorKey.data_section).get('document').get('meta').get('text_map').get('paragraph-text') as Y.Text;

  cachedText.insert(0, 'unsent edit');
  await verifyCreatedPage(owner, fixture.prepared);
  expect(cachedText.toString()).toBe('unsent edit');
  expect(providers.get(fixture.remote.guid)!.doc).toBe(cached);
});

it('refuses a stale cache version without resetting or merging its local edits', async () => {
  const fixture = documentPage();

  serve(fixture);
  await verifyCreatedPage(owner, fixture.prepared);
  const cached = providers.get(fixture.remote.guid)!.doc;

  cached.version = 'stale';
  const before = Y.encodeStateAsUpdate(cached);

  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('cache version differs');
  expect(Y.encodeStateAsUpdate(cached)).toEqual(before);
});

it('refuses a restore change between current content and provider publication', async () => {
  const fixture = databasePage();

  serve(fixture);
  let reads = 0;

  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => url.endsWith('restore-state')
    ? { database_restore_id: reads++ ? 'new-restore' : null, version: null } as never : fixture.folder as never);
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('restore changed');
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
});

it('refuses storage generation changes at publication without mutating canonical content', async () => {
  const fixture = databasePage();

  serve(fixture);
  jest.mocked(publishWithDatabaseStorageFence).mockResolvedValue(false);
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('storage changed');
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
});

it('propagates current permission failure rather than activating a cached substitute', async () => {
  const fixture = documentPage();

  serve(fixture);
  jest.mocked(atomicRead).mockRejectedValue(new Error('permission revoked'));
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('permission revoked');
  expect(openCollabDBWithProvider).not.toHaveBeenCalled();
});

it('opens a recovered Database in its current restore namespace without resetting local edits', async () => {
  const fixture = databasePage();

  fixture.remote.version = 'current-version';
  serve(fixture);
  publishDatabaseCacheEpoch(fixture.remote.guid, 'current-restore');
  jest.mocked(captureDatabaseStorageFence).mockResolvedValue({ databaseId: fixture.remote.guid, epoch: 'current-restore', cacheEpoch: 'current-restore' });
  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => url.endsWith('restore-state')
    ? { database_restore_id: 'current-restore', version: 'current-version' } as never : fixture.folder as never);
  await verifyCreatedPage(owner, fixture.prepared);
  expect(openCollabDBWithProvider).toHaveBeenCalledWith(fixture.remote.guid, { awaitSync: true, databaseRestoreId: 'current-restore' });
  expect(providers.get(fixture.remote.guid)!.provider.set).toHaveBeenCalledWith(`${fixture.remote.guid}/version`, 'current-version');
  expect(providers.get(fixture.remote.guid)!.doc.version).toBe('current-version');
});

it('does not publish if the owner changes while version persistence is pending', async () => {
  const fixture = documentPage();

  fixture.remote.version = 'version';
  serve(fixture);
  jest.mocked(openCollabDBWithProvider).mockImplementation(async (id) => {
    const entry = { doc: doc(id), provider: { set: jest.fn(async () => {
      jest.mocked(owner.assertCurrent).mockImplementation(() => { throw new Error('owner replaced'); });
    }) } };

    providers.set(id, entry);
    return entry as never;
  });
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('owner replaced');
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
});

it('does not publish if storage rotates while version persistence is pending', async () => {
  const fixture = databasePage();

  fixture.remote.version = 'version';
  serve(fixture);
  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => url.endsWith('restore-state')
    ? { database_restore_id: null, version: 'version' } as never : fixture.folder as never);
  jest.mocked(openCollabDBWithProvider).mockImplementation(async (id) => {
    const entry = { doc: doc(id), provider: { set: jest.fn(async () => {
      publishDatabaseCacheEpoch(id, 'new-restore');
    }) } };

    providers.set(id, entry);
    return entry as never;
  });
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('storage changed');
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
});

it('refuses an empty cache carrying stale durable version metadata', async () => {
  const fixture = documentPage();

  serve(fixture);
  jest.mocked(openCollabDBWithProvider).mockImplementation(async (id) => {
    const empty = doc(id);

    empty.version = 'old-version';
    const entry = { doc: empty, provider: { set: jest.fn() } };

    providers.set(id, entry);
    return entry as never;
  });
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('cache version differs');
  expect(providers.get(fixture.remote.guid)!.doc.version).toBe('old-version');
  expect(providers.get(fixture.remote.guid)!.doc.getMap(YjsEditorKey.data_section).size).toBe(0);
});

it('rejects a root retired while its Row providers are still opening', async () => {
  const fixture = databasePage();

  fixture.addRow('row');
  serve(fixture);
  let retired: YDoc | undefined;

  jest.mocked(openRowCollabDBWithProvider).mockImplementation(async (id) => {
    retired = providers.get(fixture.remote.guid)!.doc;
    retired.destroy();
    providers.delete(fixture.remote.guid);
    const entry = { doc: doc(id), provider: { set: jest.fn() } };

    providers.set(id, entry);
    return entry as never;
  });
  await expect(verifyCreatedPage(owner, fixture.prepared)).rejects.toThrow('provider retired');
  expect(retired!.getMap(YjsEditorKey.data_section).size).toBe(0);
});
