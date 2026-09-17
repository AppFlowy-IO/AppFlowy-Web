import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  dashboardSourceDatabaseIds,
  DashboardGlobalFilter,
  DashboardLayoutSetting,
  DashboardLayoutUpdate,
  DashboardRow,
  readDashboardLayoutSetting,
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
 * Shared state of one dashboard view: the persisted layout, the viewer's
 * unsaved global-filter overrides, the Edit / View mode toggle, and the
 * registry of source-database docs that mounted widgets expose so the global
 * filter editor can list every source's properties.
 *
 * Mounted by `DatabaseViews` around the dashboard content (tab bar included),
 * so both the toolbar (`DashboardActions`) and the grid read the same value.
 */
export interface DashboardContextValue {
  /** The dashboard's own view id (a view of the host database). */
  dashboardViewId: string;
  /** The host database id; widgets may reference other databases too. */
  hostDatabaseId: string;
  /** View ids shown as tabs of the host database (the widget picker offers them first). */
  hostViewIds: string[];
  /** Persisted snapshot (rows, global filters, widget-title flag). */
  setting: DashboardLayoutSetting;
  rows: DashboardRow[];
  /** Persisted global filters unless the viewer changed them locally. */
  effectiveGlobalFilters: DashboardGlobalFilter[];
  /** Unsaved, viewer-only overrides of the global filters (`null` = none). */
  localGlobalFilters: DashboardGlobalFilter[] | null;
  setLocalGlobalFilters: (filters: DashboardGlobalFilter[] | null) => void;
  /** Whether the viewer can persist layout / filter changes. */
  canEdit: boolean;
  /** Edit mode is local UI state: never persisted, never synced. */
  isEditing: boolean;
  setEditing: (editing: boolean) => void;
  /** Persist a partial update; a no-op for read-only viewers. */
  updateSetting: (update: DashboardLayoutUpdate) => void;
  /** Persist a row transformation computed from the latest rows. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => void;
  /** Y.Docs of source databases currently mounted by widgets, keyed by database id. */
  sourceDocs: Record<string, YDoc>;
  registerSourceDoc: (databaseId: string, doc: YDoc | null) => void;
  /** Display names of source databases, keyed by database id. */
  sourceNames: Record<string, string>;
  registerSourceName: (databaseId: string, name: string) => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext(): DashboardContextValue {
  const context = useContext(DashboardContext);

  if (!context) {
    throw new Error('DashboardContext is not provided');
  }

  return context;
}

export function useDashboardContextOptional(): DashboardContextValue | null {
  return useContext(DashboardContext);
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
  const setting = useMemo(
    () => (globalFilters === storedSetting.globalFilters ? storedSetting : { ...storedSetting, globalFilters }),
    [globalFilters, storedSetting]
  );
  const visibleLocalGlobalFilters = useMemo(
    () => localGlobalFilters && detachRemovedGlobalFilterSources(localGlobalFilters, widgetDatabaseIds),
    [localGlobalFilters, widgetDatabaseIds]
  );
  const viewIdsKey = viewIds?.join(',') ?? '';
  // Stable identity while the tab list is unchanged.
  const hostViewIds = useMemo(() => (viewIdsKey ? viewIdsKey.split(',') : EMPTY_VIEW_IDS), [viewIdsKey]);

  // Losing write access (or switching views) leaves Edit mode.
  useEffect(() => {
    if (readOnly) setEditingState(false);
  }, [readOnly]);

  // A layout effect: it must run before the (passive) mount effect with which
  // a freshly mounted `Dashboard` may request Edit mode for an empty layout,
  // and before paint, so the next view never flashes the previous mode.
  useLayoutEffect(() => {
    setEditingState(false);
    setLocalGlobalFilters(null);
  }, [dashboardViewId]);

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

  const value = useMemo<DashboardContextValue>(
    () => ({
      dashboardViewId,
      hostDatabaseId,
      hostViewIds,
      setting,
      rows: setting.rows,
      effectiveGlobalFilters: visibleLocalGlobalFilters ?? setting.globalFilters,
      localGlobalFilters: visibleLocalGlobalFilters,
      setLocalGlobalFilters,
      canEdit: !readOnly,
      isEditing,
      setEditing,
      updateSetting,
      updateRows,
      sourceDocs,
      registerSourceDoc,
      sourceNames,
      registerSourceName,
    }),
    [
      dashboardViewId,
      hostDatabaseId,
      hostViewIds,
      setting,
      visibleLocalGlobalFilters,
      readOnly,
      isEditing,
      setEditing,
      updateSetting,
      updateRows,
      sourceDocs,
      registerSourceDoc,
      sourceNames,
      registerSourceName,
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
