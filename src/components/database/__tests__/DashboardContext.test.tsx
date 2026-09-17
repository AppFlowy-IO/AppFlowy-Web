import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardContextOptional,
  useDashboardFilters,
  useDashboardSourceRegistry,
  useDashboardSources,
} from '@/components/database/dashboard/DashboardContext';

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

type Options = { readOnly?: boolean; activeViewId?: string };

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
    };

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider>{children}</DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  const hook = renderHook(
    () => {
      const layout = useDashboardContext();
      const filters = useDashboardFilters();
      const sources = useDashboardSources();
      const registry = useDashboardSourceRegistry();

      return { ...layout, ...filters, ...sources, parts: { layout, filters, sources, registry } };
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
    const { result } = renderDashboard(doc);

    expect(result.current.dashboardViewId).toBe(DASHBOARD_VIEW_ID);
    expect(result.current.hostDatabaseId).toBe(DATABASE_ID);
    expect(result.current.rows).toEqual(ROWS);
    expect(result.current.globalFilters).toEqual([GLOBAL_FILTER]);
    expect(result.current.showWidgetTitles).toBe(true);
    expect(result.current.effectiveGlobalFilters).toBe(result.current.globalFilters);
    expect(result.current.localGlobalFilters).toBeNull();
    expect(result.current.canEdit).toBe(true);
    expect(result.current.isEditing).toBe(false);
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

    it('leaves edit mode when write access is lost', () => {
      const { doc } = createDatabaseDoc();
      const { result, update } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      expect(result.current.isEditing).toBe(true);

      act(() => update({ readOnly: true }));
      expect(result.current.isEditing).toBe(false);
      expect(result.current.canEdit).toBe(false);
    });

    it('resets edit mode and local filters when the dashboard view changes', () => {
      const { doc } = createDatabaseDoc();
      const { result, update } = renderDashboard(doc);

      act(() => {
        result.current.setEditing(true);
        result.current.setLocalGlobalFilters([]);
      });
      expect(result.current.isEditing).toBe(true);
      expect(result.current.localGlobalFilters).toEqual([]);

      act(() => update({ activeViewId: OTHER_VIEW_ID }));
      expect(result.current.dashboardViewId).toBe(OTHER_VIEW_ID);
      expect(result.current.isEditing).toBe(false);
      expect(result.current.localGlobalFilters).toBeNull();
      expect(result.current.rows).toEqual([]);
    });

    it('never persists the edit state', () => {
      const { doc } = createDatabaseDoc();
      const updates = countUpdates(doc);
      const { result } = renderDashboard(doc);

      act(() => result.current.setEditing(true));
      expect(updates).not.toHaveBeenCalled();
    });
  });

  describe('updateRows', () => {
    it('persists changed rows through the history-aware dispatcher', () => {
      const { doc, database } = createDatabaseDoc();
      const history = getOrCreateDatabaseHistoryManager(doc);
      const { result } = renderDashboard(doc);
      const updater = jest.fn((rows: DashboardRow[]) => rows.map((row) => ({ ...row, height: 600 })));

      act(() => result.current.updateRows(updater));

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

      act(() => result.current.updateRows((rows) => rows));
      act(() => result.current.updateRows((rows) => JSON.parse(JSON.stringify(rows)) as DashboardRow[]));

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
      act(() => result.current.setLocalGlobalFilters([{ ...shared, content: 'mine' }]));
      const writes = countUpdates(doc);

      // Resizing keeps every database.
      act(() => result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 400 }))));
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters).toEqual([GLOBAL_FILTER, shared]);

      act(() => result.current.updateRows((rows) => rows.map((row) => ({ ...row, widgets: row.widgets.slice(0, 1) }))));

      const stored = readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters;

      expect(stored[0]).toEqual(GLOBAL_FILTER);
      expect(stored[1].targets).toEqual({ [DATABASE_ID]: 'status' });
      expect(result.current.globalFilters[1].targets).toEqual({ [DATABASE_ID]: 'status' });
      expect(result.current.localGlobalFilters).toEqual([
        { ...shared, content: 'mine', targets: { [DATABASE_ID]: 'status' } },
      ]);
      expect(writes).toHaveBeenCalledTimes(2);

      act(() => {
        history.undo();
      });
      expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[1].targets).toEqual(shared.targets);
      expect(result.current.rows[0].widgets).toHaveLength(2);
    });

    it('is a no-op for read-only viewers', () => {
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc, { readOnly: true });
      const updates = countUpdates(doc);
      const updater = jest.fn((rows: DashboardRow[]) => rows.slice(1));

      act(() => result.current.updateRows(updater));
      act(() => result.current.updateSetting({ showWidgetTitles: false }));

      expect(updater).not.toHaveBeenCalled();
      expect(updates).not.toHaveBeenCalled();
      expect(result.current.rows).toEqual(ROWS);
      expect(result.current.showWidgetTitles).toBe(true);
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
    });
    expect(result.current.showWidgetTitles).toBe(false);
  });

  it('prefers local global filters without persisting them', () => {
    const { doc, database } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const updates = countUpdates(doc);
    const local = [{ ...GLOBAL_FILTER, content: 'todo' }];

    act(() => result.current.setLocalGlobalFilters(local));
    expect(result.current.localGlobalFilters).toBe(local);
    expect(result.current.effectiveGlobalFilters).toBe(local);
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters).toEqual([GLOBAL_FILTER]);
    expect(updates).not.toHaveBeenCalled();

    act(() => result.current.setLocalGlobalFilters(null));
    expect(result.current.effectiveGlobalFilters).toEqual([GLOBAL_FILTER]);
  });

  it('drops a local override that a concurrent change made identical to the persisted filters', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const local = [{ ...GLOBAL_FILTER, content: 'todo' }];

    act(() => result.current.setLocalGlobalFilters(local));
    expect(result.current.localGlobalFilters).toBe(local);

    // A collaborator saves the same change: nothing is left to save.
    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: local }));
    });
    expect(result.current.localGlobalFilters).toBeNull();
    expect(result.current.effectiveGlobalFilters).toBe(result.current.globalFilters);

    // The dropped override never comes back with a later change.
    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [GLOBAL_FILTER] }));
    });
    expect(result.current.localGlobalFilters).toBeNull();
    expect(result.current.effectiveGlobalFilters).toEqual([GLOBAL_FILTER]);
  });

  it('drops a local override that only differed by a removed widget', () => {
    const { doc } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    // The viewer maps the filter to the second widget's database too.
    act(() =>
      result.current.setLocalGlobalFilters([
        { ...GLOBAL_FILTER, targets: { ...GLOBAL_FILTER.targets, 'other-database': 'stage' } },
      ])
    );
    expect(result.current.localGlobalFilters).not.toBeNull();

    // An editor removes that widget: the override now equals the saved filters.
    act(() => result.current.updateRows((rows) => rows.map((row) => ({ ...row, widgets: row.widgets.slice(0, 1) }))));
    expect(result.current.localGlobalFilters).toBeNull();
    expect(result.current.effectiveGlobalFilters).toEqual([GLOBAL_FILTER]);
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

    act(() => result.current.setLocalGlobalFilters([{ ...stale, content: 'mine' }]));
    expect(result.current.effectiveGlobalFilters).toEqual([{ ...GLOBAL_FILTER, content: 'mine' }]);
  });

  it('only changes the context whose part changed', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    let previous = result.current.parts;

    // A widget exposing its source doc touches the sources only.
    act(() => result.current.registerSourceDoc('other-database', new Y.Doc() as unknown as YDoc));
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.filters).toBe(previous.filters);
    expect(result.current.parts.sources).not.toBe(previous.sources);
    previous = result.current.parts;

    act(() => result.current.registerSourceName('other-database', 'Projects'));
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.filters).toBe(previous.filters);
    // Components that only register sources never re-render for it.
    expect(result.current.parts.registry).toBe(previous.registry);
    previous = result.current.parts;

    // Filter edits (local or persisted) leave the layout alone.
    act(() => result.current.setLocalGlobalFilters([{ ...GLOBAL_FILTER, content: 'mine' }]));
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.sources).toBe(previous.sources);
    expect(result.current.parts.filters).not.toBe(previous.filters);
    previous = result.current.parts;

    act(() => {
      doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [] }));
    });
    expect(result.current.parts.layout).toBe(previous.layout);
    expect(result.current.parts.sources).toBe(previous.sources);
    previous = result.current.parts;

    // Layout edits that keep the widget databases leave the filters alone.
    act(() => result.current.updateRows((rows) => rows.map((row) => ({ ...row, height: 400 }))));
    act(() => result.current.setEditing(true));
    expect(result.current.parts.filters).toBe(previous.filters);
    expect(result.current.parts.sources).toBe(previous.sources);
    expect(result.current.parts.layout).not.toBe(previous.layout);
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
      const { registerSourceDoc, registerSourceName, setLocalGlobalFilters } = result.current;

      rerender();
      act(() => result.current.registerSourceName('x', 'X'));

      expect(result.current.registerSourceDoc).toBe(registerSourceDoc);
      expect(result.current.registerSourceName).toBe(registerSourceName);
      expect(result.current.setLocalGlobalFilters).toBe(setLocalGlobalFilters);
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
