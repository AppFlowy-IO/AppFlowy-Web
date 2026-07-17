import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import type { View } from '@/application/types';

import BestMatch from '../BestMatch';

import type { ReactNode } from 'react';

const mockUseAIEnabled = jest.fn();
const mockSearchWorkspaceDocumentPage = jest.fn();
const mockGenerateSearchSummary = jest.fn();
const mockGetView = jest.fn();
let mockAppOutline: View[] = [];
let mockOverviewSources: Array<{
  ragId: string;
  ownerViewId?: string;
  ownerDatabaseId?: string;
}> = [];
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => mockUseAIEnabled(),
  useAppOutline: () => mockAppOutline,
  useCurrentWorkspaceId: () => 'workspace-id',
}));

jest.mock('@/application/services/domains', () => ({
  SearchService: {
    searchWorkspaceDocumentPage: (...args: unknown[]) => mockSearchWorkspaceDocumentPage(...args),
    generateSearchSummary: (...args: unknown[]) => mockGenerateSearchSummary(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/search/SearchAIOverview', () => ({
  SearchAIOverview: ({ sources }: { sources: typeof mockOverviewSources }) => {
    mockOverviewSources = sources;
    return <div data-testid='ai-overview' />;
  },
}));

jest.mock('@/components/app/search/ViewList', () => ({
  __esModule: true,
  default: ({ header, items }: { header?: ReactNode; items?: Array<{ id: string; view: { name: string } }> }) => (
    <div data-testid='view-list'>
      {header ? <div data-testid='search-header'>{header}</div> : null}
      {items?.map((item) => (
        <div key={item.id}>{item.view.name}</div>
      ))}
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
    mockOverviewSources = [];
    mockUseAIEnabled.mockReturnValue(true);
    mockSearchWorkspaceDocumentPage.mockResolvedValue({
      has_more: false,
      items: [],
      next_offset: null,
    });
    mockGenerateSearchSummary.mockResolvedValue({ summaries: [] });
    mockGetView.mockRejectedValue(new Error('not found'));
  });

  it('does not mount the AI overview header when server info disables AI', () => {
    mockUseAIEnabled.mockReturnValue(false);

    renderBestMatch();

    expect(screen.queryByTestId('search-header')).toBeNull();
    expect(screen.queryByTestId('ai-overview')).toBeNull();
  });

  it('mounts the AI overview header when AI is enabled', () => {
    renderBestMatch();

    expect(screen.getByTestId('search-header')).toBeTruthy();
    expect(screen.getByTestId('ai-overview')).toBeTruthy();
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
  });
});
