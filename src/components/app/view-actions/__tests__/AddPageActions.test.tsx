import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';

import { View, ViewLayout } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

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

jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({
  useDatabaseViewCreation: () => ({
    getAction: () => ({ type: 'create' }),
    checkCreation: () => true,
  }),
}));

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

describe('AddPageActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    });
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

  it('shows Form and Timeline creation options by default', () => {
    renderActions(view({ view_id: 'parent-id' }));

    expect(screen.getByTestId('add-form-button')).toBeTruthy();
    expect(screen.getByTestId('add-timeline-page-button')).toBeTruthy();
    expect(screen.getByTestId('add-grid-button')).toBeTruthy();
    expect(screen.getByTestId('add-list-button')).toBeTruthy();
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it('creates a Form page and navigates to it', async () => {
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

  it.each([
    ['list', ViewLayout.List],
    ['gallery', ViewLayout.Gallery],
    ['feed', ViewLayout.Feed],
  ])('creates a %s page in its final layout with one operation', async (button, layout) => {
    mockAddPage.mockResolvedValueOnce({ view_id: 'created-container-id', database_id: 'database-id' });
    renderActions(view({ view_id: 'parent-id', children: [view({ view_id: 'last-child-id' })] }));
    fireEvent.click(screen.getByTestId(`add-${button}-button`));
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('created-container-id'));
    expect(mockAddPage).toHaveBeenCalledTimes(1);
    expect(mockAddPage).toHaveBeenCalledWith('parent-id', {
      layout,
      name: 'document.plugins.database.newDatabase',
      prev_view_id: 'last-child-id',
    });
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
    expect(mockLoadView).not.toHaveBeenCalled();
    expect(mockBindViewSync).not.toHaveBeenCalled();
    expect(mockUpdatePage).not.toHaveBeenCalled();
    expect(mockDeletePage).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
  });

  it('keeps selection unchanged while creation is pending, then opens the acknowledged identity', async () => {
    let complete!: (value: { view_id: string; database_id: string }) => void;

    mockAddPage.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));
    expect(mockToView).not.toHaveBeenCalled();
    complete({ view_id: 'created-container-id', database_id: 'database-id' });
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('created-container-id'));
  });

  it('does not compensate a creation with an ambiguous response or select an unreadable page', async () => {
    mockAddPage.mockRejectedValueOnce(new Error('Creation is pending'));
    renderActions(view({ view_id: 'parent-id' }));
    fireEvent.click(screen.getByTestId('add-list-button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create page'));
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockDeletePage).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
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

  it.each(['form', 'chart'])(
    'shows a Pro upgrade message without navigating when %s creation is rejected',
    async (layout) => {
      mockAddPage.mockRejectedValueOnce({ code: 1076, message: 'Workspace limit reached' });
      renderActions(view({ view_id: 'space-id', extra: { is_space: true } }));
      fireEvent.click(screen.getByTestId(`add-${layout}-button`));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "This subscription plan isn't valid for this action. Upgrade this workspace to Pro to use this feature or increase its limits."
        )
      );
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.dismiss).toHaveBeenCalled();
      expect(mockToView).not.toHaveBeenCalled();
      expect(mockOpenPageModal).not.toHaveBeenCalled();
    }
  );

  it('shows the workspace plan error without navigating when Timeline creation is rejected', async () => {
    const message = 'Creating a Timeline view requires an active Pro plan for this workspace.';

    mockAddPage.mockRejectedValueOnce({ code: 1090, message });
    renderActions(view({ view_id: 'space-id', extra: { is_space: true } }));
    fireEvent.click(screen.getByTestId('add-timeline-page-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('An upgrade is required for this action.'));
    expect(toast.dismiss).toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
  });

  it('does not initialize or navigate to an AI chat when page creation fails', async () => {
    mockAddPage.mockRejectedValueOnce(new Error('create failed'));

    renderActions(view({ view_id: 'space-id', extra: { is_space: true } }));
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create page'));

    expect(mockChatRequest).not.toHaveBeenCalled();
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
  });
});
