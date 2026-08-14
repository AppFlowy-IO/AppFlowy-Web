import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { FieldType, FieldVisibility } from '@/application/database-yjs';
import { DatabaseViewLayout, View, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';

import type { ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockGetView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockToView = jest.fn();
const mockOpenPageModal = jest.fn();
const mockChatRequest = jest.fn();
const mockLoadView = jest.fn();
const mockBindViewSync = jest.fn();
const mockFlush = jest.fn();

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
    loadView: mockLoadView,
  }),
  useCurrentWorkspaceId: () => 'workspace-id',
  useOpenPageModal: () => mockOpenPageModal,
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
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button data-testid={props['data-testid'] as string | undefined} disabled={disabled} onClick={onClick} type='button'>
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

function createGridDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const views = new Y.Map();
  const databaseView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map();
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
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

describe('AddPageActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddPage.mockResolvedValue({ view_id: 'chat-id' });
    mockUpdateChatSettings.mockResolvedValue(undefined);
    mockToView.mockResolvedValue(undefined);
    mockFlush.mockResolvedValue(true);
    mockBindViewSync.mockReturnValue({ flush: mockFlush });
  });

  it('creates and opens a List database page through the server-compatible Grid conversion', async () => {
    const databaseDoc = createGridDatabaseDoc();

    mockAddPage.mockResolvedValueOnce({ view_id: 'list-container-id', database_id: 'database-id' });
    mockLoadView.mockResolvedValueOnce(databaseDoc);
    const parent = view({
      view_id: 'parent-id',
      children: [view({ view_id: 'last-child-id' })],
    });

    render(<AddPageActions view={parent} />);
    fireEvent.click(screen.getByTestId('add-list-button'));

    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('parent-id', {
        layout: ViewLayout.Grid,
        name: 'document.plugins.database.newDatabase',
        prev_view_id: 'last-child-id',
      })
    );
    expect(mockLoadView).toHaveBeenCalledWith('list-container-id', false, false, {
      databaseId: 'database-id',
      forceFetch: true,
    });
    expect(mockBindViewSync).toHaveBeenCalledWith(databaseDoc);

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const listView = database?.get(YjsDatabaseKey.views)?.get('grid-view-id');

    expect(listView?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.List);
    expect(listView?.get(YjsDatabaseKey.name)).toBe('List');
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-2')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysShown
    );
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-3')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysHidden
    );
    expect(mockFlush).toHaveBeenCalled();
    expect(mockToView).toHaveBeenCalledWith('list-container-id');
  });

  it('starts with no RAG IDs when the parent is a space', async () => {
    const space = view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [view({ view_id: 'space-child-1' }), view({ view_id: 'space-child-2' })],
    });

    render(<AddPageActions view={space} />);
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

    render(<AddPageActions view={page} />);
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

    render(<AddPageActions view={view({ view_id: 'space-id', extra: { is_space: true } })} />);
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create failed'));

    expect(mockChatRequest).not.toHaveBeenCalled();
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
  });
});
