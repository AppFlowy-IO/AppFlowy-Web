import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import type { View } from '@/application/types';

import BestMatch from '../BestMatch';

import type { ReactNode } from 'react';

const mockUseAIEnabled = jest.fn();
const mockSearchWorkspaceDocumentPage = jest.fn();
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

jest.mock('@/application/services/domains', () => ({
  SearchService: {
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
    onLoadMore,
  }: {
    header?: ReactNode;
    items?: Array<{ id: string; view: { name: string } }>;
    hasMore?: boolean;
    onLoadMore?: () => void;
  }) => (
    <div data-testid='view-list'>
      {header ? <div data-testid='search-header'>{header}</div> : null}
      {items?.map((item) => (
        <div key={item.id}>{item.view.name}</div>
      ))}
      {hasMore && <button onClick={onLoadMore}>Load more</button>}
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

function renderBestMatch(searchValue = '') {
  return render(<BestMatch askingAI={false} searchValue={searchValue} onAskAI={jest.fn()} onClose={jest.fn()} />);
}

describe('BestMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppOutline = [];
    mockWorkspaceId = 'workspace-id';
    mockOverviewSources = [];
    mockCanAskFollowUp = false;
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
    expect(mockGenerateSearchSummary).toHaveBeenLastCalledWith('next-workspace', 'page');
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

    await waitFor(() => expect(mockGenerateSearchSummary).toHaveBeenCalledWith('workspace-id', 'show my tasks'));
    await waitFor(() =>
      expect(mockSearchWorkspaceDocumentPage).toHaveBeenCalledWith(
        'workspace-id',
        'show my tasks',
        0,
        expect.stringMatching(/^best-match-keyword:/)
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
});
