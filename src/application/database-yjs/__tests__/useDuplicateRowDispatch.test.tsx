import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  FieldType,
  RowMetaKey,
  TimelineDependencyDirection,
  TimelineDependencyType,
} from '@/application/database-yjs/database.type';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch/row';
import { getMetaIdMap, getRowKey } from '@/application/database-yjs/row_meta';
import { getCachedProviderDoc } from '@/application/db';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { CommittedRowActivationError, createCloudRow, type CloudRowCreationIntent } from '../creation/create-row';
import { readTimelineLayoutSetting, updateTimelineLayoutSetting } from '../timeline-layout';

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

jest.mock('../creation/create-row', () => ({
  ...jest.requireActual('../creation/create-row'),
  createCloudRow: jest.fn(),
}));
beforeEach(() => {
  jest.mocked(getCachedProviderDoc).mockReset();
  jest.mocked(createCloudRow).mockReset();
  jest.mocked(createCloudRow).mockImplementation(async (intent: CloudRowCreationIntent) => {
    intent.assertCurrent();
    const row = await intent.registerRow();

    Y.applyUpdate(row, Y.encodeStateAsUpdate(intent.rowDoc));
    const database = intent.databaseDoc.getMap('data').get('database') as YDatabase;

    database.get(YjsDatabaseKey.views).forEach((view) => {
      const orders = view.get(YjsDatabaseKey.row_orders);
      const anchor = intent.position.kind === 'after' ? intent.position.row_id : '';
      const index = orders.toArray().findIndex((order) => order.id === anchor);

      orders.insert(index + 1, [{ id: intent.rowId, height: 36 }]);
    });
    return intent.rowId;
  });
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

function createReferenceRowDoc(
  options: {
    documentId?: string;
    isEmptyDocument?: boolean;
    storedFieldType?: FieldType;
  } = {}
): YDoc {
  const rowDoc = createRowDoc(sourceRowId, databaseId, {
    [fieldId]: createCell(options.storedFieldType ?? FieldType.RichText, 'Source row'),
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
  sourceDocument,
  loadRowDocument,
}: {
  sourceDocument?: YDoc;
  loadRowDocument?: DatabaseContextState['loadRowDocument'];
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
    loadRowDocument:
      loadRowDocument ??
      (async () => {
        if (!sourceDocument) throw new Error('missing source document');
        return sourceDocument;
      }),
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useDuplicateRowDispatch', () => {
  it.each([TimelineDependencyDirection.BlockedBy, TimelineDependencyDirection.Blocking])(
    'copies custom dependency metadata for direction %s in every saved view',
    async (direction) => {
      const databaseDoc = createDatabaseDoc();
      const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const views = database.get(YjsDatabaseKey.views);
      const secondView = new Y.Map() as YDatabaseView;
      const orders = new Y.Array<{ id: RowId; height: number }>();

      orders.push([{ id: sourceRowId, height: 36 }]);
      secondView.set(YjsDatabaseKey.row_orders, orders);
      views.set('other-view', secondView);
      const referenceRowDoc = createReferenceRowDoc({ isEmptyDocument: true });
      const sourceRow = referenceRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      const relation = createField('dependency');

      relation.set(YjsDatabaseKey.type, FieldType.Relation);
      database.get(YjsDatabaseKey.fields).set('dependency', relation);
      const relationCell = new Y.Map() as YDatabaseCell;

      relationCell.set(YjsDatabaseKey.field_type, FieldType.Relation);
      relationCell.set(YjsDatabaseKey.data, ['related']);
      sourceRow.get(YjsDatabaseKey.cells).set('dependency', relationCell);
      const edge = (id: string) =>
        direction === TimelineDependencyDirection.Blocking ? `${id}:related` : `related:${id}`;
      const metadata = { type: TimelineDependencyType.StartToFinish, lag: -3 };

      views.forEach((view) =>
        updateTimelineLayoutSetting(view, {
          dependencyFieldId: 'dependency',
          dependencyDirection: direction,
          dependencyLinks: { [edge(sourceRowId)]: metadata, 'unrelated:edge': { ...metadata, lag: 8 } },
        })
      );
      const createdRows = new Map<string, YDoc>();
      const { result } = renderHook(() => useDuplicateRowDispatch(), {
        wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument: jest.fn() }),
      });
      let copiedId = '';

      await act(async () => {
        copiedId = await result.current(sourceRowId);
      });
      for (const id of [viewId, 'other-view']) {
        expect(readTimelineLayoutSetting(database, id, 0, false).dependencyLinks).toEqual({
          [edge(sourceRowId)]: metadata,
          [edge(copiedId)]: metadata,
          'unrelated:edge': { ...metadata, lag: 8 },
        });
      }

      const copiedDoc = createdRows.get(getRowKey(databaseDocId, copiedId)) as YDoc;
      const copied = copiedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      expect(copied.get(YjsDatabaseKey.cells).get('dependency').get(YjsDatabaseKey.data)).toEqual(['related']);
    }
  );

  it('preserves a lazy cell raw value and stored type', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc({ storedFieldType: FieldType.MultiSelect, isEmptyDocument: true });
    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument }),
    });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current(sourceRowId);
    });

    const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId)) as YDoc;
    const row = createdRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    expect(cell.get(YjsDatabaseKey.data)).toBe('Source row');
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(jest.mocked(createCloudRow).mock.calls[0][0].preserveCellStorage).toBe(true);
  });

  it('deep-clones Y.Array cell data so duplicate edits do not mutate the source', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc({ storedFieldType: FieldType.Relation, isEmptyDocument: true });
    const referenceRow = referenceRowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
    const referenceCell = referenceRow.get(YjsDatabaseKey.cells).get(fieldId);
    const sourceIds = new Y.Array<string>();

    referenceCell.set(YjsDatabaseKey.data, sourceIds);
    sourceIds.push(['row-a', 'row-b']);

    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument }),
    });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current(sourceRowId);
    });

    const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId)) as YDoc;
    const duplicatedRow = createdRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const duplicatedCell = duplicatedRow.get(YjsDatabaseKey.cells).get(fieldId);
    const duplicatedIds = duplicatedCell.get(YjsDatabaseKey.data) as Y.Array<string>;

    expect(duplicatedIds.toArray()).toEqual(['row-a', 'row-b']);
    duplicatedIds.push(['row-c']);
    expect(sourceIds.toArray()).toEqual(['row-a', 'row-b']);
    expect(duplicatedIds.toArray()).toEqual(['row-a', 'row-b', 'row-c']);
  });

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

  it('rejects duplication when unknown document state cannot be resolved', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc();
    const createdRows = new Map<string, YDoc>();
    const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
    const loadRowDocument = jest.fn(async () => null);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument, loadRowDocument }),
    });

    await act(async () => {
      await expect(result.current(sourceRowId)).rejects.toThrow('Source Row document is unavailable');
    });
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createdRows.size).toBe(0);
    expect(createCloudRow).not.toHaveBeenCalled();
    expect(duplicateRowDocument).not.toHaveBeenCalled();
  });

  it.each(
    [false, undefined].flatMap((isEmptyDocument) =>
      ['absent', 'empty', 'incomplete', 'nonempty'].map((cache) => ({ isEmptyDocument, cache }))
    )
  )(
    'copies a complete document with metadata $isEmptyDocument and a $cache cache',
    async ({ isEmptyDocument, cache }) => {
      const sourceDocumentId = 'source-document-id';
      const sourceDocument = new Y.Doc() as YDoc;
      const body = new Y.Map();
      const blocks = new Y.Map();
      const paragraph = new Y.Map();
      const meta = new Y.Map();
      const text = new Y.Text('Source content');
      const texts = new Y.Map();

      sourceDocument.getMap('data').set('document', body);
      body.set('blocks', blocks);
      body.set('meta', meta);
      meta.set('text_map', texts);
      texts.set('text', text);
      blocks.set('paragraph', paragraph);
      paragraph.set('external_id', 'text');
      const cached = new Y.Doc() as YDoc;

      if (cache === 'empty') {
        Y.applyUpdate(cached, Y.encodeStateAsUpdate(sourceDocument));
        const cachedBody = cached.getMap('data').get('document') as Y.Map<Y.Map<Y.Map<Y.Text>>>;
        const cachedText = cachedBody.get('meta')!.get('text_map')!.get('text')!;

        cachedText.delete(0, cachedText.length);
      }

      if (cache !== 'absent')
        jest.mocked(getCachedProviderDoc).mockReturnValue(cache === 'nonempty' ? sourceDocument : cached);
      const loadRowDocument = jest.fn(async () => sourceDocument);
      const databaseDoc = createDatabaseDoc();
      const referenceRowDoc = createReferenceRowDoc({
        documentId: sourceDocumentId,
        isEmptyDocument,
      });
      const createdRows = new Map<string, YDoc>();
      const duplicateRowDocument = jest.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useDuplicateRowDispatch(), {
        wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument, loadRowDocument }),
      });
      let duplicatedRowId = '';

      await act(async () => {
        duplicatedRowId = await result.current(sourceRowId);
      });

      const createdRowDoc = createdRows.get(getRowKey(databaseDocId, duplicatedRowId));

      expect(createdRowDoc).toBeDefined();
      expect(getRowMetaValue(createdRowDoc as YDoc, duplicatedRowId, RowMetaKey.IsDocumentEmpty)).toBe(false);
      expect(duplicateRowDocument).not.toHaveBeenCalled();
      const intent = jest.mocked(createCloudRow).mock.calls.at(-1)![0];

      expect(intent.documentState).toEqual(Y.encodeStateAsUpdate(sourceDocument));
      expect(intent.template).toMatchObject({
        docViewId: getMetaIdMap(sourceRowId).get(RowMetaKey.DocumentId),
        isDocumentEmpty: false,
      });
      expect(loadRowDocument).toHaveBeenCalledTimes(cache === 'nonempty' ? 0 : 1);
      if (cache !== 'nonempty') {
        expect(loadRowDocument).toHaveBeenCalledWith(getMetaIdMap(sourceRowId).get(RowMetaKey.DocumentId), {
          requireServerFetch: true,
          rowDocumentSource: { database_id: databaseId, database_view_id: viewId, row_id: sourceRowId },
        });
      }

      cached.destroy();
      sourceDocument.destroy();
    }
  );

  it('omits the body only after loading and confirming an unknown document is empty', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc();
    const shell = new Y.Doc() as YDoc;
    const body = new Y.Map();
    const meta = new Y.Map();

    shell.getMap('data').set('document', body);
    body.set('blocks', new Y.Map());
    body.set('meta', meta);
    meta.set('text_map', new Y.Map());
    const loadRowDocument = jest.fn(async () => shell);
    const createdRows = new Map<string, YDoc>();
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({
        databaseDoc,
        referenceRowDoc,
        createdRows,
        duplicateRowDocument: jest.fn(),
        loadRowDocument,
      }),
    });
    let rowId = '';

    await act(async () => {
      rowId = await result.current(sourceRowId);
    });
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createCloudRow).mock.calls[0][0].documentState).toBeUndefined();
    expect(getRowMetaValue(createdRows.get(getRowKey(databaseDocId, rowId))!, rowId, RowMetaKey.IsDocumentEmpty)).toBe(
      true
    );
    shell.destroy();
  });

  it('rejects a nonempty row whose cached body remains empty after hydration', async () => {
    const databaseDoc = createDatabaseDoc();
    const referenceRowDoc = createReferenceRowDoc({ isEmptyDocument: false });
    const shell = new Y.Doc() as YDoc;
    const body = new Y.Map();
    const meta = new Y.Map();

    shell.getMap('data').set('document', body);
    body.set('blocks', new Y.Map());
    body.set('meta', meta);
    meta.set('text_map', new Y.Map());
    jest.mocked(getCachedProviderDoc).mockReturnValue(shell);
    const createdRows = new Map<string, YDoc>();
    const loadRowDocument = jest.fn(async () => shell);
    const { result } = renderHook(() => useDuplicateRowDispatch(), {
      wrapper: createWrapper({
        databaseDoc,
        referenceRowDoc,
        createdRows,
        duplicateRowDocument: jest.fn(),
        loadRowDocument,
      }),
    });

    await act(async () => {
      await expect(result.current(sourceRowId)).rejects.toThrow('Source Row document is still empty');
    });
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createCloudRow).not.toHaveBeenCalled();
    expect(createdRows.size).toBe(0);
    shell.destroy();
  });
});

test('duplicate completion after owner retirement reports the committed copy instead of a failed create', async () => {
  const databaseDoc = createDatabaseDoc();
  const referenceRowDoc = createReferenceRowDoc({ isEmptyDocument: true });
  const createdRows = new Map<string, YDoc>();
  const { result, unmount } = renderHook(() => useDuplicateRowDispatch(), {
    wrapper: createWrapper({ databaseDoc, referenceRowDoc, createdRows, duplicateRowDocument: jest.fn() }),
  });
  const publish = jest.mocked(createCloudRow).getMockImplementation()!;

  jest.mocked(createCloudRow).mockImplementationOnce(async (intent) => {
    const rowId = await publish(intent);

    unmount();
    return rowId;
  });
  let error: unknown;

  await act(async () => {
    error = await result.current(sourceRowId).catch((error: unknown) => error);
  });
  expect(error).toBeInstanceOf(CommittedRowActivationError);
  const rowId = (error as CommittedRowActivationError).rowId;

  expect(createdRows.has(getRowKey(databaseDocId, rowId))).toBe(true);
  expect(jest.mocked(createCloudRow)).toHaveBeenCalledTimes(1);
});
