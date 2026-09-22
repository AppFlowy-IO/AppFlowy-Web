import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { moveDashboardWidget, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardLocalWidgetChanges,
} from '../DashboardContext';
import { DashboardGrid } from '../DashboardGrid';
import { DashboardHostContext, DashboardUiContext } from '../DashboardUiContext';

const mockWidgetViews = new Map<string, YDatabaseView>();

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
jest.mock('@/components/database', () => ({
  Database: ({
    activeViewId,
    viewConditionsOverlay,
  }: {
    activeViewId: string;
    viewConditionsOverlay?: YDatabaseView;
  }) => {
    if (viewConditionsOverlay) mockWidgetViews.set(activeViewId, viewConditionsOverlay);
    return null;
  },
}));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: () => ({ doc: null, notFound: false, noAccess: false, setNotFound: jest.fn() }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => 'none',
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({
  useViewMeta: () => ({ viewMeta: null }),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: () => null,
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
  const { rows, updateRows } = useDashboardContext();
  const { resetViewOverlays, commitViewOverlays } = useDashboardFilters();
  const { unsaved: localWidgetChanges } = useDashboardLocalWidgetChanges();

  return (
    <DashboardUiContext.Provider
      value={{
        hostDatabaseId: 'db',
        dndInstanceId: Symbol.for('dashboard-lifecycle-test'),
        getRows: () => rows,
        updateRows,
        openPicker: jest.fn(),
        showLimitMessage: jest.fn(),
        acquireSourceDoc: () => jest.fn(),
      }}
    >
      <DashboardGrid />
      <output data-testid='private-changes'>{localWidgetChanges}</output>
      <button onClick={resetViewOverlays}>Reset</button>
      <button onClick={commitViewOverlays}>Save</button>
    </DashboardUiContext.Provider>
  );
}

function setup(strict = false) {
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
  updateDashboardLayoutSetting(dashboard, { rows: ROWS });
  updateDashboardLayoutSetting(otherDashboard, { rows: ROWS });
  const host: DatabaseContextState = {
    databaseDoc: doc,
    readOnly: false,
    canWrite: true,
    rowMap: {},
    databasePageId: 'dashboard',
    activeViewId: 'dashboard',
  };
  const tree = (activeViewId = 'dashboard') => {
    const content = (
      <DatabaseContext.Provider value={{ ...host, activeViewId }}>
        <DashboardHostContext.Provider value={host}>
          <DashboardProvider>
            <TestDashboard />
          </DashboardProvider>
        </DashboardHostContext.Provider>
      </DatabaseContext.Provider>
    );

    return strict ? <StrictMode>{content}</StrictMode> : content;
  };

  const rendered = render(tree());

  return {
    ...rendered,
    doc,
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

beforeEach(() => mockWidgetViews.clear());

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
