import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import {
  createCloudRow,
  CloudRowCreationIntent,
  CommittedRowActivationError,
} from '@/application/database-yjs/creation/create-row';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import { TextFilterCondition } from '@/application/database-yjs/fields';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { getMetaIdMap, getRowKey } from '@/application/database-yjs/row_meta';
import { DatabaseRowTemplateStore } from '@/application/database-yjs/template';
import templateInterop from '@/application/database-yjs/template/__tests__/fixtures/row_template_interop.json';
import {
  CoverType,
  DatabaseViewLayout,
  RowCoverType,
  ViewIconType,
  ViewLayout,
  YDatabase,
  YDatabaseCell,
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

jest.unmock('lodash-es/isEqual');

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));

jest.mock('@/application/database-yjs/creation/create-row', () => ({
  ...jest.requireActual('@/application/database-yjs/creation/create-row'),
  createCloudRow: jest.fn(),
}));
const mockCreateCloudRow = createCloudRow as jest.MockedFunction<typeof createCloudRow>;

// This suite owns dispatch preparation and lifecycle. The real atomic HTTP/activation
// workflow is covered separately; this adapter models only its committed publication.
async function publishCommittedRow(intent: CloudRowCreationIntent): Promise<string> {
  intent.assertCurrent();
  const state = Y.encodeStateAsUpdate(intent.rowDoc);
  const row = await intent.registerRow();

  intent.assertCurrent();
  Y.applyUpdate(row, state);
  const database = intent.databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  database.get(YjsDatabaseKey.views).forEach((view) => {
    const orders = view.get(YjsDatabaseKey.row_orders);
    const beforeRowId = intent.position.kind === 'after' ? intent.position.row_id : undefined;
    const before = orders.toArray().findIndex((order) => order.id === beforeRowId);
    const position = intent.position.kind === 'end' ? orders.length : intent.position.kind === 'after' ? before + 1 : 0;

    orders.insert(position, [{ id: intent.rowId, height: 36 }]);
  });
  return intent.rowId;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCloudRow.mockReset().mockImplementation(publishCommittedRow);
});

const databaseId = 'database-id';
const databaseDocId = '10000000-0000-4000-8000-000000000001';
const viewId = 'grid-view-id';
const otherViewId = 'board-view-id';
const nameFieldId = 'name-field-id';
const statusFieldId = 'status-field-id';
const documentSnapshot = Array.from(Buffer.from(templateInterop.document_snapshot, 'base64'));

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

function addTemplate(
  database: YDatabase,
  options: { empty?: boolean; makeDefault?: boolean; icon?: string; cover?: string } = {}
) {
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
    icon: 'icon' in options ? options.icon : '🐛',
    cover: 'cover' in options ? options.cover : JSON.stringify({ data: '1', cover_type: 2 }),
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
        value={{
          isAuthenticated: true,
          currentUser: {
            uid: '42',
            attributionUid: '42',
            uuid: 'user-uuid',
            name: 'Template creator',
            email: 'creator@appflowy.io',
            avatar: null,
            latestWorkspaceId: 'workspace-id',
          },
          updateCurrentUser: async () => undefined,
          openLoginModal: () => undefined,
        }}
      >
        <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
      </AFConfigContext.Provider>
    );
  };
}

describe('useNewRowDispatch database templates', () => {
  it('retries a published calendar draft with its latest edits and repairs reciprocal links without duplicating it', async () => {
    const { doc, database } = createDatabaseDoc(DatabaseViewLayout.Calendar);
    const template = addTemplate(database, { empty: false });
    const rowId = '40000000-0000-4000-8000-000000000004';
    const relatedRowId = '50000000-0000-4000-8000-000000000005';
    const relationFieldId = 'relation-field';
    const reciprocalFieldId = 'reciprocal-field';

    database.get(YjsDatabaseKey.fields).set(
      relationFieldId,
      createRelationField(relationFieldId, {
        database_id: databaseId,
        is_two_way: true,
        reciprocal_field_id: reciprocalFieldId,
      })
    );
    database.get(YjsDatabaseKey.fields).set(reciprocalFieldId, createRelationField(reciprocalFieldId));
    database.get(YjsDatabaseKey.views).forEach((view) => {
      view.get(YjsDatabaseKey.row_orders).push([{ id: relatedRowId, height: 36 }]);
    });

    const draftDoc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId, databaseId, draftDoc);
    const cells = rowFrom(draftDoc).get(YjsDatabaseKey.cells);
    const titleCell = new Y.Map() as YDatabaseCell;
    const relationCell = new Y.Map() as YDatabaseCell;
    const relationData = new Y.Array<string>();

    titleCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    titleCell.set(YjsDatabaseKey.data, 'Before retry');
    relationCell.set(YjsDatabaseKey.field_type, FieldType.Relation);
    relationData.push([relatedRowId]);
    relationCell.set(YjsDatabaseKey.data, relationData);
    cells.set(nameFieldId, titleCell);
    cells.set(relationFieldId, relationCell);
    const draft = {
      id: rowId,
      cells,
      meta: draftDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>,
    };
    const relatedKey = getRowKey(databaseDocId, relatedRowId);
    const relatedDoc = new Y.Doc({ guid: relatedKey }) as YDoc;

    initialDatabaseRow(relatedRowId, databaseId, relatedDoc);
    const createdRows = new Map<string, YDoc>([[relatedKey, relatedDoc]]);
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    const duplicateRowDocument = jest.fn(async () => undefined);
    let relatedLoadAttempts = 0;
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow: async (key) => {
        if (key === relatedKey && ++relatedLoadAttempts === 1) {
          throw new Error('Related row temporarily unavailable');
        }

        let rowDoc = createdRows.get(key);

        if (!rowDoc) {
          rowDoc = new Y.Doc({ guid: key }) as YDoc;
          createdRows.set(key, rowDoc);
        }

        return rowDoc;
      },
      loadRowDocument: async () => sourceDocument,
      duplicateRowDocument,
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    const request = { draft, templateId: template.templateId, tailing: true, suppressAutoOpen: true };

    await act(async () => {
      await expect(result.current(request)).rejects.toMatchObject({
        rowId,
        cause: new Error('Related row temporarily unavailable'),
      });
    });

    const savedDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;

    expect(cellData(savedDoc, nameFieldId)).toBe('Before retry');
    expect(cellData(relatedDoc, reciprocalFieldId)).toBeUndefined();
    database.get(YjsDatabaseKey.views).forEach((view) => {
      expect(view.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([
        { id: relatedRowId, height: 36 },
        { id: rowId, height: 36 },
      ]);
    });

    titleCell.set(YjsDatabaseKey.data, 'Edited after the failed save');
    await act(async () => {
      await expect(result.current(request)).resolves.toBe(rowId);
    });

    expect(cellData(savedDoc, nameFieldId)).toBe('Edited after the failed save');
    expect((cellData(relatedDoc, reciprocalFieldId) as Y.Array<string>).toArray()).toEqual([rowId]);
    expect(relatedLoadAttempts).toBe(2);
    expect(duplicateRowDocument).not.toHaveBeenCalled();
    expect(mockCreateCloudRow).toHaveBeenCalledTimes(1);
    database.get(YjsDatabaseKey.views).forEach((view) => {
      expect(view.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([
        { id: relatedRowId, height: 36 },
        { id: rowId, height: 36 },
      ]);
    });
  });

  it('writes grouped relation prefills as canonical relation data before reciprocal handling', async () => {
    const { doc, database } = createDatabaseDoc();
    const relationFieldId = 'relation-field-id';
    const relationField = createRelationField(relationFieldId);

    database.get(YjsDatabaseKey.fields)?.set(relationFieldId, relationField);
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
        cellsData: { [relationFieldId]: '[" related-row ","related-row"]' },
      })) as string;
    });

    const data = cellData(createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc, relationFieldId);

    expect(data).toBeInstanceOf(Y.Array);
    expect((data as Y.Array<string>).toJSON()).toEqual(['related-row']);
  });

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
    expect(rowFrom(rowDoc).get(YjsDatabaseKey.created_by)).toBe('42');
    expect(rowFrom(rowDoc).get(YjsDatabaseKey.last_edited_by)).toBe('42');
    expect(rowFrom(rowDoc).get(YjsDatabaseKey.created_by)).not.toBeInstanceOf(Y.AbstractType);
    expect(rowFrom(rowDoc).get(YjsDatabaseKey.last_edited_by)).not.toBeInstanceOf(Y.AbstractType);
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
    const template = addTemplate(database, { icon: undefined, cover: undefined });
    const desktopTemplate = new DatabaseRowTemplateStore(database).upsert({
      ...template,
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
    const unchangedTemplate = new DatabaseRowTemplateStore(database).read().templates[0];

    expect(unchangedTemplate.icon).toBeUndefined();
    expect(unchangedTemplate.cover).toBeUndefined();

    await act(async () => {
      await result.current({ templateId: desktopTemplate.templateId });
    });
    expect(loadViewMeta).toHaveBeenCalledTimes(2);
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

  it.each(['live', 'snapshot'])(
    'submits a %s template body in the atomic command without a hidden source row',
    async (kind) => {
      const { doc, database } = createDatabaseDoc();
      const original = addTemplate(database, { empty: false });
      const template =
        kind === 'snapshot'
          ? new DatabaseRowTemplateStore(database).upsert({
              ...original,
              docViewId: '',
              documentData: documentSnapshot,
              isDocumentEmpty: true,
            })
          : original;
      const createdRows = new Map<string, YDoc>();
      const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

      sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
      sourceDocument.getMap(YjsEditorKey.data_section).set('template-marker', 'client document state');
      const createRowDocument = jest.fn(async () => new Uint8Array([1]));
      const duplicateRowDocument: NonNullable<DatabaseContextState['duplicateRowDocument']> = jest.fn(
        async (_databaseId, _sourceId, _targetId, _state, prepareSource) => {
          database.get(YjsDatabaseKey.views)?.forEach((view) => {
            expect(view.get(YjsDatabaseKey.row_orders)?.toArray()).toEqual([]);
          });
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
        loadRowDocument: jest.fn(async () => sourceDocument),
        createRowDocument,
        duplicateRowDocument,
      };
      const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
      let newRowId = '';

      await act(async () => {
        newRowId = (await result.current({ templateId: template.templateId })) as string;
      });

      expect(duplicateRowDocument).not.toHaveBeenCalled();
      expect(createRowDocument).not.toHaveBeenCalled();
      const intent = mockCreateCloudRow.mock.calls[0][0];

      expect(intent.rowId).toBe(newRowId);
      expect(intent.template?.templateId).toBe(template.templateId);
      expect(intent.documentState).toBeInstanceOf(Uint8Array);
      const decodedSource = new Y.Doc();

      Y.applyUpdate(decodedSource, intent.documentState);
      if (kind === 'snapshot') {
        expect(context.loadRowDocument).not.toHaveBeenCalled();
        expect(decodedSource.getMap(YjsEditorKey.data_section).get(YjsEditorKey.document)).toBeInstanceOf(Y.Map);
      } else {
        expect(decodedSource.getMap(YjsEditorKey.data_section).get('template-marker')).toBe('client document state');
      }

      expect(createdRows.has(getRowKey(databaseDocId, template.templateId))).toBe(false);
      decodedSource.destroy();
      const orderedIds = database
        .get(YjsDatabaseKey.views)
        ?.get(viewId)
        ?.get(YjsDatabaseKey.row_orders)
        .toJSON()
        .map((order) => order.id);

      expect(orderedIds).toContain(newRowId);
      expect(orderedIds).not.toContain(template.templateId);
    }
  );

  it('rejects corrupt stored snapshots before creating a row even when legacy metadata says empty', async () => {
    const { doc, database } = createDatabaseDoc();
    const original = addTemplate(database);
    const template = new DatabaseRowTemplateStore(database).upsert({ ...original, documentData: [1, 2, 3] });
    const createRow = jest.fn(async (key: string) => new Y.Doc({ guid: key }) as YDoc);
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

    await act(async () => {
      await expect(result.current({ templateId: template.templateId })).rejects.toThrow(
        'Invalid template document snapshot'
      );
    });
    expect(createRow).not.toHaveBeenCalled();
  });

  it('rejects materialization failures without publishing or opening a partial row', async () => {
    const { doc, database } = createDatabaseDoc();
    const original = addTemplate(database, { empty: false });
    const template = new DatabaseRowTemplateStore(database).upsert({ ...original, documentData: documentSnapshot });

    mockCreateCloudRow.mockRejectedValueOnce(new Error('atomic create refused'));
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
      navigateToRow: jest.fn(),
    };
    const { result } = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });

    await act(async () => {
      await expect(result.current({ templateId: template.templateId, openAfterCreate: true })).rejects.toThrow(
        'atomic create refused'
      );
    });

    database.get(YjsDatabaseKey.views)?.forEach((view) => {
      expect(view.get(YjsDatabaseKey.row_orders)?.toArray()).toEqual([]);
    });
    expect(context.navigateToRow).not.toHaveBeenCalled();
  });

  it('rejects a non-empty template with no readable body before submitting a row', async () => {
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

    await act(async () => {
      await expect(result.current({ templateId: template.templateId })).rejects.toThrow(
        'Template document is unavailable'
      );
    });

    database.get(YjsDatabaseKey.views)?.forEach((view) => {
      expect(view.get(YjsDatabaseKey.row_orders)?.toArray()).toEqual([]);
    });
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
    expect(duplicateRowDocument).not.toHaveBeenCalled();
    expect(mockCreateCloudRow.mock.calls.map(([intent]) => intent.rowId)).toEqual(createdIds);
    expect(mockCreateCloudRow.mock.calls.every(([intent]) => intent.template?.templateId === template.templateId)).toBe(
      true
    );
    createdIds.forEach((rowId) => {
      const rowDoc = createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc;
      const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(false);
    });
  });

  it('keeps the default template body and other cells when a calendar supplies its own date', async () => {
    const { doc, database } = createDatabaseDoc(DatabaseViewLayout.Calendar);
    const dateFieldId = 'date-field';
    const dateField = createField(dateFieldId, 'Date');

    dateField.set(YjsDatabaseKey.type, FieldType.DateTime);
    database.get(YjsDatabaseKey.fields)?.set(dateFieldId, dateField);
    const original = addTemplate(database, { empty: false, makeDefault: true });
    const template = new DatabaseRowTemplateStore(database).upsert({
      ...original,
      defaultCells: { ...original.defaultCells, [dateFieldId]: { type: 'date_time', value: 1700000000 } },
    });
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
      rowId = (await result.current({ cellsData: { [dateFieldId]: { data: '1800000000' } } })) as string;
    });

    expect(duplicateRowDocument).not.toHaveBeenCalled();
    expect(mockCreateCloudRow).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId,
        template: expect.objectContaining({ templateId: template.templateId }),
        documentState: expect.any(Uint8Array),
      })
    );
    expect(cellData(createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc, nameFieldId)).toBe('From template');
    expect(cellData(createdRows.get(getRowKey(databaseDocId, rowId)) as YDoc, dateFieldId)).toBe('1800000000');
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
    ['explicitly removed icon and cover', '', ''],
  ])('copies %s from explicit and default template creation', async (_variant, icon, cover) => {
    const { doc, database } = createDatabaseDoc();
    const template = addTemplate(database, { empty: true, icon, cover });

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

      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe(icon || undefined);
      expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBe(cover || undefined);
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

describe('committed row relation follow-up', () => {
  function setup() {
    const { doc, database } = createDatabaseDoc();
    const related = createDatabaseDoc();
    const targetDatabaseId = 'related-database';
    const relatedRowId = 'related-row';
    const relationFieldId = 'relation';
    const reciprocalFieldId = 'backlink';

    related.doc.guid = targetDatabaseId;
    related.database.set(YjsDatabaseKey.id, targetDatabaseId);
    database.get(YjsDatabaseKey.fields).set(
      relationFieldId,
      createRelationField(relationFieldId, {
        database_id: targetDatabaseId,
        is_two_way: true,
        reciprocal_field_id: reciprocalFieldId,
      })
    );
    related.database.get(YjsDatabaseKey.fields).set(reciprocalFieldId, createRelationField(reciprocalFieldId));
    const target = new Y.Doc({ guid: relatedRowId }) as YDoc;

    initialDatabaseRow(relatedRowId, targetDatabaseId, target);
    const created = new Map<string, YDoc>();
    const loadTarget = jest.fn(async () => target);
    const loadView = jest.fn(async () => related.doc);
    const bindViewSync = jest.fn();
    const context: DatabaseContextState = {
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      readOnly: false,
      createRow: async (key) => {
        if (key === getRowKey(targetDatabaseId, relatedRowId)) return loadTarget();
        const row = new Y.Doc({ guid: key }) as YDoc;

        created.set(key, row);
        return row;
      },
      loadView,
      getViewIdFromDatabaseId: async () => 'related-view',
      bindViewSync,
    };
    const hook = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });

    return {
      ...hook,
      doc,
      context,
      created,
      loadView,
      loadTarget,
      bindViewSync,
      start: () => hook.result.current({ cellsData: { [relationFieldId]: JSON.stringify([relatedRowId]) } }),
      targetCell: () => cellData(target, reciprocalFieldId),
      assertCommitted: () => {
        expect(mockCreateCloudRow).toHaveBeenCalledTimes(1);
        const rowId = mockCreateCloudRow.mock.calls[0][0].rowId;

        database.get(YjsDatabaseKey.views).forEach((view) => {
          expect(view.get(YjsDatabaseKey.row_orders).toArray()).toEqual([{ id: rowId, height: 36 }]);
        });
        return rowId;
      },
      dispose: () => {
        hook.unmount();
        [doc, related.doc, target, ...created.values()].forEach((item) => item.destroy());
      },
    };
  }

  function pause<T>(method: jest.Mock<Promise<T>>) {
    let release!: (value: T) => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<T>((resolve) => {
      release = resolve;
    });
    const value = method.getMockImplementation()!();

    method.mockImplementationOnce(() => {
      entered();
      return pending;
    });
    return { reached, release: async () => release(await value) };
  }

  it('reports a committed ordinary row when its reciprocal load fails, never as a failed create', async () => {
    const fixture = setup();
    const cause = new Error('Related row is unavailable');

    fixture.loadTarget.mockRejectedValueOnce(cause);
    try {
      const error = await fixture.start().catch((error: unknown) => error);
      const rowId = fixture.assertCommitted();

      expect(error).toBeInstanceOf(CommittedRowActivationError);
      expect(error).toMatchObject({ rowId, cause });
      expect(fixture.targetCell()).toBeUndefined();
    } finally {
      fixture.dispose();
    }
  });

  it('does not edit a published draft when access changes while reopening its canonical row', async () => {
    const fixture = setup();
    const rowId = await fixture.start();

    expect(rowId).not.toBeNull();
    const rowKey = getRowKey(databaseDocId, rowId!);
    const canonical = fixture.created.get(rowKey)!;
    const originalValue = cellData(canonical, nameFieldId);
    const draftDoc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId!, databaseId, draftDoc);
    const draftCells = rowFrom(draftDoc).get(YjsDatabaseKey.cells);
    const title = new Y.Map() as YDatabaseCell;

    title.set(YjsDatabaseKey.field_type, FieldType.RichText);
    title.set(YjsDatabaseKey.data, 'Edit from a retired draft');
    draftCells.set(nameFieldId, title);
    const reopen = jest.fn(async () => canonical);
    const held = pause(reopen);
    const originalCreateRow = fixture.context.createRow!;

    fixture.context.createRow = (key) => (key === rowKey ? reopen() : originalCreateRow(key));
    fixture.rerender();
    const pending = fixture.result
      .current({
        draft: {
          id: rowId!,
          cells: draftCells,
          meta: draftDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>,
        },
      })
      .catch((error: unknown) => error);

    try {
      await held.reached;
      fixture.context.readOnly = true;
      fixture.rerender();
      await held.release();
      expect(await pending).toBeInstanceOf(CommittedRowActivationError);
      expect(cellData(canonical, nameFieldId)).toBe(originalValue);
      fixture.assertCommitted();
    } finally {
      await held.release();
      draftDoc.destroy();
      fixture.dispose();
    }
  });

  it.each(['workspace', 'read-only', 'restore', 'unmount'])(
    'does not write a late reciprocal row after %s ownership changes',
    async (change) => {
      const fixture = setup();
      const held = pause(fixture.loadTarget);
      const pending = fixture.start().catch((error: unknown) => error);

      try {
        await held.reached;
        fixture.assertCommitted();
        if (change === 'workspace') fixture.context.workspaceId = 'different-workspace';
        if (change === 'read-only') fixture.context.readOnly = true;
        if (change === 'restore') fixture.doc.databaseRestoreId = 'new-restore';
        if (change === 'unmount') fixture.unmount();
        else fixture.rerender();
        await held.release();
        expect(await pending).toBeInstanceOf(CommittedRowActivationError);
        expect(fixture.targetCell()).toBeUndefined();
      } finally {
        await held.release();
        fixture.dispose();
      }
    }
  );

  it('does not bind a late related database after the creating component unmounts', async () => {
    const fixture = setup();
    const held = pause(fixture.loadView);
    const pending = fixture.start().catch((error: unknown) => error);

    try {
      await held.reached;
      fixture.assertCommitted();
      fixture.unmount();
      await held.release();
      expect(await pending).toBeInstanceOf(CommittedRowActivationError);
      expect(fixture.bindViewSync).not.toHaveBeenCalled();
      expect(fixture.loadTarget).not.toHaveBeenCalled();
      expect(fixture.targetCell()).toBeUndefined();
    } finally {
      await held.release();
      fixture.dispose();
    }
  });
});

describe('useNewRowDispatch atomic publication lifecycle', () => {
  function setup(overrides: Partial<DatabaseContextState> = {}) {
    const { doc, database } = createDatabaseDoc();
    const createRow = jest.fn(async (key: string) => new Y.Doc({ guid: key }) as YDoc);
    const navigateToRow = jest.fn();
    const context: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createRow,
      navigateToRow,
      ...overrides,
    };
    const hook = renderHook(() => useNewRowDispatch(), { wrapper: createWrapper(context) });
    const expectUnpublished = () => {
      expect(createRow).not.toHaveBeenCalled();
      expect(navigateToRow).not.toHaveBeenCalled();
      database.get(YjsDatabaseKey.views).forEach((view) => {
        expect(view.get(YjsDatabaseKey.row_orders).toArray()).toEqual([]);
      });
    };

    return { ...hook, database, createRow, navigateToRow, expectUnpublished };
  }

  function pauseSubmission() {
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });

    mockCreateCloudRow.mockImplementationOnce(async (intent) => {
      reached();
      await held;
      return publishCommittedRow(intent);
    });
    return { release, entered };
  }

  it('keeps all row orders, providers and navigation unchanged until commit', async () => {
    const held = pauseSubmission();
    const fixture = setup();
    const pending = fixture.result.current({ cellsData: { [nameFieldId]: 'New row' }, openAfterCreate: true });

    await held.entered;
    fixture.expectUnpublished();
    expect(mockCreateCloudRow.mock.calls[0][0]).toMatchObject({ sourceViewId: viewId, position: { kind: 'start' } });
    await act(async () => {
      held.release();
      await pending;
    });
    const rowId = await pending;

    expect(fixture.createRow).toHaveBeenCalledTimes(1);
    expect(fixture.navigateToRow).toHaveBeenCalledWith(rowId);
    fixture.database.get(YjsDatabaseKey.views).forEach((view) => {
      expect(view.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([{ id: rowId, height: 36 }]);
    });
  });

  it('leaves no local row, membership or navigation after server refusal', async () => {
    mockCreateCloudRow.mockRejectedValueOnce(new Error('Permission denied'));
    const fixture = setup();

    await act(async () => {
      await expect(fixture.result.current({ openAfterCreate: true })).rejects.toThrow('Permission denied');
    });
    fixture.expectUnpublished();
  });

  it('does not activate or navigate a late creation after the caller unmounts', async () => {
    const held = pauseSubmission();
    const fixture = setup();
    const pending = fixture.result.current({ openAfterCreate: true });
    const rejected = expect(pending).rejects.toThrow('no longer writable');

    await held.entered;
    fixture.unmount();
    held.release();
    await rejected;
    fixture.expectUnpublished();
  });

  it.each([{ readOnly: true }, { canWrite: false }])('refuses before submission when access is %j', async (access) => {
    const fixture = setup(access);

    await act(async () => {
      await expect(fixture.result.current({})).rejects.toThrow('no longer writable');
    });
    expect(mockCreateCloudRow).not.toHaveBeenCalled();
    fixture.expectUnpublished();
  });
});
