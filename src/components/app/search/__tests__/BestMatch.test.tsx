import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { debounce } from 'lodash-es';

import { SearchStreamUnsupportedError } from '@/application/services/domains/search';
import type { SearchDocumentResponseItem, SearchStreamSnapshot } from '@/application/services/domains/search';
import { ViewLayout } from '@/application/types';
import type { View } from '@/application/types';

import BestMatch from '../BestMatch';

import type { ReactNode } from 'react';

const mockUseAIEnabled = jest.fn();
const mockSearchWorkspaceDocumentPage = jest.fn();
const mockSearchStream = jest.fn();
const mockGenerateProvidedSummary = jest.fn();
const mockReportPresentation = jest.fn();
let mockFrames = new Map<number, FrameRequestCallback>();
let mockFrameId = 0;
const mockNotifyError = jest.fn();
const mockGenerateSearchSummary = jest.fn();
const mockGetView = jest.fn();
const mockGetMultipleViews = jest.fn();
let mockAppOutline: View[] | undefined = [];
let mockWorkspaceId = 'workspace-id';
let mockOverviewSources: Array<{
  ragId: string;
  ownerViewId?: string;
  ownerDatabaseId?: string;
}> = [];
let mockCanAskFollowUp = false;
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

jest.mock('@/application/services/domains/search', () => ({
  SearchStreamUnsupportedError: class extends Error {},
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));

jest.mock('@/application/services/domains', () => ({
  SearchService: {
    reportSearchPresentationMetrics: (...args: unknown[]) => mockReportPresentation(...args),
    searchWorkspaceDocumentStream: (...args: unknown[]) => mockSearchStream(...args),
    generateSearchSummaryForDocuments: (...args: unknown[]) => mockGenerateProvidedSummary(...args),
    searchWorkspaceDocumentPage: (...args: unknown[]) => mockSearchWorkspaceDocumentPage(...args),
    generateSearchSummary: (...args: unknown[]) => mockGenerateSearchSummary(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
    getMultiple: (...args: unknown[]) => mockGetMultipleViews(...args),
  },
}));

jest.mock('@/components/app/search/SearchAIOverview', () => ({
  SearchAIOverview: ({ sources, canAskFollowUp }: { sources: typeof mockOverviewSources; canAskFollowUp: boolean }) => {
    mockOverviewSources = sources;
    mockCanAskFollowUp = canAskFollowUp;
    return <div data-testid='ai-overview' />;
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
    <div data-testid='view-list' data-loading={loading}>
      {header ? <div data-testid='search-header'>{header}</div> : null}
      {items?.map((item) => (
        <div key={item.id}>{item.view.name}</div>
      ))}
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

function renderBestMatch(searchValue = '', queryStartedAt?: number) {
  return render(
    <BestMatch
      askingAI={false}
      queryStartedAt={queryStartedAt}
      searchValue={searchValue}
      onAskAI={jest.fn()}
      onClose={jest.fn()}
    />
  );
}

type StreamOptions = { signal: AbortSignal; mode: string; onSnapshot: (snapshot: SearchStreamSnapshot) => void };

function result(id: string): SearchDocumentResponseItem {
  return { object_id: id, workspace_id: 'workspace-id', content: `Preview ${id}`, score: 1 };
}

function snapshot(items: SearchDocumentResponseItem[], phase: 'keyword' | 'final' = 'keyword'): SearchStreamSnapshot {
  return { type: 'snapshot', query_id: 'query-id', sequence: phase === 'keyword' ? 0 : 1, phase, items };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

async function streamOptions(index = 0): Promise<StreamOptions> {
  await waitFor(() => expect(mockSearchStream).toHaveBeenCalledTimes(index + 1));
  return mockSearchStream.mock.calls[index][2] as StreamOptions;
}

function paintResults(frames = 2) {
  for (let frame = 0; frame < frames; frame++) {
    act(() => {
      const callbacks = [...mockFrames.values()];

      mockFrames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    });
  }
}

describe('BestMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppOutline = [];
    mockWorkspaceId = 'workspace-id';
    mockOverviewSources = [];
    mockCanAskFollowUp = false;
    mockUseAIEnabled.mockReturnValue(true);
    mockReportPresentation.mockResolvedValue(undefined);
    mockFrames = new Map();
    mockFrameId = 0;
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      mockFrames.set(++mockFrameId, callback);
      return mockFrameId;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      mockFrames.delete(id);
    });
    mockSearchStream.mockRejectedValue(new SearchStreamUnsupportedError());
    mockGenerateProvidedSummary.mockResolvedValue({ summaries: [] });
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [],
      next_offset: null,
    });
    mockGenerateSearchSummary.mockResolvedValue({ summaries: [] });
    mockGetView.mockRejectedValue(new Error('not found'));
    mockGetMultipleViews.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

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
    expect(mockGetView).toHaveBeenCalledWith('workspace-id', 'deep-view-id');
  });

  it('requests server-retrieved AI context when keyword search returns no results', async () => {
    mockGenerateSearchSummary.mockResolvedValue({
      summaries: [{ content: 'One open task', sources: ['row-id'] }],
    });

    renderBestMatch('show my tasks');

    await waitFor(() =>
      expect(mockGenerateSearchSummary).toHaveBeenCalledWith('workspace-id', 'show my tasks', expect.any(AbortSignal))
    );
    await waitFor(() =>
      expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledWith(
        'workspace-id',
        'show my tasks',
        0,
        expect.stringMatching(/^best-match-keyword:/),
        expect.any(AbortSignal)
      )
    );
    await waitFor(() => expect(mockGetMultipleViews).toHaveBeenCalledWith('workspace-id', ['row-id'], 0));

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

  it('shows keyword rows before completion, replaces them with final ranking, then reuses final IDs for context', async () => {
    const completion = deferred<{ outcome: string }>();

    mockSearchStream.mockReturnValue(completion.promise);
    mockAppOutline = [
      createView({ view_id: 'keyword', name: 'Keyword page' }),
      createView({ view_id: 'semantic', name: 'Semantic page' }),
    ];
    renderBestMatch('page');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('keyword')])));
    expect(await screen.findByText('Keyword page')).toBeTruthy();
    expect(screen.getByTestId('view-list').getAttribute('data-loading')).toBe('true');
    expect(mockGenerateProvidedSummary).not.toHaveBeenCalled();
    expect(mockGenerateSearchSummary).not.toHaveBeenCalled();

    act(() => options.onSnapshot(snapshot([result('semantic')], 'final')));
    expect(await screen.findByText('Semantic page')).toBeTruthy();
    expect(screen.queryByText('Keyword page')).toBeNull();
    expect(mockGenerateProvidedSummary).not.toHaveBeenCalled();
    await act(async () => completion.resolve({ outcome: 'complete' }));
    await waitFor(() =>
      expect(mockGenerateProvidedSummary).toHaveBeenCalledWith('workspace-id', 'page', ['semantic'], options.signal)
    );
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
    expect(mockGenerateSearchSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId('view-list').getAttribute('data-loading')).toBe('false');
  });

  it('hydrates preview rows independently and ignores metadata from an obsolete snapshot', async () => {
    const completion = deferred<{ outcome: string }>();
    const slow = deferred<View>();

    mockSearchStream.mockReturnValue(completion.promise);
    mockAppOutline = [
      createView({ view_id: 'ready', name: 'Ready page' }),
      createView({ view_id: 'final', name: 'Final page' }),
    ];
    mockGetView.mockReturnValue(slow.promise);
    renderBestMatch('page');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('slow'), result('ready')])));
    expect(await screen.findByText('Ready page')).toBeTruthy();
    act(() => options.onSnapshot(snapshot([result('final')], 'final')));
    expect(await screen.findByText('Final page')).toBeTruthy();
    await act(async () => slow.resolve(createView({ view_id: 'slow', name: 'Obsolete page' })));
    expect(screen.queryByText('Obsolete page')).toBeNull();
    expect(screen.queryByText('Ready page')).toBeNull();
    await act(async () => completion.resolve({ outcome: 'complete' }));
  });

  it('aborts on a new query before the debounce ends and aborts again on unmount', async () => {
    mockSearchStream.mockReturnValue(new Promise(() => undefined));
    mockAppOutline = [createView({ view_id: 'old', name: 'Old page' })];
    const { rerender, unmount } = renderBestMatch('old');
    const old = await streamOptions();

    act(() => old.onSnapshot(snapshot([result('old')])));
    expect(await screen.findByText('Old page')).toBeTruthy();
    rerender(<BestMatch askingAI={false} searchValue='new' onAskAI={jest.fn()} onClose={jest.fn()} />);
    expect(old.signal.aborted).toBe(true);
    expect(screen.queryByText('Old page')).toBeNull();
    act(() => old.onSnapshot(snapshot([result('old')], 'final')));
    expect(screen.queryByText('Old page')).toBeNull();
    const current = await streamOptions(1);

    unmount();
    expect(current.signal.aborted).toBe(true);
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
  });

  it.each([new Error('interrupted'), { code: 1079, message: 'rate limited' }])(
    'does not replay a failed stream or retain its unverified preview',
    async (error) => {
      const completion = deferred<{ outcome: string }>();

      mockSearchStream.mockReturnValue(completion.promise);
      mockAppOutline = [createView({ view_id: 'preview', name: 'Unverified page' })];
      renderBestMatch('page');
      const options = await streamOptions();

      act(() => options.onSnapshot(snapshot([result('preview')])));
      expect(await screen.findByText('Unverified page')).toBeTruthy();
      await act(async () => completion.reject(error));
      await waitFor(() => expect(mockNotifyError).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Unverified page')).toBeNull();
      expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
      expect(mockGenerateProvidedSummary).not.toHaveBeenCalled();
      expect(mockGenerateSearchSummary).not.toHaveBeenCalled();
    }
  );

  it('discards superseded results without starting a summary or a fallback query', async () => {
    const completion = deferred<{ outcome: string }>();

    mockSearchStream.mockReturnValue(completion.promise);
    mockAppOutline = [createView({ view_id: 'preview', name: 'Superseded page' })];
    renderBestMatch('page');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('preview')])));
    expect(await screen.findByText('Superseded page')).toBeTruthy();
    await act(async () => completion.resolve({ outcome: 'superseded' }));
    expect(screen.queryByText('Superseded page')).toBeNull();
    expect(mockGenerateProvidedSummary).not.toHaveBeenCalled();
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it('continues keyword pagination from zero after keyword streaming, deduplicating rows and following the real cursor', async () => {
    mockUseAIEnabled.mockReturnValue(false);
    const completion = deferred<{ outcome: string }>();

    mockSearchStream.mockReturnValue(completion.promise);
    const initial = Array.from({ length: 10 }, (_, index) => result(`initial-${index}`));

    mockAppOutline = [
      ...initial.map((item) => createView({ view_id: item.object_id, name: item.object_id })),
      createView({ view_id: 'extra', name: 'Extra page' }),
      createView({ view_id: 'last', name: 'Last page' }),
    ];
    mockSearchWorkspaceDocumentPage
      .mockResolvedValueOnce({ items: [initial[0], result('extra')], has_more: true, next_offset: 10 })
      .mockResolvedValueOnce({ items: [result('last')], has_more: false, next_offset: null });
    renderBestMatch('page');
    const options = await streamOptions();

    expect(options.mode).toBe('keyword');
    act(() => options.onSnapshot(snapshot(initial, 'final')));
    expect(await screen.findByText('initial-0')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
    await act(async () => completion.resolve({ outcome: 'complete' }));
    fireEvent.click(await screen.findByText('Load more'));
    expect(await screen.findByText('Extra page')).toBeTruthy();
    expect(screen.getAllByText('initial-0')).toHaveLength(1);
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenNthCalledWith(
      1,
      'workspace-id',
      'page',
      0,
      expect.any(String),
      options.signal
    );
    fireEvent.click(screen.getByText('Load more'));
    expect(await screen.findByText('Last page')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenNthCalledWith(
      2,
      'workspace-id',
      'page',
      10,
      expect.any(String),
      options.signal
    );
    expect(screen.queryByText('Load more')).toBeNull();
    expect(mockGenerateProvidedSummary).not.toHaveBeenCalled();
  });

  it('offers lazy keyword continuation when a full hybrid preview becomes a shorter final ranking', async () => {
    const completion = deferred<{ outcome: string }>();
    const preview = Array.from({ length: 10 }, (_, index) => result(`keyword-${index}`));

    mockSearchStream.mockReturnValue(completion.promise);
    mockAppOutline = [
      ...preview.map((item) => createView({ view_id: item.object_id, name: item.object_id })),
      createView({ view_id: 'semantic', name: 'Semantic result' }),
    ];
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      items: [preview[0], preview[1]],
      has_more: false,
      next_offset: null,
    });
    renderBestMatch('page');
    const options = await streamOptions();

    expect(options.mode).toBe('hybrid');
    act(() => options.onSnapshot(snapshot(preview)));
    expect(await screen.findByText('keyword-0')).toBeTruthy();
    act(() => options.onSnapshot(snapshot([result('semantic'), preview[0]], 'final')));
    expect(await screen.findByText('Semantic result')).toBeTruthy();
    expect(screen.queryByText('keyword-1')).toBeNull();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
    await act(async () => completion.resolve({ outcome: 'complete' }));
    expect(await screen.findByText('Load more')).toBeTruthy();
    expect(mockSearchWorkspaceDocumentPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Load more'));
    expect(await screen.findByText('keyword-1')).toBeTruthy();
    expect(screen.getByText('Semantic result')).toBeTruthy();
    expect(screen.getAllByText('keyword-0')).toHaveLength(1);
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledWith(
      'workspace-id',
      'page',
      0,
      expect.any(String),
      options.signal
    );
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('keeps pagination pending when an independent summary finishes first', async () => {
    const completion = deferred<{ outcome: string }>();
    const summary = deferred<{ summaries: [] }>();
    const page = deferred<{ items: SearchDocumentResponseItem[]; has_more: boolean; next_offset: null }>();
    const preview = Array.from({ length: 10 }, (_, index) => result(`keyword-${index}`));

    mockSearchStream.mockReturnValue(completion.promise);
    mockGenerateProvidedSummary.mockReturnValue(summary.promise);
    mockSearchWorkspaceDocumentPage.mockReturnValue(page.promise);
    mockAppOutline = [
      ...preview.map((item) => createView({ view_id: item.object_id, name: item.object_id })),
      createView({ view_id: 'extra', name: 'Extra result' }),
    ];
    renderBestMatch('page');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot(preview)));
    act(() => options.onSnapshot(snapshot([preview[0]], 'final')));
    await act(async () => completion.resolve({ outcome: 'complete' }));
    await waitFor(() => expect(mockGenerateProvidedSummary).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText('Load more'));
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Load more').hasAttribute('disabled')).toBe(true);
    await act(async () => summary.resolve({ summaries: [] }));
    expect(screen.getByText('Load more').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Load more'));
    expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledTimes(1);
    await act(async () => page.resolve({ items: [result('extra')], has_more: false, next_offset: null }));
    expect(await screen.findByText('Extra result')).toBeTruthy();
    expect(screen.getByText('keyword-0')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('reports presentation once after routable first/final paint and validated EOF, excluding summary work', async () => {
    const completion = deferred<{ outcome: string }>();
    const summary = deferred<unknown>();

    mockSearchStream.mockReturnValue(completion.promise);
    mockGenerateProvidedSummary.mockReturnValue(summary.promise);
    mockAppOutline = [
      createView({ view_id: 'early', name: 'Early page' }),
      createView({ view_id: 'final', name: 'Final page' }),
    ];
    const { unmount } = renderBestMatch('page', performance.now() - 300);
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('early')])));
    expect(await screen.findByText('Early page')).toBeTruthy();
    paintResults();
    expect(mockReportPresentation).not.toHaveBeenCalled();
    act(() => options.onSnapshot(snapshot([result('final')], 'final')));
    expect(await screen.findByText('Final page')).toBeTruthy();
    paintResults();
    expect(mockReportPresentation).not.toHaveBeenCalled();
    await act(async () => completion.resolve({ outcome: 'complete' }));
    await waitFor(() => expect(mockReportPresentation).toHaveBeenCalledTimes(1));
    const metrics = mockReportPresentation.mock.calls[0][1] as Record<string, number | string>;

    expect(mockReportPresentation.mock.calls[0][0]).toBe('workspace-id');
    expect(metrics).toMatchObject({ transport: 'stream', mode: 'hybrid', outcome: 'complete' });
    expect(metrics.first_result_visible_ms).toBeGreaterThanOrEqual(300);
    expect(metrics.final_results_visible_ms).toBeGreaterThanOrEqual(metrics.first_result_visible_ms as number);
    expect(metrics.all_results_received_ms).toBeGreaterThanOrEqual(metrics.final_results_visible_ms as number);
    expect(Object.keys(metrics).sort()).toEqual(
      [
        'transport',
        'mode',
        'outcome',
        'elapsed_ms',
        'first_result_visible_ms',
        'all_results_received_ms',
        'final_results_visible_ms',
      ].sort()
    );
    expect(mockGenerateProvidedSummary).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockReportPresentation).toHaveBeenCalledTimes(1);
  });

  it('does not count a raw final snapshot as visible before its view metadata arrives', async () => {
    const completion = deferred<{ outcome: string }>();
    const metadata = deferred<View>();

    mockSearchStream.mockReturnValue(completion.promise);
    mockGetView.mockReturnValue(metadata.promise);
    renderBestMatch('slow');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('slow')], 'final')));
    await act(async () => completion.resolve({ outcome: 'complete' }));
    paintResults();
    expect(mockReportPresentation).not.toHaveBeenCalled();
    await act(async () => metadata.resolve(createView({ view_id: 'slow', name: 'Hydrated final page' })));
    expect(await screen.findByText('Hydrated final page')).toBeTruthy();
    paintResults();
    expect(mockReportPresentation).toHaveBeenCalledTimes(1);
    const metrics = mockReportPresentation.mock.calls[0][1] as Record<string, number>;

    expect(metrics.first_result_visible_ms).toBeGreaterThanOrEqual(metrics.all_results_received_ms);
    expect(metrics.final_results_visible_ms).toBeGreaterThanOrEqual(metrics.all_results_received_ms);
  });

  it('flushes partial presentation on query cancellation and unmount', async () => {
    mockSearchStream.mockReturnValue(new Promise(() => undefined));
    mockAppOutline = [createView({ view_id: 'early', name: 'Early page' })];
    const { rerender, unmount } = renderBestMatch('early');
    const options = await streamOptions();

    act(() => options.onSnapshot(snapshot([result('early')])));
    expect(await screen.findByText('Early page')).toBeTruthy();
    paintResults();
    rerender(<BestMatch askingAI={false} searchValue='replacement' onAskAI={jest.fn()} onClose={jest.fn()} />);
    expect(options.signal.aborted).toBe(true);
    expect(mockReportPresentation).toHaveBeenCalledTimes(1);
    expect(mockReportPresentation).toHaveBeenCalledWith(
      'workspace-id',
      expect.objectContaining({ outcome: 'cancelled', first_result_visible_ms: expect.any(Number) })
    );
    expect(mockReportPresentation.mock.calls[0][1]).not.toHaveProperty('all_results_received_ms');
    expect(mockReportPresentation.mock.calls[0][1]).not.toHaveProperty('final_results_visible_ms');
    unmount();
    expect(mockSearchStream).toHaveBeenCalledTimes(2);
    expect(mockReportPresentation).toHaveBeenCalledTimes(2);
    expect(mockReportPresentation.mock.calls[1][1]).toMatchObject({ outcome: 'cancelled' });
    expect(mockReportPresentation.mock.calls[1][1]).not.toHaveProperty('first_result_visible_ms');
  });

  it('does not report input abandoned during the real debounce interval', () => {
    jest.useFakeTimers();
    const mockedDebounce = jest.mocked(debounce);
    const previous = mockedDebounce.getMockImplementation();

    mockedDebounce.mockImplementation(jest.requireActual('lodash').debounce);
    try {
      const { unmount } = renderBestMatch('never dispatched');

      unmount();
      act(() => jest.advanceTimersByTime(500));
      expect(mockSearchStream).not.toHaveBeenCalled();
      expect(mockReportPresentation).not.toHaveBeenCalled();
    } finally {
      mockedDebounce.mockImplementation(previous!);
      jest.useRealTimers();
    }
  });

  it('measures legacy fallback as keyword retrieval and isolates a broken reporter from valid rows', async () => {
    mockAppOutline = [createView({ view_id: 'legacy', name: 'Legacy page' })];
    mockSearchWorkspaceDocumentPage.mockResolvedValue({ items: [result('legacy')], has_more: false, next_offset: null });
    mockReportPresentation.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });
    renderBestMatch('legacy');
    expect(await screen.findByText('Legacy page')).toBeTruthy();
    paintResults();
    expect(mockReportPresentation).toHaveBeenCalledWith(
      'workspace-id',
      expect.objectContaining({ transport: 'legacy', mode: 'keyword', outcome: 'complete' })
    );
    expect(screen.getByText('Legacy page')).toBeTruthy();
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it('starts a fresh timing origin when the workspace changes with an unchanged input', async () => {
    let clock = 0;

    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    const oldCompletion = deferred<{ outcome: string }>();
    const newCompletion = deferred<{ outcome: string }>();

    mockSearchStream.mockReturnValueOnce(oldCompletion.promise).mockReturnValueOnce(newCompletion.promise);
    const { rerender } = renderBestMatch('page', 0);

    await streamOptions();
    clock = 5_000;
    mockWorkspaceId = 'next-workspace';
    mockAppOutline = [createView({ view_id: 'new', name: 'New workspace page' })];
    rerender(
      <BestMatch askingAI={false} searchValue='page' queryStartedAt={0} onAskAI={jest.fn()} onClose={jest.fn()} />
    );
    const next = await streamOptions(1);

    act(() => next.onSnapshot(snapshot([result('new')], 'final')));
    expect(await screen.findByText('New workspace page')).toBeTruthy();
    clock = 5_200;
    paintResults();
    clock = 5_300;
    await act(async () => newCompletion.resolve({ outcome: 'complete' }));
    expect(mockReportPresentation).toHaveBeenLastCalledWith('next-workspace', {
      transport: 'stream',
      mode: 'hybrid',
      outcome: 'complete',
      elapsed_ms: 300,
      first_result_visible_ms: 200,
      final_results_visible_ms: 200,
      all_results_received_ms: 300,
    });
  });

  it('does not time an empty final state until EOF removes the spinner and two new frames run', async () => {
    const completion = deferred<{ outcome: string }>();

    mockSearchStream.mockReturnValue(completion.promise);
    renderBestMatch('empty');
    const options = await streamOptions();

    await act(async () => options.onSnapshot(snapshot([], 'final')));
    expect(screen.getByTestId('view-list').getAttribute('data-loading')).toBe('true');
    paintResults();
    expect(mockReportPresentation).not.toHaveBeenCalled();
    await act(async () => completion.resolve({ outcome: 'complete' }));
    expect(screen.getByTestId('view-list').getAttribute('data-loading')).toBe('false');
    expect(mockReportPresentation).not.toHaveBeenCalled();
    paintResults(1);
    expect(mockReportPresentation).not.toHaveBeenCalled();
    paintResults(1);
    expect(mockReportPresentation).toHaveBeenCalledTimes(1);
    const metrics = mockReportPresentation.mock.calls[0][1] as Record<string, number>;

    expect(metrics).not.toHaveProperty('first_result_visible_ms');
    expect(metrics.final_results_visible_ms).toBeGreaterThanOrEqual(metrics.all_results_received_ms);
  });
});
