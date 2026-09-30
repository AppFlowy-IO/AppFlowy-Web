import { act, fireEvent, render, screen } from '@testing-library/react';
import EventEmitter from 'events';
import { ReactNode, StrictMode } from 'react';
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
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import { WIDGET_GRID_ROW_GUTTER, WIDGET_INLINE_PADDING, WIDGET_MISSING_GRACE_MS } from '../constants';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardLayout,
  useDashboardLocalWidgetChanges,
  useDashboardSourceRegistry,
} from '../DashboardContext';
import { DashboardGrid } from '../DashboardGrid';
import { DashboardHostContext, DashboardUiContext } from '../DashboardUiContext';
import { useSourceDocRegistry } from '../hooks/useSourceDocRegistry';
import { WidgetActions } from '../WidgetContext';

const mockWidgetViews = new Map<string, YDatabaseView>();
const mockWidgetPaddings = new Map<string, number | undefined>();
const mockWidgetActions = new Map<string, WidgetActions>();
const mockWidgetSubscriptions = new Map<string, unknown>();
const mockSourceDocs = new Map<string, YDoc>();
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
  }: {
    doc: YDoc;
    activeViewId: string;
    paddingStart?: number;
    viewConditionsOverlay?: YDatabaseView;
    getSubscriptions?: unknown;
  }) => {
    const { useWidgetContext } = jest.requireActual<typeof import('../WidgetContext')>('../WidgetContext');
    const { DatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs')>(
      '@/application/database-yjs'
    );
    const { DatabaseHistoryScope } = jest.requireActual<typeof import('@/components/database/DatabaseHistoryScope')>(
      '@/components/database/DatabaseHistoryScope'
    );

    mockWidgetActions.set(activeViewId, useWidgetContext().actions);
    if (viewConditionsOverlay) mockWidgetViews.set(activeViewId, viewConditionsOverlay);
    mockWidgetPaddings.set(activeViewId, paddingStart);
    mockWidgetSubscriptions.set(activeViewId, getSubscriptions);
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
  useDocumentLoader: ({ viewId, databaseId }: { viewId: string; databaseId: string }) => {
    const [pending] = jest.requireActual<typeof import('react')>('react').useState(() => mockLoadPending);
    const noAccess = !pending && mockNoAccessViews.has(viewId);

    return {
      doc: pending || noAccess ? null : mockSourceDocs.get(databaseId) ?? null,
      notFound: noAccess,
      noAccess,
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
    children: (permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean }) => ReactNode;
  }) => children({ readOnly: false, canWrite: true, canShare: false }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  useDraggableWidget: () => undefined,
  useWidgetDropTarget: () => null,
  useRowGapDropTarget: () => false,
}));
jest.mock('../WidgetHeader', () => ({ WidgetHeaderFrame: () => null }));

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

function TestDashboard() {
  const { updateRows } = useDashboardContext();
  const { rows } = useDashboardLayout();
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
      }}
    >
      <DashboardGrid />
      <output data-testid='private-changes'>{localWidgetChanges}</output>
      <button onClick={resetViewOverlays}>Reset</button>
      <button onClick={() => commitViewOverlays()}>Save</button>
    </DashboardUiContext.Provider>
  );
}

function setup(strict = false, readOnly = false, sourceDoc?: YDoc, appOperations?: AppOperationsContextType) {
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
  const tree = (activeViewId = 'dashboard') => {
    const content = (
      <DatabaseContext.Provider value={{ ...host, activeViewId }}>
        <DashboardHostContext.Provider value={host}>
          <DatabaseHistoryScope>
            <DashboardProvider>
              <TestDashboard />
            </DashboardProvider>
          </DatabaseHistoryScope>
        </DashboardHostContext.Provider>
      </DatabaseContext.Provider>
    );

    const withApp = appOperations ? (
      <AppOperationsContext.Provider value={appOperations}>{content}</AppOperationsContext.Provider>
    ) : (
      content
    );

    return strict ? <StrictMode>{withApp}</StrictMode> : withApp;
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
  jest.useRealTimers();
});

function widgetPlaceholder(widgetId: string) {
  return document.querySelector<HTMLElement>(
    `[data-widget-id="${widgetId}"] [data-testid="dashboard-widget-placeholder"]`
  );
}

it("forwards the app's subscription lookup, so the widget's layout switcher can check the plan", () => {
  const getSubscriptions = jest.fn().mockResolvedValue([]);
  const { doc, unmount } = setup(false, false, undefined, { getSubscriptions } as unknown as AppOperationsContextType);

  expect(mockWidgetSubscriptions.get('v1')).toBe(getSubscriptions);
  unmount();
  doc.destroy();
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
  writeRows([
    { id: 'r3', height: 360, widgets: [{ id: 'w3', viewId: 'v3', databaseId: 'source-db', width: 12 }] },
  ]);
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
