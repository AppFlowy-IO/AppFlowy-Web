import * as Y from 'yjs';

import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { writeTemplateRecords } from '@/application/database-yjs/template/storage';

import { hasCurrentRowDocumentSource, waitForRowDocumentSource } from '../row-source-readiness';

const rowId = '11111111-1111-4111-8111-111111111111';
const documentId = getMetaIdMap(rowId).get(RowMetaKey.DocumentId)!;

it.each(['current', 'missing', 'deleted', 'other-row', 'other-document', 'missing-view'])('checks %s hidden template source', (kind) => {
  const doc = new Y.Doc();
  const root = doc.getMap('database');
  const metas = new Y.Map<unknown>();

  root.set('metas', metas);
  root.set('views', new Y.Map([['view', new Y.Map([['row_orders', new Y.Array()]])]]));
  if (kind !== 'missing') {
    writeTemplateRecords(metas, [{
      template_id: kind === 'other-row' ? 'another-row' : rowId,
      name: 'Template', doc_view_id: kind === 'other-document' ? 'another-document' : documentId,
    }]);
  }

  if (kind === 'deleted') writeTemplateRecords(metas, []);

  expect(hasCurrentRowDocumentSource(root, kind === 'missing-view' ? 'another-view' : 'view', rowId)).toBe(kind === 'current');
  doc.destroy();
});

it.each([false, true])('uses canonical visibility for linked row membership (Y.Map entries=%s)', async (asMap) => {
  const doc = new Y.Doc({ guid: 'database' });
  const database = new Y.Map<unknown>();
  const linkedOrders = new Y.Array();
  const inlineOrders = new Y.Array();
  const order = (id: string, deleted: boolean) => asMap
    ? new Y.Map<unknown>([['id', id], ['is_deleted', deleted]])
    : { id, is_deleted: deleted };

  doc.getMap('data').set('database', database);
  database.set('id', 'database');
  database.set('metas', new Y.Map([['iid', 'inline']]));
  database.set('views', new Y.Map([
    ['linked', new Y.Map([['row_orders', linkedOrders]])],
    ['inline', new Y.Map([['row_orders', inlineOrders]])],
  ]));
  linkedOrders.push([order(rowId, true), order('deleted', false), order('linked-only', false)]);
  inlineOrders.push([order(rowId, false), order('deleted', true), order('inline-only', false)]);

  expect(hasCurrentRowDocumentSource(database, 'linked', rowId)).toBe(true);
  expect(hasCurrentRowDocumentSource(database, 'linked', 'deleted')).toBe(false);
  expect(hasCurrentRowDocumentSource(database, 'linked', 'linked-only')).toBe(true);
  expect(hasCurrentRowDocumentSource(database, 'linked', 'inline-only')).toBe(false);

  const row = new Y.Doc({ guid: rowId });

  row.getMap('data').set('data', new Y.Map([['id', rowId], ['database_id', 'database']]));
  const state = (value: Y.Doc) => ({ object_id: value.guid, doc_state: Array.from(Y.encodeStateAsUpdate(value)), version: 0 });
  const rowState = state(row);
  const read = jest.fn(async () => ({ database: state(doc), row: rowState }));

  try {
    await expect(waitForRowDocumentSource({ databaseId: 'database', sourceViewId: 'linked', rowId }, {
      read, assertCurrent: () => {}, signal: new AbortController().signal, deadline: Date.now() + 1_000,
    })).resolves.toBe(rowState);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    row.destroy();
    doc.destroy();
  }
});
