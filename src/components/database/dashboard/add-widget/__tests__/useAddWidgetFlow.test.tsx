import { act, renderHook } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  readDashboardLayoutSetting,
  replaceDashboardWidgetView,
  updateDashboardLayoutSetting,
} from '@/application/database-yjs/dashboard-layout';
import { createOwnedDatabaseView, deleteOwnedDatabaseView } from '@/application/database-yjs/dashboard-owned-view-ops';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { DashboardProvider, useDashboardContext } from '../../DashboardContext';
import { selectPendingAdd, withPendingWidget } from '../../DashboardGrid';
import { useAddWidgetFlow, UseAddWidgetFlowOptions } from '../useAddWidgetFlow';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
jest.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({ announce: jest.fn(), cleanup: jest.fn() }));

let mockPlan: string | null = 'pro';
let mockOnline = true;

jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: () => ({ loadSubscription: async () => mockPlan }),
}));
jest.mock('@/application/workspace-plan-policy', () => ({
  getWorkspacePlanPolicy: () => ({
    requiresOnlineViewCreation: () => !mockOnline,
    hasProAccess: (plan: string | null) => plan === 'pro',
    getUpgradeMessage: (message: string) => message,
  }),
}));
jest.mock('@/application/database-yjs/dashboard-owned-view-ops', () => ({
  ...jest.requireActual('@/application/database-yjs/dashboard-owned-view-ops'),
  createOwnedDatabaseView: jest.fn(),
  deleteOwnedDatabaseView: jest.fn(),
  repairDashboardOwnerMarkers: jest.fn().mockResolvedValue(0),
}));

const createMock = createOwnedDatabaseView as jest.Mock;
const deleteMock = deleteOwnedDatabaseView as jest.Mock;
const toastError = toast.error as jest.Mock;

const DATABASE_ID = 'host-db';
const DASHBOARD = 'dash';

function rowOf(id: string, count: number): DashboardRow {
  return {
    id,
    height: 360,
    widgets: Array.from({ length: count }, (_, index) => ({
      id: `${id}-w${index}`,
      viewId: `${id}-v${index}`,
      databaseId: DATABASE_ID,
      width: 12 / count,
    })),
  };
}

function createDoc(rows: DashboardRow[]) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(DASHBOARD, view);
  doc.transact(() => updateDashboardLayoutSetting(view, { rows }));
  return { doc, database, views, view };
}

/** The server's new view as it lands in the host doc: a layout, a name and the owner mirror. */
function addCreatedView(
  doc: YDoc,
  views: Y.Map<YDatabaseView>,
  viewId: string,
  layout: DatabaseViewLayout,
  name: string
) {
  const created = new Y.Map() as YDatabaseView;

  doc.transact(() => {
    created.set(YjsDatabaseKey.layout, layout as never);
    created.set(YjsDatabaseKey.name, name);
    created.set(YjsDatabaseKey.dashboard_owner, DASHBOARD);
    views.set(viewId, created);
  }, 'server');
}

/** `access.readOnly` is read on every render: a test flips it and re-renders. */
function renderFlow(
  doc: YDoc,
  database: YDatabase,
  access = { readOnly: false },
  flowOverrides: Partial<UseAddWidgetFlowOptions> = {}
) {
  const selectWidget = jest.fn();
  const announce = jest.fn();
  const updatePage = jest.fn().mockResolvedValue(undefined);
  const deletePage = jest.fn().mockResolvedValue(undefined);

  function Wrapper({ children }: { children: ReactNode }) {
    const readOnly = access.readOnly;
    const value = useMemo<DatabaseContextState>(
      () => ({
        readOnly,
        databaseDoc: doc,
        databasePageId: DASHBOARD,
        activeViewId: DASHBOARD,
        rowMap: {},
        workspaceId: 'ws',
        updatePage,
        deletePage,
      }),
      [readOnly]
    );

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider>{children}</DashboardProvider>
      </DatabaseContext.Provider>
    );
  }

  const hook = renderHook(
    () => {
      const context = useDashboardContext();
      const flow = useAddWidgetFlow({
        hostDoc: doc,
        hostDatabaseId: context.hostDatabaseId,
        canEnterEdit: context.canEnterEdit,
        editing: context.isEditing && context.canEdit,
        canEdit: context.canEdit,
        pinEditing: context.pinEditing,
        getRows: () => readDashboardLayoutSetting(database, DASHBOARD).rows,
        updateRows: context.updateRows,
        ownedViews: context.ownedViews,
        selectWidget,
        announce,
        scrollToWidget: jest.fn(),
        openSourcePanel: jest.fn(),
        preloadPicker: jest.fn(),
        workspaceId: 'ws',
        updatePage,
        ...flowOverrides,
      });

      return { context, ...flow };
    },
    { wrapper: Wrapper }
  );

  return { ...hook, selectWidget, announce, updatePage };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function stored(database: YDatabase) {
  return readDashboardLayoutSetting(database, DASHBOARD).rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = 'pro';
  mockOnline = true;
});

afterEach(() => jest.restoreAllMocks());

describe('useAddWidgetFlow', () => {
  it.each(['pro', 'free'])('adds an existing view offline on %s without creating an owned view', async (plan) => {
    mockPlan = plan;
    const { doc, database } = createDoc([]);
    const { result, selectWidget } = renderFlow(doc, database);
    const writes = jest.fn();

    doc.on('update', writes);
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(result.current.api.flow.getState().kind).toBe('choosing_existing');
    const pending = selectPendingAdd(result.current.api.flow.getState());

    expect(pending).not.toBeNull();
    expect(selectWidget).toHaveBeenCalledWith(pending!.widgetId);
    // Creation choices cannot escape the existing-only state, including programmatic dispatches.
    act(() => result.current.api.flow.dispatch({ type: 'pick_layout', layout: DatabaseViewLayout.Board }));
    act(() => result.current.api.createInDatabase('other-db', 'other-grid', DatabaseViewLayout.Grid));
    expect(result.current.api.flow.getState().kind).toBe('choosing_existing');
    expect(writes).not.toHaveBeenCalled();

    act(() => result.current.api.flow.dispatch({ type: 'pick_existing', viewId: 'shared', databaseId: 'other-db' }));
    await settle();
    expect(stored(database).flatMap((row) => row.widgets)).toEqual([
      expect.objectContaining({ id: pending!.widgetId, viewId: 'shared', databaseId: 'other-db' }),
    ]);
    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('dismisses an offline pending add without writing a widget or creating a view', async () => {
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);
    const writes = jest.fn();

    doc.on('update', writes);
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    act(() => result.current.api.flow.dispatch({ type: 'dismiss' }));
    await settle();
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    expect(stored(database)).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rechecks capacity after an offline existing-view picker opened, without deleting the shared view', async () => {
    const { doc, database, view } = createDoc([rowOf('a', 4), rowOf('b', 4), rowOf('c', 3)]);
    const { result, announce } = renderFlow(doc, database);

    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    act(() => doc.transact(() => updateDashboardLayoutSetting(view, {
      rows: [rowOf('a', 4), rowOf('b', 4), rowOf('c', 4)],
    }), 'remote'));
    act(() => result.current.api.flow.dispatch({ type: 'pick_existing', viewId: 'shared', databaseId: 'other-db' }));
    await settle();
    expect(stored(database).flatMap((row) => row.widgets)).toHaveLength(12);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Dashboard is full'));
    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it.each([
    { code: 1012, message: 'Permission denied' },
    { code: 1028, message: 'Storage limit exceeded' },
    { code: 400, message: 'Dashboard is full' },
    { code: -1, message: 'Network unavailable' },
  ])('does not retry a rejected Chart as Table for $message', async (error) => {
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);

    createMock.mockRejectedValue(error);
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(stored(database)).toEqual([]);
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    expect(toastError).toHaveBeenCalledWith(error.message);
  });

  it('refuses a full dashboard before creating anything (#16)', async () => {
    const { doc, database } = createDoc([rowOf('a', 4), rowOf('b', 4), rowOf('c', 4)]);
    const { result, announce } = renderFlow(doc, database);

    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(createMock).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Dashboard is full'));
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
  });

  it('refuses the add to a full row with the row message, creating nothing', async () => {
    const { doc, database } = createDoc([rowOf('a', 4)]);
    const { result, announce } = renderFlow(doc, database);

    act(() => result.current.startAddWidget({ type: 'existing_row', rowId: 'a', index: 4 }));
    await settle();

    expect(createMock).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('A row holds up to'));
  });

  it('inserts one selected widget with the id it showed while pending, split 12 / n, as one undo step', async () => {
    const { doc, database, views } = createDoc([rowOf('a', 1)]);
    const history = getOrCreateDatabaseHistoryManager(doc);
    const { result, selectWidget } = renderFlow(doc, database);

    let release: () => void = () => undefined;

    createMock.mockImplementation(
      (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) =>
        new Promise<string>((resolve) => {
          release = () => {
            addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
            resolve('chart-1');
          };
        })
    );
    act(() => result.current.startAddWidget({ type: 'existing_row', rowId: 'a', index: 1 }));
    await settle();

    // Pending first: a preview at its place, selected, never persisted.
    const pending = selectPendingAdd(result.current.api.flow.getState());

    expect(pending).not.toBeNull();
    const widgetId = pending?.widgetId as string;

    expect(withPendingWidget(stored(database), pending)[0].widgets.map((widget) => [widget.id, widget.width])).toEqual([
      ['a-w0', 6],
      [widgetId, 6],
    ]);
    expect(stored(database)[0].widgets).toHaveLength(1);
    expect(selectWidget).toHaveBeenCalledWith(widgetId);
    await act(async () => {
      release();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        databaseId: DATABASE_ID,
        anchorViewId: DASHBOARD,
        layout: DatabaseViewLayout.Chart,
        baseName: 'Chart',
        owner: DASHBOARD,
      })
    );
    expect(stored(database)[0].widgets.map((widget) => [widget.id, widget.viewId, widget.width])).toEqual([
      ['a-w0', 'a-v0', 6],
      [widgetId, 'chart-1', 6],
    ]);
    expect(result.current.api.flow.getState()).toMatchObject({ kind: 'open', widgetId, viewId: 'chart-1' });

    // The seeded chart is not in the history: undo removes the widget only, redo brings it back.
    const chart = () =>
      (views.get('chart-1')?.get(YjsDatabaseKey.layout_settings) as unknown as Y.Map<Y.Map<unknown>>).get('3');

    expect(chart()?.get('chart_type')).toBe(4);
    act(() => {
      history.undo();
    });
    expect(stored(database)[0].widgets.map((widget) => widget.id)).toEqual(['a-w0']);
    expect(chart()?.get('show_title')).toBe(true);
    act(() => {
      history.redo();
    });
    expect(stored(database)[0].widgets.map((widget) => widget.id)).toEqual(['a-w0', widgetId]);
  });

  it('retries a Chart the plan refuses as a table named "Table"', async () => {
    const { doc, database, views } = createDoc([]);
    const { result } = renderFlow(doc, database);

    createMock
      .mockRejectedValueOnce({ code: 1076, message: 'Pro required' })
      .mockImplementationOnce(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
        addCreatedView(doc, views, 'table-1', params.layout, params.baseName);
        return 'table-1';
      });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(createMock.mock.calls.map(([, params]) => [params.layout, params.baseName])).toEqual([
      [DatabaseViewLayout.Chart, 'Chart'],
      [DatabaseViewLayout.Grid, 'Table'],
    ]);
    expect(stored(database)[0].widgets[0].viewId).toBe('table-1');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('starts with a table where Number charts are not available', async () => {
    mockPlan = 'free';
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);

    createMock.mockResolvedValue('table-1');
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(createMock.mock.calls[0][1]).toMatchObject({ layout: DatabaseViewLayout.Grid, baseName: 'Table' });
  });

  it('rechecks connectivity after resolving the default plan without creating a local fallback', async () => {
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);

    act(() => result.current.startAddWidget({ type: 'new_row' }));
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await settle();

    expect(createMock).not.toHaveBeenCalled();
    expect(stored(database)).toEqual([]);
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    expect(toastError).toHaveBeenCalledWith('Connect to the internet to create dashboard widget views.');
  });

  it.each(['new-source-view', 'existing-source-view'])('handles an offline %s choice without creating a view', async (choice) => {
    const { doc, database, views } = createDoc([rowOf('a', 1)]);
    const { result } = renderFlow(doc, database);

    createMock.mockImplementation(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    const before = stored(database);

    createMock.mockClear();
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      if (choice === 'new-source-view') {
        result.current.api.createInDatabase('other-db', 'other-anchor', DatabaseViewLayout.Board);
      } else {
        result.current.api.flow.dispatch({ type: 'pick_existing', viewId: 'a-v0', databaseId: DATABASE_ID });
      }
    });
    await settle();

    expect(createMock).not.toHaveBeenCalled();
    if (choice === 'new-source-view') {
      expect(stored(database)).toEqual(before);
      expect(toastError).toHaveBeenCalledWith('Connect to the internet to create dashboard widget views.');
    } else {
      expect(stored(database).flatMap((row) => row.widgets).map((widget) => widget.viewId)).toEqual(['a-v0', 'a-v0']);
      expect(toastError).not.toHaveBeenCalled();
    }
  });

  it('removes the pending widget and says so when the view cannot be created', async () => {
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);
    const writes = jest.fn();

    doc.on('update', writes);
    createMock.mockRejectedValue(new Error('offline'));
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    expect(toastError).toHaveBeenCalledWith('offline');
    expect(stored(database)).toEqual([]);
  });

  it('deletes the created view when a collaborator filled the dashboard meanwhile', async () => {
    const { doc, database, view } = createDoc([rowOf('a', 4), rowOf('b', 4), rowOf('c', 3)]);
    const { result, announce } = renderFlow(doc, database);

    createMock.mockImplementation(async () => {
      doc.transact(
        () => updateDashboardLayoutSetting(view, { rows: [rowOf('a', 4), rowOf('b', 4), rowOf('c', 4)] }),
        'remote'
      );
      return 'late-view';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();

    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'late-view', databaseId: DATABASE_ID });
    expect(stored(database).flatMap((row) => row.widgets.map((widget) => widget.viewId))).not.toContain('late-view');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Dashboard is full'));
  });

  it('puts the widget in a new row below its row when a collaborator filled that row meanwhile', async () => {
    const { doc, database, view } = createDoc([rowOf('a', 3), rowOf('b', 1)]);
    const { result, announce } = renderFlow(doc, database);

    createMock.mockImplementation(async () => {
      doc.transact(() => updateDashboardLayoutSetting(view, { rows: [rowOf('a', 4), rowOf('b', 1)] }), 'remote');
      return 'late-view';
    });
    act(() => result.current.startAddWidget({ type: 'existing_row', rowId: 'a', index: 3 }));
    await settle();

    const rows = stored(database);

    expect(rows.map((row) => row.widgets.map((widget) => widget.viewId))).toEqual([
      ['a-v0', 'a-v1', 'a-v2', 'a-v3'],
      ['late-view'],
      ['b-v0'],
    ]);
    // A move to a new row is not a refusal: nothing is deleted or announced.
    expect(deleteMock).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('still inserts the widget when Edit mode is left during the creation, without a picker', async () => {
    const { doc, database } = createDoc([]);
    const { result } = renderFlow(doc, database);
    let resolve: (id: string) => void = () => undefined;

    createMock.mockImplementation(() => new Promise<string>((done) => (resolve = done)));
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    act(() => result.current.context.setEditing(false));
    await act(async () => {
      resolve('chart-1');
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(stored(database)[0].widgets[0].viewId).toBe('chart-1');
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
  });

  it('swaps to a picked view in one write and queues the default view', async () => {
    const { doc, database, views } = createDoc([rowOf('a', 1)]);
    const { result } = renderFlow(doc, database);
    const enqueue = jest.spyOn(result.current.context.ownedViews, 'enqueueOwnedViewDeletion');

    createMock.mockImplementation(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    const writes = jest.fn();

    doc.on('update', writes);
    act(() => result.current.api.flow.dispatch({ type: 'pick_existing', viewId: 'a-v0', databaseId: DATABASE_ID }));

    expect(writes).toHaveBeenCalledTimes(1);
    expect(stored(database)[1].widgets[0].viewId).toBe('a-v0');
    expect(enqueue).toHaveBeenCalledWith('chart-1', DATABASE_ID);
  });

  it('switches its own view for a type pick and renames an untouched name, outside the undo history', async () => {
    const { doc, database, views } = createDoc([]);
    const history = getOrCreateDatabaseHistoryManager(doc);
    const { result, updatePage } = renderFlow(doc, database);
    const switchLayout = jest.fn();

    createMock.mockImplementation(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    act(() => result.current.bindFlowView({ viewId: 'chart-1', switchLayout }));
    const undoState = history.getSnapshot();
    const rowsBefore = stored(database);

    act(() => result.current.api.flow.dispatch({ type: 'pick_layout', layout: DatabaseViewLayout.Board }));
    await settle();

    expect(switchLayout).toHaveBeenCalledWith(DatabaseViewLayout.Board);
    expect(updatePage).toHaveBeenCalledWith('chart-1', { name: 'Board' });
    expect(views.get('chart-1')?.get(YjsDatabaseKey.name)).toBe('Board');
    expect(stored(database)).toBe(rowsBefore);
    expect(history.getSnapshot()).toBe(undoState);
  });

  it('deletes the created view without an announcement when write access went during the creation', async () => {
    const { doc, database } = createDoc([]);
    const access = { readOnly: false };
    const { result, rerender, announce } = renderFlow(doc, database, access);
    let resolve: (id: string) => void = () => undefined;

    createMock.mockImplementation(() => new Promise<string>((done) => (resolve = done)));
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    access.readOnly = true;
    rerender();
    await act(async () => {
      resolve('chart-1');
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    // The view never got its widget: deleted, but the dashboard is not full.
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'chart-1', databaseId: DATABASE_ID });
    expect(stored(database)).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
  });

  it('deletes a view created in another database when its widget went before the creation landed', async () => {
    const { doc, database, views } = createDoc([]);
    const { result } = renderFlow(doc, database);
    let resolve: (id: string) => void = () => undefined;

    createMock.mockImplementationOnce(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    expect(result.current.api.flow.getState()).toMatchObject({ kind: 'open', viewId: 'chart-1' });
    const enqueue = jest.spyOn(result.current.context.ownedViews, 'enqueueOwnedViewDeletion');

    createMock.mockImplementationOnce(() => new Promise<string>((done) => (resolve = done)));
    act(() => result.current.api.createInDatabase('other-db', 'other-anchor', DatabaseViewLayout.Board));
    expect(createMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ databaseId: 'other-db', anchorViewId: 'other-anchor', layout: DatabaseViewLayout.Board })
    );

    // The widget is removed while the request is in flight (Delete, undo, a collaborator).
    act(() => {
      result.current.context.updateRows(() => []);
    });
    await act(async () => {
      resolve('other-1');
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    // Nothing references the new view, and the queue never saw it: it goes now.
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'other-1', databaseId: 'other-db' });
    expect(stored(database)).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps a newer source choice and deletes a view whose creation finished afterwards', async () => {
    const { doc, database, views } = createDoc([]);
    const { result } = renderFlow(doc, database);
    let resolve: (id: string) => void = () => undefined;

    createMock.mockImplementationOnce(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    const widgetId = stored(database)[0].widgets[0].id;
    const enqueue = jest.spyOn(result.current.context.ownedViews, 'enqueueOwnedViewDeletion');

    createMock.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    act(() => result.current.api.createInDatabase('other-db', 'other-anchor', DatabaseViewLayout.Board));
    expect(result.current.api.flow.getState()).toEqual({ kind: 'idle' });
    // Source settings stay usable while the other database creates the view.
    act(() => {
      result.current.context.updateRows((rows) => replaceDashboardWidgetView(rows, widgetId, 'chosen-view', 'chosen-db'));
    });
    await act(async () => {
      resolve('late-created-view');
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(stored(database)[0].widgets[0]).toMatchObject({ viewId: 'chosen-view', databaseId: 'chosen-db' });
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'late-created-view', databaseId: 'other-db' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'host', 'dashboard'] as const)('does not apply a created source after the %s changes', async (scope) => {
    const { doc, database, views } = createDoc([]);
    const overrides: Partial<UseAddWidgetFlowOptions> = {};
    const { result, rerender } = renderFlow(doc, database, { readOnly: false }, overrides);
    let resolve: (id: string) => void = () => undefined;

    createMock.mockImplementationOnce(async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      addCreatedView(doc, views, 'chart-1', params.layout, params.baseName);
      return 'chart-1';
    });
    act(() => result.current.startAddWidget({ type: 'new_row' }));
    await settle();
    const originatingOwnedViews = result.current.context.ownedViews;
    const newerCleanup = jest.fn();
    const newerUpdate = jest.fn();

    createMock.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    act(() => result.current.api.createInDatabase('other-db', 'other-anchor', DatabaseViewLayout.Board));
    overrides.updateRows = newerUpdate;
    overrides.ownedViews = { ...originatingOwnedViews, deleteOwnedViewNow: newerCleanup };
    if (scope === 'workspace') overrides.workspaceId = 'new-workspace';
    if (scope === 'host') overrides.hostDoc = createDoc([]).doc;
    if (scope === 'dashboard') overrides.ownedViews.createWidgetView = jest.fn();
    rerender();

    await act(async () => {
      resolve('late-created-view');
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(newerUpdate).not.toHaveBeenCalled();
    expect(newerCleanup).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'late-created-view', databaseId: 'other-db' });
    expect(stored(database)[0].widgets[0].viewId).toBe('chart-1');
  });
});
