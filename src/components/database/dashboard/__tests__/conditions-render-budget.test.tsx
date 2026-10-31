/**
 * Render budgets of a dashboard widget's database (PERFORMANCE-REPORT W4 a,
 * W12 and theme 7 of 3.4), with the real grid cells and card fields:
 * - toggling Edit mode on a widget with no private conditions renders no
 *   GridRowCell and no CardField and computes no row order: the widget's view
 *   stays the same object in both modes (the overlay writes through in Edit mode);
 * - a global filter change renders nothing under the widget's views but what
 *   reads the filters: the views (`DatabaseViews`) keep their element, and the
 *   cells of rows the filter keeps do not render again.
 */
import { Profiler, ReactNode, createRef, useMemo } from 'react';
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DatabaseExtraFiltersContext,
  DatabaseViewOverlayContext,
  FieldType,
  SortCondition,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { clearDerivedResults } from '@/application/database-yjs/selector';
import * as sortModule from '@/application/database-yjs/sort';
import { createViewConditionsOverlay, ViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import {
  DatabaseViewLayout,
  RowId,
  YDatabaseField,
  YDatabaseRowOrders,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';
import CardField from '@/components/database/components/field/CardField';
import { GridRowCell } from '@/components/database/components/grid/grid-cell/GridRowCell';
import { GridRowProvider } from '@/components/database/components/grid/grid-row/GridRowContext';
import DatabaseViews from '@/components/database/DatabaseViews';
import { createGridInteractionStore, GridInteractionContext } from '@/components/database/grid/useGridContext';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';

import {
  DashboardFiltersContext,
  DashboardFiltersContextValue,
  DashboardSourceRegistryContext,
  DashboardSourceRegistryContextValue,
} from '../DashboardContext';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { WidgetCompositionProvider } from '../WidgetCompositionProvider';
import { WidgetFrame } from '../WidgetContext';
import { WidgetDatabaseHost } from '../WidgetDatabaseHost';

import { createDashboardUiValue, createDatabaseDoc, createWidgetActions } from './dashboardTestHarness';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});

// The cell contents: what a GridRowCell and a CardField render inside them.
jest.mock('@/components/database/components/cell', () => ({
  Cell: () => <span />,
  CellValue: ({ children }: { children: (cell: undefined) => ReactNode }) => <>{children(undefined)}</>,
}));
jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: () => <span />,
  CellValue: ({ children }: { children: (cell: undefined) => ReactNode }) => <>{children(undefined)}</>,
}));
jest.mock('@/components/database/components/cell/primary', () => ({ PrimaryCell: () => <span /> }));

// The widget composition of `DatabaseViews` (other layouts pull in heavy dependencies).
jest.mock('@/components/database/board', () => ({ Board: () => null }));
jest.mock('@/components/database/chart', () => ({ Chart: () => null }));
jest.mock('@/components/database/fullcalendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/form/FormBuilderView', () => ({ FormBuilderView: () => null }));
jest.mock('@/components/database/gallery', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/list/List', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/tabs', () => ({ DatabaseTabs: () => null }));
// The grouping reads the row orders: it renders with every filter change, as it must.
jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The widget header: renders whenever the views do.
jest.mock('@/components/database/dashboard/WidgetHeader', () => ({
  __esModule: true,
  default: () => {
    mockCountRender('WidgetHeader');
    return <div data-testid='widget-header' />;
  },
  WidgetHeaderFrame: () => <div data-testid='widget-header' />,
}));
// The grid layout: the cells of the rows a filter keeps.
jest.mock('@/components/database/grid', () => ({
  Grid: () => <MockCellsProbe />,
}));

// The widget host's source loading, permission probe and drag wiring.
const mockSourceDocs = new Map<string, YDoc>();

jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: (options: { viewId: string; databaseId: string }) => ({
    doc: options.viewId ? mockSourceDocs.get(options.databaseId) ?? null : null,
    notFound: false,
    noAccess: false,
    offline: false,
    loading: false,
    setNotFound: jest.fn(),
  }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => 'none',
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: ({
    children,
  }: {
    children: (permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean }) => ReactNode;
  }) => children({ readOnly: false, canWrite: true, canShare: false }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({ useDraggableWidget: () => undefined }));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));

// The nested database, as `Database` builds it: its context (memoized), the
// viewer's view overlay and the global filters, around the views.
jest.mock('@/components/database', () => ({
  Database: (props: Parameters<typeof MockNestedDatabase>[0]) => <MockNestedDatabase {...props} />,
}));

const salaryFieldId = 'salary-field';
const nameFieldId = 'name-field';
const viewId = 'grid-view';
const sourceDatabaseId = 'source-db';
const ROW_COUNT = 6;

/** Renders of each profiled component group since the last reset. */
const mockRenders: Record<string, number> = {};

function mockCountRender(id: string) {
  mockRenders[id] = (mockRenders[id] ?? 0) + 1;
}

const countRender = mockCountRender;

const resetRenders = () => Object.keys(mockRenders).forEach((key) => delete mockRenders[key]);

/** The source database: a primary name field, a salary sorted highest first, and its rows. */
function createSource() {
  const fixture = createDatabaseDoc({
    id: sourceDatabaseId,
    views: [{ id: viewId, name: 'Salaries', layout: DatabaseViewLayout.Grid }],
  });
  const fields = fixture.database.get(YjsDatabaseKey.fields);
  const view = fixture.view(viewId);
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
  const sort = new Y.Map() as YDatabaseSort;
  const rowIds = Array.from({ length: ROW_COUNT }, (_, index) => `row-${index}`);

  fixture.doc.transact(() => {
    [
      [nameFieldId, FieldType.RichText, true],
      [salaryFieldId, FieldType.Number, false],
    ].forEach(([id, type, primary]) => {
      const field = new Y.Map() as YDatabaseField;

      field.set(YjsDatabaseKey.id, id as string);
      field.set(YjsDatabaseKey.name, id as string);
      field.set(YjsDatabaseKey.type, type as FieldType);
      field.set(YjsDatabaseKey.is_primary, primary as boolean);
      fields.set(id as string, field);
    });
    sort.set(YjsDatabaseKey.id, 'salary-sort');
    sort.set(YjsDatabaseKey.field_id, salaryFieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
    sorts.push([sort]);
    rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    view.set(YjsDatabaseKey.filters, new Y.Array());
    view.set(YjsDatabaseKey.sorts, sorts);
  });

  const rowMap: Record<RowId, YDoc> = Object.fromEntries(
    rowIds.map((id, index) => [
      id,
      createRowDoc(id, sourceDatabaseId, {
        [nameFieldId]: createCell(FieldType.RichText, `Person ${index}`),
        [salaryFieldId]: createCell(FieldType.Number, String(1000 + index)),
      }),
    ])
  );

  return { ...fixture, rowIds, rowMap };
}

let source: ReturnType<typeof createSource>;

/** The database context `Database` provides, memoized as its `mainContextValue` is. */
function useNestedDatabaseContext(doc: YDoc, activeViewId: string, readOnly: boolean): DatabaseContextState {
  return useMemo(
    () => ({
      readOnly,
      databaseDoc: doc,
      databasePageId: activeViewId,
      activeViewId,
      rowMap: source.rowMap,
      workspaceId: 'workspace-id',
      isDashboardWidget: true,
      isDocumentBlock: true,
      embeddedHeight: 314,
      peekRowDocFromSeed: (rowId: string) => source.rowMap[rowId] ?? null,
    }),
    [activeViewId, doc, readOnly]
  );
}

/** Reads the sorted rows, as the grid's grouping does. */
function RowOrdersProbe() {
  const rows = useRowOrdersSelector();

  return <div data-row-count={rows?.length ?? -1} data-testid='row-orders-probe' />;
}

const interactionStore = createGridInteractionStore();
const interaction = {
  historyScopeId: 'grid',
  restoreHistoryFocus: () => undefined,
  setActiveCell: interactionStore.setActiveCell,
  setHoverRowKey: interactionStore.setHoverRowKey,
  store: interactionStore,
};
const gridRow = { resizeRow: () => undefined };
const noop = () => undefined;

/** The real grid cells and card fields of every row, each group profiled. */
function MockCellsProbe() {
  return (
    <GridInteractionContext.Provider value={interaction}>
      <RowOrdersProbe />
      <Profiler id='GridRowCell' onRender={() => countRender('GridRowCell')}>
        {source.rowIds.map((rowId, rowIndex) => (
          <GridRowProvider key={rowId} value={gridRow}>
            {[nameFieldId, salaryFieldId].map((fieldId, columnIndex) => (
              <GridRowCell
                key={fieldId}
                columnIndex={columnIndex}
                fieldId={fieldId}
                rowId={rowId}
                rowIndex={rowIndex}
                rowKey={`${rowId}:${rowIndex}`}
              />
            ))}
          </GridRowProvider>
        ))}
      </Profiler>
      <Profiler id='CardField' onRender={() => countRender('CardField')}>
        {source.rowIds.map((rowId) => (
          <CardField key={rowId} editing={false} fieldId={salaryFieldId} rowId={rowId} setEditing={noop} />
        ))}
      </Profiler>
    </GridInteractionContext.Provider>
  );
}

/** What `Database` renders around a widget's cells: its contexts. */
function MockNestedDatabase({
  doc,
  activeViewId,
  readOnly,
  viewConditionsOverlay,
  extraFilters,
}: {
  doc: YDoc;
  activeViewId: string;
  readOnly: boolean;
  viewConditionsOverlay?: YDatabaseView;
  extraFilters?: DashboardExtraFilter[];
}) {
  const context = useNestedDatabaseContext(doc, activeViewId, readOnly);

  return (
    <DatabaseViewOverlayContext.Provider value={viewConditionsOverlay}>
      <DatabaseExtraFiltersContext.Provider value={extraFilters}>
        <DatabaseContext.Provider value={context}>
          <MockCellsProbe />
        </DatabaseContext.Provider>
      </DatabaseExtraFiltersContext.Provider>
    </DatabaseViewOverlayContext.Provider>
  );
}

let overlay: ViewConditionsOverlay | null = null;

function createFrame(editing: boolean): WidgetFrame {
  return {
    widgetId: 'w1',
    databaseId: sourceDatabaseId,
    viewId,
    folderName: '',
    folderLayout: undefined,
    icon: null,
    isEditing: editing,
    canEdit: true,
    editing,
    showWidgetTitles: true,
    showIcon: false,
    headerHeight: 40,
    isDragging: false,
    menuOpen: false,
    setMenuOpen: jest.fn(),
    settingsOpen: false,
    setSettingsOpen: jest.fn(),
    getBoxElement: () => null,
    titleRef: createRef(),
    optionsRef: createRef(),
    settingsToolRef: createRef(),
    actions: createWidgetActions(),
  };
}

/** A widget of the source in a dashboard whose overlay store gives it the viewer's overlay. */
function renderWidget(editing: boolean) {
  const hostDoc = createDatabaseDoc({
    id: 'host-db',
    views: [{ id: 'host-view', name: 'Host', layout: DatabaseViewLayout.Grid }],
  }).doc;
  const ui = createDashboardUiValue({ hostDatabaseId: 'host-db', acquireSourceDoc: jest.fn(() => () => undefined) });
  const host = { databaseDoc: hostDoc, readOnly: false, workspaceId: 'workspace' } as DashboardHostServices;
  const filters = {
    effectiveGlobalFilters: [],
    getViewOverlay: (_widget: unknown, view: YDatabaseView | undefined) => {
      if (!view) return undefined;
      overlay ??= createViewConditionsOverlay(view);
      return overlay.view;
    },
    setViewOverlayWritable: jest.fn(),
  } as unknown as DashboardFiltersContextValue;
  const registry = {
    markWidgetShown: () => () => undefined,
    getShownDoc: () => null,
  } as unknown as DashboardSourceRegistryContextValue;
  const tree = (isEditing: boolean) => (
    <DashboardHostContext.Provider value={host}>
      <DashboardUiContext.Provider value={ui}>
        <DashboardFiltersContext.Provider value={filters}>
          <DashboardSourceRegistryContext.Provider value={registry}>
            <WidgetDatabaseHost frame={createFrame(isEditing)} viewportHeight={314} />
          </DashboardSourceRegistryContext.Provider>
        </DashboardFiltersContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
  const rendered = render(tree(editing));

  return { ...rendered, setEditing: (next: boolean) => rendered.rerender(tree(next)) };
}

describe('dashboard widget render budgets', () => {
  let sortSpy: jest.SpyInstance;

  beforeEach(() => {
    clearDerivedResults();
    source = createSource();
    mockSourceDocs.set(sourceDatabaseId, source.doc);
    overlay = null;
    resetRenders();
    sortSpy = jest.spyOn(sortModule, 'sortBy');
  });

  afterEach(() => {
    sortSpy.mockRestore();
    overlay?.destroy();
    mockSourceDocs.clear();
    Object.values(source.rowMap).forEach((doc) => doc.destroy());
    source.doc.destroy();
  });

  describe('Edit mode (W12)', () => {
    it('renders no GridRowCell and no CardField, and computes no row order, when Edit mode is toggled', async () => {
      const view = renderWidget(false);

      expect((await screen.findByTestId('row-orders-probe')).getAttribute('data-row-count')).toBe(String(ROW_COUNT));
      expect(mockRenders.GridRowCell).toBeGreaterThan(0);
      expect(mockRenders.CardField).toBeGreaterThan(0);
      resetRenders();
      sortSpy.mockClear();

      act(() => view.setEditing(true));
      expect(overlay?.isSuspended()).toBe(true);
      expect(mockRenders.GridRowCell ?? 0).toBe(0);
      expect(mockRenders.CardField ?? 0).toBe(0);
      expect(sortSpy).not.toHaveBeenCalled();

      act(() => view.setEditing(false));
      expect(overlay?.isSuspended()).toBe(false);
      expect(mockRenders.GridRowCell ?? 0).toBe(0);
      expect(mockRenders.CardField ?? 0).toBe(0);
      expect(sortSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('row-orders-probe').getAttribute('data-row-count')).toBe(String(ROW_COUNT));
    });
  });

  describe('a global filter change (W4 a)', () => {
    /** `Database` around the widget's views: a new `extraFilters` prop renders it again. */
    function NestedDatabaseWithViews({ extraFilters }: { extraFilters?: DashboardExtraFilter[] }) {
      const context = useNestedDatabaseContext(source.doc, viewId, false);
      const visibleViewIds = useMemo(() => [viewId], []);

      return (
        <DatabaseExtraFiltersContext.Provider value={extraFilters}>
          <DatabaseContext.Provider value={context}>
            <Profiler id='DatabaseViews' onRender={() => countRender('DatabaseViews')}>
              <DatabaseViews
                activeViewId={viewId}
                databasePageId={viewId}
                fixedHeight={314}
                onChangeView={noop}
                visibleViewIds={visibleViewIds}
              />
            </Profiler>
          </DatabaseContext.Provider>
        </DatabaseExtraFiltersContext.Provider>
      );
    }

    it('renders neither the views (their header) nor the cells of the rows it keeps', async () => {
      const tree = (extraFilters?: DashboardExtraFilter[]) => (
        <WidgetCompositionProvider>
          <NestedDatabaseWithViews extraFilters={extraFilters} />
        </WidgetCompositionProvider>
      );
      const view = render(tree());

      expect((await screen.findByTestId('row-orders-probe')).getAttribute('data-row-count')).toBe(String(ROW_COUNT));
      expect(mockRenders.WidgetHeader).toBeGreaterThan(0);
      resetRenders();
      sortSpy.mockClear();

      // Every salary is above 0: the filter keeps every row.
      const keepsEveryRow: DashboardExtraFilter[] = [
        { id: 'gf-1', field_id: salaryFieldId, ty: FieldType.Number, condition: 4, content: '0' },
      ];

      act(() => view.rerender(tree(keepsEveryRow)));
      // The row orders' reader reads the filters: it computed the new result.
      expect(sortSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('row-orders-probe').getAttribute('data-row-count')).toBe(String(ROW_COUNT));
      // Nothing else under the views rendered: not their header, not a cell.
      expect(mockRenders.WidgetHeader ?? 0).toBe(0);
      expect(mockRenders.GridRowCell ?? 0).toBe(0);
      expect(mockRenders.CardField ?? 0).toBe(0);
    });
  });
});
