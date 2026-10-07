import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { GridDragContext, GridDragContextValue } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import {
  createGridInteractionStore,
  createGridRowResizeStore,
  GridContext,
  GridContextType,
  GridInteractionContext,
} from '@/components/database/grid/useGridContext';

/** Every `t()` call, by key. */
const mockTranslated: string[] = [];
/** Every render of the delete confirm's modal, with its `open` and its rows. */
const mockConfirmModalRenders: { open: boolean; rowIds: string }[] = [];
let mockSorts: { id: string }[] = [];

// `lodash-es` maps to a CommonJS lodash in Jest; the row only dedupes its (here empty) columns.
jest.mock('lodash-es', () => ({
  ...jest.requireActual('lodash-es'),
  uniqBy: <T,>(items: T[]) => items,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      mockTranslated.push(key);
      return key;
    },
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabaseViewLayout: () => 0,
  useReadOnly: () => false,
  useRowData: () => undefined,
  useSortsSelector: () => mockSorts,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useClearSortingDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => jest.fn(() => Promise.resolve()),
}));

jest.mock('../HoverControls.hooks', () => ({
  useHoverControlsActions: () => ({
    addAboveLoading: false,
    addBelowLoading: false,
    duplicateLoading: false,
    onAddRowAbove: jest.fn(),
    onAddRowBelow: jest.fn(),
    onDuplicateRow: jest.fn(),
  }),
  useHoverControlsDisplay: () => ({ ref: jest.fn() }),
}));

jest.mock('@/components/_shared/modal/ConfirmModal', () => ({
  ConfirmModal: ({ open, description }: { open: boolean; description: string }) => {
    mockConfirmModalRenders.push({ open, rowIds: String(description) });
    return open ? <div role='dialog'>{description}</div> : null;
  },
}));

// The row's cells are out of scope: the row renders no column.
jest.mock('@/components/database/components/grid/grid-column/GridVirtualColumn', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-row/useGridRowDraggable', () => ({
  useGridRowDraggable: () => undefined,
}));

/** The keys only an open row menu translates. */
const ROW_MENU_KEYS = ['grid.row.insertRecordAbove', 'grid.row.insertRecordBelow', 'grid.row.duplicate'];
/** The keys only an open confirm translates. */
const CONFIRM_KEYS = ['grid.row.deleteRowPrompt', 'grid.sort.sortsActive', 'grid.sort.removeSorting'];
const ROW_COUNT = 18;

class NoopResizeObserver {
  observe() {
    return undefined;
  }

  unobserve() {
    return undefined;
  }

  disconnect() {
    return undefined;
  }
}

function Providers({ children }: { children: ReactNode }) {
  const store = createGridInteractionStore();
  const gridContext = {
    rows: [],
    setRows: () => undefined,
    setActivePropertyId: () => undefined,
    rowResizeStore: createGridRowResizeStore(),
    remainingRowCount: 0,
    loadMoreRows: () => undefined,
    revealCreatedRow: () => undefined,
    showStickyHeader: false,
    setShowStickyHeader: () => undefined,
    isGrouped: false,
  } as GridContextType;
  const dragContext = {
    registerRow: () => () => undefined,
    rowInstanceId: Symbol('rows'),
  } as unknown as GridDragContextValue;

  return (
    <GridInteractionContext.Provider
      value={{
        historyScopeId: 'grid',
        restoreHistoryFocus: () => undefined,
        setActiveCell: store.setActiveCell,
        setHoverRowKey: store.setHoverRowKey,
        store,
      }}
    >
      <GridContext.Provider value={gridContext}>
        <GridDragContext.Provider value={dragContext}>{children}</GridDragContext.Provider>
      </GridContext.Provider>
    </GridInteractionContext.Provider>
  );
}

function renderGrid() {
  return render(
    <Providers>
      {Array.from({ length: ROW_COUNT }, (_, index) => (
        <GridVirtualRow
          key={index}
          rowIndex={index + 1}
          rowData={{ type: RenderRowType.Row, rowId: `row-${index + 1}` }}
          columns={[]}
          columnItems={[]}
          totalSize={0}
        />
      ))}
    </Providers>
  );
}

function translatedAny(keys: string[]) {
  return mockTranslated.filter((key) => keys.includes(key));
}

function rowMenuTrigger(rowId: string) {
  return within(screen.getByTestId(`grid-row-${rowId}`).parentElement as HTMLElement).getByTestId(
    'row-accessory-button'
  );
}

describe('Grid rows mount their menu and dialogs on demand (W8)', () => {
  const originalResizeObserver = global.ResizeObserver;

  beforeAll(() => {
    global.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    mockTranslated.length = 0;
    mockConfirmModalRenders.length = 0;
    mockSorts = [];
  });

  it('mounts 0 dialogs and 0 row menus for an 18-row grid, and closed menus translate nothing', () => {
    renderGrid();

    expect(screen.getAllByTestId('row-accessory-button')).toHaveLength(ROW_COUNT);
    // No delete confirm, no clear-sorting confirm, no menu.
    expect(mockConfirmModalRenders).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(translatedAny([...ROW_MENU_KEYS, ...CONFIRM_KEYS])).toEqual([]);
  });

  it('mounts the menu of one row when it opens, and its delete confirm only once asked', async () => {
    renderGrid();
    fireEvent.click(rowMenuTrigger('row-3'), { button: 0, ctrlKey: false });

    const menu = await screen.findByRole('menu');

    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
    // One open menu translated its items once per render; the 17 closed ones nothing.
    expect(translatedAny(ROW_MENU_KEYS).length).toBeGreaterThan(0);
    expect(translatedAny(ROW_MENU_KEYS).length % ROW_MENU_KEYS.length).toBe(0);
    expect(mockConfirmModalRenders).toHaveLength(0);

    fireEvent.click(within(menu).getByTestId('row-menu-delete'));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('dialog').textContent).toBe('grid.row.deleteRowPrompt');
    expect(mockConfirmModalRenders.every((render) => render.open)).toBe(true);
    expect(mockConfirmModalRenders.length).toBeGreaterThan(0);
  });

  it('unmounts the menu when it closes and mounts it again on the next open', async () => {
    renderGrid();
    fireEvent.click(rowMenuTrigger('row-5'), { button: 0, ctrlKey: false });
    await screen.findByRole('menu');

    act(() => {
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });
    });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByTestId('row-menu-insert-above')).toBeNull();

    fireEvent.click(rowMenuTrigger('row-5'), { button: 0, ctrlKey: false });
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem')).toHaveLength(4);
  });

  it('mounts the clear-sorting confirm only when a sorted grid asks for it', async () => {
    mockSorts = [{ id: 'sort-1' }];
    renderGrid();
    expect(translatedAny(CONFIRM_KEYS)).toEqual([]);

    fireEvent.click(rowMenuTrigger('row-2'), { button: 0, ctrlKey: false });
    fireEvent.click(within(await screen.findByRole('menu')).getByTestId('row-menu-insert-above'));

    await waitFor(() => expect(translatedAny(['grid.sort.removeSorting'])).not.toEqual([]));
    expect(screen.getByText('grid.sort.removeSorting')).toBeTruthy();
    expect(mockConfirmModalRenders).toHaveLength(0);
  });
});
