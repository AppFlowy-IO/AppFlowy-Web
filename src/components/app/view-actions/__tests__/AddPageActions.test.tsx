import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { FieldType, FieldVisibility } from '@/application/database-yjs';
import {
  DatabaseViewLayout,
  View,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';

import type { ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockGetView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockToView = jest.fn();
const mockOpenPageModal = jest.fn();
const mockChatRequest = jest.fn();
const mockLoadView = jest.fn();
const mockLoadViewMeta = jest.fn();
const mockBindViewSync = jest.fn();
const mockCreateDatabaseView = jest.fn();
const mockDeletePage = jest.fn();
const mockDeleteTrash = jest.fn();
const mockUpdatePage = jest.fn();
const mockFlush = jest.fn();
const mockScheduleDeferredCleanup = jest.fn();
const mockMenuSelectPreventDefault = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    dismiss: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(() => 'loading-toast-id'),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useAppOperations: () => ({
    addPage: mockAddPage,
    bindViewSync: mockBindViewSync,
    createDatabaseView: mockCreateDatabaseView,
    deletePage: mockDeletePage,
    deleteTrash: mockDeleteTrash,
    loadView: mockLoadView,
    loadViewMeta: mockLoadViewMeta,
    updatePage: mockUpdatePage,
  }),
  useCurrentWorkspaceId: () => 'workspace-id',
  useOpenPageModal: () => mockOpenPageModal,
  useScheduleDeferredCleanup: () => mockScheduleDeferredCleanup,
  useToView: () => mockToView,
}));

jest.mock('@/components/chat/request', () => ({
  ChatRequest: function MockChatRequest(...args: unknown[]) {
    mockChatRequest(...args);
    return {
      getView: mockGetView,
      updateChatSettings: mockUpdateChatSettings,
    };
  },
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => ({}),
}));

jest.mock('@/components/_shared/view-icon', () => ({
  ViewIcon: () => null,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    onSelect?: (event: Event) => void;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={props['data-testid'] as string | undefined}
      disabled={disabled}
      onClick={() => {
        onClick?.();
        onSelect?.({ preventDefault: mockMenuSelectPreventDefault } as unknown as Event);
      }}
      type='button'
    >
      {children}
    </button>
  ),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function view(overrides: Partial<View> = {}): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function renderActions(targetView: View) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AddPageActions view={targetView} />
    </MemoryRouter>
  );
}

function createGridDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const views = new Y.Map();
  const databaseView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map();
  const metas = new Y.Map();
  const fieldIds = ['primary-field', 'field-1', 'field-2', 'field-3'];

  fieldIds.forEach((fieldId, index) => {
    const field = new Y.Map();
    const setting = new Y.Map();

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, index === 0 ? 'Name' : `Field ${index}`);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, index === 0);
    fields.set(fieldId, field);
    setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    fieldSettings.set(fieldId, setting);
  });
  fieldOrders.push(fieldIds.map((id) => ({ id })));
  databaseView.set(YjsDatabaseKey.id, 'grid-view-id');
  databaseView.set(YjsDatabaseKey.name, 'Grid');
  databaseView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  databaseView.set(YjsDatabaseKey.field_orders, fieldOrders);
  databaseView.set(YjsDatabaseKey.field_settings, fieldSettings);
  databaseView.set(YjsDatabaseKey.groups, new Y.Array());
  databaseView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set('grid-view-id', databaseView);
  metas.set(YjsDatabaseKey.iid, 'grid-view-id');
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createLinkedListUpdate(databaseDoc: YDoc): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database?.get(YjsDatabaseKey.views);
  const gridView = views?.get('grid-view-id');
  const listView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(gridView?.get(YjsDatabaseKey.field_orders)?.toArray() ?? []);
  listView.set(YjsDatabaseKey.id, 'list-view-id');
  listView.set(YjsDatabaseKey.name, 'List');
  listView.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
  listView.set(YjsDatabaseKey.field_orders, fieldOrders);
  listView.set(YjsDatabaseKey.field_settings, new Y.Map());
  listView.set(YjsDatabaseKey.groups, new Y.Array());
  listView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views?.set('list-view-id', listView);

  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

describe('AddPageActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddPage.mockReset();
    mockAddPage.mockResolvedValue({ view_id: 'chat-id' });
    mockUpdateChatSettings.mockResolvedValue(undefined);
    mockToView.mockResolvedValue(undefined);
    mockFlush.mockResolvedValue(true);
    mockBindViewSync.mockReturnValue({ flush: mockFlush });
    mockCreateDatabaseView.mockResolvedValue({
      view_id: 'list-view-id',
      database_id: 'database-id',
    });
    mockDeletePage.mockResolvedValue(undefined);
    mockDeleteTrash.mockResolvedValue(undefined);
    mockLoadViewMeta.mockResolvedValue(null);
    mockUpdatePage.mockResolvedValue(undefined);
  });

  it('shows Form and creates it without checking a workspace subscription', async () => {
    const parent = view({
      view_id: 'parent-id',
      children: [view({ view_id: 'last-child-id' })],
    });

    mockAddPage.mockResolvedValueOnce({ view_id: 'form-view-id', database_id: 'database-id' });
    renderActions(parent);

    expect(screen.getByTestId('add-form-button').textContent).toBe('form.menuName');
    fireEvent.click(screen.getByTestId('add-form-button'));

    expect(mockMenuSelectPreventDefault).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('parent-id', {
        layout: ViewLayout.Form,
        name: 'document.plugins.database.newDatabase',
        prev_view_id: 'last-child-id',
      })
    );
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('form-view-id'));
  });

  it('replaces the temporary standalone Grid child with a durable List child', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockCreateDatabaseView.mockResolvedValueOnce({
      view_id: 'list-view-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    mockLoadViewMeta.mockResolvedValueOnce(
      view({
        view_id: 'list-container-id',
        layout: ViewLayout.Grid,
        children: [view({ view_id: 'grid-view-id', layout: ViewLayout.Grid })],
      })
    );
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    const parent = view({
      view_id: 'parent-id',
      children: [view({ view_id: 'last-child-id' })],
    });

    renderActions(parent);
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('parent-id', {
        layout: ViewLayout.Grid,
        name: 'document.plugins.database.newDatabase',
        prev_view_id: 'last-child-id',
      })
    );
    expect(mockLoadViewMeta).toHaveBeenCalledWith('list-container-id');
    expect(mockLoadView).toHaveBeenCalledWith('grid-view-id', false, false, {
      databaseId: 'database-id',
      forceFetch: true,
    });
    expect(mockBindViewSync).toHaveBeenCalledWith(databaseDoc);
    expect(mockCreateDatabaseView).toHaveBeenCalledWith('grid-view-id', {
      parent_view_id: 'list-container-id',
      prev_view_id: 'grid-view-id',
      database_id: 'database-id',
      layout: ViewLayout.List,
      name: 'List',
      embedded: false,
    });
    expect(mockDeletePage).toHaveBeenCalledWith('grid-view-id');
    expect(mockDeleteTrash).toHaveBeenCalledWith('grid-view-id');
    expect(mockUpdatePage).not.toHaveBeenCalled();

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const databaseViews = database?.get(YjsDatabaseKey.views);
    const listView = databaseViews?.get('list-view-id');

    expect(listView?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.List);
    expect(listView?.get(YjsDatabaseKey.name)).toBe('List');
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-2')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysShown
    );
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-3')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysHidden
    );
    expect(database?.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid)).toBe('list-view-id');
    expect(databaseViews?.has('grid-view-id')).toBe(false);
    expect(Array.from(databaseViews?.keys() ?? [])).toEqual(['list-view-id']);
    expect(mockFlush).toHaveBeenCalledTimes(2);
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('list-view-id'));
    expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(mockDeletePage.mock.invocationCallOrder[0]);
    expect(mockDeletePage.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteTrash.mock.invocationCallOrder[0]);
    expect(mockDeleteTrash.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[1]);
    expect(mockFlush.mock.invocationCallOrder[1]).toBeLessThan(mockToView.mock.invocationCallOrder[0]);
  });

  it('compensates the exact container when temporary Grid soft-delete fails', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockCreateDatabaseView.mockResolvedValueOnce({
      view_id: 'list-view-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    mockLoadViewMeta.mockResolvedValueOnce(
      view({
        view_id: 'list-container-id',
        layout: ViewLayout.Grid,
        children: [view({ view_id: 'grid-view-id', layout: ViewLayout.Grid })],
      })
    );
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    mockDeletePage.mockRejectedValueOnce(new Error('temporary Grid could not be moved to trash'));

    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('temporary Grid could not be moved to trash'));

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const databaseViews = database?.get(YjsDatabaseKey.views);

    expect(database?.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid)).toBe('list-view-id');
    expect(databaseViews?.has('grid-view-id')).toBe(true);
    expect(databaseViews?.has('list-view-id')).toBe(true);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockDeletePage.mock.calls).toEqual([['grid-view-id'], ['list-container-id']]);
    expect(mockDeleteTrash.mock.calls).toEqual([['list-container-id']]);
    expect(mockToView).not.toHaveBeenCalled();
  });

  it('compensates the exact container when initial List persistence is unconfirmed', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockCreateDatabaseView.mockResolvedValueOnce({
      view_id: 'list-view-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    mockLoadViewMeta.mockResolvedValueOnce(
      view({
        view_id: 'list-container-id',
        layout: ViewLayout.Grid,
        children: [view({ view_id: 'grid-view-id', layout: ViewLayout.Grid })],
      })
    );
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    mockFlush.mockResolvedValueOnce(false);

    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The new List database could not be persisted'));

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    expect(mockDeletePage.mock.calls).toEqual([['list-container-id']]);
    expect(mockDeleteTrash.mock.calls).toEqual([['list-container-id']]);
    expect(database?.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid)).toBe('list-view-id');
    expect(database?.get(YjsDatabaseKey.views)?.has('grid-view-id')).toBe(true);
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
    expect(mockToView).not.toHaveBeenCalled();
  });

  it('compensates the exact container when temporary Grid permanent-delete fails', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockCreateDatabaseView.mockResolvedValueOnce({
      view_id: 'list-view-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    mockLoadViewMeta.mockResolvedValueOnce(
      view({
        view_id: 'list-container-id',
        layout: ViewLayout.Grid,
        children: [view({ view_id: 'grid-view-id', layout: ViewLayout.Grid })],
      })
    );
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    mockDeleteTrash.mockRejectedValueOnce(new Error('permanent cleanup unavailable'));

    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permanent cleanup unavailable'));

    expect(mockDeletePage.mock.calls).toEqual([['grid-view-id'], ['list-container-id']]);
    expect(mockDeleteTrash.mock.calls).toEqual([['grid-view-id'], ['list-container-id']]);
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    expect(database?.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid)).toBe('list-view-id');
    expect(database?.get(YjsDatabaseKey.views)?.has('grid-view-id')).toBe(true);
    expect(database?.get(YjsDatabaseKey.views)?.has('list-view-id')).toBe(true);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockToView).not.toHaveBeenCalled();
  });

  it('compensates the exact container when final Grid Y-view persistence is unconfirmed', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockCreateDatabaseView.mockResolvedValueOnce({
      view_id: 'list-view-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    mockLoadViewMeta.mockResolvedValueOnce(
      view({
        view_id: 'list-container-id',
        layout: ViewLayout.Grid,
        children: [view({ view_id: 'grid-view-id', layout: ViewLayout.Grid })],
      })
    );
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    mockFlush.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The temporary Grid cleanup could not be persisted'));

    expect(mockDeletePage.mock.calls).toEqual([['grid-view-id'], ['list-container-id']]);
    expect(mockDeleteTrash.mock.calls).toEqual([['grid-view-id'], ['list-container-id']]);
    expect(
      databaseDoc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database)
        ?.get(YjsDatabaseKey.views)
        ?.has('grid-view-id')
    ).toBe(false);
    expect(mockFlush).toHaveBeenCalledTimes(2);
    expect(mockToView).not.toHaveBeenCalled();
  });

  it('starts with no RAG IDs when the parent is a space', async () => {
    const space = view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [view({ view_id: 'space-child-1' }), view({ view_id: 'space-child-2' })],
    });

    renderActions(space);
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() =>
      expect(mockUpdateChatSettings).toHaveBeenCalledWith({
        full_workspace: false,
        rag_ids: [],
      })
    );

    expect(mockAddPage).toHaveBeenCalledWith('space-id', {
      layout: ViewLayout.AIChat,
      name: 'menuAppHeader.defaultNewPageName',
      prev_view_id: 'space-child-2',
    });
    expect(mockGetView).not.toHaveBeenCalled();
    expect(mockToView).toHaveBeenCalledWith('chat-id');
  });

  it('uses only direct document child IDs when the parent is a page', async () => {
    const nestedDocument = view({ view_id: 'nested-document-id' });
    const directDocument = view({
      view_id: 'direct-document-id',
      children: [nestedDocument],
    });
    const directDatabase = view({
      view_id: 'direct-database-id',
      layout: ViewLayout.Grid,
    });
    const secondDirectDocument = view({ view_id: 'second-direct-document-id' });
    const page = view({
      view_id: 'page-id',
      children: [directDocument, directDatabase, secondDirectDocument],
    });

    mockGetView.mockResolvedValue(page);

    renderActions(page);
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() =>
      expect(mockUpdateChatSettings).toHaveBeenCalledWith({
        full_workspace: false,
        rag_ids: ['direct-document-id', 'second-direct-document-id'],
      })
    );

    const settings = mockUpdateChatSettings.mock.calls[0][0] as { rag_ids: string[] };

    expect(settings.rag_ids).not.toContain('page-id');
    expect(settings.rag_ids).not.toContain('nested-document-id');
    expect(settings.rag_ids).not.toContain('direct-database-id');
    expect(mockAddPage).toHaveBeenCalledWith('page-id', {
      layout: ViewLayout.AIChat,
      name: 'menuAppHeader.defaultNewPageName',
      prev_view_id: 'second-direct-document-id',
    });
    expect(mockGetView).toHaveBeenCalledWith('page-id');
    expect(mockToView).toHaveBeenCalledWith('chat-id');
  });

  it('does not initialize or navigate to an AI chat when page creation fails', async () => {
    mockAddPage.mockRejectedValueOnce(new Error('create failed'));

    renderActions(view({ view_id: 'space-id', extra: { is_space: true } }));
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create failed'));

    expect(mockChatRequest).not.toHaveBeenCalled();
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
  });
});
