// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { type VirtualItem } from '@tanstack/react-virtual';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, type GridGrouping } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
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
// geometry is supplied. Two hooks count renders: only a row reads whether it
// has the active cell, and only a header cell reads the row context.
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

const rowRenders = useIsGridRowActive as jest.Mock;
const headerCellRenders = useGridRowContext as jest.Mock;

const ROW_COUNT = 12;
const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 600;
const VIEWPORT_WIDTH = 480;
const COLUMN_WIDTH = 100;
// With the default overscan of 5, all 8 columns stay rendered wherever the
// 480px window is: scrolling only moves the visible range.
const COLUMN_COUNT = 8;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return (ROW_COUNT + 2) * ROW_HEIGHT;
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
  rowRenders.mockClear();
  headerCellRenders.mockClear();
});

afterEach(async () => {
  await act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

function fixture() {
  const databaseDoc = new Y.Doc({ guid: 'grid-rerender-database' }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const rowMap: Record<string, YDoc> = {};
  const rowOrders = Array.from({ length: ROW_COUNT }, (_, index) => ({ id: `row-${index + 1}`, height: ROW_HEIGHT }));
  const columns: RenderColumn[] = Array.from({ length: COLUMN_COUNT }, (_, index) => ({
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
    readOnly: true,
    databaseDoc,
    activeViewId: 'grid-rerender-view',
    databasePageId: 'grid-rerender-view',
    workspaceId: 'grid-rerender-workspace',
    rowMap,
    seedsReady: true,
    blobPrefetchComplete: true,
  };
  const grouping: GridGrouping = {
    rowOrders, isGrouped: false, ready: true, activeGroupIds: [], groups: [], visibleGroups: [], hideEmptyGroups: false,
  };
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
