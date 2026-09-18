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
import { YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

import { detachRemovedGlobalFilterSources, GlobalFilterSource } from './global-filters/global-filter.utils';
import { readGlobalFilterSourceFields } from './global-filters/useGlobalFilterSources';

/**
 * Shared state of one dashboard view, split by how often it changes so a
 * consumer only re-renders for what it reads:
 *
 * - `DashboardContext`: the persisted layout and the Edit / View mode toggle.
 * - `DashboardFiltersContext`: the global filters and the viewer's unsaved
 *   overrides.
 * - `DashboardSourcesContext`: the registry of source-database docs (and
 *   names) that mounted widgets expose so the global filter editor can list
 *   every source's properties.
 * - `DashboardSourceRegistryContext`: only the (stable) registration
 *   callbacks, for components that register sources without reading them.
 *
 * All four are mounted by `DashboardProvider`, which `DatabaseViews` renders
 * around the dashboard content (tab bar included), so both the toolbar
 * (`DashboardActions`) and the grid read the same values.
 */
export interface DashboardContextValue {
  /** The dashboard's own view id (a view of the host database). */
  dashboardViewId: string;
  /** The host database id; widgets may reference other databases too. */
  hostDatabaseId: string;
  /** View ids shown as tabs of the host database (the widget picker offers them first). */
  hostViewIds: string[];
  /** Persisted rows. */
  rows: DashboardRow[];
  /** Persisted widget-title flag. */
  showWidgetTitles: boolean;
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

export interface DashboardFiltersContextValue {
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

export type DashboardSourceRegistryContextValue = Pick<
  DashboardSourcesContextValue,
  'registerSourceDoc' | 'registerSourceName'
>;

export const DashboardContext = createContext<DashboardContextValue | null>(null);
export const DashboardFiltersContext = createContext<DashboardFiltersContextValue | null>(null);
export const DashboardSourcesContext = createContext<DashboardSourcesContextValue | null>(null);
export const DashboardSourceRegistryContext = createContext<DashboardSourceRegistryContextValue | null>(null);

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

export function useDashboardFilters(): DashboardFiltersContextValue {
  return required(useContext(DashboardFiltersContext), 'DashboardFiltersContext');
}

export function useDashboardSources(): DashboardSourcesContextValue {
  return required(useContext(DashboardSourcesContext), 'DashboardSourcesContext');
}

/** The registration callbacks alone: never re-renders when a source registers. */
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
  const updateSetting = useUpdateDashboardSetting();
  const getDatabase = useCallback(
    () => (databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database),
    [databaseDoc]
  );
  const hostDatabaseId = useMemo(
    () => (getDatabase()?.get(YjsDatabaseKey.id) as string | undefined) ?? databaseDoc.guid,
    [getDatabase, databaseDoc]
  );

  const [isEditing, setEditingState] = useState(false);
  const [localGlobalFilters, setLocalGlobalFilters] = useState<DashboardGlobalFilter[] | null>(null);
  const [stateViewId, setStateViewId] = useState(dashboardViewId);

  // Switching to another dashboard view (the provider stays mounted) leaves
  // Edit mode and drops the local filters. Reset during render, so the next
  // view's first render (and the Edit-mode request a freshly mounted, empty
  // `Dashboard` makes) never sees the previous view's state.
  if (stateViewId !== dashboardViewId) {
    setStateViewId(dashboardViewId);
    setEditingState(false);
    setLocalGlobalFilters(null);
  }

  // Losing write access leaves Edit mode, also during render: no frame ever
  // shows Edit-mode chrome to a viewer.
  if (readOnly && isEditing) setEditingState(false);

  const [sourceDocs, setSourceDocs] = useState<Record<string, YDoc>>(() => ({ [hostDatabaseId]: databaseDoc }));
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
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

  useEffect(() => {
    setSourceDocs((previous) =>
      previous[hostDatabaseId] === databaseDoc ? previous : { ...previous, [hostDatabaseId]: databaseDoc }
    );
  }, [databaseDoc, hostDatabaseId]);

  const setEditing = useCallback(
    (editing: boolean) => {
      setEditingState(editing && !readOnly);
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
    setSourceDocs((previous) => {
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

  const registerSourceName = useCallback((databaseId: string, name: string) => {
    setSourceNames((previous) => (previous[databaseId] === name ? previous : { ...previous, [databaseId]: name }));
  }, []);

  const rows = storedSetting.rows;
  const { showWidgetTitles } = storedSetting;

  const layoutValue = useMemo<DashboardContextValue>(
    () => ({
      dashboardViewId,
      hostDatabaseId,
      hostViewIds,
      rows,
      showWidgetTitles,
      canEdit: !readOnly,
      isEditing,
      setEditing,
      updateSetting,
      updateRows,
    }),
    [
      dashboardViewId,
      hostDatabaseId,
      hostViewIds,
      rows,
      showWidgetTitles,
      readOnly,
      isEditing,
      setEditing,
      updateSetting,
      updateRows,
    ]
  );

  const filtersValue = useMemo<DashboardFiltersContextValue>(
    () => ({
      globalFilters,
      effectiveGlobalFilters: visibleLocalGlobalFilters ?? globalFilters,
      localGlobalFilters: visibleLocalGlobalFilters,
      setLocalGlobalFilters,
    }),
    [globalFilters, visibleLocalGlobalFilters]
  );

  const sourcesValue = useMemo<DashboardSourcesContextValue>(
    () => ({ sourceDocs, registerSourceDoc, sourceNames, registerSourceName }),
    [sourceDocs, registerSourceDoc, sourceNames, registerSourceName]
  );

  const registryValue = useMemo<DashboardSourceRegistryContextValue>(
    () => ({ registerSourceDoc, registerSourceName }),
    [registerSourceDoc, registerSourceName]
  );

  return (
    <DashboardContext.Provider value={layoutValue}>
      <DashboardFiltersContext.Provider value={filtersValue}>
        <DashboardSourceRegistryContext.Provider value={registryValue}>
          <DashboardSourcesContext.Provider value={sourcesValue}>{children}</DashboardSourcesContext.Provider>
        </DashboardSourceRegistryContext.Provider>
      </DashboardFiltersContext.Provider>
    </DashboardContext.Provider>
  );
}
