// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { type VirtualItem } from '@tanstack/react-virtual';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, type GridGrouping } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useHoverControlsDisplay } from '@/components/database/components/grid/controls/HoverControls.hooks';
import {
  GridDragContext,
  type GridDragContextValue,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { GridColumnType, type RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRowType } from '@/components/database/components/grid/grid-row';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { GridProvider } from '@/components/database/grid/GridProvider';
import { useIsGridRowActive } from '@/components/database/grid/useGridContext';
import { AFConfigContext } from '@/components/main/app.hooks';

import GridVirtualizer from '../GridVirtualizer';

// The real grid, rows, cells and TanStack windows; only jsdom's missing
// geometry is supplied. Hooks count renders: only a row reads whether it has
// the active cell, only a header cell reads the row context, and only a row's
// hover controls read their display. The group-header, new-row and load-more
// rows count their renders through `countDefaultExportRenders`, which keeps
// them memoized exactly as they are.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('preact', () => jest.requireActual(require.resolve('preact').replace('preact.module.js', 'preact.js')));
jest.mock('preact/hooks', () => jest.requireActual(require.resolve('preact/hooks').replace('hooks.module.js', 'hooks.js')));
jest.mock('preact/compat', () => jest.requireActual(require.resolve('preact/compat').replace('compat.module.js', 'compat.js')));
jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => true,
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@/components/database/grid/useGridContext', () => {
  const actual = jest.requireActual('@/components/database/grid/useGridContext');

  return { ...actual, useIsGridRowActive: jest.fn(actual.useIsGridRowActive) };
});
jest.mock('@/components/database/components/grid/grid-row/GridRowContext', () => {
  const actual = jest.requireActual('@/components/database/components/grid/grid-row/GridRowContext');

  return { ...actual, useGridRowContext: jest.fn(actual.useGridRowContext) };
});
jest.mock('@/components/database/components/grid/controls/HoverControls.hooks', () => {
  const actual = jest.requireActual('@/components/database/components/grid/controls/HoverControls.hooks');

  return { ...actual, useHoverControlsDisplay: jest.fn(actual.useHoverControlsDisplay) };
});
jest.mock('@/components/database/components/grid/grid-group/GridGroupHeader', () =>
  jest
    .requireActual('./renderCounter')
    .countDefaultExportRenders(jest.requireActual('@/components/database/components/grid/grid-group/GridGroupHeader'))
);
jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () =>
  jest
    .requireActual('./renderCounter')
    .countDefaultExportRenders(jest.requireActual('@/components/database/components/grid/grid-row/GridNewRow'))
);
jest.mock('@/components/database/components/grid/grid-row/GridLoadMoreRow', () =>
  jest
    .requireActual('./renderCounter')
    .countDefaultExportRenders(jest.requireActual('@/components/database/components/grid/grid-row/GridLoadMoreRow'))
);

const rowRenders = useIsGridRowActive as jest.Mock;
const headerCellRenders = useGridRowContext as jest.Mock;
const hoverControlsRenders = useHoverControlsDisplay as jest.Mock;
const renderCount = (path: string) => (jest.requireMock(path) as { renders: jest.Mock }).renders;
const groupHeaderRenders = renderCount('@/components/database/components/grid/grid-group/GridGroupHeader');
const newRowRenders = renderCount('@/components/database/components/grid/grid-row/GridNewRow');
const loadMoreRowRenders = renderCount('@/components/database/components/grid/grid-row/GridLoadMoreRow');

const ROW_COUNT = 12;
const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 600;
const VIEWPORT_WIDTH = 480;
const COLUMN_WIDTH = 100;
// With the default overscan of 5, all 8 columns stay rendered wherever the
// 480px window is: scrolling only moves the visible range.
const COLUMN_COUNT = 8;
// 30 columns outgrow the overscan: scrolling moves the rendered columns too.
const WIDE_COLUMN_COUNT = 30;
// A grouped grid: 3 groups of 3 rows, all inside the rendered rows.
const GROUP_COUNT = 3;
const GROUP_SIZE = 3;
// An embedded grid with more rows than it first shows (25), so it has a load-more row.
const EMBEDDED_ROW_COUNT = 27;
// Rows the grid's scroll container is tall enough to show.
let scrollerRowCount = ROW_COUNT;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return (scrollerRowCount + 2) * ROW_HEIGHT;
  return VIEWPORT_HEIGHT;
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  };
  global.IntersectionObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  } as unknown as typeof IntersectionObserver;

  const geometry: Record<string, PropertyDescriptor> = {
    offsetWidth: { get() { return VIEWPORT_WIDTH; } },
    clientWidth: { get() { return VIEWPORT_WIDTH; } },
    scrollWidth: { get() { return VIEWPORT_WIDTH; } },
    offsetHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    clientHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    scrollHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    scrollTo: { value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    } },
    scroll: { value(this: HTMLElement, options: ScrollToOptions) { this.scrollTo(options); } },
  };

  for (const [name, descriptor] of Object.entries(geometry)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  const layout = {
    getBoundingClientRect(this: HTMLElement) {
      const height = elementHeight(this);

      return { x: 0, y: 0, left: 0, top: 0, width: VIEWPORT_WIDTH, height, right: VIEWPORT_WIDTH, bottom: height,
        toJSON: () => ({}) };
    },
  };

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout.getBoundingClientRect);
  // The page's overlay, which the grid's sticky header row portals into.
  const stickyHeaderOverlay = document.createElement('div');

  stickyHeaderOverlay.className = 'sticky-header-overlay';
  document.body.appendChild(stickyHeaderOverlay);
  rowRenders.mockClear();
  headerCellRenders.mockClear();
  hoverControlsRenders.mockClear();
  groupHeaderRenders.mockClear();
  newRowRenders.mockClear();
  loadMoreRowRenders.mockClear();
});

afterEach(async () => {
  await act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.querySelectorAll('.sticky-header-overlay').forEach((overlay) => overlay.remove());
  scrollerRowCount = ROW_COUNT;
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

function fixture({
  columnCount = COLUMN_COUNT,
  rowCount = ROW_COUNT,
  readOnly = true,
  grouped = false,
  documentBlock = false,
} = {}) {
  const databaseDoc = new Y.Doc({ guid: 'grid-rerender-database' }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const rowMap: Record<string, YDoc> = {};
  const rowOrders = Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index + 1}`, height: ROW_HEIGHT }));
  const columns: RenderColumn[] = Array.from({ length: columnCount }, (_, index) => ({
    fieldId: `field-${index}`,
    fieldType: FieldType.RichText,
    isPrimary: index === 0,
    type: GridColumnType.Field,
    width: COLUMN_WIDTH,
  }));

  for (const { fieldId, fieldType, isPrimary } of columns) {
    const field = new Y.Map();

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, fieldId);
    field.set(YjsDatabaseKey.type, fieldType);
    field.set(YjsDatabaseKey.is_primary, Boolean(isPrimary));
    field.set(YjsDatabaseKey.type_option, new Y.Map());
    fields.set(fieldId as string, field);
  }

  for (const { id } of rowOrders) {
    rowMap[id] = createRowDoc(
      id,
      'grid-rerender-database',
      Object.fromEntries(columns.map(({ fieldId }) => [fieldId, createCell(FieldType.RichText, `${fieldId} ${id}`)]))
    );
  }

  view.set(YjsDatabaseKey.id, 'grid-rerender-view');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowOrders));
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  views.set('grid-rerender-view', view);
  database.set(YjsDatabaseKey.id, 'grid-rerender-database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    readOnly,
    databaseDoc,
    activeViewId: 'grid-rerender-view',
    databasePageId: 'grid-rerender-view',
    workspaceId: 'grid-rerender-workspace',
    rowMap,
    seedsReady: true,
    blobPrefetchComplete: true,
    isDocumentBlock: documentBlock,
  };
  const groups = Array.from({ length: GROUP_COUNT }, (_, index) => ({
    id: `group-${index}`,
    label: `Group ${index}`,
    rows: rowOrders.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE),
    isDefault: false,
    visible: true,
    hidden: false,
    automaticallyHidden: false,
    collapsed: false,
  }));
  const grouping: GridGrouping = grouped
    ? {
        rowOrders,
        isGrouped: true,
        groupId: 'grid-rerender-group-config',
        fieldId: 'field-1',
        fieldName: 'field-1',
        fieldType: FieldType.SingleSelect,
        ready: true,
        activeGroupIds: groups.map(({ id }) => id),
        groups,
        visibleGroups: groups,
        hideEmptyGroups: false,
      }
    : { rowOrders, isGrouped: false, ready: true, activeGroupIds: [], groups: [], visibleGroups: [], hideEmptyGroups: false };
  const destroy = () => {
    databaseDoc.destroy();
    Object.values(rowMap).forEach((row) => row.destroy());
  };

  return { columns, context, grouping, destroy };
}

function Providers({ data, children }: { data: ReturnType<typeof fixture>; children: ReactNode }) {
  return (
    <AFConfigContext.Provider value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <DatabaseContext.Provider value={data.context}>
        <div className='appflowy-scroll-container' data-testid='grid-rerender-viewport'>
          <GridProvider grouping={data.grouping}>{children}</GridProvider>
        </div>
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

test('scrolling sideways within the rendered columns re-renders neither rows nor header cells', async () => {
  const data = fixture();
  const commits = jest.fn();
  const rendered = render(
    <Providers data={data}>
      <Profiler id='grid' onRender={commits}>
        <GridVirtualizer columns={data.columns} />
      </Profiler>
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByText('field-7 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const scroller = rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-scrollbar"]');

    expect(scroller).not.toBeNull();
    expect(screen.getAllByText(/^field-\d row-1$/)).toHaveLength(COLUMN_COUNT);
    // Both header rows are mounted: the grid's own and the sticky one in the page overlay.
    expect(
      rendered.container.querySelectorAll('[data-parity-id="dash-widget-grid-header"] [data-column-id]')
    ).toHaveLength(COLUMN_COUNT);
    expect(document.querySelectorAll('.sticky-header-overlay [data-column-id]')).toHaveLength(COLUMN_COUNT);
    expect(headerCellRenders.mock.calls.length).toBeGreaterThanOrEqual(2 * COLUMN_COUNT);
    // A read-only grid gives neither header row a field menu.
    expect(document.querySelectorAll('[data-parity-id="dash-widget-grid-header"] [aria-haspopup="menu"]')).toHaveLength(0);
    commits.mockClear();
    rowRenders.mockClear();
    headerCellRenders.mockClear();

    // The visible columns move from 0-3 to 1-6; overscan already rendered all 8.
    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 250 } });
    await act(() => jest.advanceTimersByTime(200));

    // The grid takes the new range (and the end of scrolling)...
    expect(commits).toHaveBeenCalled();
    // ...without re-rendering a row or a header cell, each with its menus.
    expect(rowRenders).not.toHaveBeenCalled();
    expect(headerCellRenders).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^field-\d row-1$/)).toHaveLength(COLUMN_COUNT);
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('scrolling sideways past the overscan mounts the entering columns without re-rendering hover controls', async () => {
  const data = fixture({ columnCount: WIDE_COLUMN_COUNT, readOnly: false });
  const rendered = render(
    <Providers data={data}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByText('field-8 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const scroller = rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-scrollbar"]');

    expect(scroller).not.toBeNull();
    // The counter sees the hover controls render (each row's mounted).
    expect(hoverControlsRenders.mock.calls.length).toBeGreaterThanOrEqual(ROW_COUNT);
    // The rendered columns move from 0-8 to 4-18...
    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 1000 } });
    await act(() => jest.advanceTimersByTime(200));
    expect(screen.getByText('field-18 row-1')).toBeInTheDocument();
    rowRenders.mockClear();
    hoverControlsRenders.mockClear();

    // ...then to 9-23, as many columns as before.
    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 1500 } });
    await act(() => jest.advanceTimersByTime(200));

    // The rows re-render to mount the entering columns and drop the leaving ones...
    expect(rowRenders).toHaveBeenCalled();
    expect(screen.getByText('field-23 row-1')).toBeInTheDocument();
    expect(screen.queryByText('field-8 row-1')).not.toBeInTheDocument();
    // ...while their hover controls, whose props did not change, keep their render.
    expect(screen.getAllByTestId('row-accessory-button')).toHaveLength(ROW_COUNT);
    expect(hoverControlsRenders).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('pinning and unpinning the sticky header re-renders no row and keeps every header cell mounted', async () => {
  const data = fixture({ readOnly: false });
  // The grid starts 100px down the page; its header pins under the 48px app bar
  // once the page scrolls past 52px.
  const pageLayout = {
    getBoundingClientRect(this: HTMLElement) {
      const height = elementHeight(this);
      const viewport = this.closest<HTMLElement>('[data-testid="grid-rerender-viewport"]');
      const isGrid = Boolean(viewport) && this !== viewport && this.classList.contains('appflowy-custom-scroller');
      const top = isGrid ? 100 - (viewport?.scrollTop ?? 0) : 0;

      return { x: 0, y: top, left: 0, top, width: VIEWPORT_WIDTH, height, right: VIEWPORT_WIDTH, bottom: top + height,
        toJSON: () => ({}) };
    },
  };

  jest.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(pageLayout.getBoundingClientRect);
  const rendered = render(
    <Providers data={data}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByText('field-7 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const viewport = screen.getByTestId('grid-rerender-viewport');
    // Queried afresh each time, so a remounted header row is seen too.
    const gridHeader = () => rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-header"]');
    const stickyHeader = () =>
      document.querySelector<HTMLElement>('.sticky-header-overlay [data-parity-id="dash-widget-grid-header"]');
    const stickyContainer = () => document.querySelector<HTMLElement>('.sticky-header-overlay .grid-sticky-header');
    const headerCell = (row: HTMLElement | null) =>
      row?.querySelector<HTMLElement>('[data-testid="grid-field-header-field-1"]') ?? null;
    // Header cells of a row that hold a field menu (its menus carry aria-haspopup).
    const fieldMenus = (row: HTMLElement | null) =>
      Array.from(row?.querySelectorAll('[data-column-id]') ?? []).filter((cell) =>
        cell.querySelector('[aria-haspopup="menu"]')
      ).length;
    const gridCellBefore = headerCell(gridHeader());
    const stickyCellBefore = headerCell(stickyHeader());

    // The grid's own header is in view and holds the field menus.
    expect(gridCellBefore).not.toBeNull();
    expect(stickyCellBefore).not.toBeNull();
    expect(stickyContainer()?.style.opacity).toBe('0');
    expect(fieldMenus(gridHeader())).toBe(COLUMN_COUNT);
    expect(fieldMenus(stickyHeader())).toBe(0);
    rowRenders.mockClear();
    hoverControlsRenders.mockClear();

    // Pinned: the sticky header shows and takes the field menus...
    fireEvent.scroll(viewport, { target: { scrollTop: 60 } });
    await act(() => jest.advanceTimersByTime(200));
    expect(stickyContainer()?.style.opacity).toBe('1');
    expect(fieldMenus(gridHeader())).toBe(0);
    expect(fieldMenus(stickyHeader())).toBe(COLUMN_COUNT);

    // A click on the covered header (still focused, say, from before the pin) opens nothing.
    fireEvent.click(headerCell(gridHeader()) as HTMLElement);
    await act(() => jest.advanceTimersByTime(200));
    expect(document.querySelector('[role="menu"]')).toBeNull();

    // ...and unpinned: the menus move back, and none opens by itself.
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    await act(() => jest.advanceTimersByTime(200));
    expect(stickyContainer()?.style.opacity).toBe('0');
    expect(fieldMenus(gridHeader())).toBe(COLUMN_COUNT);
    expect(fieldMenus(stickyHeader())).toBe(0);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    // Neither flip re-rendered a row or its hover controls, or remounted a header cell's content.
    expect(rowRenders).not.toHaveBeenCalled();
    expect(hoverControlsRenders).not.toHaveBeenCalled();
    expect(headerCell(gridHeader())).toBe(gridCellBefore);
    expect(headerCell(stickyHeader())).toBe(stickyCellBefore);

    // The header in view still opens its menu.
    fireEvent.click(headerCell(gridHeader()) as HTMLElement);
    await act(() => jest.advanceTimersByTime(200));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('scrolling a grouped grid sideways re-renders no group header, new-row row or hover controls', async () => {
  const data = fixture({ readOnly: false, grouped: true });
  const commits = jest.fn();
  const rendered = render(
    <Providers data={data}>
      <Profiler id='grid' onRender={commits}>
        <GridVirtualizer columns={data.columns} />
      </Profiler>
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByTestId(`grid-group-header-group-${GROUP_COUNT - 1}`)).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const scroller = rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-scrollbar"]');

    expect(scroller).not.toBeNull();
    expect(screen.getAllByTestId('grid-new-row')).toHaveLength(GROUP_COUNT);
    // The counters see every group header and new-row row render.
    expect(groupHeaderRenders.mock.calls.length).toBeGreaterThanOrEqual(GROUP_COUNT);
    expect(newRowRenders.mock.calls.length).toBeGreaterThanOrEqual(GROUP_COUNT);
    commits.mockClear();
    rowRenders.mockClear();
    hoverControlsRenders.mockClear();
    groupHeaderRenders.mockClear();
    newRowRenders.mockClear();

    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 250 } });
    await act(() => jest.advanceTimersByTime(200));

    expect(commits).toHaveBeenCalled();
    expect(rowRenders).not.toHaveBeenCalled();
    expect(hoverControlsRenders).not.toHaveBeenCalled();
    expect(groupHeaderRenders).not.toHaveBeenCalled();
    expect(newRowRenders).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('scrolling an embedded grid sideways re-renders neither its load-more row nor its new-row row', async () => {
  // Tall enough to show every row of the embedded grid, its load-more and new-row rows.
  scrollerRowCount = EMBEDDED_ROW_COUNT + 4;
  const data = fixture({ readOnly: false, rowCount: EMBEDDED_ROW_COUNT, documentBlock: true });
  const commits = jest.fn();
  const rendered = render(
    <Providers data={data}>
      <Profiler id='grid' onRender={commits}>
        <GridVirtualizer columns={data.columns} />
      </Profiler>
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByTestId('grid-load-more-row')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const scroller = rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-scrollbar"]');

    expect(scroller).not.toBeNull();
    expect(screen.getByTestId('grid-load-more-row')).toHaveTextContent(`(${EMBEDDED_ROW_COUNT - 25})`);
    expect(screen.getByTestId('grid-new-row')).toBeInTheDocument();
    expect(loadMoreRowRenders).toHaveBeenCalled();
    expect(newRowRenders).toHaveBeenCalled();
    commits.mockClear();
    rowRenders.mockClear();
    loadMoreRowRenders.mockClear();
    newRowRenders.mockClear();

    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 250 } });
    await act(() => jest.advanceTimersByTime(200));

    expect(commits).toHaveBeenCalled();
    expect(rowRenders).not.toHaveBeenCalled();
    expect(loadMoreRowRenders).not.toHaveBeenCalled();
    expect(newRowRenders).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('a header row that re-renders keeps its header cells, when only the column array is new', async () => {
  const data = fixture();
  const items: VirtualItem[] = data.columns.map((column, index) => ({
    key: column.fieldId as string,
    index,
    start: 96 + index * COLUMN_WIDTH,
    end: 96 + (index + 1) * COLUMN_WIDTH,
    size: COLUMN_WIDTH,
    lane: 0,
  }));
  const dragContext: GridDragContextValue = {
    getRows: () => [],
    getColumns: () => data.columns,
    registerRow: () => () => undefined,
    registerColumn: () => () => undefined,
    reorderRow: () => undefined,
    reorderColumn: () => undefined,
    rowInstanceId: Symbol('rows'),
    columnInstanceId: Symbol('columns'),
  };
  const headerRow = Object.freeze({ key: 'header', type: RenderRowType.Header });
  const renderRow = (columnItems: VirtualItem[]) => (
    <Providers data={data}>
      <GridDragContext.Provider value={dragContext}>
        <GridVirtualRow
          rowIndex={0}
          rowData={headerRow}
          columns={data.columns}
          columnItems={columnItems}
          totalSize={96 * 2 + COLUMN_COUNT * COLUMN_WIDTH}
        />
      </GridDragContext.Provider>
    </Providers>
  );
  const rendered = render(renderRow([...items]));

  try {
    await waitFor(() => expect(screen.getByText('field-7')).toBeInTheDocument());
    rowRenders.mockClear();
    headerCellRenders.mockClear();

    // The same items in a new array: the row re-renders, its cells have nothing new.
    rendered.rerender(renderRow([...items]));

    expect(rowRenders).toHaveBeenCalledTimes(1);
    expect(headerCellRenders).not.toHaveBeenCalled();
    expect(screen.getByText('field-7')).toBeInTheDocument();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});
