import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { emit, EventType } from '@/application/session/event';
import { RAG_SOURCE_OWNERS_METADATA_KEY } from '@/components/ai-chat/rag-scope';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { Search } from '@/components/app/search/Search';

import type { ChangeEvent, ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockToView = jest.fn();
const mockGetViewNavigation = jest.fn();
const mockFetchCompleteView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockChatRequest = jest.fn();
// Recent pages from the endpoint, and the app-wide loader that other readers share.
const mockLoadRecentViews = jest.fn();
const mockSharedLoadRecentViews = jest.fn();
const mockGetObjectPermission = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockToastSuccess = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifyDefault = jest.fn();

jest.mock('@mui/material', () => ({
  Dialog: ({ children, open, onClose }: { children: ReactNode; open: boolean; onClose: () => void }) => (
    open ? <div><button onClick={onClose}>Close search</button>{children}</div> : null
  ),
  InputBase: ({ onChange, value }: { onChange: (event: ChangeEvent<HTMLInputElement>) => void; value: string }) => (
    <input aria-label='search-input' onChange={onChange} value={value} />
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useAppOperations: () => ({ addPage: mockAddPage }),
  useAppOutline: () => [],
  useAppRecent: () => ({ recentViews: [], loadRecentViews: mockSharedLoadRecentViews }),
  useAppViewId: () => 'current-page-id',
  useCurrentWorkspaceId: () => 'workspace-id',
  useToView: () => mockToView,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => 'user-id',
  useIsAuthenticatedOptional: () => true,
}));

jest.mock('@/components/app/search/BestMatch', () => ({
  __esModule: true,
  default: ({ onAskAI, searchValue, askingAI }: { onAskAI: (query: string, sources: unknown[]) => void; searchValue: string; askingAI: boolean }) => (
    <button
      disabled={askingAI}
      onClick={() =>
        onAskAI(searchValue, [
          {
            ragId: 'row-id',
            ownerViewId: 'database-view-id',
            ownerDatabaseId: 'database-id',
          },
        ])
      }
    >
      Ask AI
    </button>
  ),
}));

jest.mock('@/components/app/search/RecentViews', () => ({
  __esModule: true,
  default: ({ recentViews, loading }: { recentViews: Array<{ name: string }>; loading: boolean }) => (
    <div data-testid='recent-views' data-loading={loading}>
      {recentViews.map((view) => view.name).join(',')}
    </div>
  ),
}));

jest.mock('@/components/app/search/ViewList', () => ({
  __esModule: true,
  default: () => <div>Loading results</div>,
}));

jest.mock('@/components/chat/request', () => ({
  ChatRequest: function MockChatRequest(...args: unknown[]) {
    return mockChatRequest(...args);
  },
}));

jest.mock('@/components/chat/lib/views', () => ({
  findAncestors: (views: Array<{ view_id: string; children: unknown[] }>, targetId: string) => {
    const visit = (
      items: Array<{ view_id: string; children: unknown[] }>,
      path: Array<{ view_id: string; children: unknown[] }> = []
    ): Array<{ view_id: string; children: unknown[] }> | null => {
      for (const item of items) {
        const nextPath = [...path, item];

        if (item.view_id === targetId) return nextPath;
        const found = visit(item.children as Array<{ view_id: string; children: unknown[] }>, nextPath);

        if (found) return found;
      }

      return null;
    };

    return visit(views);
  },
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => ({}),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: (...args: unknown[]) => mockNotifyError(...args),
    default: (...args: unknown[]) => mockNotifyDefault(...args),
  },
}));

jest.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args) },
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: { getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args) },
  ViewService: { getRecent: (...args: unknown[]) => mockLoadRecentViews(...args) },
  WorkspaceService: { getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args) },
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  dropdownMenuItemVariants: () => '',
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

jest.mock('@/utils/hotkeys', () => ({
  HOT_KEY_NAME: { SEARCH: 'search' },
  createHotkey: () => () => false,
  createHotKeyLabel: () => '',
}));

describe('Search AI chat creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadRecentViews.mockResolvedValue([]);
    const currentPage = {
      view_id: 'current-page-id',
      name: 'Current page',
      icon: null,
      layout: 0,
      extra: null,
      children: [],
      is_private: false,
    };
    const databaseView = {
      view_id: 'database-view-id',
      name: 'Projects',
      icon: null,
      layout: 1,
      extra: { database_id: 'database-id' },
      children: [],
      is_private: false,
    };
    const space = {
      view_id: 'space-id',
      name: 'Space',
      icon: null,
      layout: 0,
      is_space: true,
      extra: { is_space: false },
      children: [currentPage, databaseView],
      is_private: false,
    };

    mockGetViewNavigation.mockResolvedValue({
      view_id: 'workspace-id',
      name: 'Workspace',
      icon: null,
      layout: 0,
      extra: null,
      children: [{ ...space, children: [currentPage] }],
      is_private: false,
    });
    mockFetchCompleteView.mockResolvedValue(space);
    mockGetObjectPermission.mockImplementation(async (_workspaceId: string, objectId: string, collabType: number) => ({
      object_id: objectId,
      collab_type: collabType,
      governing_view_id: objectId,
      access_level: 30,
      can_read: true,
      can_write: true,
      can_comment: true,
      can_share: false,
    }));
    mockGetSpacePermission.mockResolvedValue({ can_edit_sidebar: true });
    mockAddPage.mockResolvedValue({ view_id: 'chat-id' });
    mockUpdateChatSettings.mockResolvedValue(undefined);
    mockToView.mockResolvedValue(undefined);
    mockChatRequest.mockImplementation((_workspaceId: string, chatId: string) =>
      chatId === 'current-page-id'
        ? {
            getViewNavigation: mockGetViewNavigation,
            fetchCompleteView: mockFetchCompleteView,
          }
        : { updateChatSettings: mockUpdateChatSettings }
    );
  });

  it('clears recent names on revocation and keeps them hidden after a failed refresh', async () => {
    const emitter = new EventEmitter();

    mockLoadRecentViews.mockResolvedValueOnce([{ view_id: 'secret', name: 'Protected recent page' }]);
    const { unmount } = render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);

    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Protected recent page');
    mockLoadRecentViews.mockRejectedValueOnce(new Error('Permission unavailable'));
    act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(screen.queryByText('Protected recent page')).toBeNull();
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Protected recent page')).toBeNull();
    expect(await screen.findByText('search.recentPagesFailed')).toBeTruthy();
    mockLoadRecentViews.mockResolvedValueOnce([{ view_id: 'secret', name: 'Protected recent page' }]);
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    await screen.findByText('Protected recent page');
    unmount();
    expect(emitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(0);
  });

  it('ignores an old recent response after permission refresh', async () => {
    let resolveOld!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockLoadRecentViews.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      resolveOld([{ view_id: 'secret', name: 'Late recent page' }]);
    });
    expect(screen.queryByText('Late recent page')).toBeNull();
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(2));
  });

  it('does not create a chat after permission changes during parent resolution', async () => {
    let resolveParent!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockFetchCompleteView.mockImplementationOnce(() => new Promise((resolve) => { resolveParent = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockFetchCompleteView).toHaveBeenCalledTimes(1));
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      resolveParent({ view_id: 'space-id', children: [] });
    });
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockNotifyDefault).toHaveBeenCalledWith('search.aiChatPermissionsChanged');
  });

  it('re-validates the chat context and still opens a chat created across a permission change', async () => {
    let resolveCreate!: (value: unknown) => void;
    const emitter = new EventEmitter();
    const revalidatedSpace = { view_id: 'space-id', name: 'Space', layout: 0, is_space: true, extra: null, children: [] };

    mockAddPage.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    const button = await screen.findByText('Ask AI');

    fireEvent.click(button);
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
    mockFetchCompleteView.mockResolvedValueOnce(revalidatedSpace);
    act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveCreate({ view_id: 'chat-id' });
    });
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('chat-id'));
    expect(mockFetchCompleteView).toHaveBeenLastCalledWith('space-id', true);
    // The row source is no longer inside the re-read parent, so it is not attached.
    expect(mockUpdateChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: [],
      metadata: { initial_prompt: 'launch' },
    });
    expect(mockAddPage).toHaveBeenCalledTimes(1);
  });

  it.each(['focus', 'visible', 'socket'])('keeps an Ask AI attempt going on %s', async (event) => {
    let resolveCreate!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockAddPage.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (event === 'focus') window.dispatchEvent(new Event('focus'));
      else if (event === 'visible') document.dispatchEvent(new Event('visibilitychange'));
      else emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      resolveCreate({ view_id: 'chat-id' });
    });
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('chat-id'));
    expect(mockUpdateChatSettings).toHaveBeenCalledTimes(1);
  });

  it('finishes a chat created after the dialog closed and offers to open it', async () => {
    let resolveCreate!: (value: unknown) => void;

    mockAddPage.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Close search'));
    await act(async () => {
      resolveCreate({ view_id: 'chat-id' });
    });
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockUpdateChatSettings).toHaveBeenCalledTimes(1);
    expect(mockToView).not.toHaveBeenCalled();
    const [message, options] = mockToastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];

    expect(message).toBe('search.aiChatCreated');
    expect(options.action.label).toBe('search.openAIChat');
    options.action.onClick();
    expect(mockToView).toHaveBeenCalledWith('chat-id');
  });

  it('stops after creation without touching the next session', async () => {
    let resolveCreate!: (value: unknown) => void;

    mockAddPage.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
    await act(async () => {
      emit(EventType.SESSION_INVALID);
      resolveCreate({ view_id: 'chat-id' });
    });
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it.each([
    ['the space only lets owners add pages', () => mockGetSpacePermission.mockResolvedValueOnce({ can_edit_sidebar: false })],
    [
      'the user cannot edit the space',
      () =>
        mockGetObjectPermission.mockImplementationOnce(async (_w: string, objectId: string, collabType: number) => ({
          object_id: objectId,
          collab_type: collabType,
          governing_view_id: objectId,
          access_level: 10,
          can_read: true,
          can_write: false,
          can_comment: false,
          can_share: false,
        })),
    ],
    ['the permission check is denied', () => mockGetObjectPermission.mockRejectedValueOnce({ code: 1012, message: 'denied' })],
  ])('explains instead of creating a chat when %s', async (_case, arrange) => {
    arrange();
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('search.aiChatParentDenied'));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'space-id', expect.anything());
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-id', 'space-id');
    expect(mockAddPage).not.toHaveBeenCalled();
    expect((screen.getByText('Ask AI')).disabled).toBe(false);
  });

  it('lets the server decide when an older server has no permission routes', async () => {
    mockGetObjectPermission.mockRejectedValueOnce({ code: 404, httpStatus: 404, message: 'Not Found' });
    mockGetSpacePermission.mockRejectedValueOnce({ code: 404, httpStatus: 404, message: 'Not Found' });
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('chat-id'));
    expect(mockAddPage).toHaveBeenCalledTimes(1);
  });

  it('only needs Write for a chat under a page that is not a space', async () => {
    const page = { view_id: 'root-page', name: 'Shared root', layout: 0, extra: null, children: [] };

    mockGetViewNavigation.mockResolvedValueOnce({ ...page, children: [{ view_id: 'current-page-id', children: [] }] });
    mockFetchCompleteView.mockResolvedValueOnce(page);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('chat-id'));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'root-page', expect.anything());
    expect(mockGetSpacePermission).not.toHaveBeenCalled();
    expect(mockAddPage).toHaveBeenCalledWith('root-page', expect.objectContaining({ layout: 4 }));
  });

  it.each([
    ['the server refuses', { code: 1012, message: 'user 1 cannot manage or create children in space x' }],
    // Guests and pages shared with the user are refused by the app before anything is sent.
    ['the app refuses', Object.assign(new Error('No permission to create pages'), { code: 1012 })],
  ])('uses plain words once when %s to create the chat', async (_case, refusal) => {
    mockAddPage.mockRejectedValueOnce(refusal);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('search.aiChatParentDenied'));
    expect(mockNotifyError).toHaveBeenCalledTimes(1);
    expect(mockToView).not.toHaveBeenCalled();
  });

  it('uses authoritative navigation and persists row ownership before navigating', async () => {
    render(<Search />);

    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));

    await waitFor(() => expect(mockToView).toHaveBeenCalledWith('chat-id'));

    expect(mockGetViewNavigation).toHaveBeenCalledWith('current-page-id');
    expect(mockFetchCompleteView).toHaveBeenCalledWith('space-id', true);
    expect(mockAddPage).toHaveBeenCalledWith('space-id', {
      layout: 4,
      name: 'launch',
      prev_view_id: 'database-view-id',
    });
    expect(mockUpdateChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: ['row-id'],
      metadata: {
        initial_prompt: 'launch',
        [RAG_SOURCE_OWNERS_METADATA_KEY]: {
          'row-id': {
            view_id: 'database-view-id',
            database_id: 'database-id',
          },
        },
      },
    });
    expect(mockUpdateChatSettings.mock.invocationCallOrder[0]).toBeLessThan(mockToView.mock.invocationCallOrder[0]);
  });

  it('coalesces a stalled recent read and repeated permission hints into one follow-up', async () => {
    let resolveOld!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockLoadRecentViews.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    for (let i = 0; i < 20; i += 1) {
      act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    }

    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
    await act(async () => { resolveOld([{ view_id: 'secret', name: 'Obsolete recent' }]); });
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Obsolete recent')).toBeNull();
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(2);
  });

  it('keeps Ask AI busy across a permission change so one request cannot run twice', async () => {
    let resolveFirst!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockFetchCompleteView.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    const button = await screen.findByText('Ask AI');

    fireEvent.click(button);
    await waitFor(() => expect(mockFetchCompleteView).toHaveBeenCalledTimes(1));
    expect(button.disabled).toBe(true);
    act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mockFetchCompleteView).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst({ view_id: 'space-id', is_space: true, children: [] }); });
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
  });

  it('does not resume an AI workflow into a reopened search dialog', async () => {
    let resolveParent!: (value: unknown) => void;

    mockFetchCompleteView.mockImplementationOnce(() => new Promise((resolve) => { resolveParent = resolve; }));
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'old query' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockFetchCompleteView).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Close search'));
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'replacement query' } });
    await act(async () => { resolveParent({ view_id: 'space-id', children: [] }); });
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
    expect(mockToView).not.toHaveBeenCalled();
    expect((screen.getByLabelText('search-input')).value).toBe('replacement query');
    expect((screen.getByText('Ask AI')).disabled).toBe(false);
  });

  it('keeps closed-dialog recent responses out of a reopened dialog', async () => {
    let resolveFirst!: (value: unknown) => void;

    mockLoadRecentViews.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.click(screen.getByText('Close search'));
    fireEvent.click(screen.getByText('button.search'));
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst([{ view_id: 'old', name: 'Closed dialog recent' }]); });
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Closed dialog recent')).toBeNull();
  });
});

describe('Search recent pages', () => {
  const setOnline = (online: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadRecentViews.mockReset();
    // What the app-wide loader returns to a call that a newer reader replaced.
    mockSharedLoadRecentViews.mockReset().mockResolvedValue(undefined);
    setOnline(true);
  });

  afterAll(() => {
    setOnline(true);
  });

  it('keeps the loaded recent list when the query is cleared', async () => {
    mockLoadRecentViews.mockResolvedValue([{ view_id: 'recent', name: 'Recent page' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Recent page');
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    expect(screen.queryByText('Recent page')).toBeNull();
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: '' } });
    expect(screen.getByText('Recent page')).toBeTruthy();
    expect(screen.getByTestId('recent-views').getAttribute('data-loading')).toBe('false');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
  });

  it('publishes a recent read that settles while a query is typed', async () => {
    let resolve!: (views: unknown) => void;

    mockLoadRecentViews.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    await act(async () => {
      resolve([{ view_id: 'recent', name: 'Late but current recent' }]);
    });
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: '' } });
    expect(screen.getByText('Late but current recent')).toBeTruthy();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
  });

  it('does not report a failure when another reader replaces the app-wide recent-pages load', async () => {
    mockLoadRecentViews.mockResolvedValueOnce([{ view_id: 'recent', name: 'Recent page' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('Recent page')).toBeTruthy();
    expect(screen.queryByText('search.recentPagesFailed')).toBeNull();
    expect(mockLoadRecentViews).toHaveBeenCalledWith('workspace-id');
  });

  it('lists a recent page once and leaves out spaces', async () => {
    mockLoadRecentViews.mockResolvedValueOnce([
      { view_id: 'recent', name: 'Recent page' },
      { view_id: 'space', name: 'A space', extra: { is_space: true } },
      { view_id: 'recent', name: 'Recent page' },
    ]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    await waitFor(() => expect(screen.getByTestId('recent-views').textContent).toBe('Recent page'));
  });

  it.each(['rejected', 'unavailable'])('offers a retry when recent pages are %s', async (failure) => {
    if (failure === 'rejected') mockLoadRecentViews.mockRejectedValueOnce(new Error('offline'));
    else mockLoadRecentViews.mockResolvedValueOnce(undefined);
    mockLoadRecentViews.mockResolvedValueOnce([{ view_id: 'recent', name: 'Recovered recent' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('search.recentPagesFailed')).toBeTruthy();
    expect(screen.queryByText('noSearchResults')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    expect(await screen.findByText('Recovered recent')).toBeTruthy();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(2);
  });

  it('says there are no recent pages instead of no search results', async () => {
    mockLoadRecentViews.mockResolvedValueOnce([]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('search.noRecentPages')).toBeTruthy();
  });

  it('explains that recent pages need a connection and loads them after reconnecting', async () => {
    setOnline(false);
    mockLoadRecentViews.mockResolvedValue([{ view_id: 'recent', name: 'Online recent' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('search.offlineRecentPages')).toBeTruthy();
    expect(mockLoadRecentViews).not.toHaveBeenCalled();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Online recent')).toBeTruthy();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
  });

  it('loads recent pages after reconnecting when the connection dropped during the read', async () => {
    let fail!: (error: unknown) => void;

    mockLoadRecentViews
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValueOnce([{ view_id: 'recent', name: 'Recent after reconnect' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(1));
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await act(async () => {
      fail({ code: -1, message: 'Network Error' });
    });
    expect(screen.getByText('search.offlineRecentPages')).toBeTruthy();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Recent after reconnect')).toBeTruthy();
    expect(screen.queryByText('search.recentPagesFailed')).toBeNull();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(2);
  });

  it('retries recent pages that failed just before the browser reported going offline', async () => {
    mockLoadRecentViews
      .mockRejectedValueOnce({ code: -1, message: 'Network Error' })
      .mockResolvedValueOnce([{ view_id: 'recent', name: 'Recent after reconnect' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('search.recentPagesFailed')).toBeTruthy();
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('search.offlineRecentPages')).toBeTruthy();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Recent after reconnect')).toBeTruthy();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(2);
  });

  it('keeps recent pages visible on focus and tab visibility changes', async () => {
    mockLoadRecentViews.mockResolvedValue([{ view_id: 'recent', name: 'Stable recent' }]);
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Stable recent');
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('Stable recent')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP 403', { httpStatus: 403 }],
    ['permission error code', { code: ERROR_CODE.NOT_HAS_PERMISSION }],
    ['expired session', { httpStatus: 401 }],
  ])('clears protected recent pages when a reconnect refresh returns %s', async (_reason, error) => {
    const emitter = Object.assign(new EventEmitter(), { webSocketReadyState: WebSocket.OPEN });

    mockLoadRecentViews
      .mockResolvedValueOnce([{ view_id: 'secret', name: 'Protected recent' }])
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([{ view_id: 'allowed', name: 'Allowed recent' }]);
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Protected recent');
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    await screen.findByText('search.recentPagesFailed');
    expect(screen.queryByText('Protected recent')).toBeNull();
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: '' } });
    expect(screen.queryByText('Protected recent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    expect(await screen.findByText('Allowed recent')).toBeTruthy();
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['network failure', { code: -1 }],
    ['server failure', { httpStatus: 502 }],
  ])('keeps recent pages when a reconnect refresh has a transient %s', async (_reason, error) => {
    const emitter = Object.assign(new EventEmitter(), { webSocketReadyState: WebSocket.OPEN });

    mockLoadRecentViews
      .mockResolvedValueOnce([{ view_id: 'recent', name: 'Kept recent' }])
      .mockRejectedValueOnce(error);
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Kept recent');
    await act(async () => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    expect(mockLoadRecentViews).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Kept recent')).toBeTruthy();
    expect(screen.queryByText('search.recentPagesFailed')).toBeNull();
  });

  it('revalidates recent pages in the background after the socket reconnects', async () => {
    const emitter = Object.assign(new EventEmitter(), { webSocketReadyState: 1 });
    let resolveRefresh!: (views: unknown) => void;

    mockLoadRecentViews
      .mockResolvedValueOnce([{ view_id: 'recent', name: 'Before reconnect' }])
      .mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    await screen.findByText('Before reconnect');
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await waitFor(() => expect(mockLoadRecentViews).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Before reconnect')).toBeTruthy();
    await act(async () => {
      resolveRefresh([{ view_id: 'recent', name: 'After reconnect' }]);
    });
    expect(screen.getByText('After reconnect')).toBeTruthy();
  });
});
