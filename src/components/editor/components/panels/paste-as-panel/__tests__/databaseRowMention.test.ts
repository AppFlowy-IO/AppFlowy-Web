import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { rowDocumentIdFromRowId } from '@/application/row-document/lifecycle';
import {
  MentionType,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  DatabaseRowMentionResolverDependencies,
  resolveDatabaseRowPageMention,
} from '../databaseRowMention';

const workspaceId = '3df0c6bb-417f-4f81-939a-c6114f160f9a';
const databaseId = '1cd808b6-7f36-45e5-b520-42ebd6f620f4';
const databaseViewId = 'b709de16-f480-43cb-a175-03b1808449cf';
const rowId = '439bd5d7-6b22-4117-8465-539dcc6c55d9';

function createDatabaseDoc(): YDoc {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const primaryField = new Y.Map() as YDatabaseField;
  const views = new Y.Map();
  const inlineView = new Y.Map();
  const rowOrders = new Y.Array<{ id: string; is_deleted?: boolean }>();
  const metas = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, 'primary-field');
  primaryField.set(YjsDatabaseKey.name, 'Name');
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', primaryField);
  rowOrders.push([{ id: rowId }]);
  inlineView.set(YjsDatabaseKey.is_inline, true);
  inlineView.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(databaseViewId, inlineView);
  metas.set(YjsDatabaseKey.iid, databaseViewId);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function createRowDoc(title: string): YDoc {
  const doc = new Y.Doc({ guid: rowId }) as YDoc;

  initialDatabaseRow(rowId, databaseId, doc);
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
  cell.set(YjsDatabaseKey.data, title);
  row.get(YjsDatabaseKey.cells).set('primary-field', cell);
  return doc;
}

function resolverDependencies(rowDoc: YDoc): DatabaseRowMentionResolverDependencies {
  return {
    getDatabaseId: jest.fn(async () => databaseId),
    getCachedRow: jest.fn(() => rowDoc),
    getRowCollab: jest.fn(async () => ({ data: new Uint8Array() })),
    createRowDoc: jest.fn(() => new Y.Doc() as YDoc),
    applyRowUpdate: jest.fn(),
  };
}

describe('resolveDatabaseRowPageMention', () => {
  it('builds a titled database-row PageRef from the cached row', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc('PRJ-001');
    const dependencies = resolverDependencies(rowDoc);
    const loadView = jest.fn(async () => databaseDoc);

    await expect(
      resolveDatabaseRowPageMention(
        workspaceId,
        { workspaceId, viewId: databaseViewId, rowId },
        loadView,
        dependencies
      )
    ).resolves.toEqual({
      type: MentionType.PageRef,
      page_id: databaseViewId,
      block_id: rowId,
      row_id: rowId,
      database_id: databaseId,
      database_view_id: databaseViewId,
      database_row_id: rowId,
      row_document_id: rowDocumentIdFromRowId(rowId),
      data: { title: 'PRJ-001' },
    });

    expect(loadView).toHaveBeenCalledWith(databaseViewId, false, false, {
      databaseId,
      databaseMetadataOnly: true,
    });
    expect(dependencies.getRowCollab).not.toHaveBeenCalled();
  });

  it('fetches only the target row when it is not cached', async () => {
    const databaseDoc = createDatabaseDoc();
    const sourceRowDoc = createRowDoc('PRJ-002');
    const dependencies = resolverDependencies(sourceRowDoc);

    dependencies.getCachedRow = jest.fn(() => undefined);
    dependencies.getRowCollab = jest.fn(async () => ({ data: Y.encodeStateAsUpdate(sourceRowDoc) }));
    dependencies.createRowDoc = jest.fn(() => new Y.Doc({ guid: rowId }) as YDoc);
    dependencies.applyRowUpdate = jest.fn((doc, update) => Y.applyUpdate(doc, update));

    await expect(
      resolveDatabaseRowPageMention(
        workspaceId,
        { workspaceId, viewId: databaseViewId, rowId },
        async () => databaseDoc,
        dependencies
      )
    ).resolves.toMatchObject({
      type: MentionType.PageRef,
      row_id: rowId,
      data: { title: 'PRJ-002' },
    });

    expect(dependencies.getRowCollab).toHaveBeenCalledWith(workspaceId, rowId);
  });

  it('rejects a cached row that belongs to another database', async () => {
    const databaseDoc = createDatabaseDoc();
    const wrongRowDoc = createRowDoc('Wrong database');
    const wrongRow = wrongRowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;

    wrongRow.set(YjsDatabaseKey.database_id, 'another-database');
    const dependencies = resolverDependencies(wrongRowDoc);

    dependencies.getRowCollab = jest.fn(async () => ({ data: new Uint8Array() }));

    await expect(
      resolveDatabaseRowPageMention(
        workspaceId,
        { workspaceId, viewId: databaseViewId, rowId },
        async () => databaseDoc,
        dependencies
      )
    ).resolves.toBeNull();
  });
});
