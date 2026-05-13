import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch/row';
import { getMetaIdMap, getRowKey } from '@/application/database-yjs/row_meta';
import { RowId, YDatabase, YDatabaseField, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Yjs = require('yjs');

  return {
    deleteCollabDB: jest.fn(),
    getCachedProviderDoc: jest.fn(),
    openCollabDB: jest.fn(async () => new Yjs.Doc()),
  };
});

const databaseId = 'database-id';
const databaseDocId = '00000000-0000-4000-8000-000000000001';
const viewId = 'view-id';
const sourceRowId = 'source-row-id';
const fieldId = 'name-field-id';

function createField(fieldId: string): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Name');
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

function createDatabaseDoc(): YDoc {
  const doc = new Y.Doc({ guid: databaseDocId }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();

  fields.set(fieldId, createField(fieldId));
  rowOrders.push([{ id: sourceRowId, height: 36 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function createReferenceRowDoc(options: {
  documentId?: string;
  isEmptyDocument?: boolean;
} = {}): YDoc {
  const rowDoc = createRowDoc(sourceRowId, databaseId, {
    [fieldId]: createCell(FieldType.RichText, 'Source row'),
  });
  const meta = new Y.Map<unknown>();
  const metaKeys = getMetaIdMap(sourceRowId);

  if (options.documentId !== undefined) {
    meta.set(metaKeys.get(RowMetaKey.DocumentId) ?? '', options.documentId);
  }

  if (options.isEmptyDocument !== undefined) {
    meta.set(metaKeys.get(RowMetaKey.IsDocumentEmpty) ?? '', options.isEmptyDocument);
  }

  rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.meta, meta);
  return rowDoc;
}

function getRowMetaValue(rowDoc: YDoc, rowId: string, key: RowMetaKey) {
  const metaKey = getMetaIdMap(rowId).get(key) ?? '';
  const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

  return meta.get(metaKey);
}

function createWrapper({
  databaseDoc,
  referenceRowDoc,
  createdRows,
  duplicateRowDocument,
}: {
  databaseDoc: YDoc;
  referenceRowDoc: YDoc;
  createdRows: Map<string, YDoc>;
  duplicateRowDocument: NonNullable<DatabaseContextState['duplicateRowDocument']>;
}) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: 'database-page-id',
    activeViewId: viewId,
    rowMap: {
      [sourceRowId]: referenceRowDoc,
    },
    workspaceId: 'workspace-id',
    createRow: async (rowKey: string) => {
      const rowDoc = new Y.Doc({ guid: rowKey }) as YDoc;

      createdRows.set(rowKey, rowDoc);
      return rowDoc;
    },
    duplicateRowDocument,
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useDuplicateRowDispatch', () => {
  it('does not create or duplicate a row page when the source row is document-empty', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc({ isEmptyDocument: true });
    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument }),
    });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current(sourceRowId);
    });

    const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId));

    expect(createdRowDoc).toBeDefined();
    expect(getRowMetaValue(createdRowDoc as YDoc, duplicatedRowId, RowMetaKey.IsDocumentEmpty)).toBe(true);
    expect(duplicateRowDocument).not.toHaveBeenCalled();
  });

  it('keeps duplicated rows with unknown document state marked empty until content is confirmed', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc();
    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument }),
    });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current(sourceRowId);
    });

    const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId));

    expect(createdRowDoc).toBeDefined();
    expect(getRowMetaValue(createdRowDoc as YDoc, duplicatedRowId, RowMetaKey.IsDocumentEmpty)).toBe(true);
    expect(duplicateRowDocument).toHaveBeenCalledWith(databaseId, sourceRowId, duplicatedRowId, undefined);
  });

  it('still requests row page duplication for a known non-empty source document', async () => {
    const sourceDocumentId = 'source-document-id';
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc({
      documentId: sourceDocumentId,
      isEmptyDocument: false,
    });
    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument }),
    });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current(sourceRowId);
    });

    const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId));

    expect(createdRowDoc).toBeDefined();
    expect(getRowMetaValue(createdRowDoc as YDoc, duplicatedRowId, RowMetaKey.IsDocumentEmpty)).toBe(false);
    expect(duplicateRowDocument).toHaveBeenCalledWith(databaseId, sourceRowId, duplicatedRowId, undefined);
  });
});
