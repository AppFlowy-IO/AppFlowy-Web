import { fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext, usePrimaryFieldId, useReadOnly } from '@/application/database-yjs';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';

import { Feed } from '../Feed';
import { useFeedRowData } from '../useFeedRowOrders';
import { useFeedSearch } from '../useFeedSearch';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
  usePrimaryFieldId: jest.fn(),
  useReadOnly: jest.fn(),
  useFieldsSelector: jest.fn(() => []),
}));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  useDatabaseSearch: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../useFeedRowOrders', () => ({ useFeedRowData: jest.fn() }));
jest.mock('../useFeedSearch', () => ({ useFeedSearch: jest.fn(({ rows }: { rows: unknown }) => rows) }));
jest.mock('../FeedMembersContext', () => ({
  FeedMembersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../FeedCard', () => ({
  FeedCard: ({ primaryFieldId, rowId }: { primaryFieldId: string; rowId: string }) => {
    mockRenderedRows.add(rowId);
    return <div data-primary-field-id={primaryFieldId} data-testid={`mock-feed-card-${rowId}`} />;
  },
}));
jest.mock('../FeedControls', () => ({
  FeedEmptyState: () => <div data-testid='feed-empty' />,
  FeedLoadingIndicator: () => <div data-testid='feed-loading' />,
  FeedLoadMore: ({ onLoadMore, remainingCount }: { onLoadMore: () => void; remainingCount: number }) => (
    <button data-testid='feed-load-more' onClick={onLoadMore} type='button'>
      load more {remainingCount}
    </button>
  ),
  FeedNewRow: () => <button data-testid='feed-new-row' type='button' />,
}));

const mockRenderedRows = new Set<string>();
const mockUseFeedSearch = useFeedSearch as jest.MockedFunction<typeof useFeedSearch>;
const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUsePrimaryFieldId = usePrimaryFieldId as jest.MockedFunction<typeof usePrimaryFieldId>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseDatabaseSearch = useDatabaseSearch as jest.MockedFunction<typeof useDatabaseSearch>;
const mockUseFeedRowData = useFeedRowData as jest.MockedFunction<typeof useFeedRowData>;

const rows = Array.from({ length: 35 }, (_, index) => ({ height: 36, id: `row-${index}` }));

describe('Feed', () => {
  const onRendered = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderedRows.clear();
    mockUseFeedSearch.mockImplementation(({ rows }) => rows);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'feed-view',
      isDocumentBlock: false,
      onRendered,
    } as unknown as ReturnType<typeof useDatabaseContext>);
    mockUsePrimaryFieldId.mockReturnValue('primary');
    mockUseReadOnly.mockReturnValue(false);
    mockUseDatabaseSearch.mockReturnValue({ query: '', setQuery: jest.fn() });
    mockUseFeedRowData.mockReturnValue({ rowOrders: rows, cachedRowDocs: {} });
  });

  it('shows the loading indicator until row orders and the primary field resolve', () => {
    mockUseFeedRowData.mockReturnValue({ rowOrders: undefined, cachedRowDocs: {} });
    render(<Feed />);

    expect(screen.getByTestId('feed-loading')).toBeTruthy();
    expect(onRendered).not.toHaveBeenCalled();
  });

  it('shows the Desktop empty state without the new-row button when there are no rows', () => {
    mockUseFeedRowData.mockReturnValue({ rowOrders: [], cachedRowDocs: {} });
    render(<Feed />);

    expect(screen.getByTestId('feed-empty')).toBeTruthy();
    expect(screen.queryByTestId('feed-new-row')).toBeNull();
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it('renders 20 cards initially and loads 10 more per click (kInitialVisibleRows / kLoadMoreRowsIncrement)', () => {
    render(<Feed />);

    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(20);
    expect(screen.getByTestId('mock-feed-card-row-0').getAttribute('data-primary-field-id')).toBe('primary');
    expect(screen.getByTestId('feed-load-more').textContent).toContain('15');

    fireEvent.click(screen.getByTestId('feed-load-more'));
    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(30);
    expect(screen.getByTestId('feed-load-more').textContent).toContain('5');

    fireEvent.click(screen.getByTestId('feed-load-more'));
    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(35);
    expect(screen.queryByTestId('feed-load-more')).toBeNull();
    expect(screen.getByTestId('feed-new-row')).toBeTruthy();
  });

  it('hides the new-row action in readonly mode', () => {
    mockUseReadOnly.mockReturnValue(true);
    render(<Feed />);

    expect(screen.queryByTestId('feed-new-row')).toBeNull();
    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(20);
  });

  it('keeps matching search results paginated', () => {
    mockUseDatabaseSearch.mockReturnValue({ query: 'hello', setQuery: jest.fn() });
    render(<Feed />);

    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(20);
    expect(screen.getByTestId('feed-load-more').textContent).toContain('15');
  });

  it('resets the result window before rendering a different query', () => {
    const allRows = Array.from({ length: 70 }, (_, index) => ({ id: `row-${index}`, height: 36 }));

    mockUseFeedRowData.mockReturnValue({ rowOrders: allRows, cachedRowDocs: {} });
    mockUseFeedSearch.mockImplementation(({ query }) => (query === 'next' ? allRows.slice(35) : allRows.slice(0, 35)));
    const { rerender } = render(<Feed />);

    fireEvent.click(screen.getByTestId('feed-load-more'));
    fireEvent.click(screen.getByTestId('feed-load-more'));
    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(35);
    mockRenderedRows.clear();
    mockUseDatabaseSearch.mockReturnValue({ query: 'next', setQuery: jest.fn() });
    rerender(<Feed />);
    expect(screen.getAllByTestId(/^mock-feed-card-/)).toHaveLength(20);
    expect(mockRenderedRows.size).toBe(20);
  });

  it('uses the Desktop inline insets unless the host provides padding', () => {
    const { rerender } = render(<Feed />);

    expect(screen.getByTestId('feed-list').style.paddingInlineStart).toBe('96px');

    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'feed-view',
      isDocumentBlock: true,
      onRendered,
      paddingStart: 12,
      paddingEnd: 8,
    } as unknown as ReturnType<typeof useDatabaseContext>);
    rerender(<Feed />);

    expect(screen.getByTestId('feed-list').style.paddingInlineStart).toBe('12px');
    expect(screen.getByTestId('feed-list').style.paddingInlineEnd).toBe('8px');
    expect(screen.getByTestId('database-feed').className).toContain('overflow-visible');
  });
});
