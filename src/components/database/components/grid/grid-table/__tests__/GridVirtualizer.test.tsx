import { render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, type Row, type RowOrdersHydration } from '@/application/database-yjs';
import { YDoc } from '@/application/types';
import { RenderRowType, useRenderRows } from '@/components/database/components/grid/grid-row';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import {
  createGridRowResizeStore,
  GridContext,
  GridContextType,
  GridHydrationContext,
} from '@/components/database/grid/useGridContext';

import GridVirtualizer from '../GridVirtualizer';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? '').replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name])),
  }),
}));

// Every render row is mounted: layout is out of scope here.
jest.mock('../useGridVirtualizer', () => ({
  PADDING_INLINE: 0,
  useGridVirtualizer: ({ data }: { data: RenderRow[] }) => ({
    parentRef: { current: null },
    scrollMarginTop: 0,
    isReady: true,
    virtualizer: {
      getVirtualItems: () => data.map((_row, index) => ({ index, key: index, start: index * 36, size: 36 })),
      getTotalSize: () => data.length * 36,
      measureElement: () => undefined,
      resizeItem: () => undefined,
      options: { scrollMargin: 0 },
      scrollElement: null,
    },
    columnVirtualizer: {
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measure: () => undefined,
    },
  }),
}));
jest.mock('../useGridDnd', () => ({ useGridDnd: () => ({}) }));
jest.mock('../../grid-column/useColumnResize', () => ({
  useColumnResize: () => ({ handleResizeStart: () => undefined, isResizing: false }),
}));
jest.mock('@/components/database/components/grid/grid-row/GridVirtualRow', () => ({
  __esModule: true,
  default: ({ rowData }: { rowData: RenderRow }) => {
    return rowData.type === RenderRowType.Row ? (
      <div data-testid={`grid-row-${rowData.rowId}`} />
    ) : (
      <div data-testid={`grid-${rowData.type}`} />
    );
  },
}));
jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-new-row' />,
}));
jest.mock('@/components/database/components/grid/grid-row/GridLoadMoreRow', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-load-more-row' />,
}));
jest.mock('@/components/database/components/grid/grid-group/GridGroupHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-table/GridStickyHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar', () => ({
  __esModule: true,
  default: () => null,
}));

const noop = () => undefined;

function GridHarness({ rowOrders, hydrating }: { rowOrders?: Row[]; hydrating?: RowOrdersHydration }) {
  const { rows } = useRenderRows(rowOrders, { hydrating });
  const gridContext: GridContextType = {
    rowOrders,
    rows,
    setRows: noop,
    setActivePropertyId: noop,
    rowResizeStore: createGridRowResizeStore(),
    remainingRowCount: 0,
    loadMoreRows: noop,
    revealCreatedRow: noop,
    showStickyHeader: false,
    setShowStickyHeader: noop,
    isGrouped: false,
  };

  return (
    <GridContext.Provider value={gridContext}>
      <GridHydrationContext.Provider value={hydrating}>
        <GridVirtualizer columns={[]} />
      </GridHydrationContext.Provider>
    </GridContext.Provider>
  );
}

function renderGrid(props: { rowOrders?: Row[]; hydrating?: RowOrdersHydration }) {
  const databaseContext: DatabaseContextState = {
    readOnly: false,
    databaseDoc: new Y.Doc() as unknown as YDoc,
    databasePageId: 'view-id',
    activeViewId: 'view-id',
    rowMap: {},
    workspaceId: 'workspace-id',
    isDocumentBlock: true,
  };

  return render(
    <DatabaseContext.Provider value={databaseContext}>
      <GridHarness {...props} />
    </DatabaseContext.Provider>
  );
}

/** The mounted rows from top to bottom, as test ids. */
function mountedRowOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-index]'))
    .sort((left, right) => Number(left.dataset.index) - Number(right.dataset.index))
    .map((element) => element.querySelector<HTMLElement>('[data-testid]')?.dataset.testid);
}

describe('GridVirtualizer', () => {
  it('renders the matched rows above a loading row that reports the rows read so far', () => {
    const { container } = renderGrid({
      rowOrders: [
        { id: 'row-1', height: 36 },
        { id: 'row-2', height: 36 },
      ],
      hydrating: { ready: 1280, total: 5000 },
    });
    const loadingRow = screen.getByTestId('grid-loading-indicator');

    expect(mountedRowOrder(container)).toEqual([
      'grid-header',
      'grid-row-row-1',
      'grid-row-row-2',
      'grid-loading-indicator',
      'grid-new-row',
    ]);
    expect(within(loadingRow).getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 1280/5000');
    expect(loadingRow.dataset.loadedRowCount).toBe('1280');
    expect(loadingRow.dataset.totalRowCount).toBe('5000');
    expect(screen.queryByTestId('grid-calculate-row')).toBeNull();
  });

  it('shows a partial result without matches as loading rather than as an empty grid', () => {
    const { container } = renderGrid({ rowOrders: [], hydrating: { ready: 100, total: 5000 } });

    expect(mountedRowOrder(container)).toEqual(['grid-header', 'grid-loading-indicator', 'grid-new-row']);
    expect(screen.getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 100/5000');
  });

  it('reports the progress of a sorted view that waits for every row', () => {
    const { container } = renderGrid({ hydrating: { ready: 2500, total: 5000 } });

    expect(mountedRowOrder(container)).toEqual(['grid-header', 'grid-loading-indicator', 'grid-new-row']);
    expect(screen.getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 2500/5000');
  });

  it('keeps the plain loading dots before any row was read', () => {
    const { container } = renderGrid({});

    expect(mountedRowOrder(container)).toEqual(['grid-header', 'grid-loading-indicator', 'grid-new-row']);
    expect(screen.queryByTestId('grid-loading-progress')).toBeNull();
  });

  it('drops the loading row once every row was read', () => {
    const { container } = renderGrid({ rowOrders: [{ id: 'row-1', height: 36 }] });

    expect(mountedRowOrder(container)).toEqual(['grid-header', 'grid-row-row-1', 'grid-new-row', 'grid-calculate-row']);
    expect(screen.queryByTestId('grid-loading-indicator')).toBeNull();
  });
});
