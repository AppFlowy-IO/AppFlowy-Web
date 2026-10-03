import EventEmitter from 'events';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode, StrictMode, useMemo, useRef } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  moveDashboardWidget,
  readDashboardLayoutSetting,
  updateDashboardLayoutSetting,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import { WIDGET_GRID_ROW_GUTTER, WIDGET_INLINE_PADDING, WIDGET_MISSING_GRACE_MS } from '../constants';
import { Dashboard } from '../Dashboard';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardLayout,
  useDashboardLocalWidgetChanges,
  useDashboardSourceRegistry,
} from '../DashboardContext';
import { DashboardGrid } from '../DashboardGrid';
import { DashboardLoadSchedulerProvider } from '../DashboardLoadScheduler';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { useSourceDocRegistry } from '../hooks/useSourceDocRegistry';
import { WidgetActions } from '../WidgetContext';

const mockWidgetViews = new Map<string, YDatabaseView>();
const mockWidgetPaddings = new Map<string, number | undefined>();
const mockWidgetActions = new Map<string, WidgetActions>();
const mockWidgetSubscriptions = new Map<string, unknown>();
const mockSourceDocs = new Map<string, YDoc>();
// The views whose source load started (`useDocumentLoader` called with them), and each widget's load reporter.
const mockLoadedViewIds = new Set<string>();
const mockLoadReporters = new Map<string, ((state: 'first-data' | 'complete' | 'failed') => void) | undefined>();
// The binding release each widget's source load was given, by view.
const mockLoaderCleanups = new Map<string, unknown>();
// While set, the source permission probe has not answered yet.
let mockPermissionPending = false;
// Widgets mounted while set have neither their load nor their trash probe settled.
let mockLoadPending = false;
// Views whose own load the server refuses, and whether the source database is in the trash.
const mockNoAccessViews = new Set<string>();
let mockSourceInTrash = false;

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
jest.mock('@/components/database', () => ({
  Database: ({
    doc,
    activeViewId,
    paddingStart,
    viewConditionsOverlay,
    getSubscriptions,
    onLoadStateChange,
  }: {
    doc: YDoc;
    activeViewId: string;
    paddingStart?: number;
    viewConditionsOverlay?: YDatabaseView;
    getSubscriptions?: unknown;
    onLoadStateChange?: (state: 'first-data' | 'complete' | 'failed') => void;
  }) => {
    const { useWidgetContext } = jest.requireActual<typeof import('../WidgetContext')>('../WidgetContext');
    const { DatabaseContext } =
      jest.requireActual<typeof import('@/application/database-yjs')>('@/application/database-yjs');
    const { DatabaseHistoryScope } = jest.requireActual<typeof import('@/components/database/DatabaseHistoryScope')>(
      '@/components/database/DatabaseHistoryScope'
    );

    mockWidgetActions.set(activeViewId, useWidgetContext().actions);
    if (viewConditionsOverlay) mockWidgetViews.set(activeViewId, viewConditionsOverlay);
    mockWidgetPaddings.set(activeViewId, paddingStart);
    mockWidgetSubscriptions.set(activeViewId, getSubscriptions);
    mockLoadReporters.set(activeViewId, onLoadStateChange);
    return (
      <DatabaseContext.Provider
        value={{
          databaseDoc: doc,
          databasePageId: activeViewId,
          activeViewId,
          readOnly: false,
          rowMap: {},
          workspaceId: 'workspace-id',
        }}
      >
        <DatabaseHistoryScope>
          <button data-testid={`widget-surface-${activeViewId}`}>Widget content</button>
        </DatabaseHistoryScope>
      </DatabaseContext.Provider>
    );
  },
}));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: ({
    viewId,
    databaseId,
    scheduleDeferredCleanup,
  }: {
    viewId: string;
    databaseId: string;
    scheduleDeferredCleanup?: unknown;
  }) => {
    const [pending] = jest.requireActual<typeof import('react')>('react').useState(() => mockLoadPending);

    if (viewId) {
      mockLoadedViewIds.add(viewId);
      mockLoaderCleanups.set(viewId, scheduleDeferredCleanup);
    }

    const noAccess = !pending && mockNoAccessViews.has(viewId);

    return {
      doc: pending || noAccess ? null : mockSourceDocs.get(databaseId) ?? null,
      notFound: noAccess,
      noAccess,
      offline: false,
      setNotFound: jest.fn(),
    };
  },
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => {
    const [pending] = jest.requireActual<typeof import('react')>('react').useState(() => mockLoadPending);

    if (pending) return null;
    return mockSourceInTrash ? 'inTrash' : 'none';
  },
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({
  useViewMeta: () => ({ viewMeta: null }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: ({
    children,
  }: {
    children: (
      permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean },
      status: { settled: boolean }
    ) => ReactNode;
  }) =>
    mockPermissionPending
      ? children({ readOnly: true, canWrite: false, canShare: false }, { settled: false })
      : children({ readOnly: false, canWrite: true, canShare: false }, { settled: true }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  ...jest.requireActual<typeof import('../hooks/useDashboardDnd')>('../hooks/useDashboardDnd'),
  useDraggableWidget: () => undefined,
  useWidgetDropTarget: () => null,
  useRowGapDropTarget: () => false,
}));
// Mounted by `Dashboard` only (the leak check below): stand-ins for its network and editor-only parts.
jest.mock('../global-filters/GlobalFilterBar', () => ({ GlobalFilterBar: () => null }));
jest.mock('../WidgetPicker', () => ({ WidgetPicker: () => null }));
jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));
jest.mock('../hooks/useCreateWidgetView', () => ({
  useCreateWidgetView: () => ({ createView: jest.fn(), canCreateInOtherDatabases: false, bridge: null }),
}));
jest.mock('../WidgetHeader', () => ({
  WidgetHeaderFrame: () => <div data-testid='widget-header-frame' />,
  WidgetHeader: () => null,
}));

const ROWS: DashboardRow[] = [
  { id: 'r1', height: 360, widgets: [{ id: 'w1', viewId: 'v1', databaseId: 'db', width: 12 }] },
  { id: 'r2', height: 360, widgets: [{ id: 'w2', viewId: 'v2', databaseId: 'db', width: 12 }] },
];
const PRIVATE_FILTER = { id: 'private-filter', content: 'mine' };
const PRIVATE_SORT = { id: 'private-sort', field_id: 'title', condition: 1 };

function makeView(rowIds = ['first']) {
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.name, 'Tasks');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowIds.map((id) => ({ id, height: 36 }))));
  return view;
}

/** With `scheduled`, the grid runs inside the dashboard's load queue, as `Dashboard` renders it. */
function TestDashboard({ scheduled = false }: { scheduled?: boolean }) {
  const { updateRows } = useDashboardContext();
  const { rows } = useDashboardLayout();
  const scrollRef = useRef<HTMLDivElement>(null);
  const order = useMemo(() => rows.flatMap((row) => row.widgets.map((widget) => widget.id)), [rows]);
  const { resetViewOverlays, commitViewOverlays } = useDashboardFilters();
  const { unsaved: localWidgetChanges } = useDashboardLocalWidgetChanges();
  const { registerSourceDoc } = useDashboardSourceRegistry();
  const acquireSourceDoc = useSourceDocRegistry(registerSourceDoc, 'db');

  return (
    <DashboardUiContext.Provider
      value={{
        hostDatabaseId: 'db',
        dndInstanceId: Symbol.for('dashboard-lifecycle-test'),
        getRows: () => rows,
        updateRows,
        openPicker: jest.fn(),
        showLimitMessage: jest.fn(),
        acquireSourceDoc,
        selectWidget: jest.fn(),
      }}
    >
      {scheduled ? (
        <DashboardLoadSchedulerProvider hostSourceId='db' order={order} scrollRef={scrollRef}>
          <div ref={scrollRef}>
            <DashboardGrid />
          </div>
        </DashboardLoadSchedulerProvider>
      ) : (
        <DashboardGrid />
      )}
      <output data-testid='private-changes'>{localWidgetChanges}</output>
      <button onClick={resetViewOverlays}>Reset</button>
      <button onClick={() => commitViewOverlays()}>Save</button>
    </DashboardUiContext.Provider>
  );
}

function setup(strict = false, readOnly = false, sourceDoc?: YDoc, hostServices: Partial<DashboardHostServices> = {}) {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const dashboard = new Y.Map() as YDatabaseView;
  const otherDashboard = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'db');
  database.set(YjsDatabaseKey.views, views);
  views.set('dashboard', dashboard);
  views.set('other-dashboard', otherDashboard);
  views.set('v1', makeView());
  views.set('v2', makeView());
  const rows = sourceDoc
    ? ROWS.map((row) => ({ ...row, widgets: row.widgets.map((widget) => ({ ...widget, databaseId: 'source-db' })) }))
    : ROWS;

  if (sourceDoc) mockSourceDocs.set('source-db', sourceDoc);
  updateDashboardLayoutSetting(dashboard, { rows });
  updateDashboardLayoutSetting(otherDashboard, { rows: ROWS });
  const host: DatabaseContextState = {
    databaseDoc: doc,
    readOnly,
    canWrite: !readOnly,
    rowMap: {},
    databasePageId: 'dashboard',
    activeViewId: 'dashboard',
    // Widgets of other databases probe the trash through it.
    eventEmitter: new EventEmitter(),
  };
  // What `useDashboardHostServices` hands the widgets: the host's services, with the app's own where it has them.
  const services: DashboardHostServices = { ...host, ...hostServices };
  const tree = (activeViewId = 'dashboard') => {
    const content = (
      <DatabaseContext.Provider value={{ ...host, activeViewId }}>
        <DashboardHostContext.Provider value={services}>
          <DatabaseHistoryScope>
            <DashboardProvider>
              <TestDashboard />
            </DashboardProvider>
          </DatabaseHistoryScope>
        </DashboardHostContext.Provider>
      </DatabaseContext.Provider>
    );

    return strict ? <StrictMode>{content}</StrictMode> : content;
  };

  const rendered = render(tree());

  return {
    ...rendered,
    doc,
    database,
    views,
    switchDashboard: () => rendered.rerender(tree('other-dashboard')),
    writeRows: (rows: DashboardRow[]) => act(() => updateDashboardLayoutSetting(dashboard, { rows })),
  };
}

function widgetView() {
  const view = mockWidgetViews.get('v1');

  if (!view) throw new Error('The widget has no conditions overlay');
  return view;
}

function editConditions() {
  act(() => {
    widgetView().get(YjsDatabaseKey.filters).push([PRIVATE_FILTER]);
    widgetView().get(YjsDatabaseKey.sorts).push([PRIVATE_SORT]);
  });
  expect(screen.getByTestId('private-changes').textContent).toBe('1');
}

function createSourceDoc() {
  const sourceDoc = new Y.Doc({ guid: 'source-db' }) as YDoc;
  const sourceDatabase = new Y.Map() as YDatabase;
  const sourceViews = new Y.Map<YDatabaseView>();

  sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, sourceDatabase);
  sourceDatabase.set(YjsDatabaseKey.id, 'source-db');
  sourceDatabase.set(YjsDatabaseKey.views, sourceViews);
  sourceViews.set('v1', makeView());
  sourceViews.set('v2', makeView());
  return sourceDoc;
}

beforeEach(() => {
  mockWidgetViews.clear();
  mockWidgetPaddings.clear();
  mockWidgetActions.clear();
  mockWidgetSubscriptions.clear();
  mockSourceDocs.clear();
  mockLoadPending = false;
  mockNoAccessViews.clear();
  mockSourceInTrash = false;
  mockLoadedViewIds.clear();
  mockLoaderCleanups.clear();
  mockLoadReporters.clear();
  mockPermissionPending = false;
  jest.useRealTimers();
});

function widgetPlaceholder(widgetId: string) {
  return document.querySelector<HTMLElement>(
    `[data-widget-id="${widgetId}"] [data-testid="dashboard-widget-placeholder"]`
  );
}

it("forwards the host's subscription lookup, so the widget's layout switcher can check the plan", () => {
  const getSubscriptions = jest.fn().mockResolvedValue([]);
  const { doc, unmount } = setup(false, false, undefined, { getSubscriptions });

  expect(mockWidgetSubscriptions.get('v1')).toBe(getSubscriptions);
  unmount();
  doc.destroy();
});

it("gives a widget's source load the host's binding release, so leaving stops the source syncing", () => {
  const sourceDoc = createSourceDoc();
  const scheduleDeferredCleanup = jest.fn();
  const { doc, unmount } = setup(false, false, sourceDoc, { scheduleDeferredCleanup });

  expect(mockLoaderCleanups.get('v1')).toBe(scheduleDeferredCleanup);
  expect(mockLoaderCleanups.get('v2')).toBe(scheduleDeferredCleanup);
  unmount();
  doc.destroy();
  sourceDoc.destroy();
});

it('keeps showing a widget of another database while it moves to another row', () => {
  const sourceDoc = createSourceDoc();
  const { writeRows, doc, unmount } = setup(false, false, sourceDoc);
  const rows = ROWS.map((row) => ({
    ...row,
    widgets: row.widgets.map((widget) => ({ ...widget, databaseId: 'source-db' })),
  }));

  expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
  // The moved widget remounts; its own load and trash probe take a while.
  mockLoadPending = true;
  writeRows(moveDashboardWidget(rows, 'w1', { type: 'existing_row', rowId: 'r2' }));

  expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
  expect(screen.queryByTestId('dashboard-widget-placeholder')).toBeNull();
  unmount();
  doc.destroy();
  sourceDoc.destroy();
});

it.each([
  // Its source is in the trash.
  ['not-found', () => (mockSourceInTrash = true)],
  // Only its own view is refused; the other widget loaded the database.
  ['no-access', () => mockNoAccessViews.add('v1')],
] as const)('starts a moved widget that showed %s over instead of rendering its database', (reason, arrange) => {
  const sourceDoc = createSourceDoc();

  arrange();
  const { writeRows, doc, unmount } = setup(false, false, sourceDoc);
  const rows = ROWS.map((row) => ({
    ...row,
    widgets: row.widgets.map((widget) => ({ ...widget, databaseId: 'source-db' })),
  }));

  expect(widgetPlaceholder('w1')?.dataset.reason).toBe(reason);
  // The moved widget starts over; its load and trash probe are still running.
  mockLoadPending = true;
  writeRows(moveDashboardWidget(rows, 'w1', { type: 'existing_row', rowId: 'r2' }));

  expect(screen.queryByTestId('widget-surface-v1')).toBeNull();
  expect(widgetPlaceholder('w1')?.dataset.reason).toBe('loading');
  unmount();
  doc.destroy();
  sourceDoc.destroy();
});

it('leaves a view missing from the dashboard doc to its own load', () => {
  jest.useFakeTimers();
  const sourceDoc = createSourceDoc();
  const { writeRows, doc, unmount } = setup(false, false, sourceDoc);

  // A view created after the doc was loaded: only the widget's load fetches it.
  mockLoadPending = true;
  writeRows([{ id: 'r3', height: 360, widgets: [{ id: 'w3', viewId: 'v3', databaseId: 'source-db', width: 12 }] }]);
  act(() => {
    jest.advanceTimersByTime(WIDGET_MISSING_GRACE_MS * 2);
  });

  expect(screen.getByTestId('dashboard-widget-placeholder').dataset.reason).toBe('loading');
  unmount();
  doc.destroy();
  sourceDoc.destroy();
});

it.each(['duplicate', 'move'] as const)('undoes the host layout after the widget %s action', (action) => {
  const sourceDoc = new Y.Doc({ guid: 'source-db' }) as YDoc;
  const sourceDatabase = new Y.Map() as YDatabase;
  const sourceViews = new Y.Map<YDatabaseView>();
  const sourceView = makeView();

  sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, sourceDatabase);
  sourceDatabase.set(YjsDatabaseKey.id, 'source-db');
  sourceDatabase.set(YjsDatabaseKey.views, sourceViews);
  sourceViews.set('v1', sourceView);
  sourceViews.set('v2', makeView());
  const sourceHistory = getOrCreateDatabaseHistoryManager(sourceDoc);

  runDatabaseAction(sourceDoc, { type: 'test.source-edit' }, () => sourceView.set(YjsDatabaseKey.name, 'Source edit'));
  const { doc, database, unmount } = setup(false, false, sourceDoc);
  const before = readDashboardLayoutSetting(database, 'dashboard').rows;

  fireEvent.pointerDown(screen.getByTestId('widget-surface-v1'));
  // Invoke the actual WidgetSource callbacks supplied to the nested header's
  // menu. Both layout actions must override that header's source history.
  act(() => {
    const actions = mockWidgetActions.get('v1');

    expect(actions).toBeDefined();
    if (action === 'duplicate') actions?.duplicate();
    else actions?.move('down');
  });
  expect(readDashboardLayoutSetting(database, 'dashboard').rows).not.toEqual(before);
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };

  fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ...modifier });
  expect(readDashboardLayoutSetting(database, 'dashboard').rows).toEqual(before);
  expect(sourceView.get(YjsDatabaseKey.name)).toBe('Source edit');
  expect(sourceHistory.canUndo()).toBe(true);

  unmount();
  doc.destroy();
  sourceDoc.destroy();
});

it.each([false, true])(
  'gives a grid widget a start gutter for its row controls unless it is read-only: %s',
  (readOnly) => {
    const { doc, unmount } = setup(false, readOnly);

    // The row controls only show for editable rows; a read-only grid keeps the
    // widget padding.
    expect(mockWidgetPaddings.get('v1')).toBe(readOnly ? WIDGET_INLINE_PADDING : WIDGET_GRID_ROW_GUTTER);
    unmount();
    doc.destroy();
  }
);

it.each([false, true])('follows a server view replacement while preserving private edits: %s', async (dirty) => {
  const { doc, views, unmount } = setup();
  const previous = widgetView();

  if (dirty) editConditions();
  // Row creation on the server clears and rebuilds the views in one update.
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const remoteDatabase = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const replacement = makeView(['first', 'new-row']);
  const sharedFilter = { id: 'shared-filter', content: 'remote' };

  remoteDatabase.get(YjsDatabaseKey.views).set('v1', replacement);
  replacement.get(YjsDatabaseKey.filters).push([sharedFilter]);
  // The overlay rebinds while the widget renders and follows the replacement's
  // conditions in a microtask, which the async act flushes.
  await act(async () => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote'));
  const current = widgetView();

  expect(current).not.toBe(previous);
  expect(current.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([
    { id: 'first', height: 36 },
    { id: 'new-row', height: 36 },
  ]);
  expect(current.get(YjsDatabaseKey.filters).toJSON()).toEqual([dirty ? PRIVATE_FILTER : sharedFilter]);
  if (dirty) {
    expect(current.get(YjsDatabaseKey.sorts).toJSON()).toEqual([PRIVATE_SORT]);
    fireEvent.click(screen.getByText('Save'));
    expect(views.get('v1')?.get(YjsDatabaseKey.filters).toJSON()).toEqual([PRIVATE_FILTER]);
    expect(views.get('v1')?.get(YjsDatabaseKey.sorts).toJSON()).toEqual([PRIVATE_SORT]);
    expect(screen.getByTestId('private-changes').textContent).toBe('0');
  }

  act(() =>
    views
      .get('v1')
      ?.get(YjsDatabaseKey.filters)
      .push([{ id: 'later' }])
  );
  expect(current.get(YjsDatabaseKey.filters).toJSON()).toEqual([dirty ? PRIVATE_FILTER : sharedFilter, { id: 'later' }]);
  unmount();
  remote.destroy();
  doc.destroy();
});

it('keeps private conditions through a collaborator moving the widget to another row', () => {
  const { writeRows, doc, unmount } = setup();

  editConditions();
  const previous = widgetView();

  writeRows(moveDashboardWidget(ROWS, 'w1', { type: 'existing_row', rowId: 'r2' }));
  expect(widgetView()).toBe(previous);
  expect(widgetView().get(YjsDatabaseKey.filters).toJSON()).toEqual([PRIVATE_FILTER]);
  expect(widgetView().get(YjsDatabaseKey.sorts).toJSON()).toEqual([PRIVATE_SORT]);
  expect(screen.getByTestId('private-changes').textContent).toBe('1');
  fireEvent.click(screen.getByText('Reset'));
  expect(widgetView().get(YjsDatabaseKey.filters).length).toBe(0);
  expect(widgetView().get(YjsDatabaseKey.sorts).length).toBe(0);
  expect(screen.getByTestId('private-changes').textContent).toBe('0');
  unmount();
  doc.destroy();
});

it.each(['remove', 'replace', 'switch', 'unmount'] as const)('releases private conditions on %s', (action) => {
  const { writeRows, switchDashboard, doc, unmount } = setup(true);
  const consoleError = jest.spyOn(console, 'error');

  editConditions();
  const localDoc = widgetView().get(YjsDatabaseKey.filters).doc!;
  const destroy = jest.spyOn(localDoc, 'destroy');

  if (action === 'remove') writeRows([ROWS[1]]);
  if (action === 'replace') writeRows([{ ...ROWS[0], widgets: [{ ...ROWS[0].widgets[0], viewId: 'v2' }] }]);
  if (action === 'switch') switchDashboard();
  if (action === 'unmount') unmount();
  else expect(screen.getByTestId('private-changes').textContent).toBe('0');
  expect(destroy).toHaveBeenCalledTimes(1);
  if (action === 'switch') expect(widgetView().get(YjsDatabaseKey.filters).length).toBe(0);
  // Released after commit: a widget never updates the dashboard while it renders.
  expect(consoleError.mock.calls.flat().join('\n')).not.toContain('while rendering a different component');
  consoleError.mockRestore();
  unmount();
  doc.destroy();
});

describe('in the load queue', () => {
  const SOURCES = ['source-a', 'source-b', 'source-c'];
  // One row of three widgets over three databases: no IntersectionObserver in jsdom, so all count as visible.
  const QUEUED_ROWS: DashboardRow[] = [
    {
      id: 'r1',
      height: 360,
      widgets: SOURCES.map((databaseId, index) => ({
        id: `w${index + 1}`,
        viewId: `v${index + 1}`,
        databaseId,
        width: 4,
      })),
    },
  ];

  function setupQueue(rows = QUEUED_ROWS) {
    const doc = new Y.Doc({ guid: 'db' }) as YDoc;
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map<YDatabaseView>();
    const dashboard = new Y.Map() as YDatabaseView;

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.id, 'db');
    database.set(YjsDatabaseKey.views, views);
    views.set('dashboard', dashboard);
    SOURCES.forEach((databaseId, index) => {
      const sourceDoc = new Y.Doc({ guid: databaseId }) as YDoc;
      const sourceDatabase = new Y.Map() as YDatabase;
      const sourceViews = new Y.Map<YDatabaseView>();

      sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, sourceDatabase);
      sourceDatabase.set(YjsDatabaseKey.id, databaseId);
      sourceDatabase.set(YjsDatabaseKey.views, sourceViews);
      sourceViews.set(`v${index + 1}`, makeView());
      mockSourceDocs.set(databaseId, sourceDoc);
    });
    updateDashboardLayoutSetting(dashboard, { rows });
    const host: DatabaseContextState = {
      databaseDoc: doc,
      readOnly: false,
      canWrite: true,
      rowMap: {},
      databasePageId: 'dashboard',
      activeViewId: 'dashboard',
      eventEmitter: new EventEmitter(),
    };
    const rendered = render(
      <DatabaseContext.Provider value={host}>
        <DashboardHostContext.Provider value={host}>
          <DatabaseHistoryScope>
            <DashboardProvider>
              <TestDashboard scheduled />
            </DashboardProvider>
          </DatabaseHistoryScope>
        </DashboardHostContext.Provider>
      </DatabaseContext.Provider>
    );

    return {
      ...rendered,
      writeRows: (next: DashboardRow[]) => act(() => updateDashboardLayoutSetting(dashboard, { rows: next })),
      cleanup: () => {
        rendered.unmount();
        doc.destroy();
        mockSourceDocs.forEach((sourceDoc) => sourceDoc.destroy());
      },
    };
  }

  function widgetBox(widgetId: string) {
    const box = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);

    if (!box) throw new Error(`No widget ${widgetId}`);
    return box;
  }

  function reportLoad(viewId: string, state: 'first-data' | 'complete' | 'failed') {
    const reporter = mockLoadReporters.get(viewId);

    if (!reporter) throw new Error(`The widget of ${viewId} reports nothing`);
    act(() => reporter(state));
  }

  it('shows a queued widget with its header and the loading placeholder, and loads nothing for it', () => {
    const { cleanup } = setupQueue();

    expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
    expect(screen.getByTestId('widget-surface-v2')).toBeTruthy();
    // The third database waits for a slot: no load, no nested database, never an empty card.
    expect(screen.queryByTestId('widget-surface-v3')).toBeNull();
    expect(mockLoadedViewIds.has('v3')).toBe(false);
    expect(within(widgetBox('w3')).getByTestId('widget-header-frame')).toBeTruthy();
    expect(widgetPlaceholder('w3')?.dataset.reason).toBe('loading');
    expect(within(widgetBox('w3')).getByTestId('dashboard-widget-body')).toBeTruthy();
    cleanup();
  });

  it.each(['complete', 'failed'] as const)('starts the queued widget once a loading one is %s', (state) => {
    const { cleanup } = setupQueue();

    reportLoad('v1', 'first-data');
    expect(screen.queryByTestId('widget-surface-v3')).toBeNull();
    reportLoad('v1', state);

    expect(screen.getByTestId('widget-surface-v3')).toBeTruthy();
    expect(mockLoadedViewIds.has('v3')).toBe(true);
    cleanup();
  });

  it('starts the queued widget once a loading widget is removed', () => {
    const { writeRows, cleanup } = setupQueue();

    writeRows([{ ...QUEUED_ROWS[0], widgets: QUEUED_ROWS[0].widgets.slice(1) }]);

    expect(screen.getByTestId('widget-surface-v3')).toBeTruthy();
    cleanup();
  });

  it('starts the queued widget once a loading one turns out unavailable', () => {
    mockNoAccessViews.add('v1');
    const { cleanup } = setupQueue();

    expect(widgetPlaceholder('w1')?.dataset.reason).toBe('no-access');
    expect(screen.getByTestId('widget-surface-v2')).toBeTruthy();
    expect(screen.getByTestId('widget-surface-v3')).toBeTruthy();
    cleanup();
  });

  it('keeps a moved widget on screen without queueing it again', () => {
    const { writeRows, cleanup } = setupQueue();

    reportLoad('v1', 'complete');
    expect(screen.getByTestId('widget-surface-v3')).toBeTruthy();
    // w1 moves to a row of its own and remounts while w2 and w3 hold both slots.
    mockLoadPending = true;
    writeRows(moveDashboardWidget(QUEUED_ROWS, 'w1', { type: 'new_row', rowIndex: 1 }));

    expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
    expect(widgetPlaceholder('w1')).toBeNull();
    cleanup();
  });

  it('keeps a moved widget on screen while its permission probe answers again', () => {
    const { writeRows, cleanup } = setupQueue();

    expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
    mockLoadPending = true;
    mockPermissionPending = true;
    writeRows(moveDashboardWidget(QUEUED_ROWS, 'w1', { type: 'new_row', rowIndex: 1 }));

    expect(screen.getByTestId('widget-surface-v1')).toBeTruthy();
    expect(widgetPlaceholder('w1')).toBeNull();
    cleanup();
  });

  it('mounts no nested database before the source permission answers', () => {
    mockPermissionPending = true;
    const { cleanup } = setupQueue();

    // The doc is open, but a read-only mount would load the rows one by one and start over once writable.
    expect(screen.queryByTestId('widget-surface-v1')).toBeNull();
    expect(widgetPlaceholder('w1')?.dataset.reason).toBe('loading');
    cleanup();
  });
});

describe('leaving a dashboard', () => {
  /** Every Yjs observer registered on the types of `doc`, nested types included. */
  function countDocObservers(doc: YDoc) {
    type Observed = Y.AbstractType<unknown> & { _eH: { l: unknown[] }; _dEH: { l: unknown[] } };
    let count = 0;
    const visit = (type: unknown) => {
      if (!(type instanceof Y.AbstractType)) return;
      const observed = type as Observed;

      count += observed._eH.l.length + observed._dEH.l.length;
      if (type instanceof Y.Map) Array.from(type.values()).forEach(visit);
      if (type instanceof Y.Array) type.toArray().forEach(visit);
    };

    doc.share.forEach(visit);
    return count;
  }

  /** Observers created while the dashboard was mounted, with the boxes each still watches. */
  function installObserverRecorders() {
    const watching = new Map<string, Set<object>>();
    const roots: unknown[] = [];
    const originals = {
      IntersectionObserver: window.IntersectionObserver,
      ResizeObserver: window.ResizeObserver,
      MutationObserver: window.MutationObserver,
    };
    const recorder = (kind: string) =>
      class {
        private readonly targets = new Set<object>();

        constructor(_callback: unknown, options?: { root?: unknown }) {
          watching.set(`${kind}#${watching.size}`, this.targets);
          if (kind === 'IntersectionObserver') roots.push(options?.root);
        }

        observe(target: object) {
          this.targets.add(target);
        }

        unobserve(target: object) {
          this.targets.delete(target);
        }

        disconnect() {
          this.targets.clear();
        }

        takeRecords() {
          return [];
        }
      };

    window.IntersectionObserver = recorder('IntersectionObserver') as unknown as typeof IntersectionObserver;
    window.ResizeObserver = recorder('ResizeObserver') as unknown as typeof ResizeObserver;
    window.MutationObserver = recorder('MutationObserver') as unknown as typeof MutationObserver;
    return {
      stillWatching: () =>
        Array.from(watching.entries())
          .filter(([, targets]) => targets.size > 0)
          .map(([name]) => name),
      created: () => watching.size,
      intersectionRoots: () => roots,
      restore: () => Object.assign(window, originals),
    };
  }

  /** Whether the code that called `addEventListener` (past the spy and the test) lives under `dashboard/`. */
  function isDashboardCaller(stack: string | undefined) {
    const caller = (stack ?? '')
      .split('\n')
      .slice(1)
      .find((frame) => !frame.includes('jest-mock') && !frame.includes('__tests__'));

    return Boolean(caller && /src\/components\/database\/dashboard\//.test(caller));
  }

  /**
   * Listeners on `document` and `window` that were added and not removed, and
   * those of them that code under `dashboard/` added itself (React and jsdom
   * add a few once per document, for good).
   */
  function installListenerRecorder() {
    const live = new Map<string, number>();
    const addedByDashboard = new Set<string>();
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const idOf = (value: object) => {
      if (!ids.has(value)) ids.set(value, (nextId += 1));
      return ids.get(value);
    };

    const keyOf = (target: EventTarget, type: string, listener: unknown, options?: boolean | EventListenerOptions) => {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);

      return `${target === document ? 'document' : 'window'}:${type}:${idOf(listener as object)}:${capture}`;
    };

    // Record without changing the behaviour: call through to the real methods.
    const spies = [document, window].flatMap((target: Document | Window) => {
      const realAdd = target.addEventListener.bind(target);
      const realRemove = target.removeEventListener.bind(target);

      return [
        jest.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
          if (listener) {
            const key = keyOf(target, type, listener, options);

            live.set(key, (live.get(key) ?? 0) + 1);
            if (isDashboardCaller(new Error().stack)) addedByDashboard.add(key);
          }

          realAdd(type, listener, options);
        }),
        jest.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
          if (listener) {
            const key = keyOf(target, type, listener, options);
            const count = (live.get(key) ?? 0) - 1;

            if (count > 0) live.set(key, count);
            else live.delete(key);
          }

          realRemove(type, listener, options);
        }),
      ];
    });

    return {
      live: () => Array.from(live.keys()),
      liveFromDashboard: () => Array.from(live.keys()).filter((key) => addedByDashboard.has(key)),
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  }

  it('leaves no listener, observer or doc observer behind after three visits', () => {
    const SOURCES = ['source-a', 'source-b', 'source-c'];
    const doc = new Y.Doc({ guid: 'db' }) as YDoc;
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map<YDatabaseView>();
    const dashboard = new Y.Map() as YDatabaseView;

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.id, 'db');
    database.set(YjsDatabaseKey.views, views);
    views.set('dashboard', dashboard);
    views.set('v0', makeView());
    const sourceDocs = SOURCES.map((databaseId, index) => {
      const sourceDoc = new Y.Doc({ guid: databaseId }) as YDoc;
      const sourceDatabase = new Y.Map() as YDatabase;
      const sourceViews = new Y.Map<YDatabaseView>();

      sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, sourceDatabase);
      sourceDatabase.set(YjsDatabaseKey.id, databaseId);
      sourceDatabase.set(YjsDatabaseKey.views, sourceViews);
      sourceViews.set(`v${index + 1}`, makeView());
      mockSourceDocs.set(databaseId, sourceDoc);
      return sourceDoc;
    });

    // Two rows: the host's own view, then three widgets over three databases (one waits for a slot).
    updateDashboardLayoutSetting(dashboard, {
      rows: [
        { id: 'r0', height: 360, widgets: [{ id: 'w0', viewId: 'v0', databaseId: 'db', width: 12 }] },
        {
          id: 'r1',
          height: 360,
          widgets: SOURCES.map((databaseId, index) => ({
            id: `w${index + 1}`,
            viewId: `v${index + 1}`,
            databaseId,
            width: 4,
          })),
        },
      ],
    });
    const host: DatabaseContextState = {
      databaseDoc: doc,
      readOnly: false,
      canWrite: true,
      rowMap: {},
      databasePageId: 'dashboard',
      activeViewId: 'dashboard',
      workspaceId: 'workspace-id',
      eventEmitter: new EventEmitter(),
    };
    const docs = [doc, ...sourceDocs];
    const docObserversBefore = docs.map(countDocObservers);
    const observers = installObserverRecorders();
    const listeners = installListenerRecorder();
    const consoleWarn = jest.spyOn(console, 'warn');
    const consoleError = jest.spyOn(console, 'error');
    let listenersAfterFirstVisit: string[] | null = null;

    try {
      for (let visit = 1; visit <= 3; visit += 1) {
        const { unmount } = render(
          <DatabaseContext.Provider value={host}>
            <DatabaseHistoryScope>
              <DashboardProvider>
                <Dashboard />
              </DashboardProvider>
            </DatabaseHistoryScope>
          </DatabaseContext.Provider>
        );

        // The host's widget starts at once; the others wait for the observer's first report, which never comes here.
        expect(screen.getByTestId('widget-surface-v0')).toBeTruthy();
        expect(screen.getAllByTestId('dashboard-widget')).toHaveLength(4);
        expect(screen.queryByTestId('widget-surface-v1')).toBeNull();
        expect(widgetPlaceholder('w1')?.dataset.reason).toBe('loading');
        expect(observers.intersectionRoots().at(-1) ?? null).toBeNull();
        unmount();

        expect(observers.stillWatching()).toEqual([]);
        expect(listeners.liveFromDashboard()).toEqual([]);
        // Nothing accumulates from one visit to the next.
        listenersAfterFirstVisit ??= listeners.live();
        expect(listeners.live()).toEqual(listenersAfterFirstVisit);
        expect(docs.map(countDocObservers)).toEqual(docObserversBefore);
      }

      // One visibility observer per visit, on the viewport.
      expect(observers.intersectionRoots()).toHaveLength(3);
      // Nothing logged a DOM node: an open inspector keeps every logged node, and the tree around it, alive.
      const logged = [...consoleWarn.mock.calls, ...consoleError.mock.calls].flat();

      expect(logged.filter((value) => value instanceof Node)).toEqual([]);
    } finally {
      consoleWarn.mockRestore();
      consoleError.mockRestore();
      listeners.restore();
      observers.restore();
      doc.destroy();
      sourceDocs.forEach((sourceDoc) => sourceDoc.destroy());
    }
  });
});
