import EventEmitter from 'events';

import { act, render, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  SelectOptionFilterCondition,
} from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import {
  DatabaseViewLayout,
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import {
  DashboardProvider,
  useDashboardContext,
  useDashboardLayout,
  useDashboardSourceRegistry,
} from '../DashboardContext';
import { DashboardGrid } from '../DashboardGrid';
import { DashboardHostContext, DashboardUiContext } from '../DashboardUiContext';
import { useSourceDocRegistry } from '../hooks/useSourceDocRegistry';

/** Row docs of the source database that have loaded so far, shared with the mocked Database. */
const mockSourceRows = {
  rows: {} as Record<RowId, YDoc>,
  listeners: new Set<() => void>(),
};
const mockSourceDocs = new Map<string, YDoc>();

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.defaultValue === undefined
        ? key
        : String(options.defaultValue).replace(/{{(\w+)}}/g, (_match, name: string) => String(options[name])),
  }),
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
// The widget renders its source through the real grid pipeline: row orders,
// filters, grouping and render rows. Only the Database shell and the row
// loading are stand-ins; rows missing from `mockSourceRows` never settle.
jest.mock('@/components/database', () => ({
  Database: ({ doc, activeViewId }: { doc: YDoc; activeViewId: string }) => {
    const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
    const { DatabaseContext } =
      jest.requireActual<typeof import('@/application/database-yjs')>('@/application/database-yjs');
    const { DatabaseHistoryScope } = jest.requireActual<typeof import('@/components/database/DatabaseHistoryScope')>(
      '@/components/database/DatabaseHistoryScope'
    );
    const { GridGroupingProvider } = jest.requireActual<typeof import('@/components/database/grid/GridGroupingContext')>(
      '@/components/database/grid/GridGroupingContext'
    );
    const { Grid } = jest.requireActual<typeof import('@/components/database/grid/Grid')>(
      '@/components/database/grid/Grid'
    );
    const rowMap = useSyncExternalStore(
      (listener: () => void) => {
        mockSourceRows.listeners.add(listener);
        return () => mockSourceRows.listeners.delete(listener);
      },
      () => mockSourceRows.rows
    );

    return (
      <DatabaseContext.Provider
        value={{
          databaseDoc: doc,
          databasePageId: activeViewId,
          activeViewId,
          readOnly: false,
          rowMap,
          workspaceId: 'workspace-id',
          isDocumentBlock: true,
          isDashboardWidget: true,
          ensureRow: () => new Promise<YDoc | undefined>(() => undefined),
        }}
      >
        <DatabaseHistoryScope>
          <GridGroupingProvider>
            <Grid />
          </GridGroupingProvider>
        </DatabaseHistoryScope>
      </DatabaseContext.Provider>
    );
  },
}));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: ({ databaseId }: { databaseId: string }) => ({
    doc: mockSourceDocs.get(databaseId) ?? null,
    notFound: false,
    noAccess: false,
    setNotFound: jest.fn(),
  }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => 'none',
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({
  useViewMeta: () => ({ viewMeta: null }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: ({
    children,
  }: {
    children: (permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean }) => ReactNode;
  }) => children({ readOnly: false, canWrite: true, canShare: false }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  useDraggableWidget: () => undefined,
  useWidgetDropTarget: () => null,
  useRowGapDropTarget: () => false,
}));
jest.mock('../WidgetHeader', () => ({ WidgetHeaderFrame: () => null }));
// Grid layout and cells are out of scope: every render row is mounted and a
// data row is reported by its id.
jest.mock('@/components/database/components/grid/grid-column', () => ({
  useRenderFields: () => ({ fields: [] }),
}));
jest.mock('@/components/database/components/grid/grid-table/useGridVirtualizer', () => ({
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
    columnVirtualizer: { getVirtualItems: () => [], getTotalSize: () => 0, measure: () => undefined },
  }),
}));
jest.mock('@/components/database/components/grid/grid-table/useGridDnd', () => ({ useGridDnd: () => ({}) }));
jest.mock('@/components/database/components/grid/grid-column/useColumnResize', () => ({
  useColumnResize: () => ({ handleResizeStart: () => undefined, isResizing: false }),
}));
jest.mock('@/components/database/components/grid/grid-row/GridVirtualRow', () => ({
  __esModule: true,
  default: ({ row, data }: { row: { index: number }; data: RenderRow[] }) => {
    const rowData = data[row.index];

    return <div data-testid={rowData.rowId ? 'widget-grid-row' : `grid-${rowData.type}`} data-row={rowData.rowId} />;
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

const SOURCE_DATABASE_ID = 'employees-5000';
const HR_VIEW_ID = 'hr-view';
const DEPARTMENT_FIELD_ID = 'department';
const HR = 'option-hr';
const SALES = 'option-sales';
const TOTAL_ROWS = 500;
const ROWS: DashboardRow[] = [
  { id: 'r1', height: 360, widgets: [{ id: 'w1', viewId: HR_VIEW_ID, databaseId: SOURCE_DATABASE_ID, width: 12 }] },
];

function TestDashboard() {
  const { updateRows } = useDashboardContext();
  const { rows } = useDashboardLayout();
  const { registerSourceDoc } = useDashboardSourceRegistry();
  const acquireSourceDoc = useSourceDocRegistry(registerSourceDoc, 'db');

  return (
    <DashboardUiContext.Provider
      value={{
        hostDatabaseId: 'db',
        dndInstanceId: Symbol.for('dashboard-large-source-test'),
        getRows: () => rows,
        updateRows,
        openPicker: jest.fn(),
        showLimitMessage: jest.fn(),
        acquireSourceDoc,
      }}
    >
      <DashboardGrid />
    </DashboardUiContext.Provider>
  );
}

function createDepartmentField() {
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOption = new Y.Map();

  field.set(YjsDatabaseKey.id, DEPARTMENT_FIELD_ID);
  field.set(YjsDatabaseKey.name, 'Department');
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  selectOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      options: [
        { id: HR, name: 'HR', color: 0 },
        { id: SALES, name: 'Sales', color: 1 },
      ],
      disable_color: false,
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

/** Another, large database whose "HR" grid view filters Department is HR. */
function createSourceDatabase(isHr: (index: number) => boolean) {
  const doc = new Y.Doc({ guid: SOURCE_DATABASE_ID }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const filter = new Y.Map() as YDatabaseFilter;
  const rowIds = Array.from({ length: TOTAL_ROWS }, (_, index) => `employee-${index}`);

  filter.set(YjsDatabaseKey.id, 'department-is-hr');
  filter.set(YjsDatabaseKey.field_id, DEPARTMENT_FIELD_ID);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, SelectOptionFilterCondition.OptionIs);
  filter.set(YjsDatabaseKey.content, HR);
  view.set(YjsDatabaseKey.name, 'HR');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.filters, Y.Array.from([filter]));
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowIds.map((id) => ({ id, height: 36 }))));
  fields.set(DEPARTMENT_FIELD_ID, createDepartmentField());
  views.set(HR_VIEW_ID, view);
  database.set(YjsDatabaseKey.id, SOURCE_DATABASE_ID);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowDocs = rowIds.map((id, index) =>
    createRowDoc(id, SOURCE_DATABASE_ID, {
      [DEPARTMENT_FIELD_ID]: createCell(FieldType.SingleSelect, isHr(index) ? HR : SALES),
    })
  );

  return { doc, rowIds, rowDocs };
}

function setup(isHr: (index: number) => boolean) {
  const hostDoc = new Y.Doc({ guid: 'db' }) as YDoc;
  const hostDatabase = new Y.Map() as YDatabase;
  const hostViews = new Y.Map<YDatabaseView>();
  const dashboard = new Y.Map() as YDatabaseView;
  const source = createSourceDatabase(isHr);

  hostDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, hostDatabase);
  hostDatabase.set(YjsDatabaseKey.id, 'db');
  hostDatabase.set(YjsDatabaseKey.views, hostViews);
  hostViews.set('dashboard', dashboard);
  updateDashboardLayoutSetting(dashboard, { rows: ROWS });
  mockSourceDocs.set(SOURCE_DATABASE_ID, source.doc);

  const host: DatabaseContextState = {
    databaseDoc: hostDoc,
    readOnly: false,
    canWrite: true,
    rowMap: {},
    databasePageId: 'dashboard',
    activeViewId: 'dashboard',
    workspaceId: 'workspace-id',
    eventEmitter: new EventEmitter(),
  };
  const rendered = render(
    <DatabaseContext.Provider value={host}>
      <DashboardHostContext.Provider value={host}>
        <DatabaseHistoryScope>
          <DashboardProvider>
            <TestDashboard />
          </DashboardProvider>
        </DatabaseHistoryScope>
      </DashboardHostContext.Provider>
    </DatabaseContext.Provider>
  );

  return {
    ...rendered,
    source,
    /** The source database's first `count` rows finish loading. */
    loadRows: async (count: number) => {
      await act(async () => {
        mockSourceRows.rows = Object.fromEntries(
          source.rowIds.slice(0, count).map((id, index) => [id, source.rowDocs[index]])
        );
        mockSourceRows.listeners.forEach((listener) => listener());
      });
    },
    destroy: () => {
      rendered.unmount();
      source.rowDocs.forEach((doc) => doc.destroy());
      source.doc.destroy();
      hostDoc.destroy();
    },
  };
}

function widgetGrid() {
  return within(document.querySelector<HTMLElement>('[data-widget-id="w1"]')!);
}

function shownRowIds() {
  return widgetGrid()
    .queryAllByTestId('widget-grid-row')
    .map((row) => row.dataset.row);
}

beforeEach(() => {
  mockSourceRows.rows = {};
  mockSourceRows.listeners.clear();
  mockSourceDocs.clear();
});

it('shows the first rows of a large source database while the rest load, and never an empty grid', async () => {
  // Every fifth employee works in HR.
  const { loadRows, source, destroy } = setup((index) => index % 5 === 0);
  const grid = await widgetGrid().findByTestId('database-grid');

  // Nothing read yet: the loading row, not an empty result.
  expect(shownRowIds()).toEqual([]);
  expect(widgetGrid().getByTestId('grid-loading-indicator')).toBeTruthy();
  expect(grid.getAttribute('data-row-count')).toBeNull();

  await loadRows(100);

  const firstMatches = source.rowIds.slice(0, 100).filter((_, index) => index % 5 === 0);

  await widgetGrid().findByText(`Loading rows… 100/${TOTAL_ROWS}`);
  expect(shownRowIds()).toEqual(firstMatches);
  expect(grid.getAttribute('data-hydrating')).toBe('true');
  expect(grid.getAttribute('data-loaded-row-count')).toBe(String(firstMatches.length));
  expect(grid.getAttribute('data-row-count')).toBeNull();
  expect(widgetGrid().queryByTestId('grid-calculate-row')).toBeNull();

  await loadRows(TOTAL_ROWS);

  await waitFor(() => expect(grid.getAttribute('data-row-count')).toBe(String(TOTAL_ROWS / 5)));
  // The widget's embedded grid mounts its first 25 rows; the earlier ones kept their place.
  expect(shownRowIds()).toEqual(source.rowIds.filter((_, index) => index % 5 === 0).slice(0, 25));
  expect(widgetGrid().getByTestId('grid-load-more-row')).toBeTruthy();
  expect(widgetGrid().queryByTestId('grid-loading-indicator')).toBeNull();
  expect(grid.getAttribute('data-hydrating')).toBeNull();
  destroy();
});

it('keeps loading while the rows read so far hold no match', async () => {
  // The first hundred employees all work in Sales.
  const { loadRows, destroy } = setup((index) => index >= 100 && index % 5 === 0);
  const grid = await widgetGrid().findByTestId('database-grid');

  await loadRows(100);

  await widgetGrid().findByText(`Loading rows… 100/${TOTAL_ROWS}`);
  expect(shownRowIds()).toEqual([]);
  expect(grid.getAttribute('data-hydrating')).toBe('true');
  expect(grid.getAttribute('data-loaded-row-count')).toBe('0');
  expect(grid.getAttribute('data-row-count')).toBeNull();
  expect(widgetGrid().queryByTestId('grid-calculate-row')).toBeNull();

  await loadRows(TOTAL_ROWS);

  await waitFor(() => expect(grid.getAttribute('data-row-count')).toBe('80'));
  expect(shownRowIds()).toHaveLength(25);
  expect(widgetGrid().getByTestId('grid-load-more-row')).toBeTruthy();
  expect(widgetGrid().queryByTestId('grid-loading-indicator')).toBeNull();
  destroy();
});
