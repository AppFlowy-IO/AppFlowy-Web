import { fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext, useFieldsSelector, useReadOnly, useSortsSelector } from '@/application/database-yjs';

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
const mockCreateRow = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  FieldVisibility: { AlwaysHidden: 2, AlwaysShown: 0, HideWhenEmpty: 1 },
  isAIFieldType: () => false,
  useDatabaseContext: jest.fn(),
  useFieldsSelector: jest.fn(),
  useReadOnly: jest.fn(),
  useSortsSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => mockCreateRow,
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
  ListRow: ({
    fields,
    reorderable,
    rowId,
  }: {
    fields: Array<{ fieldId: string }>;
    reorderable: boolean;
    rowId: string;
  }) => (
    <div
      data-field-ids={fields.map((field) => field.fieldId).join(',')}
      data-reorderable={String(reorderable)}
      data-testid={`list-row-${rowId}`}
    />
  ),
}));

jest.mock('../ListGroup', () => ({
  ListGroupFooter: ({ groupId }: { groupId: string }) => <div data-testid={`list-group-footer-${groupId}`} />,
  ListGroupHeader: ({ group }: { group: { id: string } }) => <div data-testid={`list-group-header-${group.id}`} />,
  ListGroupSeparator: () => <div data-testid='list-group-separator' />,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseFieldsSelector = useFieldsSelector as jest.MockedFunction<typeof useFieldsSelector>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseSortsSelector = useSortsSelector as jest.MockedFunction<typeof useSortsSelector>;

const defaultListFields = [
  { fieldId: 'name', fieldType: 0, isPrimary: true, visibility: 0 },
  { fieldId: 'type', fieldType: 3, isPrimary: false, visibility: 0 },
  { fieldId: 'done', fieldType: 5, isPrimary: false, visibility: 0 },
  { fieldId: 'notes', fieldType: 0, isPrimary: false, visibility: 2 },
] as ReturnType<typeof useFieldsSelector>;
const allVisibleListFields = defaultListFields.map((field) => ({ ...field, visibility: 0 })) as ReturnType<
  typeof useFieldsSelector
>;

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
    mockUseFieldsSelector.mockReturnValue([{ fieldId: 'title', fieldType: 0, isPrimary: true }] as ReturnType<
      typeof useFieldsSelector
    >);
    mockCreateRow.mockResolvedValue('new-row');
  });

  it('database_list_load_more.dart: list view shows imported rows (seeded 100-row Web equivalent)', () => {
    render(<List />);

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(50);
    expect(screen.getByTestId('list-row-row-1')).toBeTruthy();
    expect(screen.getByTestId('list-row-row-50')).toBeTruthy();
    expect(screen.getByTestId('list-load-more').textContent).toContain('50');

    fireEvent.click(screen.getByTestId('list-load-more'));

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(100);
    expect(screen.queryByTestId('list-load-more')).toBeNull();
    expect(onRendered).toHaveBeenCalled();
  });

  it('keeps embedded Flutter initial loading outside row insets with 30px top padding', () => {
    grouping.rowOrders = undefined;
    render(<List />);

    const list = screen.getByTestId('database-list');
    const indicator = screen.getByRole('status', { name: 'Loading rows' });

    expect(indicator.parentElement).toBe(list);
    expect(indicator.className).toContain('pt-[30px]');
    expect(indicator.className).not.toContain('h-full');
    expect(mockUseSortsSelector).not.toHaveBeenCalled();
  });

  it('expands Flutter initial loading to center vertically in a standalone List', () => {
    grouping.rowOrders = undefined;
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'list-view',
      isDocumentBlock: false,
      onRendered,
      paddingEnd: 96,
      paddingStart: 96,
    } as ReturnType<typeof useDatabaseContext>);
    render(<List />);

    const indicator = screen.getByRole('status', { name: 'Loading rows' });

    expect(indicator.className).toContain('h-full');
    expect(indicator.className).toContain('items-center');
    expect(indicator.className).toContain('pt-[30px]');
  });

  it("database_list_load_more.dart: scroll through list view loads all 100 rows at Flutter's 200px threshold", () => {
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'list-view',
      isDocumentBlock: false,
      onRendered,
      paddingEnd: 96,
      paddingStart: 96,
    } as ReturnType<typeof useDatabaseContext>);
    render(<List />);

    const list = screen.getByTestId('database-list');

    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 2000 },
      scrollTop: { configurable: true, value: 1250 },
    });

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(50);
    fireEvent.scroll(list);
    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(100);
    expect(screen.queryByLabelText('Loading more rows')).toBeNull();
  });

  it('database_list_load_more.dart: create new row in list view increases count and opens row detail', async () => {
    grouping.rowOrders = grouping.rowOrders.slice(0, 3);
    const { rerender } = render(<List />);

    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(3);
    fireEvent.click(screen.getByTestId('list-new-row'));

    expect(mockCreateRow).toHaveBeenCalledWith({ openAfterCreate: true, tailing: true });
    // Model the row-order selector update emitted after the create dispatch.
    grouping.rowOrders = [...(grouping.rowOrders ?? []), { height: 36, id: 'row-4' }];
    rerender(<List key='after-create' />);
    expect(screen.getAllByTestId(/^list-row-row-/)).toHaveLength(4);
  });

  it('database_list_default_visibility_test.dart: creating list view should show only 3 properties and hide others', () => {
    grouping.rowOrders = grouping.rowOrders.slice(0, 1);
    mockUseFieldsSelector.mockReturnValue(defaultListFields);
    render(<List />);

    expect(screen.getByTestId('list-row-row-1').getAttribute('data-field-ids')).toBe('name,type,done');
  });

  it('database_list_default_visibility_test.dart: toggling hidden fields makes them visible in list view; database_list_field_display.dart: changing field visibility affects list display', () => {
    grouping.rowOrders = grouping.rowOrders.slice(0, 1);
    mockUseFieldsSelector.mockReturnValue(defaultListFields);
    const { rerender } = render(<List />);

    expect(screen.getByTestId('list-row-row-1').getAttribute('data-field-ids')).toBe('name,type,done');
    mockUseFieldsSelector.mockReturnValue(allVisibleListFields);
    rerender(<List />);

    expect(screen.getByTestId('list-row-row-1').getAttribute('data-field-ids')).toBe('name,type,done,notes');
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
