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
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  dashboardSourceDatabaseIds,
  DashboardGlobalFilter,
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
import {
  applyPrivateGlobalValues,
  dashboardPrivateStorageKey,
  DashboardPrivateState,
  EMPTY_PRIVATE_GLOBAL_VALUES,
  globalFilterValueOf,
  PrivateGlobalValue,
  PrivateGlobalValues,
  prunePrivateGlobalValues,
  sameGlobalFilterValue,
} from '@/application/database-yjs/dashboard-private';
import {
  consumeDashboardCreatedThisSession,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import {
  createDatabaseHistoryGroup,
  getOrCreateDatabaseHistoryManager,
  runDatabaseHistoryGroupForDatabase,
} from '@/application/database-yjs/history';
import { UIVariant, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import { FilterInputFlushContext } from '@/components/database/components/filters/hooks/FilterInputFlushContext';
import { useDatabaseHistoryScopeContext } from '@/components/database/DatabaseHistoryScope';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
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
import { useDashboardOwnerLookup } from './hooks/useDashboardOwnerLookup';
import {
  DashboardViewOverlays,
  DashboardWidgetPrivateSummary,
  OverlayWidgetHandle,
  OverlayWidgetParts,
  useDashboardViewOverlays,
} from './hooks/useDashboardViewOverlays';
import { OwnedWidgetViews, useOwnedWidgetViews } from './hooks/useOwnedWidgetViews';
import { showSavedForEveryoneToast } from './private/savedToast';
import { usePrivatePayload, usePrivatePersistence } from './private/usePrivatePersistence';
import {
  WidgetIdentity,
  WidgetPrivateContext,
  WidgetPrivateHandle,
  WidgetPrivateResolver,
  WidgetPrivateSnapshot,
} from './private/WidgetPrivateContext';

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
 * - `DashboardFiltersContext`: the global filters, the viewer's private
 *   (unsaved) values and widget conditions, and Save / Reset (WP07).
 * - `DashboardPrivateSummaryContext`: whether anything is unsaved, for the
 *   filter bar's Reset and "Save for everyone".
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
  /**
   * Edit / Done. Entering Edit mode is ignored while `canEnterEdit` is false.
   * Done also deletes the owned views no widget shows any more (WP05 §1.5).
   */
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
  /**
   * Persist a row transformation computed from the latest rows; a no-op in a
   * mobile context. Returns whether it wrote (false when refused or unchanged).
   */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => boolean;
  /** The views this dashboard owns: create, duplicate, rename, delete (WP05, WP06). */
  ownedViews: OwnedWidgetViews;
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

/** What a Save or a Reset applies to: the whole dashboard, or one widget. */
export interface DashboardPrivateScope {
  widget?: WidgetIdentity;
}

// The unsaved counts live in their own context: every widget reads this one,
// and only the filter bar needs the counts.
export interface DashboardFiltersContextValue
  extends Pick<DashboardViewOverlays, 'getViewOverlay' | 'setViewOverlayWritable' | 'resetViewOverlays'> {
  /** Persisted global filters (mappings of databases without a widget left out). */
  globalFilters: DashboardGlobalFilter[];
  /** What the widgets apply: the saved filters, with the viewer's private values in View mode. */
  effectiveGlobalFilters: DashboardGlobalFilter[];
  /** The viewer's private values of existing global filters (dirty ones only), by filter id. */
  privateGlobalValues: PrivateGlobalValues;
  /** The global filters whose value is private right now (empty in Edit mode). */
  dirtyGlobalFilterIds: ReadonlySet<string>;
  /** Set (or with `null` drop) a private value; a value equal to the saved one is dropped. */
  setPrivateGlobalValue: (filterId: string, value: PrivateGlobalValue | null) => void;
  /**
   * "Save for everyone" (writers): the private global values and every dirty,
   * writable widget, or one widget, as one dashboard undo step. Returns the
   * history group (for the toast's Undo), or `null` when nothing was saved.
   */
  saveForEveryone: (scope?: DashboardPrivateScope) => object | null;
  /** Drop the private state: everything, or one widget's filters and sorts. */
  resetPrivateChanges: (scope?: DashboardPrivateScope) => void;
  /** The widget's private parts, as the overlay store tracks them. */
  getWidgetPrivateParts: DashboardViewOverlays['getWidgetPrivateHandle'];
  /**
   * Low level: save writable widget conditions and optional global filters as
   * one dashboard undo action. `saveForEveryone` builds on it.
   */
  commitViewOverlays: (globalFilters?: DashboardGlobalFilter[]) => void;
}

/** Whether the viewer has unsaved private changes, for the filter bar (WP07 §3.3). */
export interface DashboardPrivateSummary {
  /** Something differs from the saved dashboard (never in Edit mode). */
  hasChanges: boolean;
  /** "Save for everyone" is offered: write access and something savable. */
  canSave: boolean;
  dirtyGlobalCount: number;
  dirtyWidgetCount: number;
  savableWidgetCount: number;
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
export const NO_PRIVATE_CHANGES: DashboardPrivateSummary = {
  hasChanges: false,
  canSave: false,
  dirtyGlobalCount: 0,
  dirtyWidgetCount: 0,
  savableWidgetCount: 0,
};

/** The viewer's unsaved changes, summed up. */
export const DashboardPrivateSummaryContext = createContext<DashboardPrivateSummary>(NO_PRIVATE_CHANGES);

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

/** The global filters outside a dashboard too: `null` there (a standalone chart's drill-down). */
export function useDashboardFiltersOptional(): DashboardFiltersContextValue | null {
  return useContext(DashboardFiltersContext);
}

export function useDashboardSources(): DashboardSourcesContextValue {
  return required(useContext(DashboardSourcesContext), 'DashboardSourcesContext');
}

/** Whether anything is unsaved (no changes outside a dashboard). */
export function useDashboardPrivateSummary(): DashboardPrivateSummary {
  return useContext(DashboardPrivateSummaryContext);
}

/** The registration callbacks and shown-doc lookup alone: never re-renders when a source registers. */
export function useDashboardSourceRegistry(): DashboardSourceRegistryContextValue {
  return required(useContext(DashboardSourceRegistryContext), 'DashboardSourceRegistryContext');
}

const EMPTY_VIEW_IDS: string[] = [];
const NO_DIRTY_IDS: ReadonlySet<string> = new Set();
const SUSPENDED_SNAPSHOT: WidgetPrivateSnapshot = { filters: false, sorts: false, canSave: false, suspended: true };
const CLEAN_SNAPSHOT: WidgetPrivateSnapshot = { filters: false, sorts: false, canSave: false, suspended: false };

const widgetKey = ({ id, databaseId, viewId }: WidgetIdentity) => `${id}\n${databaseId}\n${viewId}`;

interface PrivateValuesState {
  /** The storage key and dashboard the values belong to. */
  key: string | null;
  viewId: string;
  values: PrivateGlobalValues;
}

function hasDetachedTargets(filters: DashboardGlobalFilter[], widgetDatabaseIds: ReadonlySet<string>) {
  return filters.some((filter) => Object.keys(filter.targets).some((databaseId) => !widgetDatabaseIds.has(databaseId)));
}

/**
 * `hasChanges` / `canSave` (WP07 §3.3): nothing shows in Edit mode, and Save
 * needs write access plus a private global value or a writable dirty widget.
 */
export function summarizePrivateChanges(
  dirtyGlobalCount: number,
  widgets: DashboardWidgetPrivateSummary,
  { canEdit, isEditing }: { canEdit: boolean; isEditing: boolean }
): DashboardPrivateSummary {
  if (isEditing || (dirtyGlobalCount === 0 && widgets.dirtyWidgets === 0)) return NO_PRIVATE_CHANGES;
  return {
    hasChanges: true,
    canSave: canEdit && (dirtyGlobalCount > 0 || widgets.savableWidgets > 0),
    dirtyGlobalCount,
    dirtyWidgetCount: widgets.dirtyWidgets,
    savableWidgetCount: widgets.savableWidgets,
  };
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
  const { t } = useTranslation();
  // Read at call time: `t` is not stable without an initialized i18n instance.
  const tRef = useRef(t);

  tRef.current = t;
  const { databaseDoc, workspaceId, variant } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
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

  // Switching to another dashboard view (the provider stays mounted) starts
  // that view's mode. Reset during render, so the next view's first render
  // never sees the previous view's state.
  if (mode.viewId !== dashboardViewId) {
    setMode(initialMode(dashboardViewId));
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

  // This device's private state (WP07): one key per workspace, user and
  // dashboard; none on a published dashboard or for an anonymous viewer.
  const storageKey =
    variant === UIVariant.Publish ? null : dashboardPrivateStorageKey(workspaceId, currentUser?.uid, dashboardViewId);
  const storedPrivate = usePrivatePayload(storageKey);
  const overlays = useDashboardViewOverlays(dashboardViewId, rows, storedPrivate?.widgets);
  const {
    summary: widgetSummary,
    getViewOverlay,
    setViewOverlayWritable,
    getWidgetPrivateHandle: getWidgetPrivateParts,
    resetViewOverlays,
    commitViewOverlays: persistViewOverlays,
    exportPrivateWidgets,
    subscribePrivateChanges,
  } = overlays;
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

  // The private global values: dirty ones only. A dashboard (or a key that
  // resolves later) starts from what this device stored.
  const [privateState, setPrivateState] = useState<PrivateValuesState>(() => ({
    key: storageKey,
    viewId: dashboardViewId,
    values: storedPrivate?.global_filters ?? EMPTY_PRIVATE_GLOBAL_VALUES,
  }));
  let privateValues = privateState.values;

  if (privateState.viewId !== dashboardViewId) {
    privateValues = storedPrivate?.global_filters ?? EMPTY_PRIVATE_GLOBAL_VALUES;
    setPrivateState({ key: storageKey, viewId: dashboardViewId, values: privateValues });
  } else if (privateState.key !== storageKey) {
    // The user resolved after the first render: keep what was set meanwhile.
    privateValues = { ...storedPrivate?.global_filters, ...privateState.values };
    setPrivateState({ key: storageKey, viewId: dashboardViewId, values: privateValues });
  }

  // A value equal to the saved one (a collaborator saved it, an Edit-mode
  // write matched it) or of a deleted filter has nothing left to save. Not
  // while the layout is still empty: that is a dashboard still loading.
  const layoutKnown = rows.length > 0 || globalFilters.length > 0;
  const prunedValues = layoutKnown ? prunePrivateGlobalValues(privateValues, globalFilters) : privateValues;

  if (prunedValues !== privateValues) {
    privateValues = prunedValues;
    setPrivateState((current) =>
      current.viewId === dashboardViewId ? { ...current, values: prunePrivateGlobalValues(current.values, globalFilters) } : current
    );
  }

  // A tab switch renders the next dashboard before the previous one's
  // cleanup runs. Keep its drafts and value refs scoped to that dashboard.
  const privateScope = useMemo(
    () => ({
      viewId: dashboardViewId,
      values: EMPTY_PRIVATE_GLOBAL_VALUES,
      globalFilters: [] as DashboardGlobalFilter[],
      inputFlushers: new Set<() => void>(),
    }),
    [dashboardViewId]
  );
  const { inputFlushers } = privateScope;
  const flushInputs = useCallback(() => inputFlushers.forEach((flush) => flush()), [inputFlushers]);

  privateScope.values = privateValues;
  privateScope.globalFilters = globalFilters;

  // Edit mode sets the private state aside: widgets and pills show the saved dashboard.
  const effectiveGlobalFilters = useMemo(
    () => (isEditing ? globalFilters : applyPrivateGlobalValues(globalFilters, privateValues)),
    [globalFilters, isEditing, privateValues]
  );
  const dirtyGlobalFilterIds = useMemo<ReadonlySet<string>>(() => {
    const ids = Object.keys(privateValues);

    return isEditing || ids.length === 0 ? NO_DIRTY_IDS : new Set(ids);
  }, [isEditing, privateValues]);

  const writePrivateValues = useCallback(
    (updater: (values: PrivateGlobalValues) => PrivateGlobalValues) => {
      const next = updater(privateScope.values);

      if (next === privateScope.values) return;
      privateScope.values = next;
      setPrivateState((current) => (current.viewId === privateScope.viewId ? { ...current, values: next } : current));
    },
    [privateScope]
  );

  const setPrivateGlobalValue = useCallback(
    (filterId: string, value: PrivateGlobalValue | null) => {
      const saved = privateScope.globalFilters.find((filter) => filter.id === filterId);

      writePrivateValues((values) => {
        const keep = value !== null && saved !== undefined && !sameGlobalFilterValue(saved.fieldType, value, globalFilterValueOf(saved));

        if (!keep) {
          if (!(filterId in values)) return values;
          const next = { ...values };

          delete next[filterId];
          return Object.keys(next).length === 0 ? EMPTY_PRIVATE_GLOBAL_VALUES : next;
        }

        const current = values[filterId];

        if (current && sameGlobalFilterValue(saved.fieldType, current, value)) return values;
        return { ...values, [filterId]: value };
      });
    },
    [privateScope, writePrivateValues]
  );

  const collectPrivateState = useCallback(
    (): DashboardPrivateState => ({ global_filters: privateScope.values, widgets: exportPrivateWidgets() }),
    [exportPrivateWidgets, privateScope]
  );
  const persistence = usePrivatePersistence({
    storageKey,
    collect: collectPrivateState,
    flushInputs,
    subscribe: subscribePrivateChanges,
  });
  const { schedule: schedulePersist, flush: flushPrivate } = persistence;
  const persistedValuesRef = useRef(privateValues);

  // A value change is written after the debounce (not the values read from storage).
  useEffect(() => {
    if (persistedValuesRef.current === privateValues) return;
    persistedValuesRef.current = privateValues;
    schedulePersist();
  }, [privateValues, schedulePersist]);

  const viewIdsKey = viewIds?.join(',') ?? '';
  // Stable identity while the tab list is unchanged.
  const hostViewIds = useMemo(() => (viewIdsKey ? viewIdsKey.split(',') : EMPTY_VIEW_IDS), [viewIdsKey]);

  const pinEditing = useCallback(() => dispatchMode({ type: 'pin' }), [dispatchMode]);

  // Reads the Y.Doc at call time (writes are synchronous), so consecutive
  // updates in one tick build on each other instead of on the last render.
  // Removing the last widget of a database (or pointing it at another
  // database) also removes that database from the global filters, in the same
  // undoable write; a primary mapping hands over to the next one.
  const updateRows = useCallback(
    (updater: (rows: DashboardRow[]) => DashboardRow[]) => {
      if (readOnly) return false;
      // Every rows write is Edit-only (add, move, resize, remove, replace).
      if (inputsRef.current.mobileContext) {
        Log.warn('[Dashboard] edit-only write refused on mobile', ['rows']);
        return false;
      }

      const current = readDashboardLayoutSetting(getDatabase(), dashboardViewId);
      const next = updater(current.rows);

      if (sameDashboardRows(current.rows, next)) return false;
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
      return true;
    },
    [readOnly, updateSetting, getDatabase, dashboardViewId]
  );

  const getRows = useCallback(
    () => readDashboardLayoutSetting(getDatabase(), dashboardViewId).rows,
    [getDatabase, dashboardViewId]
  );
  const getSourceDoc = useCallback((databaseId: string) => sourceDocsRef.current[databaseId], []);
  const ownerOfNow = useDashboardOwnerLookup({ hostDoc: databaseDoc, sourceDocs: sourceDocsRef });
  const ownedViews = useOwnedWidgetViews({
    dashboardViewId,
    hostDatabaseId,
    canEdit: !readOnly,
    mobileContext,
    updateRows,
    getRows,
    ownerOfNow,
    getSourceDoc,
  });
  const { flushOwnedViews } = ownedViews;

  const setEditing = useCallback(
    (editing: boolean) => {
      dispatchMode({ type: 'set_editing', editing });
      // Done: the views the editor's changes left without a widget go now.
      if (!editing) void flushOwnedViews();
    },
    [dispatchMode, flushOwnedViews]
  );

  // "Save for everyone": the private global values merged into the latest
  // saved filters (key by key, read now) and the dirty parts of every
  // writable widget, or one widget, as one step of the dashboard's history.
  const saveForEveryone = useCallback(
    (scope: DashboardPrivateScope = {}) => {
      if (readOnly) return null;
      const group = createDatabaseHistoryGroup();
      const manager = getOrCreateDatabaseHistoryManager(databaseDoc);
      const values = privateScope.values;
      const saveGlobals = !scope.widget && Object.keys(values).length > 0;
      // The private values are dropped only once their write landed: a write
      // that threw (a doc observer, a refused transaction) keeps them, and
      // their stored copy, for a retry.
      let savedGlobals = false;
      let failed = false;

      hostHistoryScope?.activateHistoryScope();
      try {
        runDatabaseHistoryGroupForDatabase(
          databaseDoc,
          () => {
            if (saveGlobals) {
              const latest = detachRemovedGlobalFilterSources(
                readDashboardLayoutSetting(getDatabase(), dashboardViewId).globalFilters,
                widgetDatabaseIds
              );
              const merged = applyPrivateGlobalValues(latest, values);

              if (merged !== latest) persistSetting({ globalFilters: merged });
              savedGlobals = true;
            }

            persistViewOverlays(scope.widget);
          },
          group
        );
      } catch (error) {
        failed = true;
        Log.error('[Dashboard] save for everyone failed', error);
        toast.error(tRef.current('dashboard.saveFailed', { defaultValue: 'Could not save for everyone' }));
      }

      if (savedGlobals) writePrivateValues(() => EMPTY_PRIVATE_GLOBAL_VALUES);
      flushPrivate({ global_filters: savedGlobals ? EMPTY_PRIVATE_GLOBAL_VALUES : privateScope.values });
      // Something was recorded: the toast offers to undo exactly this step.
      if (failed || manager.latestUndoGroup() !== group) return null;
      showSavedForEveryoneToast({ t: tRef.current, historyManager: manager, group });
      return group;
    },
    [
      databaseDoc,
      dashboardViewId,
      flushPrivate,
      getDatabase,
      hostHistoryScope,
      persistSetting,
      persistViewOverlays,
      privateScope,
      readOnly,
      widgetDatabaseIds,
      writePrivateValues,
    ]
  );

  const resetPrivateChanges = useCallback(
    (scope: DashboardPrivateScope = {}) => {
      if (!scope.widget) writePrivateValues(() => EMPTY_PRIVATE_GLOBAL_VALUES);
      resetViewOverlays(scope.widget);
      flushPrivate(scope.widget ? undefined : { global_filters: EMPTY_PRIVATE_GLOBAL_VALUES });
    },
    [flushPrivate, resetViewOverlays, writePrivateValues]
  );

  // Per-widget handles for the Filter / Sort dots and the popover footers:
  // the overlay store's parts, set aside in Edit mode, with Save offered to
  // dashboard writers whose source is writable.
  const canEdit = !readOnly;
  const handleModeRef = useRef({ canEdit, isEditing });
  const handleModeListeners = useRef(new Set<() => void>());
  const saveRef = useRef(saveForEveryone);
  const resetRef = useRef(resetPrivateChanges);

  saveRef.current = saveForEveryone;
  resetRef.current = resetPrivateChanges;
  useLayoutEffect(() => {
    const current = handleModeRef.current;

    if (current.canEdit === canEdit && current.isEditing === isEditing) return;
    handleModeRef.current = { canEdit, isEditing };
    handleModeListeners.current.forEach((notify) => notify());
  }, [canEdit, isEditing]);

  const privateResolver = useMemo<WidgetPrivateResolver>(() => {
    // One wrapper per widget, bound to the store's record it wraps. The store
    // drops the records of widgets that left the rows (`retain`): a widget
    // removed and brought back by undo gets a new record, so its cached
    // wrapper is rebuilt instead of staying bound to the dropped one.
    const handles = new Map<string, { parts: OverlayWidgetHandle; handle: WidgetPrivateHandle }>();

    return {
      getWidgetPrivateHandle: (widget) => {
        const key = widgetKey(widget);
        const parts = getWidgetPrivateParts(widget);
        const existing = handles.get(key);

        if (existing && existing.parts === parts) return existing.handle;
        let cache: { parts: OverlayWidgetParts; mode: typeof handleModeRef.current; snapshot: WidgetPrivateSnapshot } | null =
          null;
        const handle: WidgetPrivateHandle = {
          subscribe: (listener) => {
            const unsubscribe = parts.subscribe(listener);

            handleModeListeners.current.add(listener);
            return () => {
              unsubscribe();
              handleModeListeners.current.delete(listener);
            };
          },
          getSnapshot: () => {
            const current = parts.getSnapshot();
            const mode = handleModeRef.current;

            if (cache && cache.parts === current && cache.mode === mode) return cache.snapshot;
            let snapshot: WidgetPrivateSnapshot;

            if (mode.isEditing) snapshot = SUSPENDED_SNAPSHOT;
            else if (!current.filters && !current.sorts) snapshot = CLEAN_SNAPSHOT;
            else {
              snapshot = {
                filters: current.filters,
                sorts: current.sorts,
                canSave: mode.canEdit && current.writable,
                suspended: false,
              };
            }

            cache = { parts: current, mode, snapshot };
            return snapshot;
          },
          reset: () => resetRef.current({ widget }),
          save: () => {
            saveRef.current({ widget });
          },
        };

        handles.set(key, { parts, handle });
        return handle;
      },
    };
  }, [getWidgetPrivateParts]);

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
      ownedViews,
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
      ownedViews,
    ]
  );

  const layoutValue = useMemo<DashboardLayoutContextValue>(
    () => ({ rows, hostViewIds, showWidgetTitles, showIconsInHeading }),
    [rows, hostViewIds, showWidgetTitles, showIconsInHeading]
  );

  const filtersValue = useMemo<DashboardFiltersContextValue>(
    () => ({
      globalFilters,
      effectiveGlobalFilters,
      privateGlobalValues: privateValues,
      dirtyGlobalFilterIds,
      setPrivateGlobalValue,
      saveForEveryone,
      resetPrivateChanges,
      getWidgetPrivateParts,
      getViewOverlay,
      setViewOverlayWritable,
      resetViewOverlays,
      commitViewOverlays,
    }),
    [
      globalFilters,
      effectiveGlobalFilters,
      privateValues,
      dirtyGlobalFilterIds,
      setPrivateGlobalValue,
      saveForEveryone,
      resetPrivateChanges,
      getWidgetPrivateParts,
      getViewOverlay,
      setViewOverlayWritable,
      resetViewOverlays,
      commitViewOverlays,
    ]
  );

  const privateSummary = useMemo<DashboardPrivateSummary>(
    () => summarizePrivateChanges(dirtyGlobalFilterIds.size, widgetSummary, { canEdit, isEditing }),
    [canEdit, dirtyGlobalFilterIds.size, isEditing, widgetSummary]
  );

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
          <DashboardPrivateSummaryContext.Provider value={privateSummary}>
            <WidgetPrivateContext.Provider value={privateResolver}>
              <DashboardSourceRegistryContext.Provider value={registryValue}>
                <DashboardSourcesContext.Provider value={sourcesValue}>
                  <FilterInputFlushContext.Provider value={inputFlushers}>{children}</FilterInputFlushContext.Provider>
                </DashboardSourcesContext.Provider>
              </DashboardSourceRegistryContext.Provider>
            </WidgetPrivateContext.Provider>
          </DashboardPrivateSummaryContext.Provider>
        </DashboardFiltersContext.Provider>
      </DashboardLayoutContext.Provider>
    </DashboardContext.Provider>
  );
}
