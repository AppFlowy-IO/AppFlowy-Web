import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  duplicateDashboardWidget,
  moveDashboardWidget,
  readDashboardLayoutSetting,
  updateDashboardLayoutSetting,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardContextOptional,
  useDashboardFilters,
  useDashboardLayout,
  useDashboardSourceRegistry,
  useDashboardSources,
} from '@/components/database/dashboard/DashboardContext';
import { DashboardModeStore } from '@/components/database/dashboard/hooks/useDashboardModeStore';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const DATABASE_ID = 'host-database';
const DASHBOARD_VIEW_ID = 'dashboard-view';
const OTHER_VIEW_ID = 'other-dashboard-view';

const ROWS: DashboardRow[] = [
  {
    id: 'r1',
    height: 480,
    widgets: [
      { id: 'w1', viewId: 'grid-view', databaseId: DATABASE_ID, width: 8 },
      { id: 'w2', viewId: 'board-view', databaseId: 'other-database', width: 4 },
    ],
  },
];

const GLOBAL_FILTER: DashboardGlobalFilter = {
  id: 'gf:1',
  name: 'Status',
  fieldType: FieldType.RichText,
  condition: 0,
  content: 'done',
  targets: { [DATABASE_ID]: 'status' },
};

function createDatabaseDoc() {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const otherView = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(DASHBOARD_VIEW_ID, view);
  views.set(OTHER_VIEW_ID, otherView);
  doc.transact(() => {
    updateDashboardLayoutSetting(view, { rows: ROWS, globalFilters: [GLOBAL_FILTER] });
  });

  return { doc, database, view };
}

type Options = {
  readOnly?: boolean;
  activeViewId?: string;
  modeStore?: DashboardModeStore;
  deletePage?: DatabaseContextState['deletePage'];
};

function renderDashboard(doc: YDoc, initial: Options = {}) {
  const current: Options = { readOnly: false, activeViewId: DASHBOARD_VIEW_ID, ...initial };
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: DatabaseContextState = {
      readOnly: current.readOnly ?? false,
      databaseDoc: doc,
      databasePageId: DASHBOARD_VIEW_ID,
      activeViewId: current.activeViewId ?? DASHBOARD_VIEW_ID,
      rowMap: {},
      workspaceId: 'workspace-id',
      deletePage: current.deletePage,
    };

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider modeStore={current.modeStore}>{children}</DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  const hook = renderHook(
    () => {
      const context = useDashboardContext();
      const layout = useDashboardLayout();
      const filters = useDashboardFilters();
      const sources = useDashboardSources();
      const registry = useDashboardSourceRegistry();

      return { ...context, ...layout, ...filters, ...sources, parts: { context, layout, filters, sources, registry } };
    },
    { wrapper }
  );
  const update = (next: Options) => {
    Object.assign(current, next);
    hook.rerender();
  };

  return { ...hook, update };
}

function countUpdates(doc: YDoc) {
  const listener = jest.fn();

  doc.on('update', listener);
  return listener;
}

describe('DashboardProvider', () => {
  it('exposes the persisted setting, host database and edit capability', () => {
    const { doc } = createDatabaseDoc();
    // The provider keeps the Edit preference to itself and records it here.
    const modeStore: DashboardModeStore = new Map();
    const { result } = renderDashboard(doc, { modeStore });

    expect(result.current.dashboardViewId).toBe(DASHBOARD_VIEW_ID);
    expect(result.current.hostDatabaseId).toBe(DATABASE_ID);
    expect(result.current.rows).toEqual(ROWS);
    expect(result.current.globalFilters).toEqual([GLOBAL_FILTER]);
    expect(result.current.showWidgetTitles).toBe(true);
    expect(result.current.showIconsInHeading).toBe(false);
    expect(result.current.effectiveGlobalFilters).toBe(result.current.globalFilters);
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.dirtyGlobalFilterIds.size).toBe(0);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.isEditing).toBe(false);
    expect(result.current.mobileContext).toBe(false);
    expect(result.current.canEnterEdit).toBe(true);
    expect(modeStore.get(DASHBOARD_VIEW_ID)).toEqual({ preference: 'off', rowsEmpty: false });
    expect(result.current.sourceDocs).toEqual({ [DATABASE_ID]: doc });
    expect(result.current.sourceNames).toEqual({});
  });

  it('falls back to the doc guid when the database has no id', () => {
    const doc = new Y.Doc() as unknown as YDoc;
    const database = new Y.Map() as YDatabase;

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    const { result } = renderDashboard(doc);

    expect(result.current.hostDatabaseId).toBe(doc.guid);
    expect(result.current.rows).toEqual([]);
    expect(result.current.sourceDocs).toEqual({ [doc.guid]: doc });
  });

  it('follows remote changes to the persisted setting', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const previousRows = result.current.rows;

    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { showWidgetTitles: false }));
    });

    expect(result.current.showWidgetTitles).toBe(false);
    expect(result.current.rows).toBe(previousRows);

    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
    });

    expect(result.current.rows).toEqual([]);
  });

  describe('edit mode', () => {
    it('toggles for writers', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      expect(result.current.isEditing).toBe(true);
      act(() => result.current.setEditing(false));
      expect(result.current.isEditing).toBe(false);
    });

    it('is refused for read-only viewers', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc, { readOnly: true });

      expect(result.current.canEdit).toBe(false);
      act(() => result.current.setEditing(true));
      expect(result.current.isEditing).toBe(false);
    });

    it('is off without write access and comes back when access returns', () => {
      const { doc } = createDatabaseDoc();
      const { result, update } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      expect(result.current.isEditing).toBe(true);

      // The app drops write access while it re-probes permissions (back on the tab, a reconnect).
      act(() => update({ readOnly: true }));
      expect(result.current.isEditing).toBe(false);
      expect(result.current.canEdit).toBe(false);

      act(() => update({ readOnly: false }));
      expect(result.current.isEditing).toBe(true);
      expect(result.current.canEdit).toBe(true);
    });

    it('keeps View mode chosen with Done when access returns', () => {
      const { doc } = createDatabaseDoc();
      const { result, update } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      act(() => result.current.setEditing(false));
      act(() => update({ readOnly: true }));
      act(() => update({ readOnly: false }));
      expect(result.current.isEditing).toBe(false);
    });

    it('resets edit mode and private filter values when the dashboard view changes', () => {
      const { doc } = createDatabaseDoc();
      const { result, update } = renderDashboard(doc);

      act(() => {
        result.current.setEditing(true);
        result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, { condition: 0, content: 'mine' });
      });
      expect(result.current.isEditing).toBe(true);
      expect(result.current.privateGlobalValues).toEqual({ [GLOBAL_FILTER.id]: { condition: 0, content: 'mine' } });

      act(() => update({ activeViewId: OTHER_VIEW_ID }));
      expect(result.current.dashboardViewId).toBe(OTHER_VIEW_ID);
      expect(result.current.privateGlobalValues).toEqual({});
      expect(result.current.rows).toEqual([]);
      // The other dashboard is empty, so it opens in (automatic) Edit mode.
      expect(result.current.isEditing).toBe(true);

      // Back on a dashboard with widgets: the earlier Edit mode is gone.
      act(() => update({ activeViewId: DASHBOARD_VIEW_ID }));
      expect(result.current.isEditing).toBe(false);
    });

    it('opens an empty dashboard in Edit mode and settles to View mode when widgets arrive', () => {
      const { doc, view } = createDatabaseDoc();

      doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
      const { result } = renderDashboard(doc);

      expect(result.current.isEditing).toBe(true);
      // Widgets from the server sync (or a collaborator), before the editor chose a mode.
      act(() => doc.transact(() => updateDashboardLayoutSetting(view, { rows: ROWS })));
      expect(result.current.isEditing).toBe(false);
      // The automatic mode is settled: emptying the dashboard again keeps View mode.
      act(() => doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] })));
      expect(result.current.isEditing).toBe(false);
    });

    it('keeps the Edit mode the editor chose when widgets arrive', () => {
      const { doc, view } = createDatabaseDoc();

      doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
      const { result } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      act(() => doc.transact(() => updateDashboardLayoutSetting(view, { rows: ROWS })));
      expect(result.current.isEditing).toBe(true);
    });

    it('decides the automatic Edit mode once write access is known', () => {
      const { doc, view } = createDatabaseDoc();

      doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
      const { result, update } = renderDashboard(doc, { readOnly: true });

      expect(result.current.isEditing).toBe(false);
      act(() => update({ readOnly: false }));
      expect(result.current.isEditing).toBe(true);
    });

    it('never persists the edit state', () => {
      const { doc } = createDatabaseDoc();
      const updates = countUpdates(doc);
      const { result } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      expect(updates).not.toHaveBeenCalled();
    });
  });

  it.each(['duplicate', 'move', 'setting'] as const)(
    'routes keyboard undo and redo to the host after a %s action from a source widget',
    (action) => {
      const host = createDatabaseDoc();
      const source = createDatabaseDoc();
      const sourceHistory = getOrCreateDatabaseHistoryManager(source.doc);
      const hostContext: DatabaseContextState = {
        databaseDoc: host.doc,
        databasePageId: DASHBOARD_VIEW_ID,
        activeViewId: DASHBOARD_VIEW_ID,
        readOnly: false,
        rowMap: {},
        workspaceId: 'workspace-id',
      };

      source.database.set(YjsDatabaseKey.id, 'other-database');
      runDatabaseAction(source.doc, { type: 'test.source-edit' }, () => {
        source.view.set(YjsDatabaseKey.name, 'Source edit');
      });
      const { result, unmount } = renderHook(() => useDashboardContext(), {
        wrapper: ({ children }) => (
          <DatabaseContext.Provider value={hostContext}>
            <DatabaseHistoryScope>
              <DashboardProvider>
                {children}
                <DatabaseContext.Provider value={{ ...hostContext, databaseDoc: source.doc }}>
                  <DatabaseHistoryScope>
                    <button data-testid='source-widget'>Source widget</button>
                  </DatabaseHistoryScope>
                </DatabaseContext.Provider>
              </DashboardProvider>
            </DatabaseHistoryScope>
          </DatabaseContext.Provider>
        ),
      });
      const widget = screen.getByTestId('source-widget');
      const before = readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID);
      const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };
      const historyKey = { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ...modifier };

      // The widget header and its portaled menu activate the nested source
      // scope. Menu actions and the dashboard's drop handler share updateRows.
      fireEvent.pointerDown(widget);
      act(() => {
        if (action === 'duplicate') result.current.updateRows((rows) => duplicateDashboardWidget(rows, 'w2'));
        if (action === 'move') {
          result.current.updateRows((rows) => moveDashboardWidget(rows, 'w2', { type: 'new_row', rowIndex: 1 }));
        }

        if (action === 'setting') result.current.updateSetting({ showWidgetTitles: false });
      });
      const changed = readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID);

      expect(changed).not.toEqual(before);
      fireEvent.keyDown(widget, historyKey);
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID)).toEqual(before);
      expect(source.view.get(YjsDatabaseKey.name)).toBe('Source edit');
      expect(sourceHistory.canUndo()).toBe(true);

      fireEvent.keyDown(widget, { ...historyKey, shiftKey: true });
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID)).toEqual(changed);

      // Interacting with source content again returns undo to its own edits.
      fireEvent.pointerDown(widget);
      fireEvent.keyDown(widget, historyKey);
      expect(source.view.get(YjsDatabaseKey.name)).toBeUndefined();
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID)).toEqual(changed);

      unmount();
      host.doc.destroy();
      source.doc.destroy();
    }
  );

  describe('updateRows', () => {
    it('persists changed rows through the history-aware dispatcher', () => {
      const { doc, database } = createDatabaseDoc();
      const history = getOrCreateDatabaseHistoryManager(doc);
      const { result } = renderDashboard(doc);
      const updater = jest.fn((rows: DashboardRow[]) => rows.map((row) => ({ ...row, height: 600 })));

      act(() => {
        result.current.updateRows(updater);
      });

      expect(updater).toHaveBeenCalledWith(ROWS);
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).rows[0].height).toBe(600);
      expect(result.current.rows[0].height).toBe(600);
      expect(history.canUndo()).toBe(true);

      act(() => {
        history.undo();
      });
      expect(result.current.rows[0].height).toBe(480);
    });

    it('skips the write when the updater returns equal rows', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);
      const updates = countUpdates(doc);
      const before = result.current.rows;

      act(() => {
        result.current.updateRows((rows) => rows);
      });
      act(() => {
        result.current.updateRows((rows) => JSON.parse(JSON.stringify(rows)) as DashboardRow[]);
      });

      expect(updates).not.toHaveBeenCalled();
      expect(result.current.rows).toBe(before);
    });

    it('reads the latest rows for consecutive updates in one tick', () => {
      const { doc, database } = createDatabaseDoc();
      const { result } = renderDashboard(doc);

      act(() => {
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 500 })));
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: row.height + 20 })));
      });

      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).rows[0].height).toBe(520);
    });

    it('detaches a database from the global filters with its last widget, in the same undoable write', () => {
      const { doc, database } = createDatabaseDoc();
      const history = getOrCreateDatabaseHistoryManager(doc);
      const shared: DashboardGlobalFilter = {
        ...GLOBAL_FILTER,
        id: 'gf:shared',
        targets: { 'other-database': 'other-status', [DATABASE_ID]: 'status' },
      };
      const { result } = renderDashboard(doc);

      act(() => result.current.updateSetting({ globalFilters: [GLOBAL_FILTER, shared] }));
      act(() => result.current.setPrivateGlobalValue(shared.id, { condition: shared.condition, content: 'mine' }));
      const writes = countUpdates(doc);

      // Resizing keeps every database.
      act(() => {
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 400 })));
      });
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters).toEqual([GLOBAL_FILTER, shared]);

      act(() => {
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, widgets: row.widgets.slice(0, 1) })));
      });

      const stored = readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters;

      expect(stored[0]).toEqual(GLOBAL_FILTER);
      expect(stored[1].targets).toEqual({ [DATABASE_ID]: 'status' });
      expect(result.current.globalFilters[1].targets).toEqual({ [DATABASE_ID]: 'status' });
      // The private value (values only, WP07) applies to the detached filter.
      expect(result.current.effectiveGlobalFilters[1]).toEqual({
        ...shared,
        content: 'mine',
        targets: { [DATABASE_ID]: 'status' },
      });
      expect(writes).toHaveBeenCalledTimes(2);

      act(() => {
        history.undo();
      });
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[1].targets).toEqual(shared.targets);
      expect(result.current.rows[0].widgets).toHaveLength(2);
    });

    it('says whether it wrote', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);
      let written: boolean[] = [];

      act(() => {
        written = [
          result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 400 }))),
          result.current.updateRows((rows) => rows),
        ];
      });
      expect(written).toEqual([true, false]);
    });

    it('is a no-op for read-only viewers', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc, { readOnly: true });
      const updates = countUpdates(doc);
      const updater = jest.fn((rows: DashboardRow[]) => rows.slice(1));
      let written: boolean | undefined;

      act(() => {
        written = result.current.updateRows(updater);
      });
      expect(written).toBe(false);
      act(() => result.current.updateSetting({ showWidgetTitles: false }));

      expect(updater).not.toHaveBeenCalled();
      expect(updates).not.toHaveBeenCalled();
      expect(result.current.rows).toEqual(ROWS);
      expect(result.current.showWidgetTitles).toBe(true);
    });
  });

  // WP05 §1.5: an owned view the editor's changes left without a widget is deleted on Done or close.
  describe('owned widget views', () => {
    function withOwnedWidget() {
      const fixture = createDatabaseDoc();
      const owned = new Y.Map() as YDatabaseView;
      const views = fixture.database.get(YjsDatabaseKey.views);

      fixture.doc.transact(() => {
        owned.set(YjsDatabaseKey.dashboard_owner, DASHBOARD_VIEW_ID);
        views.set('owned-view', owned);
        updateDashboardLayoutSetting(fixture.view, {
          rows: [
            ...ROWS,
            { id: 'r2', height: 360, widgets: [{ id: 'w3', viewId: 'owned-view', databaseId: DATABASE_ID, width: 12 }] },
          ],
        });
      });
      return { ...fixture, views };
    }

    async function settle() {
      await act(async () => {
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
      });
    }

    it('deletes the owned view of a removed widget when editing ends, and keeps shared views', async () => {
      const { doc, views } = withOwnedWidget();
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const { result } = renderDashboard(doc, { deletePage });

      act(() => result.current.setEditing(true));
      act(() => {
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, widgets: [] })));
      });
      expect(views.has('owned-view')).toBe(true);
      act(() => result.current.setEditing(false));
      await settle();

      expect(deletePage.mock.calls).toEqual([['owned-view']]);
      expect(views.has('owned-view')).toBe(false);
      expect(views.has(DASHBOARD_VIEW_ID)).toBe(true);
    });

    it('keeps the view when the removal is undone before Done', async () => {
      const { doc, views } = withOwnedWidget();
      const history = getOrCreateDatabaseHistoryManager(doc);
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const { result } = renderDashboard(doc, { deletePage });

      act(() => result.current.setEditing(true));
      act(() => {
        result.current.updateRows((rows) => rows.slice(0, 1));
      });
      act(() => {
        history.undo();
      });
      act(() => result.current.setEditing(false));
      await settle();

      expect(deletePage).not.toHaveBeenCalled();
      expect(views.has('owned-view')).toBe(true);
    });

    it('flushes when the dashboard closes', async () => {
      const { doc, views } = withOwnedWidget();
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderDashboard(doc, { deletePage });

      act(() => {
        result.current.updateRows((rows) => rows.slice(0, 1));
      });
      unmount();
      await settle();

      expect(deletePage.mock.calls).toEqual([['owned-view']]);
      expect(views.has('owned-view')).toBe(false);
    });

    it('never deletes for a remote removal', async () => {
      const { doc, database, views } = withOwnedWidget();
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const { result } = renderDashboard(doc, { deletePage });
      const remote = new Y.Doc();

      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const remoteView = (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
        .get(YjsDatabaseKey.views)
        .get(DASHBOARD_VIEW_ID);

      remote.transact(() => updateDashboardLayoutSetting(remoteView, { rows: ROWS }));
      act(() => {
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote');
      });
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).rows).toHaveLength(1);
      act(() => result.current.setEditing(false));
      await settle();

      expect(deletePage).not.toHaveBeenCalled();
      expect(views.has('owned-view')).toBe(true);
    });
  });

  it('persists partial setting updates', () => {
    const { doc, database } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.updateSetting({ showWidgetTitles: false, globalFilters: [] }));

    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID)).toEqual({
      rows: ROWS,
      globalFilters: [],
      showWidgetTitles: false,
      showIconsInHeading: false,
    });
    expect(result.current.showWidgetTitles).toBe(false);
    expect(result.current.showIconsInHeading).toBe(false);

    act(() => result.current.updateSetting({ showIconsInHeading: true }));
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).showIconsInHeading).toBe(true);
    expect(result.current.showIconsInHeading).toBe(true);
  });

  it('prefers private global filter values without persisting them', () => {
    const { doc, database } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const updates = countUpdates(doc);

    act(() => result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, { condition: 0, content: 'todo' }));
    expect(result.current.privateGlobalValues).toEqual({ [GLOBAL_FILTER.id]: { condition: 0, content: 'todo' } });
    expect(result.current.effectiveGlobalFilters).toEqual([{ ...GLOBAL_FILTER, content: 'todo' }]);
    expect([...result.current.dirtyGlobalFilterIds]).toEqual([GLOBAL_FILTER.id]);
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters).toEqual([GLOBAL_FILTER]);
    expect(updates).not.toHaveBeenCalled();

    act(() => result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, null));
    expect(result.current.effectiveGlobalFilters).toEqual([GLOBAL_FILTER]);
    expect(result.current.dirtyGlobalFilterIds.size).toBe(0);
  });

  it('drops a private value that a concurrent change made identical to the persisted filters', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const local = [{ ...GLOBAL_FILTER, content: 'todo' }];

    act(() => result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, { condition: 0, content: 'todo' }));
    expect(result.current.dirtyGlobalFilterIds.size).toBe(1);

    // A collaborator saves the same change: nothing is left to save.
    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: local }));
    });
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.effectiveGlobalFilters).toBe(result.current.globalFilters);

    // The dropped value never comes back with a later change.
    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [GLOBAL_FILTER] }));
    });
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.effectiveGlobalFilters).toEqual([GLOBAL_FILTER]);
  });

  it('a deleted global filter drops its private value', () => {
    const { doc } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, { condition: 0, content: 'mine' }));
    expect(result.current.dirtyGlobalFilterIds.size).toBe(1);

    // An editor deletes the filter: its value has nothing left to apply to.
    act(() => result.current.updateSetting({ globalFilters: [] }));
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.effectiveGlobalFilters).toEqual([]);
  });

  it('ignores global filter mappings of databases without a widget', () => {
    const { doc, database, view } = createDatabaseDoc();
    const stale: DashboardGlobalFilter = {
      ...GLOBAL_FILTER,
      targets: { 'removed-database': 'x', [DATABASE_ID]: 'status' },
    };

    doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [stale] }));
    const { result } = renderDashboard(doc);

    expect(result.current.globalFilters).toEqual([GLOBAL_FILTER]);
    expect(result.current.effectiveGlobalFilters).toBe(result.current.globalFilters);
    // Nothing is written until the filters are edited.
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters).toEqual([stale]);

    act(() => result.current.setPrivateGlobalValue(stale.id, { condition: stale.condition, content: 'mine' }));
    expect(result.current.effectiveGlobalFilters).toEqual([{ ...GLOBAL_FILTER, content: 'mine' }]);
  });

  it('only changes the context whose part changed', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    let previous = result.current.parts;

    // A widget exposing its source doc touches the sources only.
    act(() => result.current.registerSourceDoc('other-database', new Y.Doc() as unknown as YDoc));
    expect(result.current.parts.context).toBe(previous.context);
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.filters).toBe(previous.filters);
    expect(result.current.parts.sources).not.toBe(previous.sources);
    previous = result.current.parts;

    act(() => result.current.registerSourceName('other-database', 'Projects'));
    expect(result.current.parts.context).toBe(previous.context);
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.filters).toBe(previous.filters);
    // Components that only register sources never re-render for it.
    expect(result.current.parts.registry).toBe(previous.registry);
    previous = result.current.parts;

    // Filter edits (private or persisted) leave the mode and the layout alone.
    act(() => result.current.setPrivateGlobalValue(GLOBAL_FILTER.id, { condition: 0, content: 'mine' }));
    expect(result.current.parts.context).toBe(previous.context);
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.sources).toBe(previous.sources);
    expect(result.current.parts.filters).not.toBe(previous.filters);
    previous = result.current.parts;

    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [] }));
    });
    expect(result.current.parts.context).toBe(previous.context);
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.sources).toBe(previous.sources);
    previous = result.current.parts;

    // Layout edits that keep the widget databases leave the filters alone,
    // and the mode context with them: the toolbar never re-renders for a resize.
    act(() => {
        result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 400 })));
      });
    expect(result.current.parts.filters).toBe(previous.filters);
    expect(result.current.parts.sources).toBe(previous.sources);
    expect(result.current.parts.context).toBe(previous.context);
    expect(result.current.parts.layout).not.toBe(previous.layout);
    previous = result.current.parts;

    // The mode toggle leaves the rows alone.
    act(() => result.current.setEditing(true));
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.context).not.toBe(previous.context);
  });

  describe('source registry', () => {
    it('registers and unregisters source docs, keeping identity on no-ops', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);
      const sourceDoc = new Y.Doc() as unknown as YDoc;

      act(() => result.current.registerSourceDoc('other-database', sourceDoc));
      expect(result.current.sourceDocs).toEqual({ [DATABASE_ID]: doc, 'other-database': sourceDoc });

      const registered = result.current.sourceDocs;

      act(() => result.current.registerSourceDoc('other-database', sourceDoc));
      expect(result.current.sourceDocs).toBe(registered);

      const replacement = new Y.Doc() as unknown as YDoc;

      act(() => result.current.registerSourceDoc('other-database', replacement));
      expect(result.current.sourceDocs['other-database']).toBe(replacement);

      act(() => result.current.registerSourceDoc('other-database', null));
      expect(result.current.sourceDocs).toEqual({ [DATABASE_ID]: doc });

      const afterRemoval = result.current.sourceDocs;

      act(() => result.current.registerSourceDoc('never-registered', null));
      expect(result.current.sourceDocs).toBe(afterRemoval);
    });

    it('registers source names, keeping identity when the name is unchanged', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);

      act(() => result.current.registerSourceName('other-database', 'Projects'));
      expect(result.current.sourceNames).toEqual({ 'other-database': 'Projects' });

      const registered = result.current.sourceNames;

      act(() => result.current.registerSourceName('other-database', 'Projects'));
      expect(result.current.sourceNames).toBe(registered);

      act(() => result.current.registerSourceName('other-database', 'Roadmap'));
      act(() => result.current.registerSourceName(DATABASE_ID, 'Tasks'));
      expect(result.current.sourceNames).toEqual({ 'other-database': 'Roadmap', [DATABASE_ID]: 'Tasks' });
    });

    it('keeps callbacks stable across renders', () => {
      const { doc } = createDatabaseDoc();
      const { result, rerender } = renderDashboard(doc);
      const { registerSourceDoc, registerSourceName, setPrivateGlobalValue, setEditing, pinEditing } = result.current;

      rerender();
      act(() => result.current.registerSourceName('x', 'X'));
      act(() => result.current.setEditing(true));

      expect(result.current.registerSourceDoc).toBe(registerSourceDoc);
      expect(result.current.registerSourceName).toBe(registerSourceName);
      expect(result.current.setPrivateGlobalValue).toBe(setPrivateGlobalValue);
      expect(result.current.setEditing).toBe(setEditing);
      expect(result.current.pinEditing).toBe(pinEditing);
    });
  });
});

describe('useDashboardContext', () => {
  it('throws outside a DashboardProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useDashboardContext())).toThrow('DashboardContext is not provided');
    spy.mockRestore();
  });

  it('throws from the filter and source hooks outside a DashboardProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useDashboardFilters())).toThrow('DashboardFiltersContext is not provided');
    expect(() => renderHook(() => useDashboardSources())).toThrow('DashboardSourcesContext is not provided');
    spy.mockRestore();
  });

  it('returns null from the optional hook outside a provider', () => {
    const { result } = renderHook(() => useDashboardContextOptional());

    expect(result.current).toBeNull();
  });
});
