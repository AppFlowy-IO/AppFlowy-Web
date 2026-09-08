import { act, fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext } from 'react';
import * as Y from 'yjs';

import {
  useCellSelector,
  useDatabaseContext,
  useReadOnly,
  useRowDataSelector,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { RowCoverType, YDatabaseRow, YjsDatabaseKey } from '@/application/types';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { EditorPreviewContextProvider } from '@/components/editor/EditorPreviewContext';

import { FeedCard } from '../FeedCard';
import { useFeedMembers } from '../FeedMembersContext';

jest.mock('@/application/database-yjs', () => ({
  useCellSelector: jest.fn(),
  useDatabaseContext: jest.fn(),
  useReadOnly: jest.fn(),
  useRowDataSelector: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  useDatabaseSearch: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../FeedMembersContext', () => ({ useFeedMembers: jest.fn() }));
jest.mock('../FeedCardActions', () => ({
  FeedCardActions: ({ editable, rowId }: { editable: boolean; rowId: string }) => (
    <button data-editable={String(editable)} data-testid={`mock-actions-${rowId}`} type='button'>
      actions
    </button>
  ),
}));
jest.mock('../FeedCardCover', () => ({
  FeedCardCover: ({ rowId }: { rowId: string }) => <div data-testid={`mock-cover-${rowId}`} />,
}));
jest.mock('../FeedCommentSection', () => ({
  FeedCommentSection: ({ rowId }: { rowId: string }) => <div data-testid={`mock-comments-${rowId}`} />,
}));
jest.mock('../FeedDocumentPreview', () => ({
  FeedDocumentPreview: ({ documentId, rowId }: { documentId: string; rowId: string }) => (
    <div data-document-id={documentId} data-testid={`mock-preview-${rowId}`} />
  ),
}));
jest.mock('../FeedRowIcon', () => ({
  FeedRowIcon: ({ icon }: { icon: string }) => <span data-testid='mock-icon'>{icon}</span>,
}));
jest.mock('../FeedRowReactions', () => ({
  FeedRowReactions: ({ rowId }: { rowId: string }) => <div data-testid={`mock-reactions-${rowId}`} />,
}));

const mockUseCellSelector = useCellSelector as jest.MockedFunction<typeof useCellSelector>;
const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowDataSelector = useRowDataSelector as jest.MockedFunction<typeof useRowDataSelector>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;
const mockUseDatabaseSearch = useDatabaseSearch as jest.MockedFunction<typeof useDatabaseSearch>;
const mockUseFeedMembers = useFeedMembers as jest.MockedFunction<typeof useFeedMembers>;

const CREATOR_UID = '3287416529874165123';

function createRow(overrides: Partial<Record<'created_at' | 'created_by' | 'last_modified', string>> = {}) {
  const doc = new Y.Doc();
  const row = doc.getMap('row') as unknown as YDatabaseRow;

  row.set(YjsDatabaseKey.created_at, overrides.created_at ?? String(Math.floor(Date.now() / 1000)));
  row.set(YjsDatabaseKey.last_modified, overrides.last_modified ?? overrides.created_at ?? '');
  if (overrides.created_by !== undefined) row.set(YjsDatabaseKey.created_by, overrides.created_by);
  return row;
}

describe('FeedCard', () => {
  const navigateToRow = jest.fn();
  const bindRowSync = jest.fn();
  const resolveMember = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({ bindRowSync, navigateToRow } as unknown as ReturnType<
      typeof useDatabaseContext
    >);
    mockUseReadOnly.mockReturnValue(false);
    mockUseCellSelector.mockReturnValue({ data: 'Post title' } as ReturnType<typeof useCellSelector>);
    mockUseRowDataSelector.mockReturnValue({ row: createRow() });
    mockUseRowMetaSelector.mockReturnValue({ cover: null, documentId: 'doc-1', icon: '', isEmptyDocument: true });
    mockUseDatabaseSearch.mockReturnValue({ query: '', setQuery: jest.fn() });
    resolveMember.mockReturnValue(undefined);
    mockUseFeedMembers.mockReturnValue({
      resolveMember,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
  });

  it('renders the title, binds row sync, and opens the row on card click', () => {
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    expect(screen.getByTestId('feed-card-row-1').style.contentVisibility).toBe('auto');
    expect(screen.getByTestId('feed-card-title-row-1').textContent).toBe('Post title');
    expect(screen.getByTestId('feed-card-title-row-1').getAttribute('data-untitled')).toBe('false');
    expect(bindRowSync).toHaveBeenCalledWith('row-1');
    expect(screen.queryByTestId('feed-card-creator-row-1')).toBeNull();
    expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
    expect(screen.queryByTestId('mock-cover-row-1')).toBeNull();

    fireEvent.click(screen.getByTestId('feed-card-title-row-1'));
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('shows the Desktop Untitled hint for empty titles and keeps a keyboard opener', () => {
    mockUseCellSelector.mockReturnValue({ data: '   ' } as ReturnType<typeof useCellSelector>);
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    const title = screen.getByTestId('feed-card-title-row-1');

    expect(title.textContent).toBe('feed.untitled');
    expect(title.getAttribute('data-untitled')).toBe('true');
    expect(title.className).toContain('text-text-tertiary');

    fireEvent.click(screen.getByTestId('feed-card-open-row-1'));
    expect(navigateToRow).toHaveBeenCalledTimes(1);
  });

  it('does not open the row when clicking an interactive control inside the card', () => {
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    fireEvent.click(screen.getByTestId('mock-actions-row-1'));
    expect(navigateToRow).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-actions-row-1').getAttribute('data-editable')).toBe('true');
  });

  it('marks actions as non-editable in readonly mode', () => {
    mockUseReadOnly.mockReturnValue(true);
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    expect(screen.getByTestId('mock-actions-row-1').getAttribute('data-editable')).toBe('false');
  });

  it('renders creator info with an edited marker and indents the content like Desktop', () => {
    const createdAt = Math.floor(Date.now() / 1000) - 3600;

    resolveMember.mockImplementation((id: string | null | undefined) =>
      id === CREATOR_UID ? { name: 'Alice', email: 'alice@example.com', avatarUrl: null } : undefined
    );
    mockUseRowDataSelector.mockReturnValue({
      row: createRow({
        created_at: String(createdAt),
        created_by: CREATOR_UID,
        last_modified: String(createdAt + 600),
      }),
    });
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    expect(screen.getByTestId('feed-card-creator-name-row-1').textContent).toBe('Alice');
    expect(screen.getByTestId('feed-card-created-at-row-1').textContent).toContain('globalComment.edited');
    expect(screen.getByTestId('feed-card-title-row-1').closest('.pl-8')).not.toBeNull();
  });

  it('renders the cover, icon, and document preview from row meta', () => {
    mockUseRowMetaSelector.mockReturnValue({
      cover: { cover_type: RowCoverType.ColorCover, data: '#ff0000' },
      documentId: 'doc-1',
      icon: '🚀',
      isEmptyDocument: false,
    });
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    expect(screen.getByTestId('mock-cover-row-1')).toBeTruthy();
    expect(screen.getByTestId('mock-icon').textContent).toBe('🚀');
    expect(screen.getByTestId('mock-preview-row-1').getAttribute('data-document-id')).toBe('doc-1');
  });

  it('renders a linked Feed card inside a preview without loading another row document', () => {
    mockUseRowMetaSelector.mockReturnValue({ cover: null, documentId: 'recursive-doc', icon: '', isEmptyDocument: false });
    render(
      <EditorPreviewContextProvider enabled>
        <FeedCard primaryFieldId='primary' rowId='row-1' />
      </EditorPreviewContextProvider>
    );

    expect(screen.getByTestId('feed-card-title-row-1').textContent).toBe('Post title');
    expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
  });

  it('hides cards whose title does not match the toolbar search', () => {
    mockUseDatabaseSearch.mockReturnValue({ query: 'other', setQuery: jest.fn() });
    const { unmount } = render(<FeedCard primaryFieldId='primary' rowId='row-1' />);

    expect(screen.getByTestId('feed-card-row-1').hasAttribute('hidden')).toBe(true);
    unmount();

    mockUseDatabaseSearch.mockReturnValue({ query: 'post', setQuery: jest.fn() });
    render(<FeedCard primaryFieldId='primary' rowId='row-1' />);
    expect(screen.getByTestId('feed-card-row-1').hasAttribute('hidden')).toBe(false);
  });

  it('mounts previews only for matching cards near the viewport and releases them when they leave', () => {
    const originalObserver = globalThis.IntersectionObserver;
    const observers: { callback: IntersectionObserverCallback; observe: jest.Mock; disconnect: jest.Mock }[] = [];
    const SearchContext = createContext({ query: '', setQuery: jest.fn() });
    const renderCard = (query: string) => (
      <SearchContext.Provider value={{ query, setQuery: jest.fn() }}>
        <FeedCard primaryFieldId='primary' rowId='row-1' />
      </SearchContext.Provider>
    );

    mockUseDatabaseSearch.mockImplementation(() => useContext(SearchContext));

    globalThis.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
      const observer = { callback, observe: jest.fn(), disconnect: jest.fn() };

      observers.push(observer);
      return observer;
    }) as unknown as typeof IntersectionObserver;

    try {
      mockUseRowMetaSelector.mockReturnValue({ cover: null, documentId: 'doc-1', icon: '', isEmptyDocument: false });
      const { rerender, unmount } = render(renderCard('no match'));

      expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
      expect(observers).toHaveLength(0);

      rerender(renderCard('post'));
      expect(observers[0].observe).toHaveBeenCalledWith(screen.getByTestId('feed-card-row-1'));
      expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();

      const intersect = (isIntersecting: boolean) => {
        act(() => observers[0].callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
      };

      intersect(true);
      expect(screen.getByTestId('mock-preview-row-1')).toBeTruthy();
      intersect(false);
      expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
      intersect(true);
      expect(screen.getByTestId('mock-preview-row-1')).toBeTruthy();

      rerender(renderCard('no match'));
      expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
      expect(observers[0].disconnect).toHaveBeenCalled();
      intersect(true);
      expect(screen.queryByTestId('mock-preview-row-1')).toBeNull();
      unmount();
    } finally {
      globalThis.IntersectionObserver = originalObserver;
    }
  });
});
