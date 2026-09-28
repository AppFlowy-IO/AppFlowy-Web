import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

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
import { runDatabaseHistoryGroupForDatabase } from '@/application/database-yjs/history';
import { YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useDatabaseHistoryScopeContext } from '@/components/database/DatabaseHistoryScope';

import { readGlobalFilterSourceFields } from './global-filters/global-filter.source-fields';
import { detachRemovedGlobalFilterSources, GlobalFilterSource } from './global-filters/global-filter.utils';
import {
  DashboardLocalWidgetChanges,
  DashboardViewOverlays,
  useDashboardViewOverlays,
} from './hooks/useDashboardViewOverlays';

/**
 * Shared state of one dashboard view, split by how often it changes so a
 * consumer only re-renders for what it reads:
 *
 * - `DashboardContext`: the Edit / View mode toggle, write access and the
 *   layout writers; changes only when the mode or the access does.
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
  /** Edit mode is local UI state: never persisted, never synced. */
  isEditing: boolean;
  setEditing: (editing: boolean) => void;
  /** Persist a partial update; a no-op for read-only viewers. */
  updateSetting: (update: DashboardLayoutUpdate) => void;
  /** Persist a row transformation computed from the latest rows. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => void;
}

export interface DashboardLayoutContextValue {
  /** Persisted rows. */
  rows: DashboardRow[];
  /** View ids shown as tabs of the host database (the widget picker offers them first). */
  hostViewIds: string[];
  /** Persisted widget-title flag. */
  showWidgetTitles: boolean;
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

export function DashboardProvider({ children, viewIds }: { children: ReactNode; viewIds?: string[] }) {
  const { databaseDoc } = useDatabaseContext();
  const dashboardViewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const storedSetting = useDashboardLayoutSetting();
  const persistSetting = useUpdateDashboardSetting();
  const hostHistoryScope = useDatabaseHistoryScopeContext();
  const updateSetting = useCallback(
    (update: DashboardLayoutUpdate) => {
      if (readOnly) return;
      // Widget menus and drag handles live inside the source database's
      // history scope, but every dashboard layout write belongs to the host.
      hostHistoryScope?.activateHistoryScope();
      persistSetting(update);
    },
    [hostHistoryScope, persistSetting, readOnly]
  );
  const getDatabase = useCallback(
    () => (databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database),
    [databaseDoc]
  );
  const hostDatabaseId = useMemo(
    () => (getDatabase()?.get(YjsDatabaseKey.id) as string | undefined) ?? databaseDoc.guid,
    [getDatabase, databaseDoc]
  );

  // 'auto': a dashboard without widgets has nothing to view, so an editor
  // starts building it right away (Notion parity); widgets that arrive before
  // the editor chose a mode (a stale local cache, a collaborator) settle it to
  // View mode. 'on' / 'off': the editor's choice.
  const [editMode, setEditMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [localGlobalFilters, setLocalGlobalFilters] = useState<DashboardGlobalFilter[] | null>(null);
  const [stateViewId, setStateViewId] = useState(dashboardViewId);
  const rows = storedSetting.rows;

  // Switching to another dashboard view (the provider stays mounted) leaves
  // Edit mode and drops the local filters. Reset during render, so the next
  // view's first render never sees the previous view's state.
  if (stateViewId !== dashboardViewId) {
    setStateViewId(dashboardViewId);
    setEditMode('auto');
    setLocalGlobalFilters(null);
  }

  // Derived during render, so no frame shows the wrong mode. Without write
  // access nothing is editable, yet the editor's choice is kept: access is
  // briefly unknown while it is re-probed (back on the tab, a reconnect), and
  // Edit mode must come back with it. The automatic mode is decided once
  // write access is known.
  if (!readOnly && editMode === 'auto' && rows.length > 0) setEditMode('off');
  const isEditing = !readOnly && (editMode === 'on' || (editMode === 'auto' && rows.length === 0));

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
    (editing: boolean) => {
      setEditMode(editing && !readOnly ? 'on' : 'off');
    },
    [readOnly]
  );

  // Reads the Y.Doc at call time (writes are synchronous), so consecutive
  // updates in one tick build on each other instead of on the last render.
  // Removing the last widget of a database (or pointing it at another
  // database) also removes that database from the global filters, in the same
  // undoable write; a primary mapping hands over to the next one.
  const updateRows = useCallback(
    (updater: (rows: DashboardRow[]) => DashboardRow[]) => {
      if (readOnly) return;
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

  const { showWidgetTitles } = storedSetting;

  const contextValue = useMemo<DashboardContextValue>(
    () => ({
      dashboardViewId,
      hostDatabaseId,
      canEdit: !readOnly,
      isEditing,
      setEditing,
      updateSetting,
      updateRows,
    }),
    [dashboardViewId, hostDatabaseId, readOnly, isEditing, setEditing, updateSetting, updateRows]
  );

  const layoutValue = useMemo<DashboardLayoutContextValue>(
    () => ({ rows, hostViewIds, showWidgetTitles }),
    [rows, hostViewIds, showWidgetTitles]
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
