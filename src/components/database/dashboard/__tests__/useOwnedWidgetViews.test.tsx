import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  deleteOwnedDatabaseView,
  duplicateOwnedDatabaseView,
  renameDatabaseViewInDoc,
  repairDashboardOwnerMarkers,
} from '@/application/database-yjs/dashboard-owned-view-ops';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { DashboardProvider, useDashboardContext } from '../DashboardContext';
import { useOwnedWidgetViews } from '../hooks/useOwnedWidgetViews';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({ announce: jest.fn(), cleanup: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
jest.mock('@/application/database-yjs/dashboard-owned-view-ops', () => ({
  ...jest.requireActual('@/application/database-yjs/dashboard-owned-view-ops'),
  createOwnedDatabaseView: jest.fn(),
  duplicateOwnedDatabaseView: jest.fn(),
  deleteOwnedDatabaseView: jest.fn(),
  renameDatabaseViewInDoc: jest.fn(),
  repairDashboardOwnerMarkers: jest.fn().mockResolvedValue(0),
  resolveDashboardViewOwner: jest.fn(async (_deps: unknown, viewId: string) =>
    viewId.startsWith('copy') ? 'dash' : null
  ),
}));

const liveRegion = jest.requireMock('@atlaskit/pragmatic-drag-and-drop-live-region') as { announce: jest.Mock };
const duplicateMock = duplicateOwnedDatabaseView as jest.Mock;
const deleteMock = deleteOwnedDatabaseView as jest.Mock;
const renameMock = renameDatabaseViewInDoc as jest.Mock;
const repairMock = repairDashboardOwnerMarkers as jest.Mock;

const DATABASE_ID = 'host-db';
const DASHBOARD = 'dash';

function widgetRow(id: string, count: number, prefix = id): DashboardRow {
  return {
    id,
    height: 360,
    widgets: Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-w${index}`,
      viewId: `${prefix}-v${index}`,
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

function render(doc: YDoc, options: { readOnly?: boolean; updatePage?: jest.Mock } = {}) {
  const updatePage = options.updatePage ?? jest.fn().mockResolvedValue(undefined);
  const value: DatabaseContextState = {
    readOnly: options.readOnly ?? false,
    databaseDoc: doc,
    databasePageId: DASHBOARD,
    activeViewId: DASHBOARD,
    rowMap: {},
    workspaceId: 'ws',
    updatePage,
    deletePage: jest.fn().mockResolvedValue(undefined),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={value}>
      <DashboardProvider>{children}</DashboardProvider>
    </DatabaseContext.Provider>
  );

  return { ...renderHook(() => useDashboardContext(), { wrapper }), updatePage };
}

function stored(database: YDatabase) {
  return readDashboardLayoutSetting(database, DASHBOARD).rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  let copies = 0;

  duplicateMock.mockImplementation(async () => {
    copies += 1;
    return `copy-${copies}`;
  });
  deleteMock.mockResolvedValue(undefined);
  renameMock.mockResolvedValue(true);
});

it('keeps immediate cleanup bound to its original workspace and document after hook reuse', async () => {
  const originalDoc = createDoc([]).doc;
  const nextDoc = createDoc([]).doc;
  let context: DatabaseContextState = {
    databaseDoc: originalDoc, databasePageId: DASHBOARD, activeViewId: DASHBOARD,
    workspaceId: 'first-workspace', rowMap: {}, readOnly: false, deletePage: jest.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const { result, rerender } = renderHook(() => useOwnedWidgetViews({
    dashboardViewId: DASHBOARD, hostDatabaseId: DATABASE_ID, canEdit: false, mobileContext: false,
    updateRows: () => false, getRows: () => [], ownerOfNow: () => null, getSourceDoc: () => undefined,
  }), { wrapper });
  const originalCleanup = result.current.deleteOwnedViewNow;
  const refreshedDelete = jest.fn();

  context = { ...context, deletePage: refreshedDelete };
  rerender();
  const nextDelete = jest.fn();

  context = { ...context, databaseDoc: nextDoc, workspaceId: 'next-workspace', deletePage: nextDelete };
  rerender();
  await originalCleanup('never-referenced', 'source-db');
  expect(deleteMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ databaseDoc: originalDoc, deletePage: refreshedDelete }),
    { viewId: 'never-referenced', databaseId: 'source-db' }
  );
  await result.current.deleteOwnedViewNow('current-view', 'source-db');
  expect(deleteMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ databaseDoc: nextDoc, deletePage: nextDelete }),
    { viewId: 'current-view', databaseId: 'source-db' }
  );
});

describe('useOwnedWidgetViews: duplicate (WP05 §1.4)', () => {
  it('copies the view as an owned, numbered view and inserts the copy next to the source', async () => {
    const { doc, database } = createDoc([widgetRow('r1', 1)]);
    const { result } = render(doc);

    await act(async () => {
      await result.current.ownedViews.duplicateWidget('r1-w0');
    });

    expect(duplicateMock).toHaveBeenCalledWith(
      expect.objectContaining({ databaseDoc: doc }),
      expect.objectContaining({ sourceViewId: 'r1-v0', databaseId: DATABASE_ID, owner: DASHBOARD, numbered: true })
    );
    const [row] = stored(database);

    expect(row.widgets.map((widget) => [widget.viewId, widget.width])).toEqual([
      ['r1-v0', 6],
      ['copy-1', 6],
    ]);
  });

  it('refuses on a full dashboard before creating anything', async () => {
    const { doc, database } = createDoc([widgetRow('a', 4), widgetRow('b', 4), widgetRow('c', 4)]);
    const { result } = render(doc);

    await act(async () => {
      await result.current.ownedViews.duplicateWidget('a-w0');
    });

    expect(duplicateMock).not.toHaveBeenCalled();
    expect(liveRegion.announce).toHaveBeenCalledWith(expect.stringContaining('Dashboard is full'));
    expect(stored(database).flatMap((row) => row.widgets)).toHaveLength(12);
  });

  it('deletes the copy at once when a concurrent edit filled the dashboard meanwhile', async () => {
    const { doc, database, view } = createDoc([widgetRow('a', 4), widgetRow('b', 4), widgetRow('c', 3)]);
    const { result } = render(doc);

    duplicateMock.mockImplementationOnce(async () => {
      // A collaborator adds the twelfth widget while the copy is being created.
      doc.transact(() =>
        updateDashboardLayoutSetting(view, { rows: [widgetRow('a', 4), widgetRow('b', 4), widgetRow('c', 4)] })
      );
      return 'copy-late';
    });
    await act(async () => {
      await result.current.ownedViews.duplicateWidget('a-w0');
    });

    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'copy-late', databaseId: DATABASE_ID });
    expect(stored(database).flatMap((row) => row.widgets.map((widget) => widget.viewId))).not.toContain('copy-late');
    // The refusal is announced once, and the dashboard keeps the collaborator's 12 widgets.
    expect(liveRegion.announce.mock.calls).toEqual([[expect.stringContaining('Dashboard is full')]]);
    expect(stored(database).flatMap((row) => row.widgets)).toHaveLength(12);
  });

  it('disables Duplicate for the widget while its copy is being created', async () => {
    const { doc } = createDoc([widgetRow('r1', 1)]);
    const { result } = render(doc);
    let release: (id: string) => void = () => undefined;

    duplicateMock.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    let pending: Promise<void> = Promise.resolve();

    act(() => {
      pending = result.current.ownedViews.duplicateWidget('r1-w0');
    });
    expect(result.current.ownedViews.duplicatingWidget.get()).toBe('r1-w0');
    // A second click while in flight creates nothing more.
    await act(async () => {
      await result.current.ownedViews.duplicateWidget('r1-w0');
    });
    expect(duplicateMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release('copy-x');
      await pending;
    });
    expect(result.current.ownedViews.duplicatingWidget.get()).toBeNull();
  });

  it('queues the copy when its insert is undone, and deletes it on Done', async () => {
    const { doc, views } = createDoc([widgetRow('r1', 1)]);
    const history = getOrCreateDatabaseHistoryManager(doc);
    const { result } = render(doc);

    act(() => result.current.setEditing(true));
    await act(async () => {
      await result.current.ownedViews.duplicateWidget('r1-w0');
    });
    // The copy's collab mirror names this dashboard (written when it was created).
    const copy = new Y.Map() as YDatabaseView;

    doc.transact(() => {
      copy.set(YjsDatabaseKey.dashboard_owner, DASHBOARD);
      views.set('copy-1', copy);
    }, 'seed');
    act(() => {
      history.undo();
    });
    act(() => result.current.setEditing(false));
    await act(async () => {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), { viewId: 'copy-1', databaseId: DATABASE_ID });
  });

  it('is refused in a mobile context (an edit-only write)', async () => {
    const { doc } = createDoc([widgetRow('r1', 1)]);
    const originalWidth = window.innerWidth;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    const { result } = render(doc);

    expect(result.current.mobileContext).toBe(true);
    await act(async () => {
      await result.current.ownedViews.duplicateWidget('r1-w0');
    });
    await expect(result.current.ownedViews.createDefaultWidgetView('chart', 'Chart')).rejects.toThrow();
    expect(await result.current.ownedViews.renameWidgetView('r1-w0', 'Renamed', { name: 'Grid' })).toBe(false);
    expect(duplicateMock).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    window.dispatchEvent(new Event('resize'));
  });
});

describe('useOwnedWidgetViews: repair on open (WP05 §2.2 step 3.3)', () => {
  it("repairs once per open through the docs the dashboard has open, never loading a source itself", () => {
    const rows = [widgetRow('r1', 2)];
    const { doc } = createDoc(rows);
    const { rerender } = render(doc);

    expect(repairMock).toHaveBeenCalledTimes(1);
    const [, dashboardViewId, repairedRows, options] = repairMock.mock.calls[0] as [
      unknown,
      string,
      DashboardRow[],
      { getOpenDoc: (databaseId: string) => YDoc | undefined },
    ];

    expect(dashboardViewId).toBe(DASHBOARD);
    expect(repairedRows.map((row) => row.id)).toEqual(['r1']);
    // The host doc is always open; a source that is not registered resolves to nothing (no load).
    expect(options.getOpenDoc(DATABASE_ID)).toBe(doc);
    expect(options.getOpenDoc('other-db')).toBeUndefined();
    rerender();
    expect(repairMock).toHaveBeenCalledTimes(1);
  });

  it('does not repair for a reader or a dashboard without widgets', () => {
    render(createDoc([widgetRow('r1', 1)]).doc, { readOnly: true });
    render(createDoc([]).doc);
    expect(repairMock).not.toHaveBeenCalled();
  });
});

describe('useOwnedWidgetViews: rename (WP05 §2.2 step 8)', () => {
  it('renames a host view in its folder and its collab', async () => {
    const { doc } = createDoc([widgetRow('r1', 1)]);
    const { result, updatePage } = render(doc);
    let renamed = false;

    await act(async () => {
      renamed = await result.current.ownedViews.renameWidgetView('r1-w0', '  Pipeline board ', { name: 'Grid' });
    });

    expect(renamed).toBe(true);
    expect(updatePage).toHaveBeenCalledWith('r1-v0', { name: 'Pipeline board' });
    expect(renameMock).toHaveBeenCalledWith({ doc, viewId: 'r1-v0', name: 'Pipeline board' });
  });

  it("renames a view of another database in that database's doc", async () => {
    const foreignDoc = new Y.Doc() as unknown as YDoc;
    const { doc } = createDoc([
      { id: 'r1', height: 360, widgets: [{ id: 'w1', viewId: 'tasks-grid', databaseId: 'tasks-db', width: 12 }] },
    ]);
    const { result, updatePage } = render(doc);

    await act(async () => {
      await result.current.ownedViews.renameWidgetView('w1', 'Due', { name: 'Grid', doc: foreignDoc });
    });

    expect(renameMock).toHaveBeenCalledWith({ doc: foreignDoc, viewId: 'tasks-grid', name: 'Due', updatePage });
  });

  it('changes nothing for an empty or unchanged name', async () => {
    const { doc } = createDoc([widgetRow('r1', 1)]);
    const { result, updatePage } = render(doc);

    expect(await result.current.ownedViews.renameWidgetView('r1-w0', '   ', { name: 'Grid' })).toBe(false);
    expect(await result.current.ownedViews.renameWidgetView('r1-w0', 'Grid ', { name: 'Grid' })).toBe(false);
    expect(updatePage).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });
});
