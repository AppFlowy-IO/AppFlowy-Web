import * as Y from 'yjs';

import {
  CommittedRowActivationError,
  createCloudRow,
  CloudRowCreationIntent,
} from '@/application/database-yjs/creation/create-row';
import { createRowInRelatedDatabase } from '@/application/database-yjs/dispatch/relation';
import { View, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/application/database-yjs/creation/create-row', () => ({
  ...jest.requireActual('@/application/database-yjs/creation/create-row'),
  createCloudRow: jest.fn(),
}));

const publish = createCloudRow as jest.Mock;
const docs: Y.Doc[] = [];
function fixture() {
  const doc = new Y.Doc({ guid: 'f7873417-5a12-491b-ab04-ed9a01caf95b' }) as YDoc;
  const database = new Y.Map<unknown>();
  const views = new Y.Map<unknown>();
  const view = new Y.Map<unknown>();
  const orders = new Y.Array<{ id: string; height: number }>();
  const fields = new Y.Map<unknown>();

  docs.push(doc);
  doc.getMap('data').set('database', database);
  database.set('id', doc.guid);
  database.set('views', views);
  database.set('fields', fields);
  fields.set(
    'title',
    new Y.Map<unknown>([
      ['id', 'title'],
      ['ty', 0],
      ['is_primary', true],
    ])
  );
  views.set('a9c430ac-35c2-47f6-9f62-64058c8081f2', view);
  view.set('id', 'a9c430ac-35c2-47f6-9f62-64058c8081f2');
  view.set('is_inline', false);
  view.set('row_orders', orders);
  const createRow = jest.fn(async () => {
    const row = new Y.Doc() as YDoc;

    docs.push(row);
    return row;
  });

  return {
    workspaceId: '5608c0f3-73e0-46ad-aeab-30902ec541f6',
    sourceViewId: 'a9c430ac-35c2-47f6-9f62-64058c8081f2',
    relatedDatabaseDoc: doc,
    primaryFieldId: 'title',
    primaryText: '  Related work  ',
    createRow,
    assertCurrent: jest.fn(),
    bindViewSync: jest.fn(),
    orders,
  };
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => docs.splice(0).forEach((doc) => doc.destroy()));

test('related row remains private until atomic publication succeeds and exposes no local membership', async () => {
  const args = fixture();
  const before = Y.encodeStateAsUpdate(args.relatedDatabaseDoc);
  let release!: () => void;
  let intent!: CloudRowCreationIntent;
  const destroyed = jest.fn();
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  publish.mockImplementation(async (request: CloudRowCreationIntent) => {
    intent = request;
    request.rowDoc.on('destroy', destroyed);
    await gate;
    request.assertCurrent();
    await request.registerRow();
    return request.rowId;
  });
  const pending = createRowInRelatedDatabase(args);

  expect(args.orders.length).toBe(0);
  expect(Y.encodeStateAsUpdate(args.relatedDatabaseDoc)).toEqual(before);
  expect(args.createRow).not.toHaveBeenCalled();
  expect(args.bindViewSync).not.toHaveBeenCalled();
  expect(intent.position).toEqual({ kind: 'end' });
  expect(intent.workspaceId).toBe(args.workspaceId);
  expect(intent.sourceViewId).toBe(args.sourceViewId);
  const privateRow = intent.rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

  expect(privateRow.get(YjsDatabaseKey.cells).get('title').get(YjsDatabaseKey.data)).toBe('Related work');
  release();
  expect(await pending).toBe(intent.rowId);
  expect(args.createRow).toHaveBeenCalledTimes(1);
  expect(args.bindViewSync).toHaveBeenCalledWith(args.relatedDatabaseDoc);
  expect(destroyed).toHaveBeenCalledTimes(1);
  // Membership comes only from the shared canonical activation component, never this caller.
  expect(Y.encodeStateAsUpdate(args.relatedDatabaseDoc)).toEqual(before);
});

test('offline refusal destroys the prepared row without publishing cache, membership or binding', async () => {
  const args = fixture();
  const destroyed = jest.fn();

  publish.mockImplementation(async (request: CloudRowCreationIntent) => {
    request.rowDoc.on('destroy', destroyed);
    throw new Error('offline');
  });
  await expect(createRowInRelatedDatabase(args)).rejects.toThrow('offline');
  expect(destroyed).toHaveBeenCalledTimes(1);
  expect(args.createRow).not.toHaveBeenCalled();
  expect(args.bindViewSync).not.toHaveBeenCalled();
  expect(args.orders.length).toBe(0);
});

test('ownership changes while committing cannot return a row for the replacement relation picker', async () => {
  const args = fixture();

  publish.mockImplementation(async () => {
    args.assertCurrent.mockImplementation(() => {
      throw new Error('owner changed');
    });
  });
  await expect(createRowInRelatedDatabase(args)).rejects.toBeInstanceOf(CommittedRowActivationError);
  expect(args.bindViewSync).not.toHaveBeenCalled();
});

test('empty text and a missing source view do not issue a creation request', async () => {
  const args = fixture();

  expect(await createRowInRelatedDatabase({ ...args, primaryText: '  ' })).toBeNull();
  await expect(createRowInRelatedDatabase({ ...args, sourceViewId: 'absent' })).rejects.toThrow('view is required');
  expect(publish).not.toHaveBeenCalled();
  expect(args.createRow).not.toHaveBeenCalled();
});

test('a relation targeting a database container creates through its registered child view', async () => {
  const args = fixture();
  const loadViewMeta = jest.fn(
    async () =>
      ({
        view_id: 'container',
        extra: { is_database_container: true, database_id: args.relatedDatabaseDoc.guid },
        children: [{ view_id: 'stale-tab' }, { view_id: args.sourceViewId }],
      } as View)
  );

  publish.mockImplementation(async (request: CloudRowCreationIntent) => request.rowId);
  await expect(createRowInRelatedDatabase({ ...args, sourceViewId: 'container', loadViewMeta })).resolves.toBeTruthy();
  expect(loadViewMeta).toHaveBeenCalledWith('container', undefined, { authoritative: true });
  expect(publish.mock.calls[0][0].sourceViewId).toBe(args.sourceViewId);
  expect(args.orders.length).toBe(0);
});

test('a foreign container or an unmounted source never falls back to another existing tab', async () => {
  const args = fixture();
  const loadViewMeta = jest.fn(
    async () =>
      ({
        view_id: 'container',
        extra: { is_database_container: true, database_id: 'another-database' },
        children: [{ view_id: args.sourceViewId }],
      } as View)
  );

  await expect(createRowInRelatedDatabase({ ...args, sourceViewId: 'container', loadViewMeta })).rejects.toThrow(
    'view is required'
  );
  loadViewMeta.mockResolvedValue({
    view_id: 'container',
    extra: { is_database_container: true, database_id: args.relatedDatabaseDoc.guid },
    children: [],
  } as unknown as View);
  await expect(createRowInRelatedDatabase({ ...args, sourceViewId: 'container', loadViewMeta })).rejects.toThrow(
    'view is required'
  );
  expect(publish).not.toHaveBeenCalled();
});

test('post-commit provider failure preserves the related row identity and reload guidance', async () => {
  const args = fixture();
  publish.mockImplementation(async (request: CloudRowCreationIntent) => request.rowId);
  args.bindViewSync.mockImplementation(() => {
    throw new Error('provider unavailable');
  });
  const error = await createRowInRelatedDatabase(args).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(CommittedRowActivationError);
  expect((error as CommittedRowActivationError).rowId).toBe(publish.mock.calls[0][0].rowId);
  expect((error as CommittedRowActivationError).cause).toEqual(new Error('provider unavailable'));
  expect(publish).toHaveBeenCalledTimes(1);
});
