import EventEmitter from 'events';

import { waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { createField, createFieldWithTypeOption, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { FieldType } from '@/application/database-yjs/database.type';
import * as decode from '@/application/database-yjs/decode';
import { MentionablePerson, YDatabase, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createFeedSearchIndex, FeedSearchData } from '../feed-search';

function databaseFixture() {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.fields, fields);
  fields.set('title', createField('title', FieldType.RichText).clone());
  fields.get('title').set(YjsDatabaseKey.is_primary, true);
  return { doc, database, fields };
}

const users = [{ uid: '42', person_id: 'alice', name: 'Alice', email: 'alice@example.com' }] as MentionablePerson[];

it('indexes visible resolved values and metadata, observes edits, and releases removed source documents', async () => {
  const { database, fields } = databaseFixture();

  fields.set('person', createField('person', FieldType.Person).clone());
  fields.set('author', createField('author', FieldType.CreatedBy).clone());
  fields.set('editor', createField('editor', FieldType.LastEditedBy).clone());
  fields.set(
    'status',
    createField('status', FieldType.SingleSelect, { options: [{ id: 'todo', name: 'Ready' }] }).clone()
  );
  const doc = createRowDoc('row', 'database', {
    title: { fieldType: FieldType.RichText, data: 'Post' },
    person: { fieldType: FieldType.Person, data: '["alice"]' },
    status: { fieldType: FieldType.SingleSelect, data: 'todo' },
  });
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!;

  row.set(YjsDatabaseKey.created_by, '42');
  row.set(YjsDatabaseKey.last_edited_by, '42');
  const index = createFeedSearchIndex();
  const input: FeedSearchData = {
    database,
    rows: { row: doc },
    fieldIds: ['title', 'person', 'author', 'editor', 'status'],
    users,
  };

  index.configure(input);
  expect(index.getSnapshot().get('row')).toBe(
    'post alice alice@example.com alice alice@example.com alice alice@example.com ready'
  );
  index.configure({ ...input, fieldIds: ['title', 'status'] });
  expect(index.getSnapshot().get('row')).toBe('post ready');
  row.get(YjsDatabaseKey.cells).get('title')!.set(YjsDatabaseKey.data, 'Changed');
  await waitFor(() => expect(index.getSnapshot().get('row')).toBe('changed ready'));
  const replacement = createRowDoc('row', 'database', { title: { fieldType: FieldType.RichText, data: 'Replacement' } });

  index.configure({ ...input, fieldIds: ['title'], rows: { row: replacement } });
  row.get(YjsDatabaseKey.cells).get('title')!.set(YjsDatabaseKey.data, 'Stale');
  await Promise.resolve();
  expect(index.getSnapshot().get('row')).toBe('replacement');
  index.dispose();
  expect(index.getSnapshot().size).toBe(0);
});

it('uses hydrated cached values until the live shell hydrates, without reconfiguration', async () => {
  const { database } = databaseFixture();
  const live = new Y.Doc() as YDoc;
  const cached = createRowDoc('row', 'database', { title: { fieldType: FieldType.RichText, data: 'Cached' } });
  const index = createFeedSearchIndex();

  index.configure({ database, rows: { row: live }, fallbackRows: { row: cached }, fieldIds: ['title'], users: [] });
  expect(index.getSnapshot().get('row')).toBe('cached');
  const hydrated = createRowDoc('row', 'database', { title: { fieldType: FieldType.RichText, data: 'Live' } });

  Y.applyUpdate(live, Y.encodeStateAsUpdate(hydrated));
  await waitFor(() => expect(index.getSnapshot().get('row')).toBe('live'));
  index.dispose();
});

it('indexes hydrated candidates once while unchanged sync registrations complete, and still observes edits', async () => {
  const { database } = databaseFixture();
  const rows = Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => [
      String(i),
      createRowDoc(String(i), 'database', { title: { fieldType: FieldType.RichText, data: 'Cached title' } }),
    ])
  );
  const ensureRow = jest.fn(async (rowId: string) => rows[rowId]);
  const decodeCell = jest.spyOn(decode, 'decodeCellToText');
  const index = createFeedSearchIndex();
  const input: FeedSearchData = { database, rows, fieldIds: ['title'], users: [], ensureRow };

  try {
    // Clearing and restarting a search must not reindex every row for each
    // batch of registrations that returns the documents already being observed.
    for (let session = 0; session < 2; session++) {
      ensureRow.mockClear();
      decodeCell.mockClear();
      index.configure(input);
      await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(1000));
      await Promise.all(ensureRow.mock.results.map(({ value }) => value));
      expect(index.getSnapshot().size).toBe(1000);
      expect(decodeCell).toHaveBeenCalledTimes(1000);
      if (session === 0) index.dispose();
    }

    rows['0']
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row)!
      .get(YjsDatabaseKey.cells)
      .get('title')!
      .set(YjsDatabaseKey.data, 'Changed remotely');
    await waitFor(() => expect(index.getSnapshot().get('0')).toBe('changed remotely'));
  } finally {
    index.dispose();
    decodeCell.mockRestore();
  }
});

it('deduplicates relation targets and observes hydration, deletion, access loss and document reset', async () => {
  const source = databaseFixture();

  source.fields.set(
    'relation',
    createFieldWithTypeOption('relation', FieldType.Relation, { database_id: 'target' }).clone()
  );
  const target = databaseFixture();
  const views = new Y.Map();
  const view = new Y.Map();
  const orders = new Y.Array();

  orders.push([{ id: 'related' }]);
  view.set(YjsDatabaseKey.row_orders, orders);
  views.set('view', view);
  target.database.set(YjsDatabaseKey.views, views as never);
  const targetRow = new Y.Doc() as YDoc;
  const createRow = jest.fn().mockResolvedValue(targetRow);
  const loadView = jest.fn().mockResolvedValue(target.doc);
  const getViewIdFromDatabaseId = jest.fn().mockResolvedValue('target-view');
  const eventEmitter = new EventEmitter();
  const rows = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => {
      const relation = new Y.Array();

      relation.push(['related']);
      return [
        String(i),
        createRowDoc(String(i), 'source', { relation: { fieldType: FieldType.Relation, data: relation } }),
      ];
    })
  );
  const index = createFeedSearchIndex();

  index.configure({
    database: source.database,
    rows,
    fieldIds: ['relation'],
    users: [],
    createRow,
    loadView,
    getViewIdFromDatabaseId,
    eventEmitter,
  });
  await waitFor(() => expect(createRow).toHaveBeenCalledTimes(1));
  expect(loadView).toHaveBeenCalledTimes(1);
  const hydrated = createRowDoc('related', 'target', {
    title: { fieldType: FieldType.RichText, data: 'Related label' },
  });

  Y.applyUpdate(targetRow, Y.encodeStateAsUpdate(hydrated));
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('related label'));
  orders.delete(0);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe(''));
  orders.push([{ id: 'related' }]);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('related label'));
  target.fields.get('title').set(YjsDatabaseKey.is_primary, false);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe(''));
  target.fields.get('title').set(YjsDatabaseKey.is_primary, true);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('related label'));
  const replacement = new Y.Doc() as YDoc;

  eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: 'related', doc: replacement });
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe(''));
  Y.applyUpdate(
    replacement,
    Y.encodeStateAsUpdate(
      createRowDoc('related', 'target', { title: { fieldType: FieldType.RichText, data: 'Replacement' } })
    )
  );
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('replacement'));
  index.dispose();
  expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(0);
});

it('bounds related row requests and ignores pending completions after disposal', async () => {
  const source = databaseFixture();

  source.fields.set(
    'relation',
    createFieldWithTypeOption('relation', FieldType.Relation, { database_id: 'target' }).clone()
  );
  const target = databaseFixture();
  const relation = new Y.Array();

  relation.push(Array.from({ length: 30 }, (_, i) => `related-${i}`));
  const row = createRowDoc('row', 'source', { relation: { fieldType: FieldType.Relation, data: relation } });
  const resolvers: Array<(doc: YDoc) => void> = [];
  const createRow = jest.fn(() => new Promise<YDoc>((resolve) => resolvers.push(resolve)));
  const index = createFeedSearchIndex();

  index.configure({
    database: source.database,
    rows: { row },
    fieldIds: ['relation'],
    users: [],
    createRow,
    loadView: jest.fn().mockResolvedValue(target.doc),
    getViewIdFromDatabaseId: jest.fn().mockResolvedValue('target-view'),
  });
  await waitFor(() => expect(createRow).toHaveBeenCalledTimes(8));
  index.dispose();
  resolvers.forEach((resolve) => resolve(new Y.Doc() as YDoc));
  await Promise.resolve();
  await Promise.resolve();
  expect(createRow).toHaveBeenCalledTimes(8);
  expect(index.getSnapshot().size).toBe(0);
});

it('bounds candidate sync work and observes remote values without mounting a card', async () => {
  const { database } = databaseFixture();
  const rows = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      String(i),
      createRowDoc(String(i), 'database', { title: { fieldType: FieldType.RichText, data: 'Seed' } }),
    ])
  );
  const pending: Array<(doc: YDoc) => void> = [];
  const ensureRow = jest.fn(() => new Promise<YDoc>((resolve) => pending.push(resolve)));
  const index = createFeedSearchIndex();

  index.configure({ database, rows, fieldIds: ['title'], users: [], ensureRow });
  expect(ensureRow).toHaveBeenCalledTimes(8);
  expect(index.getSnapshot().get('0')).toBe('seed');
  const canonical = createRowDoc('0', 'database', { title: { fieldType: FieldType.RichText, data: 'Remote' } });

  pending[0](canonical);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('remote'));
  expect(ensureRow).toHaveBeenCalledTimes(9);
  canonical
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row)!
    .get(YjsDatabaseKey.cells)
    .get('title')!
    .set(YjsDatabaseKey.data, 'Changed remotely');
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('changed remotely'));
  index.dispose();
  pending.slice(1).forEach((resolve) => resolve(new Y.Doc() as YDoc));
  await Promise.resolve();
  await Promise.resolve();
  expect(ensureRow).toHaveBeenCalledTimes(9);
});

it('resolves relation labels before draining the candidate sync queue', async () => {
  const source = databaseFixture();
  const target = databaseFixture();

  source.fields.set(
    'relation',
    createFieldWithTypeOption('relation', FieldType.Relation, { database_id: 'target' }).clone()
  );
  const rows = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => {
      const relation = new Y.Array();

      relation.push(['related']);
      return [
        String(i),
        createRowDoc(String(i), 'source', { relation: { fieldType: FieldType.Relation, data: relation } }),
      ];
    })
  );
  const pending: Array<(doc: YDoc) => void> = [];
  const ensureRow = jest.fn(() => new Promise<YDoc>((resolve) => pending.push(resolve)));
  const targetRow = createRowDoc('related', 'target', { title: { fieldType: FieldType.RichText, data: 'Related' } });
  const createRow = jest.fn().mockResolvedValue(targetRow);
  const index = createFeedSearchIndex();

  index.configure({
    database: source.database,
    rows,
    fieldIds: ['relation'],
    users: [],
    ensureRow,
    createRow,
    loadView: jest.fn().mockResolvedValue(target.doc),
    getViewIdFromDatabaseId: jest.fn().mockResolvedValue('view'),
  });
  expect(ensureRow).toHaveBeenCalledTimes(8);
  pending[0](rows['0']);
  await waitFor(() => expect(index.getSnapshot().get('0')).toBe('related'));
  expect(createRow).toHaveBeenCalledTimes(1);
  expect(ensureRow.mock.calls.length).toBeLessThan(30);
  index.dispose();
  pending.slice(1).forEach((resolve) => resolve(new Y.Doc() as YDoc));
});
