import EventEmitter from 'events';

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { ViewLayout } from '@/application/types';
import type { View } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import BestMatch from '../BestMatch';

import type { ReactNode } from 'react';

const mockUseAIEnabled = jest.fn();
const mockSearchWorkspaceDocumentPage = jest.fn();
const mockGenerateSearchSummary = jest.fn();
const mockGetView = jest.fn();
const mockGetCachedView = jest.fn();
const mockGetMultipleViews = jest.fn();
const mockNotifyError = jest.fn();
let mockAppOutline: View[] | undefined = [];
let mockWorkspaceId = 'workspace-id';
let mockUserId = 'user-id';
let mockServer = 'https://server-a';
const mockEmitter = new EventEmitter();
let mockOverviewSources: Array<{
  ragId: string;
  ownerViewId?: string;
  ownerDatabaseId?: string;
}> = [];
let mockCanAskFollowUp = false;
let mockAskingAI = false;
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => mockUseAIEnabled(),
  useAppOutline: () => mockAppOutline,
  useCurrentWorkspaceId: () => mockWorkspaceId,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockUserId,
  useIsAuthenticatedOptional: () => true,
}));

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));

jest.mock('@/application/services/domains', () => ({
  SearchService: {
    searchWorkspaceDocumentPage: (...args: unknown[]) => mockSearchWorkspaceDocumentPage(...args),
    generateSearchSummary: (...args: unknown[]) => mockGenerateSearchSummary(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
    getCached: (...args: unknown[]) => mockGetCachedView(...args),
    getMultiple: (...args: unknown[]) => mockGetMultipleViews(...args),
  },
}));

jest.mock('@/components/app/search/SearchAIOverview', () => ({
  SearchAIOverview: ({
    sources,
    canAskFollowUp,
    summary,
    askingAI,
    loading,
  }: {
    sources: typeof mockOverviewSources;
    canAskFollowUp: boolean;
    summary?: { content: string } | null;
    askingAI: boolean;
    loading: boolean;
  }) => {
    mockOverviewSources = sources;
    mockCanAskFollowUp = canAskFollowUp;
    mockAskingAI = askingAI;
    return (
      <div data-testid='ai-overview' data-loading={String(loading)}>
        {summary?.content}
      </div>
    );
  },
}));

jest.mock('@/components/app/search/ViewList', () => ({
  __esModule: true,
  default: ({
    header,
    items,
    hasMore,
    loading,
    loadingMore,
    onLoadMore,
  }: {
    header?: ReactNode;
    items?: Array<{ id: string; view: { name: string } }>;
    hasMore?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    onLoadMore?: () => void;
  }) => (
    <div data-testid='view-list' data-loading={Boolean(loading)}>
      {header ? <div data-testid='search-header'>{header}</div> : null}
      {items?.map((item) => (
        <div key={item.id}>{item.view.name}</div>
      ))}
      {!loading && items?.length === 0 && <div>noSearchResults</div>}
      {hasMore && (
        <button disabled={loadingMore} onClick={onLoadMore}>
          Load more
        </button>
      )}
    </div>
  ),
}));

function createView(overrides: Partial<View> = {}): View {
  return {
    view_id: 'view-id',
    name: 'Page',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function base64Url(value: object) {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sessionToken(sessionId: string, rotation = 0) {
  return JSON.stringify({
    access_token: `${base64Url({ alg: 'HS256' })}.${base64Url({ sub: 'user-id', session_id: sessionId, n: rotation })}.sig`,
    refresh_token: `refresh-${sessionId}-${rotation}`,
    expires_at: 4102444800,
    user: { id: 'user-id' },
  });
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
}

function renderBestMatch(searchValue = '') {
  return render(<BestMatch askingAI={false} searchValue={searchValue} onAskAI={jest.fn()} onClose={jest.fn()} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppEventEmitterContext.Provider value={mockEmitter}>{children}</AppEventEmitterContext.Provider>
    ),
  });
}

describe('BestMatch', () => {
  afterAll(() => {
    setOnline(true);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Unconsumed one-off responses must not leak into the next case.
    [
      mockSearchWorkspaceDocumentPage,
      mockGenerateSearchSummary,
      mockGetView,
      mockGetCachedView,
      mockGetMultipleViews,
    ].forEach((mock) => mock.mockReset());
    mockAppOutline = [];
    mockWorkspaceId = 'workspace-id';
    mockUserId = 'user-id';
    mockServer = 'https://server-a';
    mockOverviewSources = [];
    mockCanAskFollowUp = false;
    mockAskingAI = false;
    setOnline(true);
    localStorage.clear();
    mockUseAIEnabled.mockReturnValue(true);
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [],
      next_offset: null,
    });
    mockGenerateSearchSummary.mockResolvedValue({ summaries: [] });
    mockGetView.mockRejectedValue(new Error('not found'));
    mockGetMultipleViews.mockResolvedValue([]);
  });

  it('hides revoked results and AI text immediately, then restores the same query after regrant', async () => {
    mockAppOutline = [createView({ view_id: 'secret', name: 'Protected page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'secret' }], has_more: false });
    mockGenerateSearchSummary.mockResolvedValueOnce({ summaries: [{ content: 'Protected summary', sources: ['secret'] }] });
    const { unmount } = renderBestMatch('unchanged query');

    await screen.findByText('Protected summary');
    expect(screen.getByText('Protected page')).toBeTruthy();
    act(() => { mockEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(screen.queryByText('Protected page')).toBeNull();
    expect(screen.queryByText('Protected summary')).toBeNull();
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2));
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'secret' }], has_more: false });
    act(() => { mockEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    await screen.findByText('Protected page');
    expect(mockSearchWorkspaceDocumentPage.mock.calls.every((call) => call[1] === 'unchanged query')).toBe(true);
    unmount();
    expect(mockEmitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(0);
  });

  it('rejects a pre-revocation response that arrives during the refresh debounce', async () => {
    let resolveOld!: (value: unknown) => void;

    mockAppOutline = [createView({ view_id: 'secret', name: 'Late protected page' })];
    mockSearchWorkspaceDocumentPage.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    renderBestMatch('query');
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      resolveOld({ items: [{ object_id: 'secret' }], has_more: false });
    });
    expect(screen.queryByText('Late protected page')).toBeNull();
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Late protected page')).toBeNull();
  });

  it('revalidates every loaded page in the background after the socket reconnects', async () => {
    let resolveFirstPage!: (value: unknown) => void;

    mockAppOutline = [
      createView({ view_id: 'first', name: 'First page' }),
      createView({ view_id: 'second', name: 'Revoked second page' }),
    ];
    mockSearchWorkspaceDocumentPage
      .mockResolvedValueOnce({ items: [{ object_id: 'first' }], has_more: true, next_offset: 10 })
      .mockResolvedValueOnce({ items: [{ object_id: 'second' }], has_more: false, next_offset: null });
    mockGenerateSearchSummary.mockResolvedValueOnce({ summaries: [{ content: 'Old summary', sources: ['first'] }] });
    renderBestMatch('page');
    await screen.findByText('Old summary');
    fireEvent.click(await screen.findByText('Load more'));
    await screen.findByText('Revoked second page');
    mockSearchWorkspaceDocumentPage
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstPage = resolve; }))
      .mockResolvedValueOnce({ items: [], has_more: false, next_offset: null });
    mockGenerateSearchSummary.mockResolvedValueOnce({ summaries: [{ content: 'Fresh summary', sources: ['first'] }] });
    act(() => {
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 0);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(3));
    // The current response stays on screen while its replacement loads.
    expect(screen.getByText('First page')).toBeTruthy();
    expect(screen.getByText('Revoked second page')).toBeTruthy();
    expect(screen.getByText('Old summary')).toBeTruthy();
    expect(screen.getByTestId('view-list').getAttribute('data-loading')).toBe('false');
    await act(async () => {
      resolveFirstPage({ items: [{ object_id: 'first' }], has_more: true, next_offset: 10 });
    });
    await screen.findByText('Fresh summary');
    expect(screen.queryByText('Revoked second page')).toBeNull();
    expect(screen.getByText('First page')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage.mock.calls.slice(2).map((call) => call[2])).toEqual([0, 10]);
  });

  it.each([
    ['HTTP 403', { httpStatus: 403 }],
    ['permission error code', { code: ERROR_CODE.NOT_HAS_PERMISSION }],
    ['expired session', { httpStatus: 401 }],
  ])('clears protected results and summaries when a reconnect refresh returns %s', async (_reason, error) => {
    let resolveSummary!: (value: unknown) => void;

    mockAppOutline = [createView({ view_id: 'secret', name: 'Protected page' })];
    mockSearchWorkspaceDocumentPage
      .mockResolvedValueOnce({ items: [{ object_id: 'secret' }], has_more: true, next_offset: 10 })
      .mockRejectedValueOnce({ ...error, message: 'Access denied' });
    mockGenerateSearchSummary
      .mockResolvedValueOnce({ summaries: [{ content: 'Protected summary', sources: ['secret'] }] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    renderBestMatch('secret');
    await screen.findByText('Protected summary');
    act(() => {
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    await waitFor(() => expect(screen.queryByText('Protected page')).toBeNull());
    expect(screen.queryByText('Protected summary')).toBeNull();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(mockOverviewSources).toEqual([]);
    expect(screen.getByTestId('ai-overview').getAttribute('data-loading')).toBe('false');
    await act(async () => {
      resolveSummary({ summaries: [{ content: 'Late protected summary', sources: ['secret'] }] });
    });
    expect(screen.queryByText('Late protected summary')).toBeNull();
  });

  it('publishes refreshed keywords and permits pagination while the AI summary is pending', async () => {
    let resolveSummary!: (value: unknown) => void;
    let resolveNextPage!: (value: unknown) => void;

    mockAppOutline = [
      createView({ view_id: 'old', name: 'Old page' }),
      createView({ view_id: 'fresh', name: 'Fresh page' }),
      createView({ view_id: 'next', name: 'Next page' }),
    ];
    mockSearchWorkspaceDocumentPage
      .mockResolvedValueOnce({ items: [{ object_id: 'old' }], has_more: false })
      .mockResolvedValueOnce({ items: [{ object_id: 'fresh' }], has_more: true, next_offset: 10 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNextPage = resolve; }));
    mockGenerateSearchSummary
      .mockResolvedValueOnce({ summaries: [{ content: 'Old summary', sources: ['old'] }] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    renderBestMatch('page');
    await screen.findByText('Old summary');
    act(() => {
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    await screen.findByText('Fresh page');
    expect(screen.queryByText('Old page')).toBeNull();
    expect(screen.queryByText('Old summary')).toBeNull();
    expect(mockOverviewSources).toEqual([]);
    expect(screen.getByTestId('ai-overview').getAttribute('data-loading')).toBe('true');
    const loadMore = screen.getByRole('button', { name: 'Load more' });

    expect(loadMore.disabled).toBe(false);
    fireEvent.click(loadMore);
    expect(loadMore.disabled).toBe(true);
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(3);
    await act(async () => {
      resolveSummary({ summaries: [{ content: 'Fresh summary', sources: ['fresh'] }] });
    });
    expect(screen.getByText('Fresh summary')).toBeTruthy();
    // Finishing the summary must not unlock pagination while its request is still pending.
    expect(loadMore.disabled).toBe(true);
    fireEvent.click(loadMore);
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(3);
    await act(async () => {
      resolveNextPage({ items: [{ object_id: 'next' }], has_more: false, next_offset: null });
    });
    expect(screen.getByText('Fresh page')).toBeTruthy();
    expect(screen.getByText('Next page')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('stops waiting for the AI summary when a reconnect revalidation fails', async () => {
    mockAppOutline = [createView({ view_id: 'kept', name: 'Kept page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'kept' }], has_more: false });
    // The first summary is still being generated; aborting it rejects like a real request.
    mockGenerateSearchSummary.mockImplementationOnce(
      (_workspaceId: unknown, _query: unknown, signal: unknown) =>
        new Promise((_resolve, reject) => {
          (signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    renderBestMatch('budget');
    await screen.findByText('Kept page');
    expect(screen.getByTestId('ai-overview').getAttribute('data-loading')).toBe('true');
    // The socket reopens and the background reload fails, e.g. while the server restarts.
    mockSearchWorkspaceDocumentPage.mockRejectedValueOnce({ code: 502, httpStatus: 502, message: 'Bad Gateway' });
    act(() => {
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('ai-overview').getAttribute('data-loading')).toBe('false'));
    expect(screen.getByText('Kept page')).toBeTruthy();
  });

  it('keeps waiting for the AI summary when a reconnect revalidation cannot run offline', async () => {
    let resolveSummary!: (value: unknown) => void;

    mockAppOutline = [createView({ view_id: 'kept', name: 'Kept page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'kept' }], has_more: false });
    mockGenerateSearchSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    renderBestMatch('budget');
    await screen.findByText('Kept page');
    setOnline(false);
    act(() => {
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await act(async () => {
      resolveSummary({ summaries: [{ content: 'Summary still arrives', sources: ['kept'] }] });
    });
    expect(await screen.findByText('Summary still arrives')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
  });

  it.each(['focus', 'visible', 'online', 'offline', 'socket'])('keeps results and the AI summary on %s', async (event) => {
    mockAppOutline = [createView({ view_id: 'kept', name: 'Kept page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'kept' }], has_more: false });
    mockGenerateSearchSummary.mockResolvedValueOnce({ summaries: [{ content: 'Kept summary', sources: ['kept'] }] });
    renderBestMatch('budget');
    await screen.findByText('Kept summary');
    act(() => {
      if (event === 'visible') document.dispatchEvent(new Event('visibilitychange'));
      else if (event === 'socket') mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 0);
      else window.dispatchEvent(new Event(event));
    });
    expect(screen.getByText('Kept page')).toBeTruthy();
    expect(screen.getByText('Kept summary')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
    expect(mockGenerateSearchSummary).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the search after a routine token refresh', async () => {
    localStorage.setItem('token', sessionToken('session-a'));
    mockAppOutline = [createView({ view_id: 'kept', name: 'Kept page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'kept' }], has_more: false });
    renderBestMatch('budget');
    await screen.findByText('Kept page');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: sessionToken('session-a', 1) }));
    });
    expect(screen.getByText('Kept page')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
  });

  it('says it is offline instead of showing no results, and does not offer Ask AI', async () => {
    setOnline(false);
    renderBestMatch('budget');
    expect(await screen.findByText('search.offlineResults')).toBeTruthy();
    expect(screen.queryByText('noSearchResults')).toBeNull();
    expect(screen.queryByTestId('ai-overview')).toBeNull();
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
    expect(mockGenerateSearchSummary).not.toHaveBeenCalled();
  });

  it('runs a query typed while offline once the browser reconnects', async () => {
    setOnline(false);
    mockAppOutline = [createView({ view_id: 'found', name: 'Found after reconnect' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'found' }], has_more: false });
    renderBestMatch('budget');
    await screen.findByText('search.offlineResults');
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('noSearchResults')).toBeNull();
    expect(await screen.findByText('Found after reconnect')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
  });

  it('runs a query again after reconnecting when the connection dropped while it was loading', async () => {
    let fail!: (error: unknown) => void;

    mockAppOutline = [createView({ view_id: 'found', name: 'Found page' })];
    mockSearchWorkspaceDocumentPage.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { fail = reject; })
    );
    renderBestMatch('budget');
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1));
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await act(async () => {
      fail({ code: -1, message: 'Network Error' });
    });
    expect(screen.getByText('search.offlineResults')).toBeTruthy();
    expect(mockNotifyError).not.toHaveBeenCalled();
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'found' }], has_more: false });
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('noSearchResults')).toBeNull();
    expect(await screen.findByText('Found page')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2);
  });

  it('retries a query that failed just before the browser reported going offline', async () => {
    mockAppOutline = [createView({ view_id: 'found', name: 'Found page' })];
    mockSearchWorkspaceDocumentPage.mockRejectedValueOnce({ code: -1, message: 'Network Error' });
    renderBestMatch('budget');
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Network Error'));
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('search.offlineResults')).toBeTruthy();
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'found' }], has_more: false });
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Found page')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2);
  });

  it('does not retry a network failure on its own while the browser stays online', async () => {
    mockSearchWorkspaceDocumentPage.mockRejectedValue({ code: -1, message: 'Network Error' });
    renderBestMatch('budget');
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded results offline and explains why Ask AI is unavailable', async () => {
    mockAppOutline = [createView({ view_id: 'kept', name: 'Kept page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'kept' }], has_more: false });
    renderBestMatch('budget');
    await screen.findByText('Kept page');
    expect(mockAskingAI).toBe(false);
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Kept page')).toBeTruthy();
    expect(screen.getByText('search.offlineAskAI')).toBeTruthy();
    expect(mockAskingAI).toBe(true);
  });

  it('fences the same workspace when the account changes', async () => {
    mockAppOutline = [createView({ view_id: 'secret', name: 'Previous account page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'secret' }], has_more: false });
    const { rerender } = renderBestMatch('query');

    await screen.findByText('Previous account page');
    mockUserId = 'replacement-account';
    rerender(<BestMatch askingAI={false} searchValue='query' onAskAI={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText('Previous account page')).toBeNull();
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2));
  });

  it('aborts old summary work and rejects its response after same-user cross-tab session replacement', async () => {
    let resolveSummary!: (value: unknown) => void;

    localStorage.setItem('token', sessionToken('original-session'));

    mockGenerateSearchSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    const { unmount } = renderBestMatch('query');

    await waitFor(() => expect(mockGenerateSearchSummary).toHaveBeenCalledTimes(1));
    const oldSignal = mockGenerateSearchSummary.mock.calls[0][2] as AbortSignal;

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: sessionToken('replacement-session') }));
      resolveSummary({ summaries: [{ content: 'Old private summary', sources: [] }] });
    });
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByText('Old private summary')).toBeNull();
    await waitFor(() => expect(mockGenerateSearchSummary).toHaveBeenCalledTimes(2));
    const currentSignal = mockGenerateSearchSummary.mock.calls[1][2] as AbortSignal;

    expect(currentSignal.aborted).toBe(false);
    unmount();
    expect(currentSignal.aborted).toBe(true);
  });

  it('cancels stalled metadata and never routes it through the replacement server', async () => {
    let resolveMetadata!: (value: unknown) => void;

    mockSearchWorkspaceDocumentPage.mockResolvedValueOnce({ items: [{ object_id: 'secret' }], has_more: false });
    mockGetView.mockImplementationOnce(() => new Promise((resolve) => { resolveMetadata = resolve; }));
    const { rerender } = renderBestMatch('query');

    await waitFor(() => expect(mockGetView).toHaveBeenCalledTimes(1));
    const signal = mockGetView.mock.calls[0][2] as AbortSignal;

    mockServer = 'https://server-b';
    rerender(<BestMatch askingAI={false} searchValue='query' onAskAI={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { resolveMetadata(createView({ view_id: 'secret', name: 'Old server metadata' })); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Old server metadata')).toBeNull();
    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2));
    expect(mockGetView).toHaveBeenCalledTimes(1);
  });

  it('does not mount the AI overview header when server info disables AI', () => {
    mockUseAIEnabled.mockReturnValue(false);

    renderBestMatch();

    expect(screen.queryByTestId('search-header')).toBeNull();
    expect(screen.queryByTestId('ai-overview')).toBeNull();
  });

  it('mounts the AI overview header when AI is enabled', async () => {
    renderBestMatch();

    expect(screen.getByTestId('search-header')).toBeTruthy();
    expect(await screen.findByTestId('ai-overview')).toBeTruthy();
  });

  it('updates renamed results without repeating the query or losing loaded pages', async () => {
    mockAppOutline = [
      createView({ view_id: 'first', name: 'First page' }),
      createView({ view_id: 'second', name: 'Second page' }),
    ];
    mockSearchWorkspaceDocumentPage
      .mockResolvedValueOnce({ has_more: true, items: [{ object_id: 'first' }], next_offset: 10 })
      .mockResolvedValueOnce({ has_more: false, items: [{ object_id: 'second' }], next_offset: null });
    const { rerender } = renderBestMatch('page');

    await screen.findByText('First page');
    fireEvent.click(screen.getByText('Load more'));
    await screen.findByText('Second page');
    mockAppOutline = [createView({ view_id: 'first', name: 'Renamed page' }), mockAppOutline[1]];
    rerender(<BestMatch askingAI={false} searchValue='page' onAskAI={jest.fn()} onClose={jest.fn()} />);
    await screen.findByText('Renamed page');
    expect(screen.getByText('Second page')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(2);
    expect(mockGenerateSearchSummary).toHaveBeenCalledTimes(1);
  });

  it('ignores an old workspace response after switching workspaces with the same query', async () => {
    let resolveOld!: (value: unknown) => void;

    mockSearchWorkspaceDocumentPage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    mockAppOutline = [createView({ view_id: 'old', name: 'Old workspace page' })];
    const { rerender } = renderBestMatch('page');

    await waitFor(() => expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1));
    mockWorkspaceId = 'next-workspace';
    mockAppOutline = [createView({ view_id: 'new', name: 'New workspace page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [{ object_id: 'new' }],
      next_offset: null,
    });
    rerender(<BestMatch askingAI={false} searchValue='page' onAskAI={jest.fn()} onClose={jest.fn()} />);
    await screen.findByText('New workspace page');
    await act(async () => {
      resolveOld({ has_more: false, items: [{ object_id: 'old' }], next_offset: null });
    });
    expect(screen.queryByText('Old workspace page')).toBeNull();
    expect(screen.getByText('New workspace page')).toBeTruthy();
    expect(mockGenerateSearchSummary).toHaveBeenLastCalledWith('next-workspace', 'page', expect.any(AbortSignal));
  });

  it('searches before the outline loads and uses the outline when it arrives', async () => {
    mockAppOutline = undefined;
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [{ object_id: 'view-id' }],
      next_offset: null,
    });
    mockGetView.mockResolvedValue(createView({ name: 'Fetched page' }));
    const { rerender } = renderBestMatch('page');

    await screen.findByText('Fetched page');
    mockAppOutline = [createView({ name: 'Updated page' })];
    rerender(<BestMatch askingAI={false} searchValue='page' onAskAI={jest.fn()} onClose={jest.fn()} />);
    await screen.findByText('Updated page');
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
    expect(mockGenerateSearchSummary).toHaveBeenCalledTimes(1);
  });

  it('loads view metadata for search results missing from the current outline', async () => {
    mockUseAIEnabled.mockReturnValue(false);
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [
        {
          object_id: 'deep-view-id',
          workspace_id: 'workspace-id',
          score: 1,
          content: 'Annie OKRs',
        },
      ],
      next_offset: null,
    });
    mockGetView.mockResolvedValue(createView({ view_id: 'deep-view-id', name: 'Annie OKRs' }));

    renderBestMatch('annie');

    expect(await screen.findByText('Annie OKRs')).toBeTruthy();
    expect(mockGetView).toHaveBeenCalledWith('workspace-id', 'deep-view-id', expect.any(AbortSignal));
  });

  it('requests server-retrieved AI context when keyword search returns no results', async () => {
    mockGenerateSearchSummary.mockResolvedValue({
      summaries: [{ content: 'One open task', sources: ['row-id'] }],
    });

    renderBestMatch('show my tasks');

    await waitFor(() => expect(mockGenerateSearchSummary).toHaveBeenCalledWith('workspace-id', 'show my tasks', expect.any(AbortSignal)));
    await waitFor(() =>
      expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledWith(
        'workspace-id',
        'show my tasks',
        0,
        expect.stringMatching(/^best-match-keyword:/),
        expect.any(AbortSignal)
      )
    );
    await waitFor(() => expect(mockGetMultipleViews).toHaveBeenCalledWith('workspace-id', ['row-id'], 0, expect.any(AbortSignal)));

    expect(mockOverviewSources).toEqual([]);
    expect(mockCanAskFollowUp).toBe(false);
  });

  it('hydrates server-retrieved page sources before exposing follow-up actions', async () => {
    const sourceView = createView({ view_id: 'deep-view-id', name: 'Deep page' });

    mockGenerateSearchSummary.mockResolvedValue({
      summaries: [{ content: 'Deep answer', sources: ['deep-view-id'] }],
    });
    mockGetMultipleViews.mockResolvedValue([sourceView]);

    renderBestMatch('deep answer');

    await waitFor(() =>
      expect(mockOverviewSources).toEqual([
        expect.objectContaining({
          ragId: 'deep-view-id',
          targetViewId: 'deep-view-id',
          ownerViewId: 'deep-view-id',
          view: sourceView,
        }),
      ])
    );

    expect(mockCanAskFollowUp).toBe(true);
  });

  it('derives database row ownership for the AI follow-up source', async () => {
    const databaseView = createView({
      view_id: 'database-view-id',
      name: 'Projects',
      layout: ViewLayout.Grid,
      extra: { database_id: 'database-id' },
    });

    mockAppOutline = [databaseView];
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [
        {
          object_id: 'row-id',
          workspace_id: 'workspace-id',
          score: 1,
          content: 'Launch project',
          database_row_id: 'row-id',
          database_view_id: 'database-view-id',
          database_id: 'database-id',
        },
      ],
      next_offset: null,
    });
    mockGenerateSearchSummary.mockResolvedValue({
      summaries: [{ content: 'Launch summary', sources: ['row-id'] }],
    });

    renderBestMatch('launch');

    await waitFor(() =>
      expect(mockOverviewSources).toEqual([
        expect.objectContaining({
          ragId: 'row-id',
          ownerViewId: 'database-view-id',
          ownerDatabaseId: 'database-id',
        }),
      ])
    );
    expect(mockCanAskFollowUp).toBe(true);
  });

  describe('views of results missing from the outline', () => {
    // What the server answers for a row or database id: it is not a folder view.
    const notAView = {
      code: ERROR_CODE.RECORD_NOT_FOUND,
      httpStatus: 404,
      sourceDomain: 'appflowy.server',
      message: 'There is no accessible folder view',
    };
    const projects = createView({ view_id: 'database-view-id', name: 'Projects', layout: ViewLayout.Grid });
    const deepResult = { object_id: 'deep-view-id', workspace_id: 'workspace-id' };

    function rowResult(rowId: string) {
      return {
        object_id: rowId,
        workspace_id: 'workspace-id',
        database_row_id: rowId,
        database_view_id: 'database-view-id',
        database_id: 'database-id',
      };
    }

    function rerenderWith(rerender: ReturnType<typeof renderBestMatch>['rerender'], searchValue: string) {
      rerender(<BestMatch askingAI={false} searchValue={searchValue} onAskAI={jest.fn()} onClose={jest.fn()} />);
    }

    beforeEach(() => {
      mockUseAIEnabled.mockReturnValue(false);
      mockGetView.mockImplementation((_workspaceId, viewId) =>
        viewId === 'database-view-id' ? Promise.resolve(projects) : Promise.reject(notAView)
      );
    });

    it('reads the database view of several row results once', async () => {
      mockSearchWorkspaceDocumentPage.mockResolvedValue({
        has_more: false,
        items: [rowResult('row-1'), rowResult('row-2'), rowResult('row-3')],
        next_offset: null,
      });
      renderBestMatch('launch');

      expect(await screen.findAllByText('Projects')).toHaveLength(3);
      expect(mockGetView.mock.calls.filter((call) => call[1] === 'database-view-id')).toHaveLength(1);
    });

    it('does not read views or row ids again for a refined query', async () => {
      mockSearchWorkspaceDocumentPage
        .mockResolvedValueOnce({ has_more: false, items: [rowResult('row-1'), rowResult('row-2')], next_offset: null })
        .mockResolvedValueOnce({
          has_more: false,
          items: [rowResult('row-1'), rowResult('row-2'), rowResult('row-3')],
          next_offset: null,
        });
      const { rerender } = renderBestMatch('lau');

      expect(await screen.findAllByText('Projects')).toHaveLength(2);
      expect(mockGetView).toHaveBeenCalledTimes(3);
      rerenderWith(rerender, 'launch');

      await waitFor(() => expect(screen.getAllByText('Projects')).toHaveLength(3));
      // Only the new row id is asked about.
      expect(mockGetView).toHaveBeenCalledTimes(4);
      expect(mockGetView).toHaveBeenLastCalledWith('workspace-id', 'row-3', expect.any(AbortSignal));
    });

    it('asks again for a view whose read was cancelled or failed', async () => {
      mockSearchWorkspaceDocumentPage.mockResolvedValue({ has_more: false, items: [deepResult], next_offset: null });
      mockGetView
        // The next keystroke cancels this read, which then rejects like a real request.
        .mockImplementationOnce(
          (_workspaceId, _viewId, signal) =>
            new Promise((_resolve, reject) => {
              (signal as AbortSignal).addEventListener('abort', () =>
                reject({ code: -1, sourceDomain: 'transport', transportFailure: 'cancelled', message: 'canceled' })
              );
            })
        )
        .mockRejectedValueOnce({ code: 500, httpStatus: 500, sourceDomain: 'http', message: 'Internal Server Error' })
        .mockResolvedValueOnce(createView({ view_id: 'deep-view-id', name: 'Deep page' }));
      const { rerender } = renderBestMatch('dee');

      await waitFor(() => expect(mockGetView).toHaveBeenCalledTimes(1));
      rerenderWith(rerender, 'deep');
      expect(await screen.findByText('noSearchResults')).toBeTruthy();
      expect(mockGetView).toHaveBeenCalledTimes(2);
      rerenderWith(rerender, 'deep page');

      expect(await screen.findByText('Deep page')).toBeTruthy();
      expect(mockGetView).toHaveBeenCalledTimes(3);
    });

    it.each([
      [
        'the socket reconnects',
        () => {
          mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
          mockEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
        },
      ],
      ['a permission changes', () => mockEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {})],
    ])('reads them again after %s', async (_event, emit) => {
      mockSearchWorkspaceDocumentPage.mockResolvedValue({ has_more: false, items: [deepResult], next_offset: null });
      mockGetView.mockResolvedValueOnce(createView({ view_id: 'deep-view-id', name: 'Deep page' }));
      renderBestMatch('deep');
      await screen.findByText('Deep page');
      mockGetView.mockResolvedValueOnce(createView({ view_id: 'deep-view-id', name: 'Renamed deep page' }));

      act(() => {
        emit();
      });

      expect(await screen.findByText('Renamed deep page')).toBeTruthy();
      expect(mockGetView).toHaveBeenCalledTimes(2);
    });

    it('uses a view the app read moments ago instead of reading it again', async () => {
      mockSearchWorkspaceDocumentPage.mockResolvedValue({ has_more: false, items: [deepResult], next_offset: null });
      mockGetCachedView.mockImplementation((_workspaceId, viewId) =>
        viewId === 'deep-view-id' ? createView({ view_id: 'deep-view-id', name: 'Deep page' }) : undefined
      );
      renderBestMatch('deep');

      expect(await screen.findByText('Deep page')).toBeTruthy();
      expect(mockGetCachedView).toHaveBeenCalledWith('workspace-id', 'deep-view-id');
      expect(mockGetView).not.toHaveBeenCalled();
    });
  });
});
