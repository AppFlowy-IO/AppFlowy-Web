import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  useDatabaseContext,
  useDatabaseGroupFieldIdSelector,
  useFieldsSelector,
  useGalleryLayoutSettings,
  useReadOnly,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { usePublishRowOrders } from '@/application/database-yjs/row-orders-store';
import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { useFeedSearch } from '@/components/database/feed/useFeedSearch';

import { Gallery } from '../Gallery';

jest.mock('@atlaskit/pragmatic-drag-and-drop/reorder', () => ({ reorder: jest.fn() }));
jest.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index', () => ({
  getReorderDestinationIndex: jest.fn(),
}));

jest.mock('@/application/database-yjs', () => ({
  FieldType: { CreatedBy: 13, LastEditedBy: 14, MultiSelect: 4, SingleSelect: 3 },
  FieldVisibility: {
    AlwaysHidden: 2,
    AlwaysShown: 0,
    HideWhenEmpty: 1,
  },
  useDatabaseContext: jest.fn(),
  useDatabaseGroupFieldIdSelector: jest.fn(),
  useFieldsSelector: jest.fn(),
  useGalleryLayoutSettings: jest.fn(),
  useReadOnly: jest.fn(),
  useRowOrdersSelector: jest.fn(),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useReorderRowDispatch: () => jest.fn() }));
jest.mock('@/application/database-yjs/row-orders-store', () => ({ usePublishRowOrders: jest.fn() }));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  useDatabaseSearch: jest.fn(),
}));
jest.mock('@/components/database/feed/useFeedSearch', () => ({
  useFeedSearch: jest.fn(({ rows }: { rows: unknown }) => rows),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../GalleryCard', () => ({
  __esModule: true,
  default: ({ fields, rowId }: { fields: Array<{ fieldId: string }>; rowId: string }) => (
    <div data-field-ids={fields.map((field) => field.fieldId).join(',')} data-testid={`mock-gallery-card-${rowId}`} />
  ),
}));
const mockUseGalleryView = jest.fn();

jest.mock('../GalleryViewContext', () => ({ useGalleryView: () => mockUseGalleryView() }));
jest.mock('../GalleryGroupFooter', () => ({
  GalleryGroupFooter: ({ groupId }: { groupId: string }) => <div data-testid={`mock-group-footer-${groupId}`} />,
  GalleryGroupNewPageTile: ({ groupId }: { groupId: string }) => <div data-testid={`mock-group-tile-${groupId}`} />,
}));
jest.mock('../GalleryNewGroup', () => ({
  GalleryNewGroup: ({ fieldId }: { fieldId: string }) => <div data-testid={`mock-new-group-${fieldId}`} />,
}));
jest.mock('../GalleryDeleteGroupConfirm', () => ({
  GalleryDeleteGroupConfirm: ({ groupId, rows }: { groupId: string; rows: Array<{ id: string }> }) => (
    <div data-row-count={rows.length} data-testid={`mock-delete-group-${groupId}`} />
  ),
}));
jest.mock('@/components/database/list/ListGroup', () => ({
  ListGroupHeader: ({
    group,
    onDeleteGroup,
    variant,
  }: {
    group: { id: string };
    onDeleteGroup?: () => void;
    variant?: string;
  }) => (
    <div data-testid={`mock-group-header-${group.id}`} data-variant={variant}>
      {onDeleteGroup ? (
        <button data-testid={`mock-delete-${group.id}`} onClick={onDeleteGroup} type='button'>
          delete
        </button>
      ) : null}
    </div>
  ),
}));
jest.mock('../GalleryNewRow', () => ({
  __esModule: true,
  default: () => <button type='button'>New row</button>,
}));
jest.mock('../GallerySortState', () => ({
  GallerySortSubscription: ({ children }: { children: React.ReactNode }) => children,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseDatabaseGroupFieldIdSelector = useDatabaseGroupFieldIdSelector as jest.MockedFunction<
  typeof useDatabaseGroupFieldIdSelector
>;
const mockUseFieldsSelector = useFieldsSelector as jest.MockedFunction<typeof useFieldsSelector>;
const mockUseGalleryLayoutSettings = useGalleryLayoutSettings as jest.MockedFunction<typeof useGalleryLayoutSettings>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowOrdersSelector = useRowOrdersSelector as jest.MockedFunction<typeof useRowOrdersSelector>;
const mockUseDatabaseSearch = useDatabaseSearch as jest.MockedFunction<typeof useDatabaseSearch>;
const mockUseFeedSearch = useFeedSearch as jest.MockedFunction<typeof useFeedSearch>;
const mockUsePublishRowOrders = usePublishRowOrders as jest.MockedFunction<typeof usePublishRowOrders>;

const rows = Array.from({ length: 100 }, (_, index) => ({ height: 36, id: `row-${index}` }));

describe('Gallery pagination lifecycle', () => {
  let resizeObserverRecords: Array<{
    callback: ResizeObserverCallback;
    elements: Set<Element>;
    observer: ResizeObserver;
  }>;
  let scrollHeight: number;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let clientHeightDescriptor: PropertyDescriptor | undefined;
  let clientWidthDescriptor: PropertyDescriptor | undefined;
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    resizeObserverRecords = [];
    scrollHeight = 500;
    originalResizeObserver = globalThis.ResizeObserver;
    clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

    class MockResizeObserver {
      private readonly elements = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        resizeObserverRecords.push({
          callback,
          elements: this.elements,
          observer: this as unknown as ResizeObserver,
        });
      }

      disconnect = jest.fn(() => this.elements.clear());
      observe = jest.fn((element: Element) => this.elements.add(element));
      unobserve = jest.fn((element: Element) => this.elements.delete(element));
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1_000 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1_000 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });

    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'gallery-view',
      isDocumentBlock: false,
      onRendered: jest.fn(),
    } as ReturnType<typeof useDatabaseContext>);
    mockUseDatabaseGroupFieldIdSelector.mockReturnValue(undefined);
    mockUseFieldsSelector.mockReturnValue([]);
    mockUseGalleryLayoutSettings.mockReturnValue({
      cardPreview: GalleryCardPreview.PageCover,
      cardSize: GalleryCardSize.Medium,
      fitImage: false,
      showCover: true,
    });
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowOrdersSelector.mockReturnValue(rows);
    // Earlier tests pin a return value; restore the pass-through for each test.
    mockUseFeedSearch.mockImplementation(({ rows: candidates }: { rows: unknown }) => candidates as typeof rows);
    mockUseGalleryView.mockImplementation(() => ({
      grouping: { rowOrders: useRowOrdersSelector(), visibleGroups: [], isGrouped: false, ready: true },
      compactMode: false,
    }));
    mockUseDatabaseSearch.mockReturnValue({ query: '', setQuery: jest.fn() });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;

    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }

    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }

    if (scrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
  });

  it('keeps loading until a non-overflowing viewport is filled', async () => {
    render(<Gallery />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(rows.length);
    });
  });

  it('loads more when a grid-only resize leaves room below the rendered cards', async () => {
    scrollHeight = 2_000;
    render(<Gallery />);

    expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(50);

    const grid = screen.getByTestId('gallery-content');

    scrollHeight = 500;
    act(() => {
      for (const record of resizeObserverRecords) {
        if (record.elements.has(grid)) record.callback([], record.observer);
      }
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(rows.length);
    });
  });

  it('searches every row instead of limiting candidates to the current page', () => {
    scrollHeight = 2_000;
    mockUseDatabaseSearch.mockReturnValue({ query: 'only in row 99', setQuery: jest.fn() });
    mockUseFeedSearch.mockReturnValue([rows[99]]);

    render(<Gallery />);

    expect(mockUseFeedSearch).toHaveBeenLastCalledWith(expect.objectContaining({ rows }));
    expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(1);
    expect(screen.getByTestId('mock-gallery-card-row-99')).toBeTruthy();
  });

  it('publishes the search-narrowed order for the row peek instead of the raw view order', () => {
    const matching = [rows[0], rows[99]];

    mockUseDatabaseSearch.mockReturnValue({ query: 'row', setQuery: jest.fn() });
    mockUseFeedSearch.mockReturnValue(matching);

    render(<Gallery />);

    expect(mockUseFeedSearch).toHaveBeenLastCalledWith(expect.objectContaining({ rows, query: 'row' }));
    expect(mockUsePublishRowOrders).toHaveBeenLastCalledWith(matching, true, { layout: 'gallery', query: 'row' });
    expect(screen.getAllByTestId(/^mock-gallery-card-/).map((card) => card.dataset.testid)).toEqual([
      'mock-gallery-card-row-0',
      'mock-gallery-card-row-99',
    ]);
  });

  it('keeps an explicit zero inset and excludes the preserved grouping field', () => {
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'gallery-view',
      isDocumentBlock: false,
      paddingEnd: 0,
      paddingStart: 0,
    } as ReturnType<typeof useDatabaseContext>);
    mockUseDatabaseGroupFieldIdSelector.mockReturnValue('status');
    mockUseFieldsSelector.mockReturnValue([
      { fieldId: 'name', isPrimary: true, visibility: 0 },
      { fieldId: 'status', isPrimary: false, visibility: 0 },
      { fieldId: 'owner', isPrimary: false, visibility: 0 },
    ] as ReturnType<typeof useFieldsSelector>);
    mockUseRowOrdersSelector.mockReturnValue(rows.slice(0, 1));

    render(<Gallery />);

    const container = screen.getByTestId('database-gallery').firstElementChild as HTMLElement;

    expect(container.style.paddingInlineStart).toBe('0');
    expect(container.style.paddingInlineEnd).toBe('0');
    expect(screen.getByTestId('mock-gallery-card-row-0').getAttribute('data-field-ids')).toBe('name,owner');
  });

  const groupRows = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({ height: 36, id: `${prefix}-${index}` }));

  function mockGroupedView(
    groups: Array<{ id: string; rows: ReturnType<typeof groupRows>; isDefault?: boolean }>,
    fieldName = 'Status',
    fieldType = 3
  ) {
    const gridGroups = groups.map((group) => ({ ...group, collapsed: false, isDefault: !!group.isDefault, label: group.id }));

    mockUseGalleryView.mockReturnValue({
      compactMode: false,
      grouping: {
        fieldId: 'status',
        fieldName,
        fieldType,
        groupId: 'group-config',
        groups: gridGroups,
        isGrouped: true,
        ready: true,
        rowOrders: groups.flatMap((group) => group.rows),
        visibleGroups: gridGroups,
      },
    });
  }

  it('pages each group on its own so Load more grows the group it was clicked in', () => {
    mockGroupedView([
      { id: 'a', rows: groupRows('a', 40) },
      { id: 'b', rows: groupRows('b', 40) },
      { id: 'c', rows: groupRows('c', 60) },
    ]);

    render(<Gallery />);

    expect(screen.getAllByTestId(/^mock-gallery-card-a-/)).toHaveLength(40);
    expect(screen.getAllByTestId(/^mock-gallery-card-b-/)).toHaveLength(40);
    expect(screen.getAllByTestId(/^mock-gallery-card-c-/)).toHaveLength(50);
    expect(screen.getAllByTestId('gallery-load-more')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('gallery-load-more'));

    expect(screen.getAllByTestId(/^mock-gallery-card-c-/)).toHaveLength(60);
    expect(screen.queryByTestId('gallery-load-more')).toBeNull();
    expect(screen.getAllByTestId(/^mock-gallery-card-/)).toHaveLength(140);
  });

  it('puts New page in a free slot of the last row and uses the footer when the row is full', () => {
    // 1000px fits three Medium cards (260px minimum each, 16px gaps).
    mockGroupedView([
      { id: 'partial', rows: groupRows('partial', 2) },
      { id: 'full', rows: groupRows('full', 3) },
      { id: 'empty', rows: groupRows('empty', 0) },
    ]);

    render(<Gallery />);

    expect(screen.getByTestId('mock-group-tile-partial')).toBeTruthy();
    expect(screen.queryByTestId('mock-group-footer-partial')).toBeNull();
    expect(screen.getByTestId('mock-group-footer-full')).toBeTruthy();
    expect(screen.queryByTestId('mock-group-tile-full')).toBeNull();
    expect(screen.getByTestId('mock-group-footer-empty')).toBeTruthy();
    expect(screen.getByTestId('mock-group-header-partial').dataset.variant).toBe('gallery');
  });

  it('offers New group for select grouping and deletes a group with every page in it', () => {
    mockGroupedView([
      { id: 'status', rows: groupRows('none', 1), isDefault: true },
      { id: 'todo', rows: groupRows('todo', 4) },
    ]);

    render(<Gallery />);

    expect(screen.getByTestId('mock-new-group-status')).toBeTruthy();
    // The default "No status" group is derived, so desktop delete_group leaves it alone.
    expect(screen.queryByTestId('mock-delete-status')).toBeNull();
    fireEvent.click(screen.getByTestId('mock-delete-todo'));
    expect(screen.getByTestId('mock-delete-group-todo').dataset.rowCount).toBe('4');
  });

  it('keeps New group and Delete away from read-only and non-select groupings', () => {
    mockGroupedView([{ id: 'Yes', rows: groupRows('yes', 1) }], 'Done', 5);
    const { unmount } = render(<Gallery />);

    expect(screen.queryByTestId('mock-new-group-status')).toBeNull();
    expect(screen.getByTestId('mock-delete-Yes')).toBeTruthy();
    unmount();

    mockUseReadOnly.mockReturnValue(true);
    mockGroupedView([{ id: 'todo', rows: groupRows('todo', 1) }]);
    render(<Gallery />);
    expect(screen.queryByTestId('mock-new-group-status')).toBeNull();
    expect(screen.queryByTestId('mock-delete-todo')).toBeNull();
    expect(screen.queryByTestId('mock-group-tile-todo')).toBeNull();
  });

  it('shows the desktop empty state when grouping leaves no visible group', () => {
    mockGroupedView([], 'Category');

    render(<Gallery />);

    expect(screen.getByTestId('gallery-no-groups').textContent).toContain('gallery.noGroupsForField');
    expect(screen.queryByTestId('gallery-grid')).toBeNull();
  });
});
