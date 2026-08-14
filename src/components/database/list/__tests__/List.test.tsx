import { fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext, useReadOnly, useSortsSelector } from '@/application/database-yjs';

import { List } from '../List';

const grouping = {
  activeGroupIds: [],
  groups: [],
  hideEmptyGroups: true,
  isGrouped: false,
  ready: true,
  rowOrders: Array.from({ length: 100 }, (_, index) => ({ height: 36, id: `row-${index + 1}` })),
  visibleGroups: [],
};

jest.mock('@/application/database-yjs', () => ({
  FieldVisibility: { AlwaysHidden: 2, AlwaysShown: 0, HideWhenEmpty: 1 },
  isAIFieldType: () => false,
  useDatabaseContext: jest.fn(),
  useFieldsSelector: () => [{ fieldId: 'title', fieldType: 0, isPrimary: true }],
  useReadOnly: jest.fn(),
  useSortsSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => jest.fn(),
  useReorderRowDispatch: () => jest.fn(),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: React.ReactNode }) => children,
  useListGrouping: () => grouping,
}));

jest.mock('../ListRow', () => ({
  ListRow: ({ reorderable, rowId }: { reorderable: boolean; rowId: string }) => (
    <div data-reorderable={String(reorderable)} data-testid={`list-row-${rowId}`} />
  ),
}));

jest.mock('../ListGroup', () => ({
  ListGroupFooter: ({ groupId }: { groupId: string }) => <div data-testid={`list-group-footer-${groupId}`} />,
  ListGroupHeader: ({ group }: { group: { id: string } }) => <div data-testid={`list-group-header-${group.id}`} />,
  ListGroupSeparator: () => <div data-testid='list-group-separator' />,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseSortsSelector = useSortsSelector as jest.MockedFunction<typeof useSortsSelector>;

describe('List incremental rendering', () => {
  const onRendered = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    grouping.isGrouped = false;
    grouping.visibleGroups = [];
    grouping.rowOrders = Array.from({ length: 100 }, (_, index) => ({ height: 36, id: `row-${index + 1}` }));
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'list-view',
      isDocumentBlock: true,
      onRendered,
      paddingEnd: 96,
      paddingStart: 96,
    } as ReturnType<typeof useDatabaseContext>);
    mockUseReadOnly.mockReturnValue(false);
    mockUseSortsSelector.mockReturnValue([]);
  });

  it('renders 50 embedded rows initially and loads the next 50 explicitly', () => {
    render(<List />);

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(50);
    expect(screen.getByTestId('list-load-more').textContent).toContain('50');

    fireEvent.click(screen.getByTestId('list-load-more'));

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(100);
    expect(screen.queryByTestId('list-load-more')).toBeNull();
    expect(onRendered).toHaveBeenCalled();
  });

  it('suppresses row creation and reordering in readonly mode', () => {
    mockUseReadOnly.mockReturnValue(true);
    render(<List />);

    expect(screen.queryByTestId('list-new-row')).toBeNull();
    expect(screen.getByTestId('list-row-row-1').getAttribute('data-reorderable')).toBe('false');
    expect(mockUseSortsSelector).not.toHaveBeenCalled();
  });

  it('uses one List-level sort consumer for all editable rows', () => {
    render(<List />);

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(50);
    // React's development lifecycle may replay the single consumer, but the
    // count must remain constant rather than scale with the 50 mounted rows.
    expect(mockUseSortsSelector.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('renders grouped rows with headers and footers but never enables grouped dragging', () => {
    grouping.isGrouped = true;
    grouping.rowOrders = [
      { height: 36, id: 'row-1' },
      { height: 36, id: 'row-2' },
    ];
    grouping.visibleGroups = [
      {
        collapsed: false,
        hidden: false,
        id: 'todo',
        isDefault: false,
        label: 'To do',
        rows: grouping.rowOrders,
        visible: true,
      },
    ];

    render(<List />);

    expect(screen.getByTestId('list-group-header-todo')).toBeTruthy();
    expect(screen.getByTestId('list-group-footer-todo')).toBeTruthy();
    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(2);
    expect(screen.getByTestId('list-row-row-1').getAttribute('data-reorderable')).toBe('false');
    expect(screen.queryByTestId('list-new-row')).toBeNull();
  });

  it('does not leak ungrouped rows when all groups are hidden', () => {
    grouping.isGrouped = true;
    grouping.visibleGroups = [];

    render(<List />);

    expect(screen.queryAllByTestId(/^list-row-row-/)).toHaveLength(0);
    expect(screen.queryByTestId('list-new-row')).toBeNull();
  });
});
