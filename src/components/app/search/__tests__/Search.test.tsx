import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RAG_SOURCE_OWNERS_METADATA_KEY } from '@/components/ai-chat/rag-scope';
import { Search } from '@/components/app/search/Search';

import type { ChangeEvent, ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockToView = jest.fn();
const mockGetViewNavigation = jest.fn();
const mockFetchCompleteView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockChatRequest = jest.fn();

jest.mock('@mui/material', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
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
  useAppRecent: () => ({ recentViews: [], loadRecentViews: jest.fn() }),
  useAppViewId: () => 'current-page-id',
  useCurrentWorkspaceId: () => 'workspace-id',
  useToView: () => mockToView,
}));

jest.mock('@/components/app/search/BestMatch', () => ({
  __esModule: true,
  default: ({ onAskAI, searchValue }: { onAskAI: (query: string, sources: unknown[]) => void; searchValue: string }) => (
    <button
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
  default: () => null,
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

  it('uses authoritative navigation and persists row ownership before navigating', async () => {
    render(<Search />);

    fireEvent.click(screen.getByText('button.search'));
    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'launch' } });
    fireEvent.click(screen.getByText('Ask AI'));

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
});
