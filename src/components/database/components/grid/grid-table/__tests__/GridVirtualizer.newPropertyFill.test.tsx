// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, type GridGrouping } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { GridColumnType, type RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { GridProvider } from '@/components/database/grid/GridProvider';
import { useIsGridRowActive } from '@/components/database/grid/useGridContext';
import { AFConfigContext } from '@/components/main/app.hooks';

import GridVirtualizer from '../GridVirtualizer';

// The real grid, rows, cells and TanStack windows, as in GridVirtualizer.rerenders:
// only jsdom's missing geometry is supplied, here with a grid width the tests
// change and a ResizeObserver they fire, as the browser does when the window,
// the sidebar or a side peek resizes the grid.
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

const rowRenders = useIsGridRowActive as jest.Mock;

const ROW_COUNT = 3;
const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 600;
const COLUMN_WIDTH = 100;
const NEW_PROPERTY_WIDTH = 150;
// A page grid's inline padding on each side (PADDING_INLINE).
const PAGE_PADDING = 96;
/** The New property column's width in a page grid of three columns: what the columns and paddings leave. */
const fill = (width: number) => `${width - 2 * PAGE_PADDING - 3 * COLUMN_WIDTH}px`;
let gridWidth = 1200;
let scrollerRowCount = ROW_COUNT;
const resizeObservers = new Set<TestResizeObserver>();
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

class TestResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }

  resize(target: Element, width: number, height: number) {
    if (!this.targets.has(target)) return;
    const box = [{ inlineSize: width, blockSize: height }];
    const contentRect = { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };

    this.callback(
      [{ target, contentRect, borderBoxSize: box, contentBoxSize: box, devicePixelContentBoxSize: box } as ResizeObserverEntry],
      this
    );
  }
}

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return (scrollerRowCount + 2) * ROW_HEIGHT;
  return VIEWPORT_HEIGHT;
}

beforeAll(() => {
  global.ResizeObserver = TestResizeObserver;
  global.IntersectionObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  } as unknown as typeof IntersectionObserver;

  const geometry: Record<string, PropertyDescriptor> = {
    offsetWidth: { get() { return gridWidth; } },
    clientWidth: { get() { return gridWidth; } },
    scrollWidth: { get() { return gridWidth; } },
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

      return { x: 0, y: 0, left: 0, top: 0, width: gridWidth, height, right: gridWidth, bottom: height,
        toJSON: () => ({}) };
    },
  };

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout.getBoundingClientRect);
  // The page's overlay, which the grid's sticky header row portals into.
  const stickyHeaderOverlay = document.createElement('div');

  stickyHeaderOverlay.className = 'sticky-header-overlay';
  document.body.appendChild(stickyHeaderOverlay);
  rowRenders.mockClear();
});

afterEach(async () => {
  await act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.querySelectorAll('.sticky-header-overlay').forEach((overlay) => overlay.remove());
  gridWidth = 1200;
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

/** An editable grid: its field columns, then the New property column, as `useRenderFields` lists them. */
function fixture({
  columnCount = 3,
  documentBlock = false,
  paddingStart,
  paddingEnd,
}: { columnCount?: number; documentBlock?: boolean; paddingStart?: number; paddingEnd?: number } = {}) {
  const databaseDoc = new Y.Doc({ guid: 'grid-fill-database' }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const rowMap: Record<string, YDoc> = {};
  const rowOrders = Array.from({ length: ROW_COUNT }, (_, index) => ({ id: `row-${index + 1}`, height: ROW_HEIGHT }));
  const fieldColumns: RenderColumn[] = Array.from({ length: columnCount }, (_, index) => ({
    fieldId: `field-${index}`,
    fieldType: FieldType.RichText,
    isPrimary: index === 0,
    type: GridColumnType.Field,
    width: COLUMN_WIDTH,
  }));

  for (const { fieldId, fieldType, isPrimary } of fieldColumns) {
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
      'grid-fill-database',
      Object.fromEntries(fieldColumns.map(({ fieldId }) => [fieldId, createCell(FieldType.RichText, `${fieldId} ${id}`)]))
    );
  }

  view.set(YjsDatabaseKey.id, 'grid-fill-view');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowOrders));
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  views.set('grid-fill-view', view);
  database.set(YjsDatabaseKey.id, 'grid-fill-database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    activeViewId: 'grid-fill-view',
    databasePageId: 'grid-fill-view',
    workspaceId: 'grid-fill-workspace',
    rowMap,
    seedsReady: true,
    blobPrefetchComplete: true,
    isDocumentBlock: documentBlock,
    paddingStart,
    paddingEnd,
  };
  const grouping: GridGrouping = {
    rowOrders, isGrouped: false, ready: true, activeGroupIds: [], groups: [], visibleGroups: [], hideEmptyGroups: false,
  };
  const columns: RenderColumn[] = [...fieldColumns, { type: GridColumnType.NewProperty, width: NEW_PROPERTY_WIDTH }];
  const destroy = () => {
    databaseDoc.destroy();
    Object.values(rowMap).forEach((row) => row.destroy());
  };

  return { columns, context, grouping, destroy };
}

function Providers({ context, grouping, children }: {
  context: DatabaseContextState;
  grouping: GridGrouping;
  children: ReactNode;
}) {
  return (
    <AFConfigContext.Provider value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <DatabaseContext.Provider value={context}>
        <div className='appflowy-scroll-container'>
          <GridProvider grouping={grouping}>{children}</GridProvider>
        </div>
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

const gridScroller = () => document.querySelector('[data-parity-id="dash-widget-grid-scrollbar"]') as HTMLElement;
/** The width of the New property column in each header row: the grid's own, then the sticky one (page grids). */
const newPropertyWidths = () =>
  screen
    .queryAllByTestId('grid-new-property-button')
    .map((button) => button.closest<HTMLElement>('.grid-row-cell')?.style.width);
/** The grid's total width, as its sticky horizontal scrollbar spans it. */
const totalWidth = () =>
  document.querySelector<HTMLElement>('.grid-sticky-overlay .appflowy-visible-scrollbar > div')?.style.width;

/** The browser resizes the grid: every observer of its scroll element hears of the new width. */
function resizeGrid(width: number) {
  gridWidth = width;
  const scroller = gridScroller();

  act(() => resizeObservers.forEach((observer) => observer.resize(scroller, width, elementHeight(scroller))));
}

test('the New property column fills the rest of the grid and follows the grid as it resizes', async () => {
  const data = fixture();
  const rendered = render(
    <Providers context={data.context} grouping={data.grouping}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByText('field-2 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    expect(newPropertyWidths()).toEqual([fill(1200), fill(1200)]);
    expect(totalWidth()).toBe('1200px');

    // The window narrows, or a sidebar or side peek opens: no overflow.
    resizeGrid(900);
    expect(newPropertyWidths()).toEqual([fill(900), fill(900)]);
    expect(totalWidth()).toBe('900px');

    // Too narrow to fill: the column keeps its own width and the grid scrolls.
    resizeGrid(600);
    expect(newPropertyWidths()).toEqual([`${NEW_PROPERTY_WIDTH}px`, `${NEW_PROPERTY_WIDTH}px`]);
    expect(totalWidth()).toBe(`${2 * PAGE_PADDING + 3 * COLUMN_WIDTH + NEW_PROPERTY_WIDTH}px`);

    // Wide again: no gap after the column.
    resizeGrid(1200);
    expect(newPropertyWidths()).toEqual([fill(1200), fill(1200)]);
    expect(totalWidth()).toBe('1200px');
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('a grid mounted without a width fills once its first width arrives', async () => {
  // Mounted before layout gave it a width, e.g. in a collapsed or hidden container.
  gridWidth = 0;
  const data = fixture();
  const rendered = render(
    <Providers context={data.context} grouping={data.grouping}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );

  try {
    await act(() => jest.runOnlyPendingTimers());

    resizeGrid(1200);
    await waitFor(() => expect(screen.getByText('field-2 row-1')).toBeInTheDocument());
    expect(newPropertyWidths()).toEqual([fill(1200), fill(1200)]);
    expect(totalWidth()).toBe('1200px');
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test("an embedded grid's New property column follows the document's edges and the grid's width", async () => {
  // Tall enough to show every row: an embedded grid scrolls inside itself.
  scrollerRowCount = ROW_COUNT + 4;
  const data = fixture({ documentBlock: true, paddingStart: 40, paddingEnd: 24 });
  const renderGrid = (paddingStart: number, paddingEnd: number) => (
    <Providers context={{ ...data.context, paddingStart, paddingEnd }} grouping={data.grouping}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );
  const rendered = render(renderGrid(40, 24));

  try {
    await waitFor(() => expect(screen.getByText('field-2 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    // 1200 - 40 - 3 * 100 - 24; an embedded grid has no sticky header row.
    expect(newPropertyWidths()).toEqual(['836px']);
    expect(totalWidth()).toBe('1200px');

    // The document's end edge moves in...
    rendered.rerender(renderGrid(40, 124));
    await act(() => jest.runOnlyPendingTimers());
    expect(newPropertyWidths()).toEqual(['736px']);
    expect(totalWidth()).toBe('1200px');

    // ...then its start edge...
    rendered.rerender(renderGrid(140, 124));
    await act(() => jest.runOnlyPendingTimers());
    expect(newPropertyWidths()).toEqual(['636px']);
    expect(totalWidth()).toBe('1200px');

    // ...then the grid narrows.
    resizeGrid(900);
    expect(newPropertyWidths()).toEqual(['336px']);
    expect(totalWidth()).toBe('900px');
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('a resize that changes no column width re-renders no row', async () => {
  // Eight columns overflow the grid at both widths: the New property column keeps its own width.
  gridWidth = 480;
  const data = fixture({ columnCount: 8 });
  const rendered = render(
    <Providers context={data.context} grouping={data.grouping}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );

  try {
    await waitFor(() => expect(screen.getByText('field-7 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    rowRenders.mockClear();

    resizeGrid(600);

    expect(rowRenders).not.toHaveBeenCalled();
    expect(newPropertyWidths()).toEqual([`${NEW_PROPERTY_WIDTH}px`, `${NEW_PROPERTY_WIDTH}px`]);
    expect(totalWidth()).toBe(`${2 * PAGE_PADDING + 8 * COLUMN_WIDTH + NEW_PROPERTY_WIDTH}px`);
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('a column being resized keeps its live width while the grid resizes; the fill follows when the resize ends', async () => {
  const data = fixture();
  const rendered = render(
    <Providers context={data.context} grouping={data.grouping}>
      <GridVirtualizer columns={data.columns} />
    </Providers>
  );
  const headerCell = () =>
    rendered.container.querySelector<HTMLElement>('[data-parity-id="dash-widget-grid-header"] [data-column-id="field-1"]');

  try {
    await waitFor(() => expect(screen.getByText('field-2 row-1')).toBeInTheDocument());
    await act(() => jest.runOnlyPendingTimers());
    const handle = headerCell()?.querySelector<HTMLElement>('.column-resize-handle');

    expect(handle).toBeTruthy();
    // Drag the column 60px wider: only its header cell follows the pointer.
    fireEvent.mouseDown(handle as HTMLElement);
    const move = new MouseEvent('mousemove', { bubbles: true });

    Object.defineProperty(move, 'movementX', { value: 60 });
    act(() => {
      document.dispatchEvent(move);
    });
    expect(headerCell()?.style.width).toBe('160px');
    rowRenders.mockClear();

    // The grid resizes mid-drag: nothing re-renders under the pointer.
    resizeGrid(900);
    expect(rowRenders).not.toHaveBeenCalled();
    expect(headerCell()?.style.width).toBe('160px');

    // The resize ends: the New property column takes the grid's new width (the
    // fixture's view has no field settings, so its columns keep their widths).
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(newPropertyWidths()).toEqual([fill(900), fill(900)]);
    expect(totalWidth()).toBe('900px');
  } finally {
    rendered.unmount();
    data.destroy();
  }
});
