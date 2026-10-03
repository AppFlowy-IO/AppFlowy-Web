import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  dashboardSourceDatabaseIds,
  DashboardGlobalFilter,
  DashboardLayoutUpdate,
  DashboardRow,
  readDashboardLayoutSetting,
  sameDashboardGlobalFilters,
  sameDashboardRows,
  useDashboardLayoutSetting,
  useDatabaseContext,
  useDatabaseViewId,
  useReadOnly,
  useUpdateDashboardSetting,
} from '@/application/database-yjs';
import {
  consumeDashboardCreatedThisSession,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import { runDatabaseHistoryGroupForDatabase } from '@/application/database-yjs/history';
import { YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import { useDatabaseHistoryScopeContext } from '@/components/database/DatabaseHistoryScope';
import { Log } from '@/utils/log';

import {
  canEnterDashboardEdit,
  DashboardModeEvent,
  DashboardModeInputs,
  reduceDashboardEditPreference,
  resolveDashboardEditing,
  touchesEditOnlyKeys,
} from './dashboard-mode';
import { readGlobalFilterSourceFields } from './global-filters/global-filter.source-fields';
import { detachRemovedGlobalFilterSources, GlobalFilterSource } from './global-filters/global-filter.utils';
import { DashboardModeSnapshot, DashboardModeStore } from './hooks/useDashboardModeStore';
import {
  DashboardLocalWidgetChanges,
  DashboardViewOverlays,
  useDashboardViewOverlays,
} from './hooks/useDashboardViewOverlays';

/**
 * Shared state of one dashboard view, split by how often it changes so a
 * consumer only re-renders for what it reads:
 *
 * - `DashboardContext`: the Edit / View mode (R-MODE, `dashboard-mode.ts`),
 *   write access, the mobile context and the layout writers; changes only
 *   when the mode, the access or the mobile context does.
 * - `DashboardLayoutContext`: the persisted rows and display settings, for
 *   the grid and everything that reads the rows. Kept apart so the toolbar
 *   and the filter bar do not re-render for every resize or move.
 * - `DashboardFiltersContext`: the global filters and the viewer's unsaved
 *   overrides.
 * - `DashboardSourcesContext`: the registry of source-database docs (and
 *   names) that mounted widgets expose so the global filter editor can list
 *   every source's properties.
 * - `DashboardSourceRegistryContext`: only the (stable) registration
 *   callbacks, for components that register sources without reading them,
 *   and the docs widgets show (a moved widget starts from its own).
 *
 * All of them are mounted by `DashboardProvider`, which `DatabaseViews`
 * renders around the dashboard content (tab bar included), so both the
 * toolbar (`DashboardActions`) and the grid read the same values.
 */
export interface DashboardContextValue {
  /** The dashboard's own view id (a view of the host database). */
  dashboardViewId: string;
  /** The host database id; widgets may reference other databases too. */
  hostDatabaseId: string;
  /** Whether the viewer can persist layout / filter changes. */
  canEdit: boolean;
  /**
   * Whether the dashboard is in Edit mode right now: the editor's preference
   * applied to the current write access and mobile context. Edit mode is local
   * UI state: never persisted, never synced.
   */
  isEditing: boolean;
  /** Edit / Done. Entering Edit mode is ignored while `canEnterEdit` is false. */
  setEditing: (editing: boolean) => void;
  /**
   * A phone or a web viewport below 768px: the dashboard is view-only there,
   * and every edit-only write is refused.
   */
  mobileContext: boolean;
  /** Write access outside a mobile context: whether Edit mode can be offered. */
  canEnterEdit: boolean;
  /** The editor started building (the add flow): keep Edit mode whatever the sync brings. */
  pinEditing: () => void;
  /** Persist a partial update; a no-op for read-only viewers and edit-only keys in a mobile context. */
  updateSetting: (update: DashboardLayoutUpdate) => void;
  /** Persist a row transformation computed from the latest rows; a no-op in a mobile context. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => void;
}

export interface DashboardLayoutContextValue {
  /** Persisted rows. */
  rows: DashboardRow[];
  /** View ids shown as tabs of the host database (the widget picker offers them first). */
  hostViewIds: string[];
  /** Persisted widget-title flag. */
  showWidgetTitles: boolean;
  /** Persisted flag: widget titles show the view icon (off by default). */
  showIconsInHeading: boolean;
}

// The unsaved counts live in their own context: every widget reads this one,
// and only the filter bar needs the counts.
export interface DashboardFiltersContextValue
  extends Omit<DashboardViewOverlays, keyof DashboardLocalWidgetChanges | 'commitViewOverlays'> {
  /** Save writable widget conditions and optional global filters as one dashboard undo action. */
  commitViewOverlays: (globalFilters?: DashboardGlobalFilter[]) => void;
  /** Persisted global filters (mappings of databases without a widget left out). */
  globalFilters: DashboardGlobalFilter[];
  /** Persisted global filters unless the viewer changed them locally. */
  effectiveGlobalFilters: DashboardGlobalFilter[];
  /**
   * Unsaved, viewer-only overrides of the global filters (`null` = none, also
   * when the override no longer differs from the persisted filters).
   */
  localGlobalFilters: DashboardGlobalFilter[] | null;
  setLocalGlobalFilters: (filters: DashboardGlobalFilter[] | null) => void;
}

export interface DashboardSourcesContextValue {
  /** Y.Docs of source databases currently mounted by widgets, keyed by database id. */
  sourceDocs: Record<string, YDoc>;
  registerSourceDoc: (databaseId: string, doc: YDoc | null) => void;
  /** Display names of source databases, keyed by database id. */
  sourceNames: Record<string, string>;
  registerSourceName: (databaseId: string, name: string) => void;
}

export interface DashboardSourceRegistryContextValue
  extends Pick<DashboardSourcesContextValue, 'registerSourceDoc' | 'registerSourceName'> {
  /** Record the doc a widget shows as ready, until the returned cleanup runs. */
  markWidgetShown: (widgetId: string, viewId: string, doc: YDoc) => () => void;
  /**
   * The doc this widget showed for this view, read at call time: a widget that
   * remounts (moved to another row) starts from it instead of loading again.
   */
  getShownDoc: (widgetId: string, viewId: string) => YDoc | null;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);
export const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);
export const DashboardFiltersContext = createContext<DashboardFiltersContextValue | null>(null);
export const DashboardSourcesContext = createContext<DashboardSourcesContextValue | null>(null);
export const DashboardSourceRegistryContext = createContext<DashboardSourceRegistryContextValue | null>(null);
const NO_LOCAL_WIDGET_CHANGES: DashboardLocalWidgetChanges = { unsaved: 0, savable: 0 };

/** Widgets whose View-mode filters / sorts the viewer changed locally. */
export const DashboardLocalWidgetChangesContext = createContext<DashboardLocalWidgetChanges>(NO_LOCAL_WIDGET_CHANGES);

function required<T>(value: T | null, name: string): T {
  if (!value) {
    throw new Error(`${name} is not provided`);
  }

  return value;
}

export function useDashboardContext(): DashboardContextValue {
  return required(useContext(DashboardContext), 'DashboardContext');
}

export function useDashboardContextOptional(): DashboardContextValue | null {
  return useContext(DashboardContext);
}

/** The persisted rows and display settings; re-renders the caller on every layout write. */
export function useDashboardLayout(): DashboardLayoutContextValue {
  return required(useContext(DashboardLayoutContext), 'DashboardLayoutContext');
}

export function useDashboardFilters(): DashboardFiltersContextValue {
  return required(useContext(DashboardFiltersContext), 'DashboardFiltersContext');
}

export function useDashboardSources(): DashboardSourcesContextValue {
  return required(useContext(DashboardSourcesContext), 'DashboardSourcesContext');
}

export function useDashboardLocalWidgetChanges(): DashboardLocalWidgetChanges {
  return useContext(DashboardLocalWidgetChangesContext);
}

/** The registration callbacks and shown-doc lookup alone: never re-renders when a source registers. */
export function useDashboardSourceRegistry(): DashboardSourceRegistryContextValue {
  return required(useContext(DashboardSourceRegistryContext), 'DashboardSourceRegistryContext');
}

const EMPTY_VIEW_IDS: string[] = [];

function hasDetachedTargets(filters: DashboardGlobalFilter[], widgetDatabaseIds: ReadonlySet<string>) {
  return filters.some((filter) => Object.keys(filter.targets).some((databaseId) => !widgetDatabaseIds.has(databaseId)));
}

interface DashboardModeState extends DashboardModeSnapshot {
  viewId: string;
}

export function DashboardProvider({
  children,
  viewIds,
  modeStore,
}: {
  children: ReactNode;
  viewIds?: string[];
  /** Keeps the Edit preference across tab switches (owned by `DatabaseViews`). */
  modeStore?: DashboardModeStore;
}) {
  const { databaseDoc } = useDatabaseContext();
  const dashboardViewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const mobileContext = useMobileContext();
  const storedSetting = useDashboardLayoutSetting();
  const persistSetting = useUpdateDashboardSetting();
  const hostHistoryScope = useDatabaseHistoryScopeContext();
  const rows = storedSetting.rows;
  const rowsEmpty = rows.length === 0;

  // Write access and the mobile context are inputs of R-MODE, never events:
  // losing access for a moment (a re-probe on returning to the tab, a
  // reconnect) or narrowing the window hides Edit mode, and the editor's
  // preference applies again when they come back. Read by the callbacks at
  // call time, so they stay stable.
  const inputs = useMemo<DashboardModeInputs>(
    () => ({ canEdit: !readOnly, mobileContext }),
    [readOnly, mobileContext]
  );
  const inputsRef = useRef(inputs);

  inputsRef.current = inputs;

  // `reset` then `loaded`: a remembered preference (the page switched tabs
  // and back), otherwise the first layout snapshot decides. `auto` opens an
  // empty dashboard, or one created in this session, in Edit mode.
  const initialMode = (viewId: string): DashboardModeState => {
    const stored = modeStore?.get(viewId);

    if (stored) return { viewId, ...stored };
    return {
      viewId,
      rowsEmpty,
      preference: reduceDashboardEditPreference(
        'auto',
        { type: 'loaded', rowsEmpty, createdThisSession: wasDashboardCreatedThisSession(viewId) },
        inputs
      ),
    };
  };

  const [mode, setMode] = useState(() => initialMode(dashboardViewId));
  const [localGlobalFilters, setLocalGlobalFilters] = useState<DashboardGlobalFilter[] | null>(null);

  // Switching to another dashboard view (the provider stays mounted) starts
  // that view's mode and drops the local filters. Reset during render, so the
  // next view's first render never sees the previous view's state.
  if (mode.viewId !== dashboardViewId) {
    setMode(initialMode(dashboardViewId));
    setLocalGlobalFilters(null);
  } else if (mode.rowsEmpty !== rowsEmpty) {
    // Rows that became non-empty without a write of this client (a stale local
    // cache catching up, a collaborator) end an automatic Edit mode. Local
    // writes dispatch `local_write` before they land, so they never do.
    setMode((current) =>
      current.viewId !== dashboardViewId || current.rowsEmpty === rowsEmpty
        ? current
        : {
            ...current,
            rowsEmpty,
            preference: reduceDashboardEditPreference(
              current.preference,
              { type: 'remote_rows', wasEmpty: current.rowsEmpty, isEmpty: rowsEmpty },
              inputs
            ),
          }
    );
  }

  const dispatchMode = useCallback((event: DashboardModeEvent) => {
    setMode((current) => {
      const preference = reduceDashboardEditPreference(current.preference, event, inputsRef.current);

      return preference === current.preference ? current : { ...current, preference };
    });
  }, []);

  useEffect(() => {
    modeStore?.set(mode.viewId, { preference: mode.preference, rowsEmpty: mode.rowsEmpty });
  }, [modeStore, mode]);

  // The created-this-session mark only decides the first open (read by the
  // initializer above, which may run twice in StrictMode).
  useEffect(() => {
    consumeDashboardCreatedThisSession(dashboardViewId);
  }, [dashboardViewId]);

  const isEditing = resolveDashboardEditing(mode.preference, inputs);
  const canEnterEdit = canEnterDashboardEdit(inputs);

  const updateSetting = useCallback(
    (update: DashboardLayoutUpdate) => {
      if (readOnly) return;
      // Defensive: a mobile context never offers Edit-only controls.
      if (inputsRef.current.mobileContext && touchesEditOnlyKeys(update)) {
        Log.warn('[Dashboard] edit-only write refused on mobile', Object.keys(update));
        return;
      }

      dispatchMode({ type: 'local_write' });
      // Widget menus and drag handles live inside the source database's
      // history scope, but every dashboard layout write belongs to the host.
      hostHistoryScope?.activateHistoryScope();
      persistSetting(update);
    },
    [dispatchMode, hostHistoryScope, persistSetting, readOnly]
  );
  const getDatabase = useCallback(
    () => (databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database),
    [databaseDoc]
  );
  const hostDatabaseId = useMemo(
    () => (getDatabase()?.get(YjsDatabaseKey.id) as string | undefined) ?? databaseDoc.guid,
    [getDatabase, databaseDoc]
  );

  const {
    unsaved,
    savable,
    getViewOverlay,
    setViewOverlayWritable,
    resetViewOverlays,
    commitViewOverlays: persistViewOverlays,
  } = useDashboardViewOverlays(dashboardViewId, rows);
  const commitViewOverlays = useCallback(
    (globalFilters?: DashboardGlobalFilter[]) => {
      if (readOnly) return;
      hostHistoryScope?.activateHistoryScope();
      runDatabaseHistoryGroupForDatabase(databaseDoc, () => {
        if (globalFilters) persistSetting({ globalFilters });
        persistViewOverlays();
      });
    },
    [databaseDoc, hostHistoryScope, persistSetting, persistViewOverlays, readOnly]
  );

  // Docs the widgets registered; the host doc is derived, so a replaced host
  // doc never leaves a render with the previous one.
  const [widgetSourceDocs, setWidgetSourceDocs] = useState<Record<string, YDoc>>({});
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const sourceDocs = useMemo(
    () => ({ ...widgetSourceDocs, [hostDatabaseId]: databaseDoc }),
    [databaseDoc, hostDatabaseId, widgetSourceDocs]
  );
  const sourceDocsRef = useRef(sourceDocs);

  sourceDocsRef.current = sourceDocs;
  // A global filter only reaches databases that still have a widget. Mappings
  // left behind by a removed widget (for example by a concurrent edit) are
  // ignored here and dropped with the next filter write.
  const widgetDatabaseKey = dashboardSourceDatabaseIds(storedSetting.rows).join('\n');
  // Stable while the set of widget databases is unchanged (resizes, moves).
  const widgetDatabaseIds = useMemo(
    () => new Set(widgetDatabaseKey ? widgetDatabaseKey.split('\n') : []),
    [widgetDatabaseKey]
  );
  const storedGlobalFilters = storedSetting.globalFilters;
  const globalFilters = useMemo(
    () => detachRemovedGlobalFilterSources(storedGlobalFilters, widgetDatabaseIds),
    [storedGlobalFilters, widgetDatabaseIds]
  );
  const visibleLocalGlobalFilters = useMemo(() => {
    if (!localGlobalFilters) return null;
    const visible = detachRemovedGlobalFilterSources(localGlobalFilters, widgetDatabaseIds);

    return sameDashboardGlobalFilters(visible, globalFilters) ? null : visible;
  }, [globalFilters, localGlobalFilters, widgetDatabaseIds]);

  // An override that a concurrent change made identical to the persisted
  // filters (a removed widget, the same edit saved by a collaborator) has
  // nothing left to save: drop it rather than let it resurface stale later.
  if (localGlobalFilters && !visibleLocalGlobalFilters) {
    setLocalGlobalFilters(null);
  }

  const viewIdsKey = viewIds?.join(',') ?? '';
  // Stable identity while the tab list is unchanged.
  const hostViewIds = useMemo(() => (viewIdsKey ? viewIdsKey.split(',') : EMPTY_VIEW_IDS), [viewIdsKey]);

  const setEditing = useCallback(
    (editing: boolean) => dispatchMode({ type: 'set_editing', editing }),
    [dispatchMode]
  );
  const pinEditing = useCallback(() => dispatchMode({ type: 'pin' }), [dispatchMode]);

  // Reads the Y.Doc at call time (writes are synchronous), so consecutive
  // updates in one tick build on each other instead of on the last render.
  // Removing the last widget of a database (or pointing it at another
  // database) also removes that database from the global filters, in the same
  // undoable write; a primary mapping hands over to the next one.
  const updateRows = useCallback(
    (updater: (rows: DashboardRow[]) => DashboardRow[]) => {
      if (readOnly) return;
      // Every rows write is Edit-only (add, move, resize, remove, replace).
      if (inputsRef.current.mobileContext) {
        Log.warn('[Dashboard] edit-only write refused on mobile', ['rows']);
        return;
      }

      const current = readDashboardLayoutSetting(getDatabase(), dashboardViewId);
      const next = updater(current.rows);

      if (sameDashboardRows(current.rows, next)) return;
      const nextDatabaseIds = new Set(dashboardSourceDatabaseIds(next));
      let sources: GlobalFilterSource[] | undefined;
      const detach = (filters: DashboardGlobalFilter[]) => {
        if (!hasDetachedTargets(filters, nextDatabaseIds)) return filters;
        // The removed widget's doc is still registered, so its property can be followed.
        if (!sources) {
          sources = Object.entries(sourceDocsRef.current).map(([databaseId, doc]) => ({
            databaseId,
            name: '',
            fields: readGlobalFilterSourceFields(doc),
          }));
        }

        return detachRemovedGlobalFilterSources(filters, nextDatabaseIds, sources);
      };

      const nextGlobalFilters = detach(current.globalFilters);

      updateSetting(
        nextGlobalFilters === current.globalFilters ? { rows: next } : { rows: next, globalFilters: nextGlobalFilters }
      );
      setLocalGlobalFilters((local) => local && detach(local));
    },
    [readOnly, updateSetting, getDatabase, dashboardViewId]
  );

  const registerSourceDoc = useCallback((databaseId: string, doc: YDoc | null) => {
    setWidgetSourceDocs((previous) => {
      if (doc === null) {
        if (!(databaseId in previous)) return previous;
        const next = { ...previous };

        delete next[databaseId];
        return next;
      }

      if (previous[databaseId] === doc) return previous;
      return { ...previous, [databaseId]: doc };
    });
  }, []);

  // What each widget of another database shows as ready, by widget. A moved
  // widget's new instance reads it while rendering, before the old instance's
  // cleanup releases it in the commit.
  const shownDocsRef = useRef(new Map<string, { viewId: string; doc: YDoc }>());
  const markWidgetShown = useCallback((widgetId: string, viewId: string, doc: YDoc) => {
    const shown = shownDocsRef.current;
    const entry = { viewId, doc };

    shown.set(widgetId, entry);
    return () => {
      if (shown.get(widgetId) === entry) shown.delete(widgetId);
    };
  }, []);
  const getShownDoc = useCallback((widgetId: string, viewId: string) => {
    const entry = shownDocsRef.current.get(widgetId);

    return entry?.viewId === viewId ? entry.doc : null;
  }, []);

  const registerSourceName = useCallback((databaseId: string, name: string) => {
    setSourceNames((previous) => (previous[databaseId] === name ? previous : { ...previous, [databaseId]: name }));
  }, []);

  const { showWidgetTitles, showIconsInHeading } = storedSetting;

  const contextValue = useMemo<DashboardContextValue>(
    () => ({
      dashboardViewId,
      hostDatabaseId,
      canEdit: !readOnly,
      isEditing,
      setEditing,
      mobileContext,
      canEnterEdit,
      pinEditing,
      updateSetting,
      updateRows,
    }),
    [
      dashboardViewId,
      hostDatabaseId,
      readOnly,
      isEditing,
      setEditing,
      mobileContext,
      canEnterEdit,
      pinEditing,
      updateSetting,
      updateRows,
    ]
  );

  const layoutValue = useMemo<DashboardLayoutContextValue>(
    () => ({ rows, hostViewIds, showWidgetTitles, showIconsInHeading }),
    [rows, hostViewIds, showWidgetTitles, showIconsInHeading]
  );

  const filtersValue = useMemo<DashboardFiltersContextValue>(
    () => ({
      globalFilters,
      effectiveGlobalFilters: visibleLocalGlobalFilters ?? globalFilters,
      localGlobalFilters: visibleLocalGlobalFilters,
      setLocalGlobalFilters,
      getViewOverlay,
      setViewOverlayWritable,
      resetViewOverlays,
      commitViewOverlays,
    }),
    [
      globalFilters,
      visibleLocalGlobalFilters,
      getViewOverlay,
      setViewOverlayWritable,
      resetViewOverlays,
      commitViewOverlays,
    ]
  );

  const localWidgetChanges = useMemo<DashboardLocalWidgetChanges>(() => ({ unsaved, savable }), [unsaved, savable]);

  const sourcesValue = useMemo<DashboardSourcesContextValue>(
    () => ({ sourceDocs, registerSourceDoc, sourceNames, registerSourceName }),
    [sourceDocs, registerSourceDoc, sourceNames, registerSourceName]
  );

  const registryValue = useMemo<DashboardSourceRegistryContextValue>(
    () => ({ registerSourceDoc, registerSourceName, markWidgetShown, getShownDoc }),
    [getShownDoc, markWidgetShown, registerSourceDoc, registerSourceName]
  );

  return (
    <DashboardContext.Provider value={contextValue}>
      <DashboardLayoutContext.Provider value={layoutValue}>
        <DashboardFiltersContext.Provider value={filtersValue}>
          <DashboardLocalWidgetChangesContext.Provider value={localWidgetChanges}>
            <DashboardSourceRegistryContext.Provider value={registryValue}>
              <DashboardSourcesContext.Provider value={sourcesValue}>{children}</DashboardSourcesContext.Provider>
            </DashboardSourceRegistryContext.Provider>
          </DashboardLocalWidgetChangesContext.Provider>
        </DashboardFiltersContext.Provider>
      </DashboardLayoutContext.Provider>
    </DashboardContext.Provider>
  );
}
