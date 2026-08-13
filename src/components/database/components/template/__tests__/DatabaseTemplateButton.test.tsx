import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap, getRowKey } from '@/application/database-yjs/row_meta';
import { DatabaseRowTemplateStore } from '@/application/database-yjs/template';
import { rowDocumentIdFromRowId } from '@/application/row-document/lifecycle';
import {
  DatabaseViewLayout,
  ViewIconType,
  ViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { DatabaseTemplateButton } from '../DatabaseTemplateButton';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));

jest.mock('@/components/database/components/header/DatabaseRowHeader', () => ({
  __esModule: true,
  default: ({ rowId, templateStyle }: { rowId: string; templateStyle?: boolean }) => (
    <div data-testid='mock-template-header' data-template-style={String(Boolean(templateStyle))}>
      {rowId}
    </div>
  ),
}));

jest.mock('@/components/database/components/database-row', () => ({
  DatabaseRowProperties: ({ rowId, templateStyle }: { rowId: string; templateStyle?: boolean }) => (
    <div data-testid='mock-template-properties' data-template-style={String(Boolean(templateStyle))}>
      {rowId}
    </div>
  ),
  RowSubDocument: ({ rowId }: { rowId: string }) => <div data-testid='mock-template-document'>{rowId}</div>,
}));

const databaseId = 'database-id';
const databaseDocId = '40000000-0000-4000-8000-000000000004';
const viewId = 'grid-view';
const nameFieldId = 'name-field';

function setup() {
  const databaseDoc = new Y.Doc({ guid: databaseDocId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const nameField = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  nameField.set(YjsDatabaseKey.id, nameFieldId);
  nameField.set(YjsDatabaseKey.name, 'Name');
  nameField.set(YjsDatabaseKey.type, FieldType.RichText);
  nameField.set(YjsDatabaseKey.is_primary, true);
  fields.set(nameFieldId, nameField);
  view.set(YjsDatabaseKey.name, 'Tasks');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rows = new Map<string, YDoc>();
  const createRow = jest.fn(async (key: string) => {
    const existing = rows.get(key);

    if (existing) return existing;
    const row = new Y.Doc({ guid: key }) as YDoc;

    rows.set(key, row);
    return row;
  });
  const createRowDocument = jest.fn(async () => new Uint8Array([1]));
  const updatePage = jest.fn(async () => undefined);
  const navigateToRow = jest.fn();
  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: {},
    workspaceId: 'workspace-id',
    createRow,
    createRowDocument,
    updatePage,
    navigateToRow,
  };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
    >
      <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );

  return { Wrapper, context, database, view, rows, createRow, createRowDocument, updatePage, navigateToRow };
}

describe('DatabaseTemplateButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function openMenu() {
    fireEvent.keyDown(screen.getByTestId('database-template-menu-trigger'), { key: 'ArrowDown' });
    await screen.findByTestId('database-template-menu');
  }

  async function openTemplateActions(templateId: string) {
    await openMenu();
    const trigger = screen.getByTestId(`database-template-actions-${templateId}`);

    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  }

  it('shows the empty menu, creates a hidden template row, and opens its editor without server registration', async () => {
    const { Wrapper, database, view, rows, createRowDocument } = setup();

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openMenu();

    const menu = screen.getByTestId('database-template-menu');

    expect(menu.className).toContain('w-[300px]');
    expect(menu.className).toContain('p-[6px]');
    expect(menu.className).toContain('shadow-[var(--shadows-sm)]');
    expect(screen.getByTestId('database-template-split-button').className).toContain('h-7');
    expect((await screen.findByText('Templates for Tasks')).className).toContain('leading-[14px]');
    expect(screen.getByText('No templates yet').className).toContain('leading-4');
    expect(screen.getByTestId('database-template-create-icon')).toBeTruthy();
    expect(screen.queryByTestId('database-template-document-icon')).toBeNull();
    expect(screen.getByTestId('database-template-create').className).toContain('text-text-action');
    fireEvent.click(screen.getByTestId('database-template-create'));

    const editor = await screen.findByTestId('database-template-editor');

    expect(editor.className).toContain('h-[70vh]');
    expect(editor.className).toContain('w-[70vw]');
    expect(editor.className).toContain('rounded-[16px]');
    expect(screen.getByTestId('database-template-editor-banner').textContent).toBe("You're editing a template in Tasks");
    expect(screen.getByTestId('mock-template-header').getAttribute('data-template-style')).toBe('true');
    expect(screen.getByTestId('mock-template-properties').getAttribute('data-template-style')).toBe('true');
    const state = new DatabaseRowTemplateStore(database).read();

    expect(state.templates).toHaveLength(1);
    expect(state.templates[0].name).toBe('New template');
    expect(rows.has(getRowKey(databaseDocId, state.templates[0].templateId))).toBe(true);
    expect(view.get(YjsDatabaseKey.row_orders)).toHaveLength(0);
    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it('subscribes to template schema changes only while template UI is active', async () => {
    const { Wrapper, database } = setup();
    const fields = database.get(YjsDatabaseKey.fields);
    const observeFields = jest.spyOn(fields, 'observeDeep');
    const unobserveFields = jest.spyOn(fields, 'unobserveDeep');

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    expect(observeFields).not.toHaveBeenCalled();

    await openMenu();
    await waitFor(() => expect(observeFields).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByTestId('database-template-menu'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('database-template-menu')).toBeNull());
    expect(unobserveFields).toHaveBeenCalledTimes(1);

    observeFields.mockRestore();
    unobserveFields.mockRestore();
  });

  it('flushes pending row metadata when the template editor unmounts', async () => {
    const { Wrapper, database, rows } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const template = store.upsert({
      templateId: 'flush-on-unmount',
      name: 'Original',
      docViewId: rowDocumentIdFromRowId('flush-on-unmount'),
      isDocumentEmpty: true,
      embeddedDatabases: [],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'Original' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const rendered = render(<DatabaseTemplateButton />, { wrapper: Wrapper });

    await openTemplateActions(template.templateId);
    fireEvent.click(await screen.findByText('Edit'));
    await screen.findByTestId('database-template-editor');

    const rowDoc = rows.get(getRowKey(databaseDocId, template.templateId)) as YDoc;
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    act(() => {
      row.get(YjsDatabaseKey.cells).get(nameFieldId)?.set(YjsDatabaseKey.data, 'Saved during cleanup');
    });
    rendered.unmount();

    expect(store.read().templates[0].name).toBe('Saved during cleanup');
  });

  it('does not rewrite database template metadata for document-body changes', async () => {
    const { Wrapper, database, rows } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const template = store.upsert({
      templateId: 'narrow-observer',
      name: 'Narrow observer',
      docViewId: rowDocumentIdFromRowId('narrow-observer'),
      isDocumentEmpty: true,
      embeddedDatabases: [],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'Narrow observer' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const upsertTemplate = jest.spyOn(DatabaseRowTemplateStore.prototype, 'upsert');

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openTemplateActions(template.templateId);
    fireEvent.click(await screen.findByText('Edit'));
    await screen.findByTestId('database-template-editor');
    upsertTemplate.mockClear();

    const rowDoc = rows.get(getRowKey(databaseDocId, template.templateId)) as YDoc;
    const root = rowDoc.getMap(YjsEditorKey.data_section);

    act(() => {
      const document = new Y.Map<unknown>();

      root.set(YjsEditorKey.document, document);
      document.set('body-change', 'content');
    });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(upsertTemplate).not.toHaveBeenCalled();

    const row = root.get(YjsEditorKey.database_row) as YDatabaseRow;

    act(() => {
      row.get(YjsDatabaseKey.cells).get(nameFieldId)?.set(YjsDatabaseKey.data, 'Relevant row change');
    });
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledTimes(1));
    upsertTemplate.mockRestore();
  });

  it('uses the configured default when the main New half is clicked', async () => {
    const { Wrapper, database, view, rows, navigateToRow } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const template = store.upsert({
      templateId: '50000000-0000-4000-8000-000000000005',
      name: 'Default issue',
      docViewId: '60000000-0000-4000-8000-000000000006',
      isDocumentEmpty: true,
      embeddedDatabases: [],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'From default' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    store.setDefault(template.templateId);
    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('database-new-row-button'));

    await waitFor(() => expect(view.get(YjsDatabaseKey.row_orders)).toHaveLength(1));
    const rowId = view.get(YjsDatabaseKey.row_orders).get(0).id;
    const rowDoc = rows.get(getRowKey(databaseDocId, rowId)) as YDoc;
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    expect(row.get(YjsDatabaseKey.cells).get(nameFieldId)?.get(YjsDatabaseKey.data)).toBe('From default');
    expect(navigateToRow).toHaveBeenCalledWith(rowId);
  });

  it('syncs the template name and emoji to its orphan view when the editor closes', async () => {
    const { Wrapper, context, database, rows, updatePage } = setup();

    context.loadViewMeta = jest.fn(async (documentViewId) => ({
      view_id: documentViewId,
      name: 'New template',
      icon: null,
      layout: ViewLayout.Document,
      extra: {
        row_document: {
          source: {
            database_id: databaseId,
            database_view_id: viewId,
            row_id: 'template-row',
          },
        },
      },
      children: [],
      is_published: false,
      is_private: false,
    }));

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openMenu();
    fireEvent.click(screen.getByTestId('database-template-create'));

    const editor = await screen.findByTestId('database-template-editor');
    const template = new DatabaseRowTemplateStore(database).read().templates[0];
    const rowDoc = rows.get(getRowKey(databaseDocId, template.templateId)) as YDoc;
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;
    const iconId = getMetaIdMap(template.templateId).get(RowMetaKey.IconId) as string;

    meta.set(iconId, '🐞');
    fireEvent.click(editor.querySelector('button') as HTMLElement);

    await waitFor(() =>
      expect(updatePage).toHaveBeenCalledWith(rowDocumentIdFromRowId(template.templateId), {
        name: 'New template',
        icon: { ty: ViewIconType.Emoji, value: '🐞' },
        extra: {
          row_document: {
            source: {
              database_id: databaseId,
              database_view_id: viewId,
              row_id: 'template-row',
            },
          },
          cover: undefined,
          database_row_template: true,
          database_view_id: viewId,
          template_id: template.templateId,
        },
      })
    );
  });

  it('creates a row immediately when a template item is selected', async () => {
    const { Wrapper, database, view, rows, navigateToRow } = setup();
    const template = new DatabaseRowTemplateStore(database).upsert({
      templateId: '55000000-0000-4000-8000-000000000005',
      name: 'Bug report',
      docViewId: '65000000-0000-4000-8000-000000000006',
      isDocumentEmpty: true,
      embeddedDatabases: [],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'From selected template' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openMenu();
    const templateRow = screen.getByTestId(`database-template-row-${template.templateId}`);
    const templateButton = screen.getByTestId(`database-template-${template.templateId}`);
    const actionsButton = screen.getByTestId(`database-template-actions-${template.templateId}`);

    expect(templateRow.contains(templateButton)).toBe(true);
    expect(templateRow.contains(actionsButton)).toBe(true);
    expect(screen.getByTestId('database-template-drag-handle')).toBeTruthy();
    expect(templateRow.querySelector('[data-testid="database-template-document-icon"]')).toBeTruthy();
    expect(screen.getByTestId('database-template-create-icon')).toBeTruthy();
    fireEvent.click(templateButton);

    await waitFor(() => expect(view.get(YjsDatabaseKey.row_orders)).toHaveLength(1));
    const rowId = view.get(YjsDatabaseKey.row_orders).get(0).id;
    const row = rows
      .get(getRowKey(databaseDocId, rowId))
      ?.getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;

    expect(row.get(YjsDatabaseKey.cells).get(nameFieldId)?.get(YjsDatabaseKey.data)).toBe('From selected template');
    expect(navigateToRow).toHaveBeenCalledWith(rowId);
  });

  it('sets defaults, duplicates next to the source, reorders, and deletes templates', async () => {
    const { Wrapper, database } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const base = {
      docViewId: 'document',
      isDocumentEmpty: true,
      embeddedDatabases: [],
      defaultCells: {},
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const first = store.upsert({ ...base, templateId: 'first', name: 'First' });
    const second = store.upsert({ ...base, templateId: 'second', name: 'Second' });

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openTemplateActions(first.templateId);
    const actionMenu = screen
      .getByTestId(`database-template-edit-${first.templateId}`)
      .closest('[data-slot="dropdown-menu-sub-content"]') as HTMLElement;

    expect(within(actionMenu).getAllByRole('menuitem')).toHaveLength(4);
    expect(within(actionMenu).getByTestId('database-template-edit-icon')).toBeTruthy();
    expect(within(actionMenu).getByTestId('database-template-duplicate-icon')).toBeTruthy();
    expect(within(actionMenu).getByTestId('database-template-default-icon').getAttribute('data-icon-style')).toBe(
      'outlined'
    );
    const deleteAction = within(actionMenu).getByTestId(`database-template-delete-${first.templateId}`);

    expect(within(deleteAction).getByTestId('database-template-delete-icon')).toBeTruthy();
    expect(deleteAction.className).toContain('hover:text-text-error');
    expect(actionMenu.className).toContain('max-w-[200px]');
    expect(actionMenu.className).toContain('p-[6px]');
    fireEvent.click(await screen.findByText('Set as default'));

    expect(store.read().defaultTemplateId).toBe(first.templateId);

    await openTemplateActions(first.templateId);
    expect(await screen.findByText('Clear default')).toBeTruthy();
    expect(screen.getByTestId('database-template-default-icon').getAttribute('data-icon-style')).toBe('filled');
    fireEvent.keyDown(screen.getByTestId(`database-template-actions-${first.templateId}`), { key: 'Escape' });

    await openTemplateActions(first.templateId);
    fireEvent.click(await screen.findByText('Duplicate'));
    await waitFor(() => expect(store.read().templates).toHaveLength(3));

    const afterDuplicate = store.read().templates;
    const copy = afterDuplicate[1];

    expect(afterDuplicate.map((template) => template.name)).toEqual(['First', 'First (Copy)', 'Second']);

    await openMenu();
    const secondDragHandle = screen.getByRole('button', { name: 'Reorder Second' });

    fireEvent.keyDown(secondDragHandle, { key: 'ArrowUp' });
    expect(store.read().templates.map((template) => template.templateId)).toEqual([
      first.templateId,
      second.templateId,
      copy.templateId,
    ]);

    await openTemplateActions(copy.templateId);
    expect(screen.queryByText('Move up')).toBeNull();
    expect(screen.queryByText('Move down')).toBeNull();
    fireEvent.click(await screen.findByText('Delete'));
    expect(store.read().templates).toHaveLength(3);
    expect(screen.getByText(`Are you sure you want to delete "${copy.name}"?`)).toBeTruthy();
    fireEvent.click(await screen.findByTestId('database-template-delete-confirm'));
    expect(store.read().templates.map((template) => template.templateId)).toEqual([first.templateId, second.templateId]);
    expect(store.read().defaultTemplateId).toBe(first.templateId);
  });

  it('duplicates a non-empty template through the row-document deep-copy pipeline', async () => {
    const { Wrapper, context, database, rows, createRowDocument } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const source = store.upsert({
      templateId: 'non-empty-template',
      name: 'Database template',
      docViewId: 'non-empty-template-document',
      documentData: [1, 2, 3],
      isDocumentEmpty: false,
      embeddedDatabases: [
        {
          sourceViewId: 'inline-grid',
          sourceDatabaseId: 'inline-database',
          layoutType: 0,
          name: 'Grid',
          rawData: '{"database_id":"inline-database"}',
          isLinked: false,
        },
      ],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'Database template' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const sourceDocument = new Y.Doc({ guid: source.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    sourceDocument.getMap(YjsEditorKey.data_section).set('copy-marker', 'preserved');
    context.loadRowDocument = jest.fn(async () => sourceDocument);
    context.duplicateRowDocument = jest.fn(async (_databaseId, sourceId, targetId, state, prepareSource) => {
      expect(sourceId).toBe(source.templateId);
      expect(targetId).not.toBe(source.templateId);
      expect(state).toEqual(expect.any(String));
      await prepareSource?.();
    });

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openTemplateActions(source.templateId);
    fireEvent.click(await screen.findByText('Duplicate'));

    await waitFor(() => expect(store.read().templates).toHaveLength(2));
    const duplicate = store.read().templates[1];

    expect(duplicate).toEqual(
      expect.objectContaining({
        name: 'Database template (Copy)',
        isDocumentEmpty: false,
        docViewId: rowDocumentIdFromRowId(duplicate.templateId),
        documentData: undefined,
        embeddedDatabases: [],
      })
    );
    expect(context.duplicateRowDocument).toHaveBeenCalledTimes(1);
    expect(createRowDocument).toHaveBeenCalledWith(
      rowDocumentIdFromRowId(source.templateId),
      expect.objectContaining({ row_id: source.templateId })
    );
    expect(rows.has(getRowKey(databaseDocId, source.templateId))).toBe(true);
    expect(rows.has(getRowKey(databaseDocId, duplicate.templateId))).toBe(true);
  });

  it('migrates Desktop snapshot metadata through a temporary hidden source', async () => {
    const { Wrapper, context, database } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const template = store.upsert({
      templateId: 'desktop-template',
      name: 'Desktop template',
      docViewId: 'desktop-document',
      documentData: [1, 2, 3],
      isDocumentEmpty: false,
      embeddedDatabases: [
        {
          sourceViewId: 'snapshot-view',
          sourceDatabaseId: 'snapshot-database',
          layoutType: 0,
          name: 'Projects',
          rawData: '{"database_id":"snapshot-database"}',
          isLinked: false,
        },
      ],
      defaultCells: { [nameFieldId]: { type: 'text', value: 'Desktop template' } },
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    context.loadRowDocument = jest.fn(async () => sourceDocument);
    context.duplicateRowDocument = jest.fn(async (_databaseId, sourceId, targetId, _state, prepareSource) => {
      expect(sourceId).not.toBe(template.templateId);
      expect(targetId).toBe(template.templateId);
      expect(store.read().templates.some((item) => item.templateId === sourceId)).toBe(true);
      await prepareSource?.();
    });

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openTemplateActions(template.templateId);
    fireEvent.click(await screen.findByText('Edit'));

    expect(await screen.findByTestId('database-template-editor')).toBeTruthy();
    const migrated = store.read().templates;

    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toEqual(
      expect.objectContaining({
        templateId: template.templateId,
        docViewId: rowDocumentIdFromRowId(template.templateId),
        documentData: undefined,
        embeddedDatabases: [],
      })
    );
  });

  it('keeps Desktop snapshots intact when live migration fails', async () => {
    const { Wrapper, context, database } = setup();
    const store = new DatabaseRowTemplateStore(database);
    const template = store.upsert({
      templateId: 'failed-desktop-template',
      name: 'Desktop template',
      docViewId: 'desktop-document',
      documentData: [1, 2, 3],
      isDocumentEmpty: false,
      embeddedDatabases: [],
      defaultCells: {},
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const sourceDocument = new Y.Doc({ guid: template.docViewId }) as YDoc;

    sourceDocument.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
    context.loadRowDocument = jest.fn(async () => sourceDocument);
    context.duplicateRowDocument = jest.fn(async () => Promise.reject(new Error('copy failed')));

    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    await openTemplateActions(template.templateId);
    fireEvent.click(await screen.findByText('Edit'));
    await waitFor(() => expect(context.duplicateRowDocument).toHaveBeenCalled());

    const preserved = store.read().templates;

    expect(preserved).toHaveLength(1);
    expect(preserved[0].templateId).toBe(template.templateId);
    expect(preserved[0].documentData).toEqual([1, 2, 3]);
    expect(screen.queryByTestId('database-template-editor')).toBeNull();
  });

  it('disables row creation and ignores repeated clicks while an action is pending', async () => {
    const { Wrapper, context, createRow, view } = setup();
    let resolveCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });
    const pendingCreateRow = jest.fn(async (key: string) => {
      await createGate;
      return createRow(key);
    });

    context.createRow = pendingCreateRow;
    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    const newRowButton = screen.getByTestId('database-new-row-button');

    fireEvent.click(newRowButton);
    fireEvent.click(newRowButton);

    expect(pendingCreateRow).toHaveBeenCalledTimes(1);
    expect(newRowButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('database-template-split-button').getAttribute('aria-busy')).toBe('true');

    resolveCreate();
    await waitFor(() => expect(view.get(YjsDatabaseKey.row_orders)).toHaveLength(1));
    await waitFor(() => expect(newRowButton.hasAttribute('disabled')).toBe(false));
  });

  it('reports row creation failures and resets its pending state', async () => {
    const { Wrapper, context } = setup();

    context.createRow = jest.fn(async () => Promise.reject(new Error('create failed')));
    render(<DatabaseTemplateButton />, { wrapper: Wrapper });
    const newRowButton = screen.getByTestId('database-new-row-button');

    fireEvent.click(newRowButton);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create failed'));
    expect(newRowButton.hasAttribute('disabled')).toBe(false);
  });
});
