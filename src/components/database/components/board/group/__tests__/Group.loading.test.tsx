import { render, screen } from '@testing-library/react';

import { useRowsByGroup } from '@/application/database-yjs';
import { Group } from '@/components/database/components/board/group/Group';

let mockSearchQuery = '';
let mockSorts: { id: string }[] = [];
const mockUseColumnsDrag = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 100,
  useBoardLayoutSettings: () => ({ groupCalculation: undefined, showColorColumns: false }),
  useDatabaseContext: () => ({ navigateToRow: jest.fn(), paddingEnd: 0, paddingStart: 0 }),
  useDatabaseSearchQuery: () => mockSearchQuery,
  useReadOnly: () => false,
  useRowsByGroup: jest.fn(),
  useSortsSelector: () => mockSorts,
}));

jest.mock('@/components/database/board/useBoardGroupCalculations', () => ({
  useBoardGroupCalculations: () => null,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => jest.fn(),
}));
jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: () => ({ setEditingCardId: jest.fn(), setSelectedCardIds: jest.fn() }),
}));
jest.mock('@/components/database/components/board/drag-and-drop/useColumnsDrag', () => ({
  useColumnsDrag: (...args: unknown[]) => {
    mockUseColumnsDrag(...args);
    return { contextValue: { instanceId: 'test-board' }, scrollableRef: { current: null } };
  },
}));
jest.mock('@/components/database/components/board/group/Columns', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => <div data-testid='board-columns'>Hydrated board</div>),
  };
});
jest.mock('@/components/database/components/board/group/GroupStickyHeader', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => null),
  };
});
jest.mock('@/components/database/components/board/group/useNavigationKey', () => ({
  useNavigationKey: jest.fn(),
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => null),
  };
});
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseRowsByGroup = useRowsByGroup as jest.MockedFunction<typeof useRowsByGroup>;
const loadingResult = {
  columns: [],
  fieldId: 'status-field-id',
  groupResult: new Map(),
  groupRowsReady: false,
  hideEmptyGroups: false,
  notFound: false,
  groupingRows: {},
};

describe('Board group loading state', () => {
  afterEach(() => {
    mockUseRowsByGroup.mockReset();
    mockUseColumnsDrag.mockReset();
    mockSearchQuery = '';
    mockSorts = [];
  });

  it('replaces the non-interactive Kanban skeleton after the first row grouping is hydrated', () => {
    mockUseRowsByGroup.mockReturnValue(loadingResult);

    const { rerender } = render(<Group groupId='status-group-id' />);

    expect(screen.getByTestId('kanban-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('board-columns')).toBeNull();
    expect(screen.queryByText('New')).toBeNull();

    mockUseRowsByGroup.mockReturnValue({ ...loadingResult, groupRowsReady: true });
    rerender(<Group groupId='status-group-id' />);

    expect(screen.queryByTestId('kanban-skeleton')).toBeNull();
    expect(screen.getByTestId('board-columns').textContent).toBe('Hydrated board');
  });

  it('shows "No results" in place of the columns when a settled search matches no card (WP09)', () => {
    mockSearchQuery = 'zzqx';
    mockUseRowsByGroup.mockReturnValue({
      ...loadingResult,
      groupRowsReady: true,
      groupResult: new Map([
        ['todo', []],
        ['doing', []],
      ]),
    });

    render(<Group groupId='status-group-id' />);

    expect(screen.getByTestId('database-search-empty-state').getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('board-columns')).toBeNull();
  });

  it('keeps the columns while the search still matches a card, and while it is loading', () => {
    mockSearchQuery = 'mobile';
    mockUseRowsByGroup.mockReturnValue({
      ...loadingResult,
      groupRowsReady: true,
      groupResult: new Map([['todo', [{ id: 'mobile-app', height: 36 }]]]),
    });

    const { rerender } = render(<Group groupId='status-group-id' />);

    expect(screen.getByTestId('board-columns')).toBeTruthy();
    expect(screen.queryByTestId('database-search-empty-state')).toBeNull();

    mockUseRowsByGroup.mockReturnValue(loadingResult);
    rerender(<Group groupId='status-group-id' />);
    expect(screen.getByTestId('kanban-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('database-search-empty-state')).toBeNull();
  });

  it('tells the drag and drop that the board is sorted (WP09 §1.4)', () => {
    mockSorts = [{ id: 'sort-estimate' }];
    mockUseRowsByGroup.mockReturnValue({ ...loadingResult, groupRowsReady: true });

    render(<Group groupId='status-group-id' />);

    expect(mockUseColumnsDrag).toHaveBeenLastCalledWith(
      'status-group-id',
      [],
      expect.any(Function),
      'status-field-id',
      true
    );
  });
});
