import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { View } from '@/application/types';
import { RAG_SOURCE_OWNERS_METADATA_KEY } from '@/components/ai-chat/rag-scope';
import { Search } from '@/components/app/search/Search';

import type { ChangeEvent, ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockToView = jest.fn();
const mockGetViewNavigation = jest.fn();
const mockFetchCompleteView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockChatRequest = jest.fn();
const mockLoadRecentViews = jest.fn();
const mockReadOverviews = jest.fn();
const mockOutline: View[] = [];
let mockWorkspaceId = 'workspace-id';
let mockAccountId = 'member-a';
let mockAIEnabled = true;

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockAccountId,
}));

jest.mock('@/application/services/domains', () => ({
  SearchService: { getRecentOverviews: (...args: unknown[]) => mockReadOverviews(...args) },
}));

jest.mock('@/components/app/search/SearchAIOverview', () => ({
  MarkdownSummary: ({ content }: { content: string }) => <p>{content}</p>,
}));

jest.mock('@mui/material', () => ({
  Dialog: ({ children, open, onClose }: { children: ReactNode; open: boolean; onClose: () => void }) =>
    open ? <div onKeyDown={(event) => event.key === 'Escape' && onClose()}>{children}</div> : null,
  InputBase: ({ onChange, value }: { onChange: (event: ChangeEvent<HTMLInputElement>) => void; value: string }) => (
    <input aria-label='search-input' onChange={onChange} value={value} />
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => mockAIEnabled,
  useAppOperations: () => ({ addPage: mockAddPage }),
  useAppOutline: () => mockOutline,
  useAppRecent: () => ({ recentViews: [], loadRecentViews: mockLoadRecentViews }),
  useAppViewId: () => 'current-page-id',
  useCurrentWorkspaceId: () => mockWorkspaceId,
  useToView: () => mockToView,
}));

jest.mock('@/components/app/search/BestMatch', () => ({
  __esModule: true,
  default: ({
    onAskAI,
    searchValue,
    submitted,
    onOverviewFailure,
  }: {
    onAskAI: (query: string, sources: unknown[]) => void;
    searchValue: string;
    submitted: boolean;
    onOverviewFailure: () => void;
  }) => (
    <>
      <button
        data-query={searchValue}
        data-submitted={submitted}
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
      <button onClick={onOverviewFailure}>Simulate overview failure</button>
    </>
  ),
}));

jest.mock('@/components/app/search/RecentViews', () => ({
  __esModule: true,
  default: () => null,
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

function preparedOverview(title: string) {
  return {
    topics: [{ title, generated_at: '2026-11-19T08:00:00Z', summary: { content: `Answer for ${title}`, sources: [] } }],
  };
}

describe('workspace search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = 'workspace-id';
    mockAIEnabled = true;
    mockAccountId = 'member-a';
    mockReadOverviews.mockReset().mockResolvedValue(preparedOverview('Release checklist'));
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

  it('submits the current query and clears submission on editing, workspace changes, and reopening', async () => {
    const { rerender } = render(<Search />);

    fireEvent.click(screen.getByText('button.search'));
    const input = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: 'button.search' });

    expect(submitButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: 'invoice' } });
    expect((await screen.findByText('Ask AI')).dataset.submitted).toBe('false');
    fireEvent.click(submitButton);
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('true');
    fireEvent.click(screen.getByText('Simulate overview failure'));
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('false');
    fireEvent.click(submitButton);
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('true');
    fireEvent.change(input, { target: { value: 'invoice?' } });
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('false');
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('true');
    mockWorkspaceId = 'next-workspace';
    rerender(<Search />);
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('false');
    fireEvent.click(submitButton);
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {
      fireEvent.click(screen.getByText('button.search'));
    });
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('');
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('keeps IME drafts and confirmation out of search and requires a later submit for an overview', async () => {
    render(<Search />);
    fireEvent.click(screen.getByText('button.search'));
    const input = screen.getByRole('textbox');

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '输入' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
    fireEvent.submit(input.closest('form')!);
    expect(screen.queryByText('Ask AI')).toBeNull();
    expect(screen.getByRole('button', { name: 'button.search' }).hasAttribute('disabled')).toBe(true);
    fireEvent.compositionEnd(input);
    expect((await screen.findByText('Ask AI')).dataset.submitted).toBe('false');
    expect(screen.getByText('Ask AI').dataset.query).toBe('输入');
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByText('Ask AI').dataset.submitted).toBe('true');
  });

  it('opens the ranked topics only on an empty, authenticated, AI-enabled palette', async () => {
    const { rerender } = render(<Search />);

    expect(screen.queryByText('Release checklist')).toBeNull();
    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('Release checklist')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } });
    expect(screen.queryByText('Release checklist')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(await screen.findByText('Release checklist')).toBeTruthy();
    mockAIEnabled = false;
    rerender(<Search />);
    expect(screen.queryByText('Release checklist')).toBeNull();
    mockAIEnabled = true;
    mockAccountId = '';
    rerender(<Search />);
    expect(screen.queryByText('Release checklist')).toBeNull();
  });

  it('removes a previous member’s card immediately and ignores their pending read on a same-workspace switch', async () => {
    let finishBen!: (value: ReturnType<typeof preparedOverview>) => void;

    mockReadOverviews
      .mockResolvedValueOnce(preparedOverview('Ada checklist'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishBen = resolve;
          })
      )
      .mockResolvedValueOnce(preparedOverview('Casey checklist'));

    const { rerender } = render(<Search />);

    fireEvent.click(screen.getByText('button.search'));
    expect(await screen.findByText('Answer for Ada checklist')).toBeTruthy();

    mockAccountId = 'ben';
    rerender(<Search />);
    expect(screen.queryByText('Answer for Ada checklist')).toBeNull();
    await waitFor(() => expect(mockReadOverviews).toHaveBeenCalledTimes(2));
    const benSignal = mockReadOverviews.mock.calls[1][1] as AbortSignal;

    mockAccountId = 'casey';
    rerender(<Search />);
    expect(benSignal.aborted).toBe(true);
    expect(await screen.findByText('Answer for Casey checklist')).toBeTruthy();

    await act(async () => finishBen(preparedOverview('Ben checklist')));
    expect(screen.queryByText('Ben checklist')).toBeNull();
    expect(screen.getByText('Answer for Casey checklist')).toBeTruthy();
    expect(mockReadOverviews.mock.calls.map(([workspace]) => workspace)).toEqual(Array(3).fill('workspace-id'));
  });

  it('passes the typed query to the search panel after a prepared read fails and retries on reopen', async () => {
    mockReadOverviews.mockRejectedValueOnce(new Error('Overview endpoint unavailable'));
    render(<Search />);

    fireEvent.click(screen.getByText('button.search'));
    await waitFor(() => expect(mockReadOverviews).toHaveBeenCalledTimes(1));
    const input = screen.getByRole('textbox');

    expect(screen.queryByRole('region', { name: 'commandPalette.recentOverviews' })).toBeNull();
    fireEvent.change(input, { target: { value: 'release' } });
    const typedSearch = await screen.findByText('Ask AI');

    expect(typedSearch.dataset.query).toBe('release');
    expect(typedSearch.dataset.submitted).toBe('false');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByText('button.search'));

    expect(await screen.findByText('Release checklist')).toBeTruthy();
    expect(mockReadOverviews).toHaveBeenCalledTimes(2);
  });

  it('leaves native Tab available for the topic buttons before Recent handles its navigation shortcut', async () => {
    const listener = jest.fn();

    document.addEventListener('keydown', listener);
    try {
      render(<Search />);
      fireEvent.click(screen.getByText('button.search'));
      await screen.findByText('Release checklist');
      const input = screen.getByRole('textbox');

      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
      expect(listener).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'query' } });
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', listener);
    }
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
});
