import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
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
const mockLoadRecentViews = jest.fn();

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
  useAppRecent: () => ({ recentViews: [], loadRecentViews: mockLoadRecentViews }),
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
  default: ({ recentViews }: { recentViews: Array<{ name: string }> }) => <div>{recentViews.map((view) => view.name).join(',')}</div>,
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
  notify: { error: jest.fn() },
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
    mockLoadRecentViews.mockResolvedValueOnce([{ view_id: 'secret', name: 'Protected recent page' }]);
    act(() => { window.dispatchEvent(new Event('focus')); });
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
  });

  it('does not attach old sources or navigate after a delayed create acknowledgement', async () => {
    let resolveCreate!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockAddPage.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText('Ask AI'));
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledTimes(1));
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      resolveCreate({ view_id: 'chat-id' });
    });
    expect(mockUpdateChatSettings).not.toHaveBeenCalled();
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

  it('keeps a replacement AI attempt busy when the old attempt finally settles', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const emitter = new EventEmitter();

    mockFetchCompleteView
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<AppEventEmitterContext.Provider value={emitter}><Search /></AppEventEmitterContext.Provider>);
    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'query' } });
    const button = await screen.findByText('Ask AI');

    fireEvent.click(button);
    await waitFor(() => expect(mockFetchCompleteView).toHaveBeenCalledTimes(1));
    expect(button.disabled).toBe(true);
    act(() => { emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mockFetchCompleteView).toHaveBeenCalledTimes(2));
    await act(async () => { resolveFirst({ view_id: 'space-id', children: [] }); });
    expect(button.disabled).toBe(true);
    expect(mockAddPage).not.toHaveBeenCalled();
    await act(async () => { resolveSecond({ view_id: 'space-id', children: [] }); });
    expect(mockAddPage).toHaveBeenCalledTimes(1);
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
