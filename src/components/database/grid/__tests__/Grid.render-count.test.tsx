import { act, render, screen } from '@testing-library/react';
import { type Context, useState } from 'react';
import * as Y from 'yjs';

import { DatabaseContext } from '@/application/database-yjs';
import type { DatabaseContextState, GridGrouping, Row, RowOrdersHydration } from '@/application/database-yjs';
import type { YDoc } from '@/application/types';
import type { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import { Grid } from '@/components/database/grid/Grid';
import { useGridOptions } from '@/components/database/grid/useGridContext';

const mockRowRenders = new Map<string, number>();
/** Renders of `GridVirtualizer`: each one calls `useGridVirtualizer` once. */
const mockVirtualizerRenders = { count: 0 };
const mockColumns: RenderColumn[] = [];
const mockGridOptions: ReturnType<typeof useGridOptions>[] = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? '').replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name])),
  }),
}));

// The grouping comes from the test, as the selector publishes it.
jest.mock('@/components/database/grid/GridGroupingContext', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const MockGroupingContext = createContext<GridGrouping | undefined>(undefined);

  return {
    MockGroupingContext,
    useGridGrouping: () => useContext(MockGroupingContext),
  };
});

// The columns are memoized by the real hook: one stable array here.
jest.mock('@/components/database/components/grid/grid-column', () => ({
  useRenderFields: () => ({ fields: mockColumns }),
}));

// Every render row is mounted, and the item arrays keep their identity as the
// real virtualizer's do while nothing is measured.
jest.mock('@/components/database/components/grid/grid-table/useGridVirtualizer', () => {
  const items = new WeakMap<object, { index: number; key: number; start: number; size: number }[]>();
  const noColumns: unknown[] = [];

  return {
    PADDING_INLINE: 0,
    useGridVirtualizer: ({ data }: { data: RenderRow[] }) => {
      mockVirtualizerRenders.count += 1;
      if (!items.has(data)) {
        items.set(
          data,
          data.map((_row, index) => ({ index, key: index, start: index * 36, size: 36 }))
        );
      }

      return {
        parentRef: { current: null },
        scrollMarginTop: 0,
        isReady: true,
        virtualizer: {
          getVirtualItems: () => items.get(data),
          getTotalSize: () => data.length * 36,
          measureElement: () => undefined,
          resizeItem: () => undefined,
          options: { scrollMargin: 0 },
          scrollElement: null,
        },
        columnVirtualizer: {
          getVirtualItems: () => noColumns,
          getTotalSize: () => 0,
          measure: () => undefined,
        },
      };
    },
  };
});
jest.mock('@/components/database/components/grid/grid-table/useGridDnd', () => ({ useGridDnd: () => ({}) }));
jest.mock('@/components/database/components/grid/grid-column/useColumnResize', () => {
  const handleResizeStart = () => undefined;

  return { useColumnResize: () => ({ handleResizeStart, isResizing: false }) };
});
// Memoized like the real row, so its renders show which props changed.
jest.mock('@/components/database/components/grid/grid-row/GridVirtualRow', () => {
  const { memo } = jest.requireActual<typeof import('react')>('react');
  const { useGridOptions: useOptions } = jest.requireActual<typeof import('@/components/database/grid/useGridContext')>(
    '@/components/database/grid/useGridContext'
  );

  return {
    __esModule: true,
    default: memo(({ rowData }: { rowData: RenderRow }) => {
      const key = rowData.rowId ?? rowData.type;

      mockGridOptions.push(useOptions());
      mockRowRenders.set(key, (mockRowRenders.get(key) ?? 0) + 1);
      return <div data-testid={`grid-row-${key}`} />;
    }),
  };
});
jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-new-row' />,
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

const { MockGroupingContext } = jest.requireMock<{ MockGroupingContext: Context<GridGrouping | undefined> }>(
  '@/components/database/grid/GridGroupingContext'
);

function grouping(rowOrders: Row[], hydrating?: RowOrdersHydration): GridGrouping {
  return {
    isGrouped: false,
    hideEmptyGroups: false,
    ready: true,
    activeGroupIds: [],
    groups: [],
    visibleGroups: [],
    rowOrders,
    hydrating,
  };
}

function renderGrid(initial: GridGrouping, options?: { isDashboardWidget?: boolean }) {
  let publish: (next: GridGrouping) => void = () => undefined;
  const databaseContext: DatabaseContextState = {
    readOnly: true,
    databaseDoc: new Y.Doc() as unknown as YDoc,
    databasePageId: 'view-id',
    activeViewId: 'view-id',
    rowMap: {},
    workspaceId: 'workspace-id',
    isDocumentBlock: true,
    isDashboardWidget: options?.isDashboardWidget,
  };

  function Harness() {
    const [value, setValue] = useState(initial);

    publish = setValue;
    return (
      <MockGroupingContext.Provider value={value}>
        <Grid />
      </MockGroupingContext.Provider>
    );
  }

  render(
    <DatabaseContext.Provider value={databaseContext}>
      <Harness />
    </DatabaseContext.Provider>
  );

  return { publish: (next: GridGrouping) => act(() => publish(next)) };
}

const rendersOf = (key: string) => mockRowRenders.get(key) ?? 0;

describe('Grid re-renders while rows load', () => {
  beforeEach(() => {
    mockRowRenders.clear();
    mockVirtualizerRenders.count = 0;
    mockGridOptions.length = 0;
  });

  it('re-renders neither the virtualized body nor any row for a tick that only moves the progress', () => {
    const rows: Row[] = [
      { id: 'row-1', height: 36 },
      { id: 'row-2', height: 36 },
    ];
    const { publish } = renderGrid(grouping(rows, { ready: 100, total: 5000 }));

    expect(rendersOf('row-1')).toBe(1);
    expect(rendersOf('row-2')).toBe(1);
    expect(rendersOf('header')).toBe(1);
    expect(screen.getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 100/5000');
    const virtualizerRenders = mockVirtualizerRenders.count;

    // The selector publishes a new grouping object with the same rows.
    publish(grouping(rows, { ready: 1280, total: 5000 }));
    publish(grouping(rows, { ready: 2560, total: 5000 }));

    expect(screen.getByTestId('grid-loading-progress').textContent).toBe('Loading rows… 2560/5000');
    expect(screen.getByTestId('database-grid').dataset.loadedRowCount).toBe('2');
    // Only the loading row, which reads the progress itself, rendered again.
    expect(mockVirtualizerRenders.count).toBe(virtualizerRenders);
    expect(rendersOf('row-1')).toBe(1);
    expect(rendersOf('row-2')).toBe(1);
    expect(rendersOf('header')).toBe(1);
  });

  it('renders only the appended rows when more matches arrive', () => {
    const first: Row[] = [
      { id: 'row-1', height: 36 },
      { id: 'row-2', height: 36 },
    ];
    const { publish } = renderGrid(grouping(first, { ready: 100, total: 5000 }));

    publish(grouping([...first, { id: 'row-3', height: 36 }], { ready: 200, total: 5000 }));

    expect(screen.getByTestId('grid-row-row-3')).toBeTruthy();
    expect(rendersOf('row-1')).toBe(1);
    expect(rendersOf('row-2')).toBe(1);
    expect(rendersOf('row-3')).toBe(1);
  });

  it('asks the rows of a dashboard widget for the widget row pitch and header icons', () => {
    renderGrid(grouping([{ id: 'row-1', height: 36 }]), { isDashboardWidget: true });
    expect(mockGridOptions.every((options) => options.rowMeasure === 'row' && options.headerIcons === 'dashboard')).toBe(
      true
    );
    expect(mockGridOptions.length).toBeGreaterThan(0);
  });

  it('keeps the default row measure and header icons for any other host', () => {
    renderGrid(grouping([{ id: 'row-1', height: 36 }]));
    expect(mockGridOptions.every((options) => options.rowMeasure === 'cell' && options.headerIcons === 'field')).toBe(
      true
    );
    expect(mockGridOptions.length).toBeGreaterThan(0);
  });
});
