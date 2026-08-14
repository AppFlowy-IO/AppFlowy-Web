import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import { TextFilterCondition } from '@/application/database-yjs/fields';
import { getMetaIdMap, getRowKey } from '@/application/database-yjs/row_meta';
import { DatabaseRowTemplateStore } from '@/application/database-yjs/template';
import {
  CoverType,
  DatabaseViewLayout,
  RowCoverType,
  ViewIconType,
  ViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));

const databaseId = 'database-id';
const databaseDocId = '10000000-0000-4000-8000-000000000001';
const viewId = 'grid-view-id';
const otherViewId = 'board-view-id';
const nameFieldId = 'name-field-id';
const statusFieldId = 'status-field-id';

function createField(id: string, name: string, primary = false): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.is_primary, primary);
  return field;
}

function createView(layout: DatabaseViewLayout): YDatabaseView {
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.layout, layout);
  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  return view;
}

function createDatabaseDoc(layout: DatabaseViewLayout = DatabaseViewLayout.Grid): { doc: YDoc; database: YDatabase } {
  const doc = new Y.Doc({ guid: databaseDocId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();

  fields.set(nameFieldId, createField(nameFieldId, 'Name', true));
  fields.set(statusFieldId, createField(statusFieldId, 'Status'));
  views.set(viewId, createView(layout));
  views.set(otherViewId, createView(DatabaseViewLayout.Board));
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return { doc, database };
}

function addTemplate(database: YDatabase, options: { empty?: boolean; makeDefault?: boolean } = {}) {
  const now = Date.now();
  const template = new DatabaseRowTemplateStore(database).upsert({
    templateId: '20000000-0000-4000-8000-000000000002',
    name: 'Bug report',
    docViewId: '30000000-0000-4000-8000-000000000003',
    isDocumentEmpty: options.empty ?? true,
    embeddedDatabases: [],
    defaultCells: {
      [nameFieldId]: { type: 'text', value: 'From template' },
      [statusFieldId]: { type: 'text', value: 'Template status' },
    },
    icon: '🐛',
    cover: JSON.stringify({ data: '1', cover_type: 2 }),
    createdAtMs: now,
    updatedAtMs: now,
  });

  if (options.makeDefault) new DatabaseRowTemplateStore(database).setDefault(template.templateId);
  return template;
}

function rowFrom(doc: YDoc): YDatabaseRow {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
}

function cellData(doc: YDoc, fieldId: string): unknown {
  return rowFrom(doc).get(YjsDatabaseKey.cells).get(fieldId)?.get(YjsDatabaseKey.data);
}

function createWrapper(context: DatabaseContextState): ({ children }: { children: ReactNode }) => React.ReactElement {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AFConfigContext.Provider
        value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
      >
        <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
      </AFConfigContext.Provider>
    );
  };
}

describe('useNewRowDispatch database templates', () => {
  it('uses an explicit template and lets contextual cells override defaults in every view', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database);
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({
        templateId: template.templateId,
        cellsData: { [statusFieldId]: 'Board override' },
      })) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;

    expect(cellData(rowDoc, nameFieldId)).toBe('From template');
    expect(cellData(rowDoc, statusFieldId)).toBe('Board override');
    expect(
      (rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>).get(
        getMetaIdMap(rowId).get(RowMetaKey.IconId) ?? ''
      )
    ).toBe('🐛');
    expect(
      (rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>).get(
        getMetaIdMap(rowId).get(RowMetaKey.CoverId) ?? ''
      )
    ).toBe(JSON.stringify({ data: '1', cover_type: 2 }));
    expect(database.get(YjsDatabaseKey.views)?.get(viewId)?.get(YjsDatabaseKey.row_orders).toJSON()).toContainEqual({
      id: rowId,
      height: 36,
    });
    expect(database.get(YjsDatabaseKey.views)?.get(otherViewId)?.get(YjsDatabaseKey.row_orders).toJSON()).toContainEqual(
      {
        id: rowId,
        height: 36,
      }
    );
  });

  it('applies the default template unless explicitly skipped', async () => {
    const { doc, database } = createDatabaseDoc();

    addTemplate(database, { makeDefault: true });
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let templatedId = '';
    let plainId = '';

    await act(async () => {
      templatedId = (await result.current({})) as string;
      plainId = (await result.current({ skipDefaultTemplate: true })) as string;
    });

    expect(cellData(createdRows.get(getRowKey(databaseDocId, templatedId)) as YDoc, nameFieldId)).toBe('From template');
    expect(cellData(createdRows.get(getRowKey(databaseDocId, plainId)) as YDoc, nameFieldId)).toBeUndefined();
  });

  it('keeps the primary title empty while pre-filling secondary fields from active filters', async () => {
    const { doc, database } = createDatabaseDoc();
    const filters = database.get(YjsDatabaseKey.views)?.get(viewId)?.get(YjsDatabaseKey.filters);
    const nameFilter = new Y.Map() as YDatabaseFilter;
    const statusFilter = new Y.Map() as YDatabaseFilter;

    nameFilter.set(YjsDatabaseKey.id, 'name-filter');
    nameFilter.set(YjsDatabaseKey.field_id, nameFieldId);
    nameFilter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIsNotEmpty);
    nameFilter.set(YjsDatabaseKey.content, '');
    statusFilter.set(YjsDatabaseKey.id, 'status-filter');
    statusFilter.set(YjsDatabaseKey.field_id, statusFieldId);
    statusFilter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIs);
    statusFilter.set(YjsDatabaseKey.content, 'Ready');
    filters?.push([nameFilter, statusFilter]);

    const createdRows = new Map<string, YDoc>();
    const navigateToRow = jest.fn();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      navigateToRow,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({})) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;

    expect(cellData(rowDoc, nameFieldId)).toBeUndefined();
    expect(cellData(rowDoc, statusFieldId)).toBe('Ready');
    expect(navigateToRow).toHaveBeenCalledWith(rowId);
  });

  it('falls back to the orphan view icon and cover used by Desktop templates', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database);
    const desktopTemplate = new DatabaseRowTemplateStore(database).upsert({
      ...template,
      documentData: [1, 2, 3],
      icon: undefined,
      cover: undefined,
    });
    const createdRows = new Map<string, YDoc>();
    const loadViewMeta: NonNullable<DatabaseContextState['loadViewMeta']> = jest.fn(async () => ({
      view_id: desktopTemplate.docViewId,
      name: desktopTemplate.name,
      icon: { ty: ViewIconType.Emoji, value: ' 🧩 ' },
      layout: ViewLayout.Document,
      extra: {
        cover: { type: CoverType.BuildInImage, value: '2', offset: 0.25 },
      },
      children: [],
      is_published: false,
      is_private: false,
    }));
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      loadViewMeta,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({ templateId: desktopTemplate.templateId })) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

    expect(loadViewMeta).toHaveBeenCalledWith(desktopTemplate.docViewId);
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe('🧩');
    expect(JSON.parse(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string) as string)).toEqual({
      cover_type: RowCoverType.AssetCover,
      data: '2',
      offset: 0.25,
    });
    expect(new DatabaseRowTemplateStore(database).read().templates[0]).toEqual(
      expect.objectContaining({
        icon: '🧩',
        cover: expect.any(String),
      })
    );

    await act(async () => {
      await result.current({ templateId: desktopTemplate.templateId });
    });
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
  });

  it('does not request orphan view metadata for explicitly empty decorations', async () => {
    const { doc, database } = createDatabaseDoc();
    const original = addTemplate(database);
    const template = new DatabaseRowTemplateStore(database).upsert({ ...original, icon: '', cover: '' });
    const loadViewMeta = jest.fn().mockRejectedValue(new Error('explicit blanks are already resolved'));
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => new Y.Doc({ guid: key }) as YDoc,
      loadViewMeta,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });

    await act(async () => {
      await result.current({ templateId: template.templateId });
    });

    expect(loadViewMeta).not.toHaveBeenCalled();
  });

  it('rejects an unknown explicit template before creating a row', async () => {
    const { doc } = createDatabaseDoc();
    const createRow = jest.fn(async () => new Y.Doc() as YDoc);
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });

    await expect(result.current({ templateId: 'missing' })).rejects.toThrow(
      'templateId does not match any row template'
    );
    expect(createRow).not.toHaveBeenCalled();
  });

  it('materializes a non-empty template document through the existing deep-copy pipeline', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: false });
    const createdRows = new Map<string, YDoc>();
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    sourceDocument.getMap(YjsEditorKey.data_section).set('template-marker', 'client document state');
    const createRowDocument = jest.fn(async () => new Uint8Array([1]));
    const duplicateRowDocument: NonNullable<DatabaseContextState['duplicateRowDocument']> = jest.fn(
      async (_databaseId, _sourceId, _targetId, _state, prepareSource) => {
        await prepareSource?.();
      }
    );
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      loadRowDocument: async () => sourceDocument,
      createRowDocument,
      duplicateRowDocument,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let newRowId = '';

    await act(async () => {
      newRowId = (await result.current({ templateId: template.templateId })) as string;
    });

    expect(duplicateRowDocument).toHaveBeenCalledWith(
      databaseId,
      template.templateId,
      newRowId,
      expect.any(String),
      expect.any(Function)
    );
    expect(createRowDocument).toHaveBeenCalledWith(expect.any(String), {
      database_id: databaseId,
      database_view_id: viewId,
      row_id: template.templateId,
    });
    const encodedSource = duplicateRowDocument.mock.calls[0][3] as string;
    const decodedSource = new Y.Doc();

    Y.applyUpdate(
      decodedSource,
      Uint8Array.from(atob(encodedSource), (character) => character.charCodeAt(0))
    );
    expect(decodedSource.getMap(YjsEditorKey.data_section).get('template-marker')).toBe('client document state');
    const hiddenSource = createdRows.get(getRowKey(databaseDocId, template.templateId)) as YDoc;

    expect(cellData(hiddenSource, nameFieldId)).toBe('From template');
    expect(
      (hiddenSource.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>).get(
        getMetaIdMap(template.templateId).get(RowMetaKey.IconId) as string
      )
    ).toBe('🐛');
    const orderedIds = database
      .get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.row_orders)
      .toJSON()
      .map((order) => order.id);

    expect(orderedIds).toContain(newRowId);
    expect(orderedIds).not.toContain(template.templateId);
  });

  it('keeps template cells but marks the row document empty when materialization fails', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: false });
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      duplicateRowDocument: jest.fn(async () => Promise.reject(new Error('copy failed'))),
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({ templateId: template.templateId })) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

    expect(cellData(rowDoc, nameFieldId)).toBe('From template');
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(true);
  });

  it('marks a non-empty template document empty when duplication is unavailable', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: false });
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({ templateId: template.templateId })) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

    expect(cellData(rowDoc, nameFieldId)).toBe('From template');
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(true);
  });

  it.each([
    ['Grid', DatabaseViewLayout.Grid],
    ['Board', DatabaseViewLayout.Board],
    ['Calendar', DatabaseViewLayout.Calendar],
    ['Chart', DatabaseViewLayout.Chart],
    ['List', DatabaseViewLayout.List],
    ['Gallery', DatabaseViewLayout.Gallery],
  ] as const)('applies the default from the shared New action in %s layout', async (_name, layout) => {
    const { doc, database } = createDatabaseDoc(layout);

    addTemplate(database, { makeDefault: true });
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({})) as string;
    });

    expect(cellData(createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc, nameFieldId)).toBe('From template');
  });

  it('creates independent target documents each time the same template is used', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: false });
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    const duplicateRowDocument = jest.fn(async () => undefined);
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      loadRowDocument: async () => sourceDocument,
      duplicateRowDocument,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    const createdIds: string[] = [];

    await act(async () => {
      createdIds.push((await result.current({ templateId: template.templateId })) as string);
      createdIds.push((await result.current({ templateId: template.templateId })) as string);
    });

    expect(new Set(createdIds)).toHaveProperty('size', 2);
    expect(duplicateRowDocument).toHaveBeenCalledTimes(2);
    expect(duplicateRowDocument.mock.calls.map((call) => call[2])).toEqual(createdIds);
    expect(duplicateRowDocument.mock.calls.every((call) => call[1] === template.templateId)).toBe(true);
    createdIds.forEach((rowId) => {
      const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
      const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(false);
    });
  });

  it('uses a non-empty default template through the same document materialization path', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: false, makeDefault: true });
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    const duplicateRowDocument = jest.fn(async () => undefined);
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      loadRowDocument: async () => sourceDocument,
      duplicateRowDocument,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({})) as string;
    });

    expect(duplicateRowDocument).toHaveBeenCalledWith(
      databaseId,
      template.templateId,
      rowId,
      expect.any(String),
      expect.any(Function)
    );
    expect(cellData(createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc, nameFieldId)).toBe('From template');
  });

  it('keeps an empty template row empty without invoking document duplication', async () => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: true });
    const duplicateRowDocument = jest.fn(async () => undefined);
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
      duplicateRowDocument,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    let rowId = '';

    await act(async () => {
      rowId = (await result.current({ templateId: template.templateId })) as string;
    });

    const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

    expect(duplicateRowDocument).not.toHaveBeenCalled();
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(true);
  });

  it.each([
    ['neither icon nor cover', undefined, undefined],
    ['icon only', '🧭', undefined],
    ['cover only', undefined, JSON.stringify({ data: '2', cover_type: 2 })],
    ['both icon and cover', '🧭', JSON.stringify({ data: '2', cover_type: 2 })],
  ])('copies %s from explicit and default template creation', async (_variant, icon, cover) => {
    const { doc, database } = createDatabaseDoc();
    const original = addTemplate(database, { empty: true });
    const template = new DatabaseRowTemplateStore(database).upsert({ ...original, icon, cover });

    new DatabaseRowTemplateStore(database).setDefault(template.templateId);
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    const rowIds: string[] = [];

    await act(async () => {
      rowIds.push((await result.current({ templateId: template.templateId })) as string);
      rowIds.push((await result.current({})) as string);
    });

    rowIds.forEach((rowId) => {
      const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
      const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe(icon);
      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBe(cover);
    });
  });

  it('prefers an explicit template over the default and clones cells independently', async () => {
    const { doc, database } = createDatabaseDoc();
    const defaultTemplate = addTemplate(database, { makeDefault: true });
    const explicitTemplate = new DatabaseRowTemplateStore(database).upsert({
      ...defaultTemplate,
      templateId: '70000000-0000-4000-8000-000000000007',
      docViewId: '80000000-0000-4000-8000-000000000008',
      name: 'Explicit',
      defaultCells: { [nameFieldId]: { type: 'text', value: 'Explicit value' } },
    });
    const createdRows = new Map<string, YDoc>();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        const rowDoc = new Y.Doc({ guid: key }) as YDoc;

        createdRows.set(key, rowDoc);
        return rowDoc;
      },
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    const ids: string[] = [];

    await act(async () => {
      ids.push((await result.current({ templateId: explicitTemplate.templateId })) as string);
      ids.push((await result.current({ templateId: explicitTemplate.templateId })) as string);
    });

    const first = createdRows.get(getRowKey(databaseDocId, ids[0])) as YDoc;
    const second = createdRows.get(getRowKey(databaseDocId, ids[1])) as YDoc;

    expect(cellData(first, nameFieldId)).toBe('Explicit value');
    expect(cellData(second, nameFieldId)).toBe('Explicit value');
    rowFrom(first).get(YjsDatabaseKey.cells).get(nameFieldId)?.set(YjsDatabaseKey.data, 'Changed');
    expect(cellData(second, nameFieldId)).toBe('Explicit value');
  });
});
