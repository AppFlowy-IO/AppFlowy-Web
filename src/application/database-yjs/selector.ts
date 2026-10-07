import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AbstractType, type Transaction, type YEvent } from 'yjs';

import { subscribeRowDocRelease } from '@/application/database-blob/row-doc-retention';
import { readBoardGroupCalculation } from '@/application/database-yjs/board-group-calculation';
import { isUngroupedColumnHidden, resolveBoardColumnVisibility } from '@/application/database-yjs/board-visibility';
import { createCalendarLayoutStore } from '@/application/database-yjs/calendar-layout';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell, FormulaCell, RollupCell } from '@/application/database-yjs/cell.type';
import { hasRowConditionData, invalidateRowConditionCache } from '@/application/database-yjs/condition-value-cache';
import { DEFAULT_FIELD_WRAP, getCell, MIN_COLUMN_WIDTH } from '@/application/database-yjs/const';
import {
  useDatabase,
  useDatabaseContext,
  useDatabaseExtraFilters,
  useDatabaseFields,
  useDatabaseSearchQuery,
  useDatabaseView,
  useDatabaseViewId,
  useRow,
  useRowMap,
  useRowPassState,
} from '@/application/database-yjs/context';
import { createDashboardLayoutStore } from '@/application/database-yjs/dashboard-layout';
import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import { DASHBOARD_LOADING } from '@/application/database-yjs/dashboard-loading';
import { filterOwnedTabViewIds } from '@/application/database-yjs/dashboard-owned-views';
import { getSearchableFields, normalizeSearchQuery, searchRows, type SearchTextOptions } from '@/application/database-yjs/database-search';
import { decodeCellToText } from '@/application/database-yjs/decode';
import {
  collectFormulaExternalReferences,
  compileFormula,
  evaluateFormulaCell,
  FormulaExternalReferences,
  FormulaFieldSchema,
  FormulaType,
  getDateCellStr,
  getFieldDateTimeFormats,
  getTypeOptions,
  NO_EXTERNAL_REFERENCES,
  parseFormulaTypeOption,
  parseFormulaVisualizationOption,
  parsePersonTypeOptions,
  readFormulaSchema,
  readFormulaSchemaForVersion,
  parseRelationTypeOption,
  parseRollupTypeOption,
  parseRollupVisualizationOption,
  parseSelectOptionTypeOptions,
  SelectOption,
} from '@/application/database-yjs/fields';
import {
  combineFilters,
  filterBy,
  type FilterList,
  flattenFilterTree,
  getEffectiveFiltersSnapshot,
  hasEffectiveFilters,
  normalizeFilterNode,
  parseFilter,
} from '@/application/database-yjs/filter';
import { useFormulaClock } from '@/application/database-yjs/formula/clock';
import {
  formulaConditionContext,
  formulaRowContext,
  historicalFormulaRowContext,
  memberNames,
  useFormulaReadContext,
} from '@/application/database-yjs/formula/read-context';
import { FormulaRowSources, useFormulaRelationTitles } from '@/application/database-yjs/formula/useFormulaRelationTitles';
import { DEFAULT_GALLERY_LAYOUT_SETTINGS } from '@/application/database-yjs/gallery-layout';
import {
  areGroupRowsHydrated,
  getGroupColumns,
  getGroupLabel,
  groupByField,
  isDatabaseGroupableFieldType,
  isDynamicDatabaseGroupFieldType,
} from '@/application/database-yjs/group';
import {
  hasPendingLocalDatabaseGroupInitialization,
  normalizeDatabaseGroupColumn,
  normalizeUniqueDatabaseGroupColumns,
} from '@/application/database-yjs/group-column';
import type { DatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { retainDatabaseHistoryRow } from '@/application/database-yjs/history-row-store';
import {
  type BackgroundRowDocChange,
  useBackgroundRowDocLoader,
  useRollupFieldObservers,
} from '@/application/database-yjs/hooks';
import { useTimelineRowSource } from '@/application/database-yjs/hooks/TimelineRowValuesProvider';
import { useTimelineRowValuesSnapshot } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { createLocalFirstObserver } from '@/application/database-yjs/local-first-observer';
import { createNumberGroupingPolicy, NumberGroupingPolicy } from '@/application/database-yjs/number-grouping';
import {
  ensureRelationGroupLabel,
  getRelationGroupLabelRevision,
  invalidateRelationCell,
  readRelationGroupLabel,
  readRelationCellText,
  retainRelationGroupLabels,
  subscribeRelationCache,
  subscribeRelationGroupLabels,
} from '@/application/database-yjs/relation/cache';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { readHistoricalRelationText } from '@/application/database-yjs/relation/history';
import { useDatabaseDependencyRestoreRevision } from '@/application/database-yjs/restore-dependencies';
import {
  invalidateRollupCell,
  readRollupCell,
  readRollupCellSync,
  RollupCellValue,
  subscribeRollupCell,
  subscribeRollupCache,
} from '@/application/database-yjs/rollup/cache';
import { observeRollupCell } from '@/application/database-yjs/rollup/observe';
import { retainRollupSource } from '@/application/database-yjs/rollup/source-sync';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { sortBy } from '@/application/database-yjs/sort';
import { createTimelineLayoutStore } from '@/application/database-yjs/timeline-layout';
import {
  DatabaseViewLayout,
  FieldId,
  GalleryCardPreview,
  GalleryCardSize,
  GalleryLayoutSettings,
  MentionablePerson,
  RowId,
  SortId,
  TimeFormat,
  YDatabase,
  YDatabaseChartLayoutSetting,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseMetas,
  YDatabaseRow,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { sameChartExtendedSettings } from './chart-extended-settings';
import { ChartLayoutSettings, parseChartLayoutSettings } from './chart.type';
import {
  CalculationType,
  FieldType,
  FieldVisibility,
  Filter,
  FilterType,
  RowMeta,
  RollupDisplayMode,
  SortCondition,
} from './database.type';
import { useDatabaseFieldsVersion } from './hooks/useDatabaseFieldsVersion';
import { useRelativeDateFilterRefresh } from './hooks/useRelativeDateFilterRefresh';


export interface Column {
  fieldId: string;
  fieldName?: string;
  width: number;
  visibility: FieldVisibility;
  wrap?: boolean;
  isPrimary: boolean;
  fieldType?: FieldType;
}

export interface Row {
  id: string;
  height: number;
  // Soft-delete tombstone mirroring collab-database's RowOrder.is_deleted.
  // Tombstoned rows stay in row_orders (restorable from trash) but must be
  // hidden from every rendered view.
  is_deleted?: boolean;
}

function shouldLogDatabaseConditionPerformance() {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return false;
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}

function stringifyConditionSignature(value: unknown) {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

function getConditionSignature(sorts?: YDatabaseSorts, filters?: FilterList, fields?: YDatabaseFields) {
  const effectiveFilters = getEffectiveFiltersSnapshot(filters, fields);
  const hasConditions = (sorts?.length ?? 0) > 0 || effectiveFilters.length > 0;

  if (!hasConditions) return '';

  return stringifyConditionSignature({
    filters: effectiveFilters,
    sorts: sorts?.toJSON?.() ?? [],
  });
}

/** Field ids the view's sorts and effective filters refer to. */
function getConditionFieldIds(sorts?: YDatabaseSorts, filters?: FilterList, fields?: YDatabaseFields) {
  const fieldIds = new Set<string>();

  sorts?.forEach((sort) => {
    const fieldId = sort.get(YjsDatabaseKey.field_id);

    if (fieldId) fieldIds.add(fieldId);
  });

  const visitFilter = (filter: ReturnType<typeof getEffectiveFiltersSnapshot>[number]) => {
    if (filter.fieldId) fieldIds.add(filter.fieldId);
    filter.children?.forEach(visitFilter);
  };

  getEffectiveFiltersSnapshot(filters, fields).forEach(visitFilter);
  return fieldIds;
}

function getComputedConditionFieldIds(sorts?: YDatabaseSorts, filters?: FilterList, fields?: YDatabaseFields) {
  const relationFieldIds = new Set<string>();
  const rollupFieldIds = new Set<string>();

  getConditionFieldIds(sorts, filters, fields).forEach((fieldId) => {
    if (!fields) return;
    const fieldType = Number(fields.get(fieldId)?.get(YjsDatabaseKey.type));

    if (fieldType === FieldType.Relation) {
      relationFieldIds.add(fieldId);
    } else if (fieldType === FieldType.Rollup) {
      rollupFieldIds.add(fieldId);
    } else if (fieldType === FieldType.Formula) {
      const references = collectFormulaExternalReferences(fields.get(fieldId), readFormulaSchema(fields));

      references.relations.forEach((entry) => relationFieldIds.add(entry.id));
      references.rollups.forEach((entry) => rollupFieldIds.add(entry.id));
    }
  });

  return {
    relationFieldIds: [...relationFieldIds],
    rollupFieldIds: [...rollupFieldIds],
  };
}

const CONDITION_ROW_LOAD_BATCH_SIZE = 24;

/** Remote changes (sync, other tabs) arrive in bursts: the conditions recompute once they pause. */
export const CONDITION_REMOTE_CHANGE_DEBOUNCE_MS = 200;
const ROLLUP_CELL_OBSERVER_POOL_SIZE = 4;

/** What ran a scheduled recompute: the next frame after the user's own write, or the trailing debounce. */
type ConditionChangeTrigger = 'frame' | 'debounce';

interface ConditionChangeScheduler {
  /** Schedules a recompute for a change made in `transaction` (none: treated as remote). */
  (transaction?: Pick<Transaction, 'local'>): void;
  /** Whether a recompute is scheduled and has not run. */
  pending: () => boolean;
  cancel: () => void;
}

/** A recompute carried over from an observer that was replaced before it ran: the next frame. */
const CARRIED_OVER_CHANGE = { local: true };
const HOLD_REMOVED_ROWS = { holdRemovedRows: true };

/**
 * Schedules the recompute after something the conditions read changed in
 * place. The user's own write (a local Yjs transaction: a cell edit, a new
 * row) recomputes on the next animation frame, which still folds a paste or a
 * fill into one pass; remote changes wait for the trailing debounce, so a
 * burst recomputes once. Whichever runs first covers the other.
 */
function createConditionChangeScheduler(run: (trigger: ConditionChangeTrigger) => void): ConditionChangeScheduler {
  let frame: number | null = null;
  let remotePending = false;
  const remote = debounce(() => {
    remotePending = false;
    run('debounce');
  }, CONDITION_REMOTE_CHANGE_DEBOUNCE_MS);
  const cancelRemote = () => {
    remotePending = false;
    remote.cancel();
  };

  const flush = () => {
    frame = null;
    cancelRemote();
    run('frame');
  };

  const schedule = ((transaction?: Pick<Transaction, 'local'>) => {
    if (transaction?.local) {
      if (frame === null) frame = requestAnimationFrame(flush);
      return;
    }

    // A frame already scheduled covers the remote change too.
    if (frame !== null) return;
    remotePending = true;
    remote();
  }) as ConditionChangeScheduler;

  schedule.pending = () => frame !== null || remotePending;
  schedule.cancel = () => {
    cancelRemote();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  return schedule;
}

// ---------------------------------------------------------------------------
// Derived results of resident sources (PERFORMANCE-REPORT W6 b, theme 3)
// ---------------------------------------------------------------------------

/**
 * How long a view's derived result is kept after its last use: the residency
 * window of its source (`DASHBOARD_LOADING.sourceIdleReleaseMs`), so a return
 * to the dashboard within it shows the result without computing it again.
 */
export const DERIVED_ROW_ORDERS_TTL_MS = DASHBOARD_LOADING.sourceIdleReleaseMs;
/** The results kept at most per kind; the least recently used goes first. */
const DERIVED_RESULTS_LIMIT = 64;

/** Bumped by every transaction that changes a row doc a derived result read, and when it is destroyed. */
const rowDocVersions = new WeakMap<YDoc, number>();

function watchRowDocVersion(doc: YDoc) {
  if (rowDocVersions.has(doc)) return;
  const bump = () => rowDocVersions.set(doc, (rowDocVersions.get(doc) ?? 0) + 1);

  rowDocVersions.set(doc, 0);
  doc.on('afterTransaction', (transaction: Transaction) => {
    if (transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0) bump();
  });
  doc.on('destroy', bump);
}

/** What a derived result was computed from, besides its key (database, view and conditions). */
interface DerivedInputs {
  /** The row source's id; a published document's guid can be its publish name instead. */
  databaseId: string;
  /** The view's visible row orders it read. */
  rowOrders: Row[];
  /** The fields it read, as JSON (a type or an option change changes it). */
  fieldsKey: string;
  /** The doc each row is read from now. */
  resolveDoc: (rowId: string) => YDoc | null | undefined;
}

interface DerivedEntry<T> {
  databaseId: string;
  value: T;
  orderKey: string;
  fieldsKey: string;
  /** Relative date filters resolve against the day. */
  day: string;
  docs: Map<string, { doc: YDoc; version: number }>;
  expiresAt: number;
}

/** A key of the fields or conditions a result read: their JSON (desktop-authored values can be BigInts). */
function derivedInputKey(value: unknown) {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item}n` : item)) ?? '';
}

function rowOrdersKey(rowOrders: Row[]) {
  return rowOrders.map(({ id, height, is_deleted }) => `${id}|${height}|${is_deleted ? 1 : 0}`).join('\n');
}

function derivedSourceDatabaseId(doc: YDoc) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;

  return database?.get(YjsDatabaseKey.id) || doc.guid;
}

/**
 * Results derived from a resident source's rows, by key. An entry is the
 * result while the row orders and fields it read are the same and every row
 * is read from the same doc, unchanged since (`rowDocVersions`); anything
 * else is a miss, and the caller computes. Entries live for the residency
 * window after their last use.
 */
function createDerivedStore<T>() {
  const entries = new Map<string, DerivedEntry<T>>();

  const touch = (key: string, entry: DerivedEntry<T>) => {
    entry.expiresAt = Date.now() + DERIVED_ROW_ORDERS_TTL_MS;
    // Most recently used last.
    entries.delete(key);
    entries.set(key, entry);
  };

  return {
    read(key: string, inputs: DerivedInputs): T | undefined {
      const entry = entries.get(key);

      if (!entry) return undefined;
      const valid =
        entry.expiresAt > Date.now() &&
        entry.databaseId === inputs.databaseId &&
        entry.fieldsKey === inputs.fieldsKey &&
        entry.day === dayjs().format('YYYY-MM-DD') &&
        entry.orderKey === rowOrdersKey(inputs.rowOrders) &&
        Array.from(entry.docs).every(
          ([rowId, { doc, version }]) => inputs.resolveDoc(rowId) === doc && rowDocVersions.get(doc) === version
        );

      if (!valid) {
        entries.delete(key);
        return undefined;
      }

      touch(key, entry);
      return entry.value;
    },
    store(key: string, inputs: DerivedInputs, value: T) {
      const docs = new Map<string, { doc: YDoc; version: number }>();

      for (const { id } of inputs.rowOrders) {
        const doc = inputs.resolveDoc(id);

        // A row read from nowhere cannot be checked later: nothing is kept.
        if (!doc) return;
        watchRowDocVersion(doc);
        docs.set(id, { doc, version: rowDocVersions.get(doc) ?? 0 });
      }

      const now = Date.now();

      entries.forEach((entry, entryKey) => {
        if (entry.expiresAt <= now) entries.delete(entryKey);
      });
      touch(key, {
        databaseId: inputs.databaseId,
        value,
        orderKey: rowOrdersKey(inputs.rowOrders),
        fieldsKey: inputs.fieldsKey,
        day: dayjs().format('YYYY-MM-DD'),
        docs,
        expiresAt: 0,
      });

      while (entries.size > DERIVED_RESULTS_LIMIT) {
        const oldest = entries.keys().next().value;

        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    /** Keeps the entry for the residency window, from now. */
    retain(key: string) {
      const entry = entries.get(key);

      if (entry) touch(key, entry);
    },
    clear() {
      entries.clear();
    },
    releaseDatabase(databaseId: string) {
      entries.forEach((entry, key) => {
        if (entry.databaseId === databaseId) entries.delete(key);
      });
    },
  };
}

/** The filtered and sorted rows of a view, by database, view and conditions. */
const derivedRowOrders = createDerivedStore<Row[]>();
/** A board's rows by column, by database, view, grouping and the rows it grouped. */
const derivedGroups = createDerivedStore<Map<string, Row[]>>();

// A source's final release also releases the strong row-doc references held
// by its derived results. The residency manager already includes the grace
// period that permits a warm return to reuse them.
subscribeRowDocRelease({
  onDatabaseReleased(databaseId) {
    derivedRowOrders.releaseDatabase(databaseId);
    derivedGroups.releaseDatabase(databaseId);
  },
  onRowUnbound() {
    // A row can unbind while the source stays resident for a warm return.
  },
});

/** Forget every kept result (tests). */
export function clearDerivedResults() {
  derivedRowOrders.clear();
  derivedGroups.clear();
}

const defaultVisible = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty];

type ConditionReference = { id: string; fieldId: string };

/** The filter with this id, whether it is a Y.Map or a plain object synced from desktop. */
function findFilter(filters: YDatabaseFilters, id: string): YDatabaseFilter | undefined {
  for (const entry of filters.toArray() as unknown[]) {
    const filter = normalizeFilterNode(entry);

    if (filter?.get(YjsDatabaseKey.id) === id) return filter;
  }

  return undefined;
}

/** The field and condition of the sort with this id, whether it is a Y.Map or a plain object synced from desktop. */
function findSort(sorts: YDatabaseSorts, id: string): Pick<Sort, 'fieldId' | 'condition'> | undefined {
  for (const entry of sorts.toArray() as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const map = entry as { get?: (key: string) => unknown };
    const read = (key: string) =>
      typeof map.get === 'function' ? map.get(key) : (entry as Record<string, unknown>)[key];

    if (read(YjsDatabaseKey.id) !== id) continue;
    return { fieldId: read(YjsDatabaseKey.field_id) as FieldId, condition: Number(read(YjsDatabaseKey.condition)) };
  }

  return undefined;
}

function areConditionReferencesEqual(left: ConditionReference[], right: ConditionReference[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const rightItem = right[index];

      return item.id === rightItem?.id && item.fieldId === rightItem.fieldId;
    })
  );
}

type DatabaseViewsSnapshot = {
  viewIds: string[];
  childViews: (YDatabaseView | undefined)[];
};

const EMPTY_DATABASE_VIEWS_SNAPSHOT: DatabaseViewsSnapshot = { viewIds: [], childViews: [] };

function haveSameItems<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Hook to get all database views (tabs) for the database.
 * @param databasePageId - The main database page ID in the folder structure
 * @param visibleViewIds - Optional filter for embedded databases to show only specific views
 */
export function useDatabaseViewsSelector(databasePageId: string, visibleViewIds?: string[]) {
  const database = useDatabase();

  const views = database?.get(YjsDatabaseKey.views);
  const [snapshot, setSnapshot] = useState(EMPTY_DATABASE_VIEWS_SNAPSHOT);

  // Stabilize visibleViewIds reference to avoid unnecessary effect re-runs
  const visibleViewIdsKey = visibleViewIds?.join(',') ?? '';

  useEffect(() => {
    if (!views) return;

    // Parse the stabilized key back to array (or undefined)
    const stableVisibleViewIds = visibleViewIdsKey ? visibleViewIdsKey.split(',') : undefined;

    const observerEvent = () => {
      const insertionOrder = new Map<string, number>();

      const getCreatedAtSortValue = (viewId: string): number => {
        const createdAt = views.get(viewId)?.get(YjsDatabaseKey.created_at);

        if (!createdAt) {
          return Number.POSITIVE_INFINITY;
        }

        const numericValue = Number(createdAt);

        if (Number.isFinite(numericValue)) {
          return numericValue;
        }

        const timestampValue = Date.parse(createdAt);

        return Number.isFinite(timestampValue) ? timestampValue : Number.POSITIVE_INFINITY;
      };

      // Step 1: Get all non-inline views from Yjs (don't filter by embedded yet)
      // See: flowy-database2/src/services/database/database_editor.rs:get_database_view_ids()
      // Only the ids are needed, in the map's own order: serializing the views
      // would walk every view's row orders, filters and sorts on every event.
      let allViewIds = Array.from(views.keys()).filter((viewId) => {
        const view = views.get(viewId);

        if (!view) return false;

        const isInline = view.get(YjsDatabaseKey.is_inline);

        return !isInline;
      });

      allViewIds.forEach((viewId, index) => {
        insertionOrder.set(viewId, index);
      });

      // Step 2: Apply context-specific filtering (separate concerns)
      if (stableVisibleViewIds !== undefined && stableVisibleViewIds.length > 0) {
        // For embedded databases: show ONLY views in visibleViewIds
        // This handles views with embedded: true (created via + button)
        // The visibleViewIds list is the source of truth for what to display
        const allViewIdsSet = new Set(allViewIds);

        allViewIds = stableVisibleViewIds.filter((viewId) => allViewIdsSet.has(viewId));
      } else {
        // For standalone databases: exclude embedded views
        // Embedded views belong to their respective embedded database blocks
        allViewIds = allViewIds.filter((viewId) => {
          const view = views.get(viewId);
          const isEmbedded = view?.get(YjsDatabaseKey.embedded) === true;

          return !isEmbedded;
        });

        allViewIds.sort((left, right) => {
          const createdAtDiff = getCreatedAtSortValue(left) - getCreatedAtSortValue(right);

          if (createdAtDiff !== 0) {
            return createdAtDiff;
          }

          return (insertionOrder.get(left) ?? 0) - (insertionOrder.get(right) ?? 0);
        });

        // Dashboard-owned widget views are not tabs either (WP05 §1.2); an
        // opened one is the only tab. An explicit list above is never filtered.
        allViewIds = filterOwnedTabViewIds(allViewIds, databasePageId, (viewId) =>
          Boolean(views.get(viewId)?.get(YjsDatabaseKey.dashboard_owner))
        );
      }

      const nextChildViews = allViewIds.map((viewId) => views.get(viewId));

      // The observer is deep, so it also fires for a row, filter or sort edit
      // inside any view. Those leave the tabs as they are: keep both arrays, so
      // nothing that reads them re-renders.
      setSnapshot((previous) => {
        const viewIds = haveSameItems(previous.viewIds, allViewIds) ? previous.viewIds : allViewIds;
        const childViews = haveSameItems(previous.childViews, nextChildViews) ? previous.childViews : nextChildViews;

        return viewIds === previous.viewIds && childViews === previous.childViews ? previous : { viewIds, childViews };
      });
    };

    observerEvent();
    views.observeDeep(observerEvent);

    return () => {
      views.unobserveDeep(observerEvent);
    };
  }, [databasePageId, views, visibleViewIdsKey]);

  return snapshot;
}

export function useDatabaseViewLayout() {
  const view = useDatabaseView();

  const [layout, setLayout] = useState<DatabaseViewLayout | null>(null);

  useEffect(() => {
    const observerEvent = () => {
      const layoutValue = view?.get(YjsDatabaseKey.layout);

      if (layoutValue !== undefined) {
        setLayout(Number(layoutValue) as DatabaseViewLayout);
      } else {
        setLayout(null);
      }
    };

    observerEvent();

    view?.observe(observerEvent);
    return () => {
      view?.unobserve(observerEvent);
    };
  }, [view]);

  return layout;
}

export function useFieldsSelector(visibilitys: FieldVisibility[] = defaultVisible) {
  const view = useDatabaseView();
  const database = useDatabase();
  const [columns, setColumns] = useState<Column[]>([]);

  useEffect(() => {
    if (!view) return;
    const fields = database?.get(YjsDatabaseKey.fields);
    const fieldsOrder = view?.get(YjsDatabaseKey.field_orders);
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
    const getColumns = () => {
      if (!fields || !fieldsOrder) return [];

      const fieldIds = (fieldsOrder.toJSON() as { id: string }[]).map((item) => item.id);

      return fieldIds
        .map((fieldId) => {
          const setting = fieldSettings?.get(fieldId);
          const field = fields.get(fieldId);

          return {
            fieldId,
            fieldName: field?.get(YjsDatabaseKey.name),
            isPrimary: field?.get(YjsDatabaseKey.is_primary),
            width: parseInt(setting?.get(YjsDatabaseKey.width)) || MIN_COLUMN_WIDTH,
            visibility: Number(
              setting?.get(YjsDatabaseKey.visibility) || FieldVisibility.AlwaysShown
            ) as FieldVisibility,
            wrap: setting?.get(YjsDatabaseKey.wrap) ?? DEFAULT_FIELD_WRAP,
            fieldType: Number(field?.get(YjsDatabaseKey.type)) as FieldType,
          };
        })
        .filter((column) => {
          return visibilitys.includes(column.visibility);
        });
    };

    const observerEvent = () => {
      const next = getColumns();

      setColumns((current) => {
        const unchanged =
          current.length === next.length &&
          current.every(
            (column, index) =>
              column.fieldId === next[index].fieldId &&
              column.fieldName === next[index].fieldName &&
              column.fieldType === next[index].fieldType &&
              column.isPrimary === next[index].isPrimary &&
              column.visibility === next[index].visibility &&
              column.width === next[index].width &&
              column.wrap === next[index].wrap
          );

        return unchanged ? current : next;
      });
    };

    observerEvent();

    fieldsOrder?.observeDeep(observerEvent);
    fieldSettings?.observeDeep(observerEvent);
    fields?.observeDeep(observerEvent);

    return () => {
      fieldsOrder?.unobserveDeep(observerEvent);
      fieldSettings?.unobserveDeep(observerEvent);
      fields?.unobserveDeep(observerEvent);
    };
  }, [database, view, visibilitys]);

  return columns;
}

/**
 * Return the active view's persisted group field without waiting for an
 * effect. Gallery keeps Board grouping configuration when layouts switch, but
 * Desktop never renders that grouping field as a card property.
 */
export function useDatabaseGroupFieldIdSelector(): string | undefined {
  const view = useDatabaseView();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!view) return () => undefined;

      view.observeDeep(onStoreChange);
      return () => view.unobserveDeep(onStoreChange);
    },
    [view]
  );
  const getSnapshot = useCallback(() => {
    const groups = view?.get(YjsDatabaseKey.groups);
    // Yjs 14 throws when reading beyond an array's current length. Gallery
    // views normally have no groups, so guard the first-item lookup.
    const group = groups && groups.length > 0 ? groups.get(0) : undefined;
    const fieldId = group?.get(YjsDatabaseKey.field_id);

    return typeof fieldId === 'string' && fieldId ? fieldId : undefined;
  }, [view]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFieldType(fieldId: string) {
  const database = useDatabase();
  const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);
  const [fieldType, setFieldType] = useState<FieldType>(FieldType.RichText);

  useEffect(() => {
    if (!field) return;

    const observerEvent = () => {
      setFieldType(Number(field.get(YjsDatabaseKey.type)) as FieldType);
    };

    observerEvent();

    field.observe(observerEvent);

    return () => {
      field.unobserve(observerEvent);
    };
  }, [field]);

  return fieldType;
}

export function useFieldVisibility(fieldId: string) {
  const view = useDatabaseView();
  const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
  const fieldSetting = fieldSettings?.get(fieldId);

  const [visibility, setVisibility] = useState<FieldVisibility>(
    Number(fieldSetting?.get(YjsDatabaseKey.visibility)) ?? FieldVisibility.AlwaysShown
  );

  useEffect(() => {
    if (!view) return;

    const observerEvent = () => {
      setVisibility(Number(fieldSetting?.get(YjsDatabaseKey.visibility)) ?? FieldVisibility.AlwaysShown);
    };

    observerEvent();

    fieldSettings?.observeDeep(observerEvent);

    return () => {
      fieldSettings?.unobserveDeep(observerEvent);
    };
  }, [view, fieldId, fieldSettings, fieldSetting]);

  return visibility;
}

export function useFieldWrap(fieldId: string) {
  const view = useDatabaseView();
  const database = useDatabase();
  const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
  const fieldSetting = fieldSettings?.get(fieldId);

  const [wrap, setWrap] = useState(fieldSetting?.get(YjsDatabaseKey.wrap) ?? DEFAULT_FIELD_WRAP);

  useEffect(() => {
    if (!view) return;

    const observerEvent = () => {
      setWrap(fieldSetting?.get(YjsDatabaseKey.wrap) ?? DEFAULT_FIELD_WRAP);
    };

    observerEvent();

    fieldSettings?.observeDeep(observerEvent);

    return () => {
      fieldSettings?.unobserveDeep(observerEvent);
    };
  }, [database, view, fieldId, fieldSettings, fieldSetting]);

  return wrap;
}

export function useFieldSelector(fieldId: string) {
  const database = useDatabase();
  const [clock, setClock] = useState<number>(0);
  const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

  useEffect(() => {
    if (!database) return;
    const observerEvent = () => setClock((prev) => prev + 1);

    field?.observeDeep(observerEvent);

    return () => {
      field?.unobserveDeep(observerEvent);
    };
  }, [database, field, fieldId]);

  return {
    field,
    clock,
  };
}

export function useDatabaseIdFromField(fieldId: string) {
  const database = useDatabase();
  const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!field) return () => undefined;

      field.observe(onStoreChange);
      return () => {
        field.unobserve(onStoreChange);
      };
    },
    [field]
  );
  const getSnapshot = useCallback(() => parseRelationTypeOption(field)?.database_id ?? null, [field]);

  // Relation cells need this value during their first render so an existing
  // relation never paints an empty frame before its loading indicator.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFiltersSelector() {
  const view = useDatabaseView();
  const filterOrders = view?.get(YjsDatabaseKey.filters);
  const [filters, setFilters] = useState<ConditionReference[]>([]);

  useEffect(() => {
    if (!filterOrders) {
      setFilters([]);
      return;
    }

    const getFilters = () => {
      const rawData = filterOrders.toJSON();

      return (rawData as { id: string; field_id: string; filter_type?: number }[])
        .filter((item) => {
          // Filter out AND/OR group filters (used in advanced mode)
          // These have filter_type of And (1) or Or (2) and no field_id
          const filterType = item.filter_type;

          if (filterType === FilterType.And || filterType === FilterType.Or) {
            return false;
          }

          return true;
        })
        .map((item) => {
          return {
            id: item.id,
            fieldId: item.field_id,
          };
        });
    };

    const observerEvent = () => {
      const nextFilters = getFilters();

      setFilters((prevFilters) => (areConditionReferencesEqual(prevFilters, nextFilters) ? prevFilters : nextFilters));
    };

    observerEvent();

    filterOrders.observeDeep(observerEvent);

    return () => {
      filterOrders.unobserveDeep(observerEvent);
    };
  }, [filterOrders]);

  return filters;
}

export function useFilterSelector(filterId: string) {
  const database = useDatabase();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = useDatabaseView();
  const filters = view?.get(YjsDatabaseKey.filters);
  const [filterValue, setFilterValue] = useState<Filter | null>(null);

  useEffect(() => {
    if (!filters || !fields) {
      setFilterValue(null);
      return;
    }

    // Look the filter up on every change: a reset, save or reorder can replace
    // its Y.Map with a copy under the same id.
    const observerEvent = () => {
      const filter = findFilter(filters, filterId);
      const field = filter && fields.get(filter.get(YjsDatabaseKey.field_id));

      if (!filter || !field) {
        setFilterValue(null);
        return;
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      const next = parseFilter(fieldType, filter, fields);

      // Edits to other filters leave this one's value, and its chip, alone.
      setFilterValue((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };

    observerEvent();
    fields.observeDeep(observerEvent);
    filters.observeDeep(observerEvent);
    return () => {
      fields.unobserveDeep(observerEvent);
      filters.unobserveDeep(observerEvent);
    };
  }, [fields, filters, filterId]);
  return filterValue;
}

const DEFAULT_ROOT_INFO = { isHierarchical: false, rootType: null, childCount: 0 } as const;

/**
 * Returns information about the root filter structure for determining if advanced mode should be enabled
 */
export function useRootFilterInfo() {
  const view = useDatabaseView();
  const filters = view?.get(YjsDatabaseKey.filters);
  const [rootInfo, setRootInfo] = useState<{
    isHierarchical: boolean;
    rootType: FilterType | null;
    childCount: number;
  }>(DEFAULT_ROOT_INFO);

  useEffect(() => {
    if (!filters) {
      setRootInfo(DEFAULT_ROOT_INFO);
      return;
    }

    const observerEvent = () => {
      if (filters.length === 0) {
        setRootInfo({ isHierarchical: false, rootType: null, childCount: 0 });
        return;
      }

      const rootFilter = filters.get(0);

      if (!rootFilter) {
        setRootInfo({ isHierarchical: false, rootType: null, childCount: 0 });
        return;
      }

      // Handle both Yjs Map (with .get() method) and plain object (from desktop sync)
      const isYjsMap = typeof (rootFilter as { get?: unknown }).get === 'function';
      const getValue = (key: string): unknown => {
        if (isYjsMap) {
          return (rootFilter as { get: (key: string) => unknown }).get(key);
        }

        return (rootFilter as unknown as Record<string, unknown>)[key];
      };

      const filterType = Number(getValue(YjsDatabaseKey.filter_type));

      if (filterType === FilterType.And || filterType === FilterType.Or) {
        const children = getValue(YjsDatabaseKey.children);
        const childCount =
          children && typeof (children as { length?: number }).length === 'number'
            ? (children as { length: number }).length
            : 0;

        setRootInfo({ isHierarchical: true, rootType: filterType, childCount });
      } else {
        setRootInfo({ isHierarchical: false, rootType: null, childCount: filters.length });
      }
    };

    observerEvent();
    filters.observeDeep(observerEvent);

    return () => {
      filters.unobserveDeep(observerEvent);
    };
  }, [filters]);

  return rootInfo;
}

/**
 * Returns parsed filters from the root filter's children in advanced mode.
 * Recursively flattens nested AND/OR trees, extracting per-row operators.
 * Mirrors the desktop's `collectFilters()` logic.
 */
export function useAdvancedFiltersSelector() {
  const database = useDatabase();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = useDatabaseView();
  const filtersArray = view?.get(YjsDatabaseKey.filters);
  const [filters, setFilters] = useState<Filter[]>([]);

  useEffect(() => {
    if (!fields || !filtersArray) {
      setFilters([]);
      return;
    }

    const observerEvent = () => {
      if (filtersArray.length === 0) {
        setFilters([]);
        return;
      }

      const drafts = flattenFilterTree(filtersArray, fields);

      const parsedFilters: Filter[] = drafts.map((draft) => {
        const ft = draft.fieldType as FieldType;
        const proxy = {
          get: (key: string) => {
            if (key === YjsDatabaseKey.field_id) return draft.fieldId;
            if (key === YjsDatabaseKey.filter_type) return FilterType.Data;
            if (key === YjsDatabaseKey.id) return draft.id;
            if (key === YjsDatabaseKey.content) return draft.content;
            if (key === YjsDatabaseKey.condition) return draft.condition;
            if (key === YjsDatabaseKey.rollup_meta) return draft.rollupMetadata;
            if (key === YjsDatabaseKey.rollup_target_type) return draft.rollupTargetFieldType;

            return undefined;
          },
        };

        const parsed = parseFilter(ft, proxy as Parameters<typeof parseFilter>[1], fields);

        return {
          ...parsed,
          operator: draft.operator,
          fieldType: ft,
          rollupTargetFieldType: draft.rollupTargetFieldType,
          rollupMetadata: draft.rollupMetadata,
        } as Filter;
      });

      setFilters(parsedFilters);
    };

    observerEvent();
    filtersArray.observeDeep(observerEvent);
    fields.observeDeep(observerEvent);

    return () => {
      filtersArray.unobserveDeep(observerEvent);
      fields.unobserveDeep(observerEvent);
    };
  }, [fields, filtersArray]);

  return filters;
}

/**
 * Returns a single filter from the advanced mode children array
 */
export function useAdvancedFilterSelector(filterId: string) {
  const database = useDatabase();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = useDatabaseView();
  const filtersArray = view?.get(YjsDatabaseKey.filters);
  const [filterValue, setFilterValue] = useState<Filter | null>(null);

  useEffect(() => {
    if (!fields || !filtersArray) {
      setFilterValue(null);
      return;
    }

    const observerEvent = () => {
      if (filtersArray.length === 0) {
        setFilterValue(null);
        return;
      }

      const rootFilter = filtersArray.get(0);

      if (!rootFilter) {
        setFilterValue(null);
        return;
      }

      // Handle both Yjs Map and plain object for rootFilter
      const isRootYjsMap = typeof (rootFilter as { get?: unknown }).get === 'function';
      const children = isRootYjsMap
        ? (rootFilter as { get: (key: string) => unknown }).get(YjsDatabaseKey.children)
        : (rootFilter as unknown as Record<string, unknown>)[YjsDatabaseKey.children];

      if (!children) {
        setFilterValue(null);
        return;
      }

      // Handle both Yjs Y.Array (with .get() method) and plain JavaScript array (from desktop sync)
      const isYArray = typeof (children as { get?: unknown }).get === 'function';
      const childrenArray = children as { length: number; get?: (index: number) => unknown } | unknown[];
      const childCount = Array.isArray(childrenArray)
        ? childrenArray.length
        : (childrenArray as { length: number }).length;

      let foundFilter: unknown = null;

      for (let i = 0; i < childCount; i++) {
        const child = isYArray
          ? (childrenArray as { get: (index: number) => unknown }).get(i)
          : (childrenArray as unknown[])[i];

        if (!child) continue;

        // Handle both Yjs Map and plain object
        const isYjsMap = typeof (child as { get?: unknown }).get === 'function';
        const childId = isYjsMap
          ? (child as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
          : (child as Record<string, unknown>)[YjsDatabaseKey.id];

        if (childId === filterId) {
          foundFilter = child;
          break;
        }
      }

      if (!foundFilter) {
        setFilterValue(null);
        return;
      }

      // Handle both Yjs Map and plain object for getting values
      const isYjsMap = typeof (foundFilter as { get?: unknown }).get === 'function';
      const getValue = (key: string): unknown => {
        if (isYjsMap) {
          return (foundFilter as { get: (key: string) => unknown }).get(key);
        }

        return (foundFilter as Record<string, unknown>)[key];
      };

      const fieldId = getValue(YjsDatabaseKey.field_id) as string;
      const field = fields.get(fieldId);

      // Use field type from filter's "ty" key as fallback if field not found
      let fieldType: FieldType;

      if (field) {
        fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      } else {
        // Fallback: use the "ty" field from the filter data (set by desktop)
        const tyValue = getValue('ty');

        fieldType = tyValue !== undefined ? (Number(tyValue) as FieldType) : FieldType.RichText;
      }

      // For plain objects, wrap them to work with parseFilter
      const filterProxy = isYjsMap
        ? (foundFilter as Parameters<typeof parseFilter>[1])
        : {
            get: (key: string) => (foundFilter as Record<string, unknown>)[key],
          };

      setFilterValue(parseFilter(fieldType, filterProxy as Parameters<typeof parseFilter>[1], fields));
    };

    observerEvent();
    filtersArray.observeDeep(observerEvent);
    fields.observeDeep(observerEvent);

    return () => {
      filtersArray.unobserveDeep(observerEvent);
      fields.unobserveDeep(observerEvent);
    };
  }, [fields, filterId, filtersArray]);

  return filterValue;
}

export function useSortsSelector() {
  const view = useDatabaseView();
  const sortOrders = view?.get(YjsDatabaseKey.sorts);
  const [sorts, setSorts] = useState<ConditionReference[]>([]);

  useEffect(() => {
    if (!sortOrders) {
      setSorts([]);
      return;
    }

    const getSorts = () => {
      return (sortOrders.toJSON() as { id: string; field_id: string }[]).map((item) => {
        return {
          id: item.id,
          fieldId: item.field_id,
        };
      });
    };

    const observerEvent = () => {
      const nextSorts = getSorts();

      setSorts((prevSorts) => (areConditionReferencesEqual(prevSorts, nextSorts) ? prevSorts : nextSorts));
    };

    setSorts(getSorts());

    sortOrders.observeDeep(observerEvent);

    return () => {
      sortOrders.unobserveDeep(observerEvent);
    };
  }, [sortOrders]);

  return sorts;
}

export interface Sort {
  fieldId: FieldId;
  condition: SortCondition;
  id: SortId;
}

export function useSortSelector(sortId: SortId) {
  const [sortValue, setSortValue] = useState<Sort | null>(null);
  const view = useDatabaseView();
  const sorts = view?.get(YjsDatabaseKey.sorts);

  useEffect(() => {
    if (!sorts) {
      setSortValue(null);
      return;
    }

    // Look the sort up on every change: a reset, save or reorder can replace
    // its Y.Map with a copy under the same id.
    const observerEvent = () => {
      const sort = findSort(sorts, sortId);

      if (!sort) {
        setSortValue(null);
        return;
      }

      const next: Sort = { ...sort, id: sortId };

      setSortValue((prev) =>
        prev && prev.id === next.id && prev.fieldId === next.fieldId && prev.condition === next.condition ? prev : next
      );
    };

    observerEvent();
    sorts.observeDeep(observerEvent);

    return () => {
      sorts.unobserveDeep(observerEvent);
    };
  }, [sorts, sortId]);

  return sortValue;
}

export function useGroupsSelector() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [groups, setGroups] = useState<string[]>([]);

  useEffect(() => {
    if (!viewId || !database) {
      return;
    }

    let retryIntervalId: ReturnType<typeof setInterval> | null = null;

    const updateGroups = () => {
      const view = database.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view) {
        setGroups([]);
        return false;
      }

      const groupOrders = view.get(YjsDatabaseKey.groups);

      if (!groupOrders) {
        setGroups([]);
        return false;
      }

      const newGroups = groupOrders.toArray().map((item) => item.get(YjsDatabaseKey.id));

      setGroups(newGroups);

      // Clear retry interval once we have groups
      if (retryIntervalId && newGroups.length > 0) {
        clearInterval(retryIntervalId);
        retryIntervalId = null;
      }

      return newGroups.length > 0;
    };

    // Attach observer FIRST to avoid missing updates that arrive during setup
    database.observeDeep(updateGroups);

    // Then check current state
    const hasGroups = updateGroups();

    // If groups not found initially, poll briefly to catch race conditions
    if (!hasGroups) {
      retryIntervalId = setInterval(() => {
        const found = updateGroups();

        if (found && retryIntervalId) {
          clearInterval(retryIntervalId);
          retryIntervalId = null;
        }
      }, 100);

      // Stop polling after 3 seconds max
      setTimeout(() => {
        if (retryIntervalId) {
          clearInterval(retryIntervalId);
          retryIntervalId = null;
        }
      }, 3000);
    }

    return () => {
      if (retryIntervalId) {
        clearInterval(retryIntervalId);
      }

      try {
        database.unobserveDeep(updateGroups);
      } catch {
        // Ignore errors from unobserving destroyed Yjs objects
      }
    };
  }, [database, viewId]);

  return groups;
}

export type GroupColumn = DatabaseGroupColumn;

function getFallbackGroupColumns(field?: YDatabaseField, content?: string): GroupColumn[] {
  if (!field) return [];

  return (getGroupColumns(field, content) ?? []).map((column) => ({
    id: column.id,
    visible: true,
    visibleExplicit: false,
  }));
}

export function useGroup(groupId: string) {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const fields = database?.get(YjsDatabaseKey.fields);
  const group = view
    ?.get(YjsDatabaseKey.groups)
    ?.toArray()
    .find((group) => group.get(YjsDatabaseKey.id) === groupId);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [columns, setColumns] = useState<GroupColumn[]>([]);

  useEffect(() => {
    if (!viewId || !group) {
      setFieldId(null);
      setColumns([]);
      return;
    }

    const observerEvent = () => {
      const groupFieldId = group.get(YjsDatabaseKey.field_id);

      setFieldId(groupFieldId);
      const groupColumnsVisible = group.get(YjsDatabaseKey.groups);
      const persistedColumns = normalizeUniqueDatabaseGroupColumns(groupColumnsVisible?.toArray() ?? []);

      setColumns(persistedColumns.length > 0 ? persistedColumns : getFallbackGroupColumns(fields?.get(groupFieldId)));
    };

    observerEvent();
    group?.observeDeep(observerEvent);
    fields?.observeDeep(observerEvent);

    return () => {
      group?.unobserveDeep(observerEvent);
      fields?.unobserveDeep(observerEvent);
    };
  }, [viewId, groupId, group, fields]);

  return {
    columns,
    fieldId,
  };
}

/** A stored value as plain JSON (a `Y.Map` through `toJSON`), for a stable comparison key. */
function plainLayoutValue(value: unknown): unknown {
  return value instanceof AbstractType ? value.toJSON() : value;
}

function layoutValueKey(value: unknown) {
  try {
    return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? `${inner}n` : inner)) ?? '';
  } catch {
    return String(value);
  }
}

export function useBoardLayoutSettings() {
  const view = useDatabaseView();
  const fields = useDatabaseFields();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hideUnGroup, setHideUnGroup] = useState(false);
  const [hideEmptyGroups, setHideEmptyGroups] = useState(false);
  // "Color columns" (WP09 §1.5): on only when stored as `true`.
  const [showColorColumns, setShowColorColumns] = useState(false);
  // The stored `group_calculation` as plain JSON (WP09 §1.6); read below against the fields.
  const [rawGroupCalculation, setRawGroupCalculation] = useState<{ key: string; value: unknown }>({
    key: '',
    value: undefined,
  });
  const [shownEmptyGroupIds, setShownEmptyGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const groups = view?.get(YjsDatabaseKey.groups);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [ungroupedColumn, setUngroupedColumn] = useState<GroupColumn | null>(null);

  useEffect(() => {
    if (!view) return;

    const observerEvent = () => {
      const layoutSetting = view.get(YjsDatabaseKey.layout_settings)?.get('1');
      const collapseHiddenGroups = layoutSetting?.get(YjsDatabaseKey.collapse_hidden_groups);

      setIsCollapsed(collapseHiddenGroups === undefined ? true : Boolean(collapseHiddenGroups));
      setHideUnGroup(Boolean(layoutSetting?.get(YjsDatabaseKey.hide_ungrouped_column)));
      setHideEmptyGroups(Boolean(layoutSetting?.get(YjsDatabaseKey.hide_empty_groups)));
      setShowColorColumns(layoutSetting?.get(YjsDatabaseKey.show_color_columns) === true);
      const groupCalculationValue = plainLayoutValue(layoutSetting?.get(YjsDatabaseKey.group_calculation));
      const groupCalculationKey = layoutValueKey(groupCalculationValue);

      setRawGroupCalculation((current) =>
        current.key === groupCalculationKey ? current : { key: groupCalculationKey, value: groupCalculationValue }
      );
      const rawShownEmptyGroupIds = layoutSetting?.get(YjsDatabaseKey.shown_empty_group_ids) as unknown;
      const shownIds: unknown[] = Array.isArray(rawShownEmptyGroupIds)
        ? rawShownEmptyGroupIds
        : rawShownEmptyGroupIds &&
          typeof rawShownEmptyGroupIds === 'object' &&
          'toArray' in rawShownEmptyGroupIds &&
          typeof rawShownEmptyGroupIds.toArray === 'function'
        ? (rawShownEmptyGroupIds.toArray() as unknown[])
        : [];
      const nextShownEmptyGroupIds = new Set<string>(shownIds.filter((id): id is string => typeof id === 'string'));

      setShownEmptyGroupIds((currentIds) =>
        currentIds.size === nextShownEmptyGroupIds.size && [...currentIds].every((id) => nextShownEmptyGroupIds.has(id))
          ? currentIds
          : nextShownEmptyGroupIds
      );
    };

    observerEvent();
    view.observeDeep(observerEvent);

    return () => {
      view.unobserveDeep(observerEvent);
    };
  }, [view]);

  useEffect(() => {
    const observerEvent = () => {
      const group = groups?.toArray()?.[0];

      if (!group) {
        setFieldId(null);
        setUngroupedColumn(null);
        return;
      }

      const groupFieldId = group.get(YjsDatabaseKey.field_id);

      setFieldId(groupFieldId);

      const rawColumns = group.get(YjsDatabaseKey.groups)?.toArray() ?? [];
      let next: GroupColumn | null = null;

      for (const rawColumn of rawColumns) {
        const column = normalizeDatabaseGroupColumn(rawColumn);

        if (column?.id === groupFieldId) {
          next = column;
          break;
        }
      }

      setUngroupedColumn((current) =>
        current?.id === next?.id &&
        current?.visible === next?.visible &&
        current?.visibleExplicit === next?.visibleExplicit
          ? current
          : next
      );
    };

    observerEvent();
    groups?.observeDeep(observerEvent);

    return () => {
      groups?.unobserveDeep(observerEvent);
    };
  }, [groups]);

  const ungroupedColumnHidden = isUngroupedColumnHidden({
    column: ungroupedColumn,
    hideUngroupedColumn: hideUnGroup,
  });
  // A field that is deleted or changes type turns the calculation back into the card count.
  const fieldsVersion = useDatabaseFieldsVersion(rawGroupCalculation.value !== undefined);
  const groupCalculation = useMemo(() => {
    void fieldsVersion;
    if (rawGroupCalculation.value === undefined) return undefined;
    return readBoardGroupCalculation(rawGroupCalculation.value, (id) => {
      const field = fields?.get(id);

      return field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : undefined;
    });
  }, [fields, fieldsVersion, rawGroupCalculation]);

  return {
    isCollapsed,
    hideUnGroup,
    hideEmptyGroups,
    shownEmptyGroupIds,
    fieldId,
    ungroupedColumnHidden,
    showColorColumns,
    groupCalculation,
  };
}

export function useGetBoardHiddenGroup(
  groupId: string,
  getRowCount: (columnId: string) => number,
  groupRowsReady: boolean
) {
  const { columns, fieldId } = useGroup(groupId);
  const { hideEmptyGroups, hideUnGroup } = useBoardLayoutSettings();
  const hiddenColumns = useMemo(
    () =>
      resolveBoardColumnVisibility({
        columns,
        fieldId,
        getRowCount,
        groupRowsReady,
        hideEmptyGroups,
        hideUngroupedColumn: hideUnGroup,
      }).hiddenColumns,
    [columns, fieldId, getRowCount, groupRowsReady, hideEmptyGroups, hideUnGroup]
  );

  return {
    hiddenColumns,
  };
}

/**
 * Whether two group results list the same columns, in the same order, with the
 * same rows in each. Rows compare by what a card shows of them, not by object:
 * a new copy of the row orders produces equal rows.
 */
export function haveSameGroupRows(previous: Map<string, Row[]>, next: Map<string, Row[]>) {
  if (previous === next) return true;
  if (previous.size !== next.size) return false;
  const previousEntries = previous.entries();

  for (const [columnId, rows] of next) {
    const [previousColumnId, previousRows] = previousEntries.next().value as [string, Row[]];

    if (previousColumnId !== columnId || previousRows.length !== rows.length) return false;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const previousRow = previousRows[index];

      if (
        row !== previousRow &&
        (row.id !== previousRow.id ||
          row.height !== previousRow.height ||
          Boolean(row.is_deleted) !== Boolean(previousRow.is_deleted))
      ) {
        return false;
      }
    }
  }

  return true;
}

export function useRowsByGroup(groupId: string) {
  const { columns, fieldId } = useGroup(groupId);
  const rows = useRowMap();
  const rowOrders = useRowOrdersSelector();
  const viewId = useDatabaseViewId();
  const { databaseDoc, dataSource, peekRowDocFromSeed } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const { cachedRowDocs } = useBackgroundRowDocLoader(Boolean(fieldId), 'board-grouping');
  const groupingRows = useMemo(() => {
    if (isHistory) return rows ?? {};
    const next = { ...cachedRowDocs };

    Object.entries(rows ?? {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows, isHistory]);

  const fields = useDatabaseFields();
  const [notFound, setNotFound] = useState(false);
  const [groupResult, setGroupResult] = useState<Map<string, Row[]>>(new Map());
  const [hydratedGroupingIdentity, setHydratedGroupingIdentity] = useState<{
    databaseDoc: YDoc;
    groupingKey: string;
  } | null>(null);
  const view = useDatabaseView();
  const filters = view?.get(YjsDatabaseKey.filters);
  const { hideEmptyGroups, hideUnGroup, shownEmptyGroupIds } = useBoardLayoutSettings();
  const groupingKey = fieldId ? `${viewId ?? ''}:${groupId}:${fieldId}` : null;
  // The grouping the board shows: the result below is for this key.
  const shownGroupingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fieldId || !rowOrders) {
      // While the rows are filtered again (a dashboard's global filter, the
      // viewer's private conditions) the board keeps the grouping it shows,
      // so its columns change once, to the new result, instead of emptying
      // first. Another grouping, or none, starts empty.
      if (!fieldId || shownGroupingKeyRef.current !== groupingKey) {
        shownGroupingKeyRef.current = null;
        setGroupResult(new Map());
      }

      return;
    }

    // The rows of a grouping the board already shows changed (a dashboard's
    // global filter, the view's conditions): the new columns render as a
    // transition, in slices, instead of every card in one task.
    const regroupsShownGrouping = shownGroupingKeyRef.current === groupingKey;

    shownGroupingKeyRef.current = groupingKey;

    const onConditionsChange = (renderInTransition = false) => {
      const newResult = new Map<string, Row[]>();

      const field = fields.get(fieldId);

      if (!field) {
        setNotFound(true);
        setGroupResult(newResult);
        return;
      }

      setNotFound(false);

      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (![FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(fieldType)) {
        setNotFound(true);
        setGroupResult(newResult);
        return;
      }

      const filter = filters?.toArray().find((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);
      const rowsHydrated = areGroupRowsHydrated(rowOrders, groupingRows);
      // The grouping of every row is kept for the source's residency window
      // (`derivedGroups`), so the board of a return shows its columns without
      // grouping the rows again.
      const derived =
        !isHistory && peekRowDocFromSeed && groupingKey
          ? {
              key: `${databaseDoc.guid}\n${groupingKey}\n${derivedInputKey(filter?.toJSON() ?? null)}`,
              inputs: {
                databaseId: derivedSourceDatabaseId(databaseDoc),
                rowOrders,
                fieldsKey: derivedInputKey(field.toJSON()),
                resolveDoc: (rowId: string) => {
                  const doc = groupingRows[rowId];

                  return hasRowConditionData(doc) ? doc : peekRowDocFromSeed(rowId);
                },
              },
            }
          : null;
      const kept = derived ? derivedGroups.read(derived.key, derived.inputs) : undefined;
      const groupResult = kept ?? groupByField(rowOrders, groupingRows, field, filter);

      if (!groupResult) {
        setGroupResult(newResult);
        return;
      }

      if (derived && !kept && rowsHydrated) derivedGroups.store(derived.key, derived.inputs, groupResult);

      // A regroup that changes no column keeps the previous result, so the
      // columns and every card under them do not re-render for nothing.
      const showResult = () =>
        setGroupResult((previous) => (haveSameGroupRows(previous, groupResult) ? previous : groupResult));

      if (renderInTransition) startTransition(showResult);
      else showResult();

      if ((rowsHydrated || kept) && groupingKey) {
        setHydratedGroupingIdentity((current) =>
          current?.databaseDoc === databaseDoc && current.groupingKey === groupingKey
            ? current
            : { databaseDoc, groupingKey }
        );
      }
    };

    onConditionsChange(regroupsShownGrouping);
    if (isHistory) return;

    const regroup = () => onConditionsChange();

    fields.observeDeep(regroup);
    filters?.observeDeep(regroup);

    const debouncedConditionsChange = debounce(regroup, 150);

    const observerRowsEvent = () => {
      debouncedConditionsChange();
    };

    Object.values(groupingRows).forEach((row) => {
      row.getMap(YjsEditorKey.data_section).observeDeep(observerRowsEvent);
    });
    return () => {
      debouncedConditionsChange.cancel();

      fields.unobserveDeep(regroup);
      filters?.unobserveDeep(regroup);
      Object.values(groupingRows).forEach((row) => {
        row.getMap(YjsEditorKey.data_section).unobserveDeep(observerRowsEvent);
      });
    };
  }, [databaseDoc, fieldId, fields, rowOrders, groupingRows, filters, groupingKey, isHistory, peekRowDocFromSeed]);

  // Cold Boards must wait for their first complete grouping before empty
  // columns can be classified safely. Once that baseline exists, a later
  // row_order arriving before its separate DatabaseRow collab must not
  // temporarily disable Hide empty groups for every column.
  const groupVisibilityReady =
    groupingKey !== null &&
    hydratedGroupingIdentity?.databaseDoc === databaseDoc &&
    hydratedGroupingIdentity.groupingKey === groupingKey;

  const visibleColumns = useMemo(
    () =>
      resolveBoardColumnVisibility({
        columns,
        fieldId,
        getRowCount: (columnId) => groupResult.get(columnId)?.length ?? 0,
        groupRowsReady: groupVisibilityReady,
        hideEmptyGroups,
        hideUngroupedColumn: hideUnGroup,
        shownEmptyGroupIds,
      }).visibleColumns,
    [columns, fieldId, groupResult, groupVisibilityReady, hideEmptyGroups, hideUnGroup, shownEmptyGroupIds]
  );

  return {
    fieldId,
    groupResult,
    columns: visibleColumns,
    groupRowsReady: groupVisibilityReady,
    hideEmptyGroups,
    notFound,
    /** The row docs the grouping read (the row map plus background-loaded docs), by row id. */
    groupingRows,
  };
}

export interface GridGroup {
  id: string;
  label: string;
  rows: Row[];
  isDefault: boolean;
  visible: boolean;
  hidden: boolean;
  automaticallyHidden: boolean;
  collapsed: boolean;
  option?: SelectOption;
}

export interface GridGrouping {
  isGrouped: boolean;
  /**
   * The filtered and sorted rows used to build group membership. For an
   * ungrouped grid still reading its rows (`hydrating`), the first rows of
   * the result found so far.
   */
  rowOrders?: Row[];
  /** Set while an ungrouped grid's rows are still being read. */
  hydrating?: RowOrdersHydration;
  groupId?: string;
  fieldId?: string;
  fieldType?: FieldType;
  fieldName?: string;
  field?: YDatabaseField;
  content?: string;
  /** Canonical group IDs backed by all view rows, in persisted metadata order. */
  activeGroupIds: string[];
  groups: GridGroup[];
  visibleGroups: GridGroup[];
  hideEmptyGroups: boolean;
  ready: boolean;
  /**
   * Group IDs that are safe to reconcile into shared metadata. While some
   * rows are seed-only this preserves every persisted ID and appends IDs
   * derived only from locally mutated rows. It intentionally differs from
   * activeGroupIds, whose conservative UI union may include seed-only values.
   */
  metadataGroupIds?: string[];
  /** Local group config whose one-time hydrated metadata initialization is pending. */
  metadataInitializationGroup?: YDatabaseGroup;
  /** Changes only when row membership inputs change, not when group metadata changes. */
  metadataSyncKey?: string;
}

export type DatabaseGroupingGroup = GridGroup;
export type DatabaseGrouping = GridGrouping;

const EMPTY_DATABASE_GROUPING: DatabaseGrouping = {
  isGrouped: false,
  activeGroupIds: [],
  groups: [],
  visibleGroups: [],
  hideEmptyGroups: true,
  ready: true,
  metadataGroupIds: [],
  metadataSyncKey: '',
};

function orderNumberGroupIds(groupIds: string[], defaultGroupId: string, policy: NumberGroupingPolicy) {
  return [...groupIds].sort((left, right) => {
    if (left === defaultGroupId) return -1;
    if (right === defaultGroupId) return 1;

    return policy.compareGroupIds(left, right);
  });
}

function yjsEventChangesKey(event: unknown, key: string) {
  const keysChanged = (event as { keysChanged?: Set<unknown> }).keysChanged;

  return keysChanged?.has(key) ?? false;
}

function yjsEventTouchesGroupingCell(event: { path: Array<string | number> }, fieldId: string) {
  const { path } = event;

  if (path.length === 0) return yjsEventChangesKey(event, YjsEditorKey.database_row);
  if (path[0] !== YjsEditorKey.database_row) return false;
  if (path.length === 1) return yjsEventChangesKey(event, YjsDatabaseKey.cells);
  if (path[1] !== YjsDatabaseKey.cells) return false;
  if (path.length === 2) return yjsEventChangesKey(event, fieldId);

  return path[2] === fieldId;
}

const DATABASE_GROUPING_VIEW_KEYS = new Set<string>([
  YjsDatabaseKey.groups,
  YjsDatabaseKey.layout_settings,
  YjsDatabaseKey.row_orders,
  YjsDatabaseKey.sorts,
]);

function yjsEventTouchesDatabaseGroupingView(event: YEvent) {
  if (event.path.length > 0) return DATABASE_GROUPING_VIEW_KEYS.has(String(event.path[0]));

  return [...DATABASE_GROUPING_VIEW_KEYS].some((key) => yjsEventChangesKey(event, key));
}

function yjsEventTouchesField(event: YEvent, fieldId?: string) {
  if (!fieldId) return false;
  if (event.path.length > 0) return event.path[0] === fieldId;

  return yjsEventChangesKey(event, fieldId);
}

type DatabaseGroupingRowObserver = {
  dataSection: ReturnType<YDoc['getMap']>;
  doc: YDoc;
  observer: Parameters<ReturnType<YDoc['getMap']>['observeDeep']>[0];
};

type DatabaseGroupingRowsStore = {
  applyCachedRowsChange: (change: BackgroundRowDocChange) => void;
  detachRows: () => void;
  getSnapshot: () => number;
  replaceCachedRows: (rows: Record<RowId, YDoc>) => void;
  replaceLiveRows: (rows: Record<RowId, YDoc>) => void;
  subscribe: (onStoreChange: () => void) => () => void;
};

function createDatabaseGroupingRowsStore(fieldId?: string): DatabaseGroupingRowsStore {
  const subscribers = new Set<() => void>();
  const observers = new Map<RowId, DatabaseGroupingRowObserver>();
  const cachedRows = new Map<RowId, YDoc>();
  const liveRows = new Map<RowId, YDoc>();
  let revision = 0;

  const publish = () => {
    revision += 1;
    subscribers.forEach((subscriber) => subscriber());
  };

  const detach = ({ dataSection, observer }: DatabaseGroupingRowObserver) => {
    try {
      dataSection.unobserveDeep(observer);
    } catch {
      // The row document may already have been destroyed during a lifecycle reset.
    }
  };

  const attach = (rowId: RowId, doc: YDoc) => {
    const dataSection = doc.getMap(YjsEditorKey.data_section);
    const observer: Parameters<typeof dataSection.observeDeep>[0] = (events: YEvent[]) => {
      if (fieldId && events.some((event) => yjsEventTouchesGroupingCell(event, fieldId))) publish();
    };

    dataSection.observeDeep(observer);
    observers.set(rowId, { dataSection, doc, observer });
  };

  const getEffectiveRow = (rowId: RowId) => {
    const cachedRow = cachedRows.get(rowId);
    const liveRow = liveRows.get(rowId);

    if (liveRow && (hasRowConditionData(liveRow) || !cachedRow)) return liveRow;
    return cachedRow;
  };

  const reconcileRow = (rowId: RowId) => {
    const current = observers.get(rowId);
    const next = getEffectiveRow(rowId);

    if (current?.doc === next) return;
    if (current) {
      detach(current);
      observers.delete(rowId);
    }

    if (fieldId && next) attach(rowId, next);
  };

  const replaceRows = (currentRows: Map<RowId, YDoc>, nextRows: Record<RowId, YDoc>) => {
    const changedRowIds = new Set<RowId>();

    currentRows.forEach((doc, rowId) => {
      if (nextRows[rowId] === doc) return;
      currentRows.delete(rowId);
      changedRowIds.add(rowId);
    });
    Object.entries(nextRows).forEach(([rowId, doc]) => {
      if (currentRows.get(rowId) === doc) return;
      currentRows.set(rowId, doc);
      changedRowIds.add(rowId);
    });
    changedRowIds.forEach(reconcileRow);
  };

  return {
    applyCachedRowsChange: ({ added, removed }) => {
      const changedRowIds = new Set<RowId>();

      Object.entries(removed).forEach(([rowId, doc]) => {
        if (cachedRows.get(rowId) !== doc) return;
        cachedRows.delete(rowId);
        changedRowIds.add(rowId);
      });
      Object.entries(added).forEach(([rowId, doc]) => {
        if (cachedRows.get(rowId) === doc) return;
        cachedRows.set(rowId, doc);
        changedRowIds.add(rowId);
      });
      changedRowIds.forEach(reconcileRow);
    },
    detachRows: () => {
      observers.forEach(detach);
      observers.clear();
      cachedRows.clear();
      liveRows.clear();
    },
    getSnapshot: () => revision,
    replaceCachedRows: (rows) => replaceRows(cachedRows, rows),
    replaceLiveRows: (rows) => replaceRows(liveRows, rows),
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      return () => {
        subscribers.delete(onStoreChange);
      };
    },
  };
}

/** Same rows, in the same order, with the same heights. */
function haveSameRows(left: Row[], right: Row[]) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index].id &&
        row.height === right[index].height &&
        Boolean(row.is_deleted) === Boolean(right[index].is_deleted)
    )
  );
}

function haveSameRowOrder(left?: Row[], right?: Row[]) {
  return Boolean(
    left &&
      right &&
      left.length === right.length &&
      left.every(
        (row, index) => row.id === right[index]?.id && Boolean(row.is_deleted) === Boolean(right[index]?.is_deleted)
      )
  );
}

function orderDatabaseGroupsForPrimarySort(
  groupIds: string[],
  groupResult: Map<string, Row[]> | undefined,
  sortedRows: Row[] | undefined,
  sortCondition: SortCondition
) {
  if (!groupResult || !sortedRows || groupIds.length <= 1) return groupIds;

  const originalIndexById = new Map(groupIds.map((id, index) => [id, index] as const));
  const sortedRowIndexById = new Map(sortedRows.map((row, index) => [row.id, index] as const));
  const representativeOrderById = new Map<string, number>();

  groupIds.forEach((id) => {
    const representative = groupResult.get(id)?.[0];
    const order = representative ? sortedRowIndexById.get(representative.id) : undefined;

    if (order !== undefined) representativeOrderById.set(id, order);
  });

  if (representativeOrderById.size === 0) return groupIds;

  const isPopulated = (id: string) => (groupResult.get(id)?.length ?? 0) > 0;
  const emptyGroupOrder = (index: number) => {
    let runStart = 0;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (isPopulated(groupIds[cursor])) {
        runStart = cursor + 1;
        break;
      }
    }

    let runEnd = groupIds.length;

    for (let cursor = index + 1; cursor < groupIds.length; cursor += 1) {
      if (isPopulated(groupIds[cursor])) {
        runEnd = cursor;
        break;
      }
    }

    const runLength = Math.max(runEnd - runStart, 0);
    const offset = Math.max(index - runStart, 0) + 1;
    let previousOrder: number | undefined;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      previousOrder = representativeOrderById.get(groupIds[cursor]);
      if (previousOrder !== undefined) break;
    }

    let nextOrder: number | undefined;

    for (let cursor = index + 1; cursor < groupIds.length; cursor += 1) {
      nextOrder = representativeOrderById.get(groupIds[cursor]);
      if (nextOrder !== undefined) break;
    }

    if (previousOrder !== undefined && nextOrder !== undefined) {
      return previousOrder + ((nextOrder - previousOrder) * offset) / (runLength + 1);
    }

    if (nextOrder !== undefined) {
      return sortCondition === SortCondition.Ascending
        ? nextOrder - (runLength - offset + 1)
        : nextOrder + (runLength - offset + 1);
    }

    if (previousOrder !== undefined) {
      return sortCondition === SortCondition.Ascending ? previousOrder + offset : previousOrder - offset;
    }

    return index;
  };

  const orderById = new Map(
    groupIds.map((id, index) => [id, representativeOrderById.get(id) ?? emptyGroupOrder(index)] as const)
  );

  return [...groupIds].sort((left, right) => {
    const order = (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0);

    return order || (originalIndexById.get(left) ?? 0) - (originalIndexById.get(right) ?? 0);
  });
}

/**
 * Resolves optional grouping for the current Grid or List view and observes every source that
 * can change group membership. Row documents are separate Yjs documents, so
 * observing only the database view is not sufficient when a cell is edited.
 */
export function useDatabaseGroupingSelector(layout: DatabaseViewLayout): DatabaseGrouping {
  const {
    dataSource,
    createRow,
    getCellLocalMutationRevision,
    getViewIdFromDatabaseId,
    hasCellLocalMutation,
    loadView,
    subscribeToCellLocalMutations,
  } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const database = useDatabase();
  const fields = useDatabaseFields();
  const persistedGroups = view?.get(YjsDatabaseKey.groups);
  const persistedGroup = persistedGroups?.toArray()?.[0];
  const fieldId = persistedGroup?.get(YjsDatabaseKey.field_id);
  const persistedGroupingField = fieldId ? fields?.get(fieldId) : undefined;
  const persistedGroupingFieldType = Number(persistedGroupingField?.get(YjsDatabaseKey.type)) as FieldType;
  // Only an ungrouped grid lists the rows read so far (see the result below);
  // a list, a timeline and a grouped grid wait for the complete result.
  const showsPartialRows =
    layout === DatabaseViewLayout.Grid &&
    !(persistedGroup && persistedGroupingField && isDatabaseGroupableFieldType(persistedGroupingFieldType));
  const { rows: progressiveRowOrders, hydrating } = useProgressiveRowOrdersSelector(
    showsPartialRows ? PARTIAL_ROW_ORDERS : WHOLE_VIEW_ROW_ORDERS
  );
  // Groups, their counts and their metadata need every row.
  const rowOrders = hydrating ? undefined : progressiveRowOrders;
  const rows = useRowMap();
  const isPersonGroupingField = [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(
    persistedGroupingFieldType
  );
  const { users: mentionableUsers } = useMentionableUsersWithAutoFetch(isPersonGroupingField);
  const rawRowOrders = view?.get(YjsDatabaseKey.row_orders);
  const inlineRowOrders = getInlineViewRowOrders(database);
  const { cachedRowDocs, getCachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(
    Boolean(fieldId),
    `${
      layout === DatabaseViewLayout.List ? 'list' : layout === DatabaseViewLayout.Timeline ? 'timeline' : 'grid'
    }-grouping`
  );
  const groupingRows = useMemo(() => {
    if (isHistory) return rows ?? {};
    const next = { ...cachedRowDocs };

    Object.entries(rows ?? {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows, isHistory]);
  const groupingRowsStore = useMemo(() => {
    // The same database field can group multiple views; each view owns its
    // observer lifecycle even when the field ID is identical.
    void viewId;
    return createDatabaseGroupingRowsStore(fieldId);
  }, [fieldId, viewId]);

  useLayoutEffect(() => {
    // Live row-map changes are small and may be followed by another layout
    // effect that edits a cell, so close that commit-phase observation gap.
    if (!isHistory) groupingRowsStore.replaceLiveRows(rows ?? {});
  }, [groupingRowsStore, rows, isHistory]);
  useEffect(() => {
    // Seed hydration publishes bounded add/remove deltas before its React
    // snapshot. Subscribe once instead of rescanning every accumulated seed doc
    // in a layout effect for each 128-row batch.
    if (isHistory) return;
    const unsubscribe = subscribeToCachedRowDocChanges(groupingRowsStore.applyCachedRowsChange);

    groupingRowsStore.replaceCachedRows(getCachedRowDocs());
    return unsubscribe;
  }, [getCachedRowDocs, groupingRowsStore, subscribeToCachedRowDocChanges, isHistory]);
  useLayoutEffect(
    () => () => {
      // React StrictMode and reusable effects replay cleanup followed by setup
      // while preserving memoized values. Detach external resources here, but
      // keep the store reusable so the next setup can attach them again.
      groupingRowsStore.detachRows();
    },
    [groupingRowsStore]
  );

  const groupingViewRevisionRef = useRef(0);
  const subscribeToGroupingView = useCallback(
    (onStoreChange: () => void) => {
      const publish = () => {
        groupingViewRevisionRef.current += 1;
        onStoreChange();
      };

      const handleViewChange = (events: YEvent[]) => {
        if (events.some(yjsEventTouchesDatabaseGroupingView)) publish();
      };

      const handleFieldsChange = (events: YEvent[]) => {
        if (events.some((event) => yjsEventTouchesField(event, fieldId))) publish();
      };

      view?.observeDeep(handleViewChange);
      fields?.observeDeep(handleFieldsChange);
      if (inlineRowOrders !== rawRowOrders) inlineRowOrders?.observeDeep(publish);

      // Close the render-to-subscribe gap with a cached primitive snapshot.
      // useSyncExternalStore rechecks it immediately after subscribing.
      groupingViewRevisionRef.current += 1;

      return () => {
        view?.unobserveDeep(handleViewChange);
        fields?.unobserveDeep(handleFieldsChange);
        if (inlineRowOrders !== rawRowOrders) inlineRowOrders?.unobserveDeep(publish);
      };
    },
    [fieldId, fields, inlineRowOrders, rawRowOrders, view]
  );
  const getGroupingViewRevision = useCallback(() => groupingViewRevisionRef.current, []);
  const groupingViewRevision = useSyncExternalStore(
    subscribeToGroupingView,
    getGroupingViewRevision,
    getGroupingViewRevision
  );
  const allRowOrders = useMemo(() => {
    void groupingViewRevision;

    const sourceRowOrders = (rawRowOrders?.toJSON() as Row[] | undefined) ?? rowOrders;

    return materializeVisibleRowOrders(sourceRowOrders, inlineRowOrders?.toJSON() as Row[] | undefined);
  }, [groupingViewRevision, inlineRowOrders, rawRowOrders, rowOrders]);
  const groupingRowsSnapshot = useSyncExternalStore(
    groupingRowsStore.subscribe,
    groupingRowsStore.getSnapshot,
    groupingRowsStore.getSnapshot
  );
  const cellLocalMutationSubscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!fieldId || !subscribeToCellLocalMutations) return () => undefined;

      return subscribeToCellLocalMutations(fieldId, onStoreChange);
    },
    [fieldId, subscribeToCellLocalMutations]
  );
  const getCellLocalMutationSnapshot = useCallback(
    () => (fieldId && getCellLocalMutationRevision ? getCellLocalMutationRevision(fieldId) : ''),
    [fieldId, getCellLocalMutationRevision]
  );
  const cellLocalMutationRevision = useSyncExternalStore(
    cellLocalMutationSubscribe,
    getCellLocalMutationSnapshot,
    getCellLocalMutationSnapshot
  );
  // Only relation grouping renders resolved titles, so every other grouping
  // field type holds a constant snapshot and never recomputes for them.
  const groupsByRelation = !isHistory && persistedGroupingFieldType === FieldType.Relation;
  const subscribeToRelationGroupLabels = useCallback(
    (onStoreChange: () => void) => (groupsByRelation ? subscribeRelationGroupLabels(onStoreChange) : () => undefined),
    [groupsByRelation]
  );
  const getRelationGroupLabelSnapshot = useCallback(
    () => (groupsByRelation ? getRelationGroupLabelRevision() : 0),
    [groupsByRelation]
  );
  const relationGroupLabelRevision = useSyncExternalStore(
    subscribeToRelationGroupLabels,
    getRelationGroupLabelSnapshot,
    getRelationGroupLabelSnapshot
  );

  const rowsHydrated = Boolean(allRowOrders && areGroupRowsHydrated(allRowOrders, groupingRows));
  const metadataSyncKey = useMemo(() => {
    void groupingViewRevision;
    const groupingField = fieldId ? fields?.get(fieldId) : undefined;

    return stringifyConditionSignature([
      persistedGroup?.get(YjsDatabaseKey.id) ?? null,
      fieldId ?? null,
      persistedGroup?.get(YjsDatabaseKey.content) ?? null,
      groupingField?.toJSON() ?? null,
      groupingRowsSnapshot,
      cellLocalMutationRevision,
      allRowOrders?.map((row) => [row.id, Boolean(row.is_deleted)]) ?? null,
    ]);
  }, [
    allRowOrders,
    fieldId,
    fields,
    groupingRowsSnapshot,
    groupingViewRevision,
    persistedGroup,
    cellLocalMutationRevision,
  ]);

  // The ungrouped result changes only with the rows. The memo below re-runs
  // whenever a row loads; returning this one keeps the grid, which re-renders
  // on every new grouping object, from re-rendering for each of those rows.
  const ungroupedGrouping = useMemo(() => ({ ...EMPTY_DATABASE_GROUPING, rowOrders }), [rowOrders]);
  const grouping = useMemo(() => {
    void groupingViewRevision;
    void cellLocalMutationRevision;
    void relationGroupLabelRevision;

    const group = view?.get(YjsDatabaseKey.groups)?.toArray()?.[0];
    const currentFieldId = group?.get(YjsDatabaseKey.field_id);
    const field = currentFieldId ? fields?.get(currentFieldId) : undefined;
    const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

    if (!group || !field || !isDatabaseGroupableFieldType(fieldType)) {
      return ungroupedGrouping;
    }

    const groupingFieldId = field.get(YjsDatabaseKey.id);
    const content = group.get(YjsDatabaseKey.content);
    const numberPolicy = fieldType === FieldType.Number ? createNumberGroupingPolicy(content) : undefined;
    const result = rowOrders ? groupByField(rowOrders, groupingRows, field, undefined, content) : undefined;
    const metadataResult = haveSameRowOrder(rowOrders, allRowOrders)
      ? result
      : allRowOrders
      ? groupByField(allRowOrders, groupingRows, field, undefined, content)
      : undefined;
    const locallyMutatedRowOrders = allRowOrders?.filter(
      (row) => hasCellLocalMutation?.(row.id, groupingFieldId) ?? true
    );
    const locallyDerivedMetadataResult = locallyMutatedRowOrders
      ? groupByField(locallyMutatedRowOrders, groupingRows, field, undefined, content)
      : undefined;
    const ready = rowsHydrated;
    const initializesLocalGroup = ready && hasPendingLocalDatabaseGroupInitialization(group);
    const rawColumns = group.get(YjsDatabaseKey.groups)?.toArray() ?? [];
    // Configuration changes can invalidate old numeric IDs without proving
    // anything about unloaded rows. Keep every still-valid persisted ID.
    const persistedColumns = normalizeUniqueDatabaseGroupColumns(rawColumns).filter(
      (column) => !numberPolicy || column.id === groupingFieldId || numberPolicy.isValidGroupId(column.id)
    );
    const fallbackColumns = getFallbackGroupColumns(field, content);
    const derivedMetadataGroupIds = metadataResult
      ? [...metadataResult.keys()]
      : fallbackColumns.map((column) => column.id);
    const persistedAndDerivedIds = persistedColumns.map((column) => column.id);
    const orderedIdSet = new Set(persistedAndDerivedIds);

    derivedMetadataGroupIds.forEach((id) => {
      if (!orderedIdSet.has(id)) {
        persistedAndDerivedIds.push(id);
        orderedIdSet.add(id);
      }
    });
    fallbackColumns.forEach((column) => {
      if (!orderedIdSet.has(column.id)) {
        persistedAndDerivedIds.push(column.id);
        orderedIdSet.add(column.id);
      }
    });
    const orderedIds = numberPolicy
      ? orderNumberGroupIds(persistedAndDerivedIds, groupingFieldId, numberPolicy)
      : persistedAndDerivedIds;

    // Seed-only docs may lag a Desktop edit indefinitely because background
    // grouping hydration deliberately does not bind realtime for offscreen
    // rows. Preserve all persisted IDs and append only IDs proven by a local
    // mutation. Sync registration alone never makes a derived value writable.
    const metadataGroupIds = persistedColumns.map((column) => column.id);
    const metadataGroupIdSet = new Set(metadataGroupIds);
    const safeDerivedGroupIds = initializesLocalGroup
      ? derivedMetadataGroupIds
      : locallyDerivedMetadataResult
      ? [...locallyDerivedMetadataResult.keys()]
      : fallbackColumns.map((column) => column.id);

    safeDerivedGroupIds.forEach((id) => {
      if (!metadataGroupIdSet.has(id)) {
        metadataGroupIds.push(id);
        metadataGroupIdSet.add(id);
      }
    });
    fallbackColumns.forEach((column) => {
      if (!metadataGroupIdSet.has(column.id)) {
        metadataGroupIds.push(column.id);
        metadataGroupIdSet.add(column.id);
      }
    });
    const orderedMetadataGroupIds = numberPolicy
      ? orderNumberGroupIds(metadataGroupIds, groupingFieldId, numberPolicy)
      : metadataGroupIds;

    const collapsedValue = group.get(YjsDatabaseKey.collapsed_group_ids) as unknown;
    const collapsedIds = new Set(
      (collapsedValue && typeof collapsedValue === 'object' && 'toArray' in collapsedValue
        ? (collapsedValue as { toArray: () => unknown[] }).toArray()
        : Array.isArray(collapsedValue)
        ? collapsedValue
        : []
      ).filter((id): id is string => typeof id === 'string')
    );
    const layoutSetting =
      layout === DatabaseViewLayout.List
        ? view?.get(YjsDatabaseKey.layout_settings)?.get('4')
        : layout === DatabaseViewLayout.Timeline
        ? view?.get(YjsDatabaseKey.layout_settings)?.get('8')
        : view?.get(YjsDatabaseKey.layout_settings)?.get('0');
    const storedHideEmpty = layoutSetting?.get(YjsDatabaseKey.hide_empty_groups);
    const hideEmptyGroups = storedHideEmpty === undefined ? true : Boolean(storedHideEmpty);
    const optionById = new Map(
      (parseSelectOptionTypeOptions(field)?.options ?? []).map((option) => [option.id, option] as const)
    );
    const columnsById = new Map(persistedColumns.map((column) => [column.id, column] as const));
    const primarySort = view?.get(YjsDatabaseKey.sorts)?.toArray()[0];
    const primarySortCondition =
      primarySort?.get(YjsDatabaseKey.field_id) === currentFieldId
        ? (Number(primarySort.get(YjsDatabaseKey.condition)) as SortCondition)
        : undefined;
    const displayIds =
      primarySortCondition === undefined || numberPolicy
        ? orderedIds
        : orderDatabaseGroupsForPrimarySort(orderedIds, result, rowOrders, primarySortCondition);
    const identifierLabels = buildIdentifierLabels({
      fieldType,
      field,
      mentionableUsers,
      relationIds: displayIds.filter((id) => id !== currentFieldId),
      readRelationLabel: (id) =>
        isHistory
          ? readHistoricalRelationText(database, parseRelationTypeOption(field).database_id, [id], groupingRows)
          : readRelationGroupLabel({ relationField: field, relatedRowId: id }),
    });

    const now = new Date();
    const groups = displayIds.map((id): GridGroup => {
      const groupRows = result?.get(id) ?? [];
      const hidden = columnsById.get(id)?.visible === false;
      // Desktop deletes empty row-derived groups. Web conservatively keeps
      // their persisted Y.Maps because seed-only rows cannot prove global
      // absence, but must not resurrect those stale IDs as empty headers when
      // the user turns the static-option "Hide empty groups" setting off.
      const automaticallyHidden =
        ready &&
        groupRows.length === 0 &&
        (hideEmptyGroups ||
          (id !== currentFieldId && isDynamicDatabaseGroupFieldType(fieldType) && !numberPolicy?.retainsEmptyGroups));

      return {
        id,
        label: getGroupLabel(id, field, content, now, identifierLabels),
        rows: groupRows,
        isDefault: id === currentFieldId,
        visible: !hidden && !automaticallyHidden,
        hidden,
        automaticallyHidden,
        collapsed: collapsedIds.has(id),
        option: optionById.get(id),
      };
    });

    return {
      isGrouped: true,
      rowOrders,
      groupId: group.get(YjsDatabaseKey.id),
      fieldId: currentFieldId,
      fieldType,
      fieldName: field.get(YjsDatabaseKey.name),
      field,
      content,
      activeGroupIds: orderedIds,
      groups,
      visibleGroups: groups.filter((group) => group.visible),
      hideEmptyGroups,
      ready,
      metadataGroupIds: orderedMetadataGroupIds,
      metadataInitializationGroup: initializesLocalGroup ? group : undefined,
      metadataSyncKey,
    };
  }, [
    allRowOrders,
    fields,
    groupingRows,
    database,
    isHistory,
    groupingViewRevision,
    hasCellLocalMutation,
    layout,
    metadataSyncKey,
    mentionableUsers,
    relationGroupLabelRevision,
    cellLocalMutationRevision,
    rowOrders,
    rowsHydrated,
    ungroupedGrouping,
    view,
  ]);

  const groupingField = grouping.field;
  const relationDatabaseId =
    groupingField && grouping.fieldType === FieldType.Relation
      ? parseRelationTypeOption(groupingField).database_id
      : undefined;
  const relationGroupLabelIdsKey = relationDatabaseId
    ? JSON.stringify(grouping.activeGroupIds.filter((id) => id !== grouping.fieldId))
    : undefined;
  const relationGroupLabelIds = useMemo(
    () => (relationGroupLabelIdsKey === undefined ? undefined : (JSON.parse(relationGroupLabelIdsKey) as RowId[])),
    [relationGroupLabelIdsKey]
  );

  useEffect(() => {
    if (isHistory || !groupingField || !relationDatabaseId || !relationGroupLabelIds) return;

    return retainRelationGroupLabels(
      relationGroupLabelIds.map((relatedRowId) => ({ relationField: groupingField, relatedRowId }))
    );
  }, [groupingField, relationDatabaseId, relationGroupLabelIds, isHistory]);

  useEffect(() => {
    // Resolving a title loads a related document, so it belongs after commit
    // rather than inside the memo. Each resolution publishes on the group-label
    // channel, which brings the memo back through relationGroupLabelRevision.
    void relationGroupLabelRevision;
    if (isHistory || !groupingField || !relationDatabaseId || !relationGroupLabelIds) return;

    relationGroupLabelIds.forEach((id) => {
      ensureRelationGroupLabel({
        relationField: groupingField,
        relatedRowId: id,
        loadView,
        createRow,
        getViewIdFromDatabaseId,
      });
    });
  }, [
    createRow,
    getViewIdFromDatabaseId,
    groupingField,
    loadView,
    relationDatabaseId,
    relationGroupLabelIds,
    relationGroupLabelRevision,
    isHistory,
  ]);

  // An ungrouped grid shows the rows read so far, followed by a loading row.
  return useMemo(
    () =>
      showsPartialRows && hydrating && !grouping.isGrouped
        ? { ...grouping, rowOrders: progressiveRowOrders, hydrating }
        : grouping,
    [grouping, hydrating, progressiveRowOrders, showsPartialRows]
  );
}

export function useGridGroupingSelector(): GridGrouping {
  return useDatabaseGroupingSelector(DatabaseViewLayout.Grid);
}

export function useListGroupingSelector(): DatabaseGrouping {
  return useDatabaseGroupingSelector(DatabaseViewLayout.List);
}

export function useTimelineGroupingSelector(): DatabaseGrouping {
  return useDatabaseGroupingSelector(DatabaseViewLayout.Timeline);
}

/** Formula fields the view's sorts and effective filters refer to. */
function conditionFormulaFields(
  fields: YDatabaseFields | undefined,
  sorts: YDatabaseSorts | undefined,
  filters: FilterList | undefined
): YDatabaseField[] {
  if (!fields || !(sorts?.length || filters?.length)) return [];
  return Array.from(getConditionFieldIds(sorts, filters, fields))
    .map((fieldId) => fields.get(fieldId))
    .filter((field): field is YDatabaseField => Number(field?.get(YjsDatabaseKey.type)) === FieldType.Formula);
}

/** What the given formula conditions read from outside the rows. */
function formulaConditionExternalReferences(
  formulas: YDatabaseField[],
  schema: FormulaFieldSchema[]
): FormulaExternalReferences {
  if (formulas.length === 0) return NO_EXTERNAL_REFERENCES;
  const references = formulas.map((field) => collectFormulaExternalReferences(field, schema));

  return {
    clock: references.some((entry) => entry.clock),
    people: references.some((entry) => entry.people),
    relations: references.flatMap((entry) => entry.relations),
    rollups: references.flatMap((entry) => entry.rollups),
  };
}

/** How far a conditioned view got through reading its rows. */
export interface RowOrdersHydration {
  /** Rows whose data the conditions have read, or that cannot be loaded. */
  ready: number;
  total: number;
}

export interface RowOrdersSnapshot {
  /**
   * The sorted and filtered rows. While `hydrating`, the matches among the
   * rows read so far: later matches only ever append below the ones already
   * listed, so the rows shown never move while more load. When rows arrive in
   * the view's order these are the first rows of the final result; the
   * complete result is always in the view's order. Undefined until a row can
   * be shown, for sorted views until every row was read, and for a consumer
   * that did not ask for the partial result.
   */
  rows?: Row[];
  /** Set until every row was read; a partial result, even an empty one, is never final. */
  hydrating?: RowOrdersHydration;
}

export interface RowOrdersSelectorOptions {
  /**
   * Publish the matches found so far and the progress while rows still load.
   * Only a consumer that shows them (the ungrouped grid) asks for it. Any other
   * one waits for the complete result: it pays for no partial filter and is not
   * woken by each batch of rows.
   */
  partial?: boolean;
}

const EMPTY_ROW_ORDERS_SNAPSHOT: RowOrdersSnapshot = {};
/** `hydrating` for a consumer that waits for the complete result: it reads no progress. */
const HYDRATING_WITHOUT_PROGRESS: RowOrdersHydration = Object.freeze({ ready: 0, total: 0 });

/**
 * What a filter-only view found among the rows it has read so far. The hook
 * owns one per condition state and `advancePartialFilter` advances it in place.
 */
export interface PartialFilterState {
  /** `viewId:conditionSignature` the verdicts belong to. */
  conditionStateKey: string;
  /** Counts the passes; a verdict of an earlier pass is for a row that is gone or unreadable. */
  pass: number;
  /** What the filter decided for each row, and the doc it read. Cleared when the verdicts go stale. */
  verdicts: Map<string, { matched: boolean; doc: YDoc; pass: number }>;
  /** The matches, in the order they were first shown. */
  shown: Row[];
  shownIds: Set<string>;
}

export function createPartialFilterState(conditionStateKey: string): PartialFilterState {
  return { conditionStateKey, pass: 0, verdicts: new Map(), shown: [], shownIds: new Set() };
}

/**
 * Advances a partial filter result with the rows that can be read now. Only
 * rows the filter has not judged yet (or whose doc was replaced) are filtered,
 * so a view of n rows runs the predicate n times in total, however many times
 * rows arrive. Their matches append below the rows already shown, in the order
 * `readableRows` lists them; a shown row is only ever removed (it left the view
 * or no longer matches), never moved.
 *
 * @param readableRows - The rows whose data can be read, in view order
 * @param filter - Returns the matches among the given rows, keeping their order
 * @returns The rows to show: the same array as before when nothing changed
 */
export function advancePartialFilter(
  state: PartialFilterState,
  readableRows: Row[],
  docs: Record<RowId, YDoc>,
  filter: (rows: Row[]) => Row[]
): Row[] {
  const pass = (state.pass += 1);
  const unjudged: Row[] = [];

  for (const row of readableRows) {
    const verdict = state.verdicts.get(row.id);

    if (verdict && verdict.doc === docs[row.id]) {
      verdict.pass = pass;
    } else {
      unjudged.push(row);
    }
  }

  const appended: Row[] = [];

  if (unjudged.length > 0) {
    const matchedIds = new Set(filter(unjudged).map((row) => row.id));

    unjudged.forEach((row) => {
      const matched = matchedIds.has(row.id);

      state.verdicts.set(row.id, { matched, doc: docs[row.id], pass });
      if (matched && !state.shownIds.has(row.id)) appended.push(row);
    });
  }

  const kept = state.shown.filter((row) => {
    const verdict = state.verdicts.get(row.id);

    if (verdict?.matched && verdict.pass === pass) return true;
    state.shownIds.delete(row.id);
    return false;
  });

  if (kept.length !== state.shown.length || appended.length > 0) {
    appended.forEach((row) => state.shownIds.add(row.id));
    state.shown = [...kept, ...appended];
  }

  return state.shown;
}

export interface ComputeRowOrdersInput {
  /** The view's visible rows, in view order. */
  rowOrders: Row[];
  /** The row docs the conditions read. */
  docs: Record<RowId, YDoc>;
  /** Rows that cannot be loaded: they are left out, and nothing waits for them. */
  unavailable: ReadonlySet<string>;
  /** The view's sort, when it has one. */
  sort?: (rows: Row[]) => Row[];
  /** The view's filter, when it has one. It keeps the order of the rows it is given. */
  filter?: (rows: Row[]) => Row[];
  /** The partial result so far, for a caller that shows one while rows load. Advanced in place. */
  partial?: PartialFilterState;
}

export interface ComputeRowOrdersResult {
  /** The complete result or, while `hydrating`, the partial one (undefined without `partial`). */
  rows?: Row[];
  /** Set while rows are still unread. */
  hydrating?: RowOrdersHydration;
  /** The rows the conditions still wait for, in view order. */
  unresolved: Row[];
  /** How many rows the conditions could read. */
  readable: number;
}

/**
 * Sorts and filters a view's rows. While a row is unread the result is not
 * final: it reports the progress and, for a filter-only view with `partial`,
 * the matches found so far. One pass over the rows finds the readable and the
 * unread ones.
 */
export function computeRowOrders({
  rowOrders,
  docs,
  unavailable,
  sort,
  filter,
  partial,
}: ComputeRowOrdersInput): ComputeRowOrdersResult {
  const readable: Row[] = [];
  const unresolved: Row[] = [];

  for (const row of rowOrders) {
    if (hasRowConditionData(docs[row.id])) {
      readable.push(row);
    } else if (!unavailable.has(row.id)) {
      unresolved.push(row);
    }
  }

  if (unresolved.length > 0) {
    return {
      // A filter keeps row order and judges each row on its own, so its matches
      // can show as rows arrive. A sort can move any row: it waits for them all.
      rows: partial && !sort ? advancePartialFilter(partial, readable, docs, filter ?? ((rows) => rows)) : undefined,
      hydrating: { ready: rowOrders.length - unresolved.length, total: rowOrders.length },
      unresolved,
      readable: readable.length,
    };
  }

  const sorted = sort ? sort(readable) : readable;

  return { rows: filter ? filter(sorted) : sorted, unresolved, readable: readable.length };
}

/** A short, stable key for a condition signature (FNV-1a). */
function hashConditionSignature(signature: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16);
}

/** What a row-orders result of a view currently shows; see `RowOrdersLoadReporter`. */
export interface RowOrdersLoadReport {
  /** Every row was read: the result is final. */
  complete: boolean;
  /** The result lists rows its conditions matched, so it shows real row data. */
  hasMatches: boolean;
}

/**
 * How the `Database` that hosts a view learns what its row-orders results show.
 * Each mounted result reports under its own `source` whenever it publishes, and
 * releases it when it unmounts.
 */
export interface RowOrdersLoadReporter {
  report: (source: object, report: RowOrdersLoadReport) => void;
  release: (source: object) => void;
}

export const RowOrdersLoadReporterContext = createContext<RowOrdersLoadReporter | undefined>(undefined);

const WHOLE_VIEW_ROW_ORDERS: RowOrdersSelectorOptions = { partial: false };
const PARTIAL_ROW_ORDERS: RowOrdersSelectorOptions = { partial: true };

/**
 * Sorted and filtered rows once every row was read, and undefined while they
 * load. Consumers that can show a partial result (the ungrouped grid) use
 * `useProgressiveRowOrdersSelector`; charts, calculations, groups and other
 * whole-view consumers keep waiting for the complete result.
 */
export function useRowOrdersSelector() {
  const { rows, hydrating } = useProgressiveRowOrdersSelector(WHOLE_VIEW_ROW_ORDERS);

  return hydrating ? undefined : rows;
}

/**
 * Hook to get sorted and filtered row orders, including the partial result of
 * a filtered view whose rows are still loading (see `RowOrdersSelectorOptions`).
 *
 * This hook is composed of smaller, focused hooks (like BLoC pattern):
 * - useBackgroundRowDocLoader: Handles background loading of row docs
 * - useRollupFieldObservers: Handles rollup field change observers
 *
 * The main hook handles:
 * - Applying sorts and filters to row orders (`computeRowOrders`)
 * - Observing data changes to trigger re-computation
 */
export function useProgressiveRowOrdersSelector(options?: RowOrdersSelectorOptions): RowOrdersSnapshot {
  const partial = options?.partial ?? true;
  const rows = useRowMap();
  const view = useDatabaseView();
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const viewId = useDatabaseViewId();
  const sorts = view?.get(YjsDatabaseKey.sorts);
  const fields = useDatabaseFields();
  const viewFilters = view?.get(YjsDatabaseKey.filters);
  const database = useDatabase();
  const inlineRowOrders = getInlineViewRowOrders(database);
  const databaseContext = useDatabaseContext();
  const {
    dataSource,
    databaseDoc,
    workspaceId,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    ensureRow,
    loadRowFromSeed,
    peekRowDocFromSeed,
  } = databaseContext;
  const { blobPrefetchComplete, seedsReady } = useRowPassState(databaseContext);
  const extraFilters = useDatabaseExtraFilters();
  // Dashboard global filters ride along with the view's own filters for
  // evaluation and signatures; observers stay on the real Yjs array. A global
  // filter whose mapped field changed type is skipped (read live, so the field
  // observer's recompute picks the change up).
  const filters = useMemo(() => combineFilters(viewFilters, extraFilters, fields), [viewFilters, extraFilters, fields]);
  // The view instance's row search (WP09 §1.2), ANDed after the filters. It is
  // part of every condition state key, so a new query is a new result.
  const searchQuery = normalizeSearchQuery(useDatabaseSearchQuery());
  const searchKey = searchQuery ? `:q=${searchQuery}` : '';
  const searchReadsPeople =
    searchQuery !== '' &&
    getSearchableFields(fields, view).some(({ type }) =>
      [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(type)
    );
  const isHistory = dataSource?.type === 'history';
  const hasAttributionSort =
    sorts?.toArray().some((sort) => {
      const field = fields?.get(sort.get(YjsDatabaseKey.field_id));
      const fieldType = Number(field?.get(YjsDatabaseKey.type));

      return fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;
    }) ?? false;
  // Formula conditions can read member names, related titles and rollups.
  const conditionFormulas = conditionFormulaFields(fields, sorts, filters);
  const conditionFormulaKey = conditionFormulas.map((field) => String(field.get(YjsDatabaseKey.id))).join(',');
  // Their references change with the formulas' expressions (and the fields they reach).
  const conditionFieldsVersion = useDatabaseFieldsVersion(conditionFormulaKey !== '');
  const formulaConditionReferences = useMemo(
    () => {
      void conditionFieldsVersion;
      const formulas = conditionFormulaKey
        .split(',')
        .map((fieldId) => fields?.get(fieldId))
        .filter((field): field is YDatabaseField => Boolean(field));

      return formulaConditionExternalReferences(formulas, readFormulaSchemaForVersion(fields, conditionFieldsVersion));
    },
    [fields, conditionFormulaKey, conditionFieldsVersion]
  );
  const { users: conditionMentionableUsers } = useMentionableUsersWithAutoFetch(
    !isHistory && (hasAttributionSort || formulaConditionReferences.people || searchReadsPeople)
  );
  const attributionNameByUid = useMemo(() => {
    const names = new Map<string, string>();

    if (isHistory) return names;
    conditionMentionableUsers.forEach((person) => {
      const name = person.name?.trim() || person.email?.trim();
      const uid = canonicalizeUserUid(person.uid);

      if (name && uid) names.set(uid, name);
    });

    return names;
  }, [conditionMentionableUsers, isHistory]);
  const attributionNameGetter = useCallback((uid: string) => attributionNameByUid.get(uid), [attributionNameByUid]);
  const searchNameById = useMemo(() => {
    // Person cells store workspace person ids; attribution fields store user uids.
    const names = new Map(attributionNameByUid);

    if (isHistory) return names;
    conditionMentionableUsers.forEach((person) => {
      const name = person.name?.trim() || person.email?.trim();

      if (name && person.person_id) names.set(person.person_id, name);
    });
    return names;
  }, [attributionNameByUid, conditionMentionableUsers, isHistory]);
  const searchNameGetter = useCallback((id: string) => searchNameById.get(id), [searchNameById]);
  const conditionMembers = useMemo(() => memberNames(isHistory ? [] : conditionMentionableUsers), [conditionMentionableUsers, isHistory]);
  const conditionReadsRelatedTitles = formulaConditionReferences.relations.length > 0;
  const formulaClock = useFormulaClock(!isHistory && formulaConditionReferences.clock);

  // A complete result is kept per database, view and conditions for the
  // source's residency window (`derivedRowOrders`) when the conditions
  // read only the rows' own cells: a remount (a return to the dashboard) or a
  // second consumer of the same view and conditions shows it without
  // computing it again. A search, a formula, a relation, a rollup or a
  // person's name reads more than the row, so those results are not kept.
  const derivedRowOrdersCacheable =
    !isHistory && !searchQuery && Boolean(peekRowDocFromSeed) && conditionFormulas.length === 0 && !hasAttributionSort;
  const derivedRowOrdersOf = useCallback(
    (visibleRowOrders: Row[], conditionStateKey: string, docs: Record<RowId, YDoc>) => {
      if (!derivedRowOrdersCacheable) return null;
      const computed = getComputedConditionFieldIds(sorts, filters, fields);

      if (computed.relationFieldIds.length > 0 || computed.rollupFieldIds.length > 0) return null;
      const fieldIds = Array.from(getConditionFieldIds(sorts, filters, fields)).sort();

      return {
        key: `${databaseDoc.guid}\n${conditionStateKey}`,
        inputs: {
          databaseId: derivedSourceDatabaseId(databaseDoc),
          rowOrders: visibleRowOrders,
          fieldsKey: derivedInputKey(fieldIds.map((fieldId) => [fieldId, fields?.get(fieldId)?.toJSON() ?? null])),
          resolveDoc: (rowId: string) => {
            const doc = docs[rowId];

            return hasRowConditionData(doc) ? doc : peekRowDocFromSeed?.(rowId);
          },
        },
      };
    },
    [databaseDoc, derivedRowOrdersCacheable, fields, filters, peekRowDocFromSeed, sorts]
  );
  // The key of the kept result this consumer showed last: kept for the
  // residency window from the moment the consumer goes away.
  const derivedRowOrdersKeyRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (derivedRowOrdersKeyRef.current) derivedRowOrders.retain(derivedRowOrdersKeyRef.current);
    },
    []
  );

  const [rowOrdersState, setRowOrdersState] = useState<{
    rows?: Row[];
    hydrating?: RowOrdersHydration;
    conditionSignature: string;
    /** The view and the (combined) filters the rows were computed for. */
    viewId?: string;
    filters?: FilterList;
    /** The normalized search the rows were computed for (`''` for none). */
    query?: string;
  }>(() => {
    // A consumer mounting again within the residency window shows the kept
    // result in its first render, before any row doc of its own has loaded.
    const conditionSignature = getConditionSignature(sorts, filters, fields);
    const visibleRowOrders = conditionSignature
      ? materializeVisibleRowOrders(
          rowOrders?.toJSON() as Row[] | undefined,
          inlineRowOrders?.toJSON() as Row[] | undefined
        )
      : undefined;
    const conditionStateKey = `${viewId ?? ''}:${conditionSignature}${searchKey}`;
    const derived = visibleRowOrders ? derivedRowOrdersOf(visibleRowOrders, conditionStateKey, rows ?? {}) : null;
    const kept = derived ? derivedRowOrders.read(derived.key, derived.inputs) : undefined;

    if (!derived || !kept) return { conditionSignature: '' };
    derivedRowOrdersKeyRef.current = derived.key;
    return { rows: kept, conditionSignature: conditionStateKey, viewId, filters, query: searchQuery };
  });
  const loadReporter = useContext(RowOrdersLoadReporterContext);
  // Identifies this result to the reporter for as long as the hook is mounted.
  const [loadSource] = useState(() => ({}));
  // What the last publish was for: the view, the (combined) filters and the search, and whether it was complete.
  const publishedRef = useRef<{ viewId?: string; filters?: FilterList; query: string; complete: boolean } | null>(null);
  // The last complete result published, and the conditions it is for.
  const shownResultRef = useRef<{ conditionStateKey: string; rows: Row[] } | null>(null);

  useEffect(() => {
    if (!loadReporter) return;
    return () => loadReporter.release(loadSource);
  }, [loadReporter, loadSource]);

  const publishRows = useCallback(
    (
      rows: Row[] | undefined,
      conditionSignature: string,
      state?: { hydrating?: RowOrdersHydration; conditioned?: boolean }
    ) => {
      const hydrating = state?.hydrating;

      // Reported before the state commits, so the host knows a result is final
      // no later than the render that shows it.
      loadReporter?.report(loadSource, {
        complete: !hydrating,
        hasMatches: Boolean(state?.conditioned && rows?.length),
      });
      const last = publishedRef.current;
      // The result of new dashboard global filters or a new search. The view
      // shows its last result until this one renders (`showsPublishedResult`),
      // so it renders as a transition: in slices, interrupted by later input,
      // instead of every widget of the source re-rendering in one task.
      const rendersInTransition = Boolean(
        last?.complete && last.viewId === viewId && (last.filters !== filters || last.query !== searchQuery)
      );

      publishedRef.current = { viewId, filters, query: searchQuery, complete: !hydrating };
      if (!hydrating && rows) shownResultRef.current = { conditionStateKey: conditionSignature, rows };
      const setState: typeof setRowOrdersState = rendersInTransition
        ? (update) => startTransition(() => setRowOrdersState(update))
        : setRowOrdersState;

      setState((previous) => {
        const sameConditions =
          previous.conditionSignature === conditionSignature &&
          previous.viewId === viewId &&
          previous.filters === filters &&
          previous.query === searchQuery;

        // A complete result computed again (a row doc loaded, a cell the
        // conditions do not read changed) keeps its rows when they are the
        // same: every consumer re-renders and recomputes on a new array.
        if (
          !hydrating &&
          !previous.hydrating &&
          sameConditions &&
          rows &&
          previous.rows &&
          haveSameRows(rows, previous.rows)
        ) {
          return previous;
        }

        const republishesPartialResult = hydrating && previous.hydrating && sameConditions;

        if (!republishesPartialResult) {
          return { rows, hydrating, conditionSignature, viewId, filters, query: searchQuery };
        }

        // A partial result is published again each time more rows were read.
        // Keep what did not change, so the rows already shown do not re-render.
        const sameRows = rows === previous.rows || Boolean(rows && previous.rows && haveSameRows(rows, previous.rows));
        const sameProgress =
          hydrating.ready === previous.hydrating?.ready && hydrating.total === previous.hydrating?.total;

        if (sameRows && sameProgress) return previous;
        return {
          rows: sameRows ? previous.rows : rows,
          hydrating: sameProgress ? previous.hydrating : hydrating,
          conditionSignature,
          viewId,
          filters,
          query: searchQuery,
        };
      });
    },
    [filters, loadReporter, loadSource, searchQuery, viewId]
  );
  const [rollupWatchVersion, setRollupWatchVersion] = useState(0);
  const [conditionLoadRevision, setConditionLoadRevision] = useState(0);
  // Once filters have been applied successfully, don't revert to unfiltered
  // when rowDocsForConditions temporarily changes (e.g. new rows being added to rowMap).
  const filtersAppliedRef = useRef(false);
  const conditionSignatureRef = useRef('');
  const conditionComputeLogRef = useRef({ count: 0, lastLoggedAt: 0 });
  const pendingConditionRowLoadsRef = useRef(new Set<string>());
  const unavailableConditionRowsRef = useRef(new Set<string>());
  const lastProcessedRowOrderTransactionRef = useRef<Transaction | null>(null);
  // A data change whose recompute was scheduled by observers replaced before it ran.
  const carriedConditionChangeRef = useRef(false);
  // Schedules the recompute that removes rows the user's own edit filtered out.
  const holdRemovedRowsRef = useRef<(() => void) | null>(null);
  // The partial result of a filter-only view whose rows still load.
  const partialFilterRef = useRef<PartialFilterState | null>(null);
  // What the partial filter's verdicts were computed with, besides the row docs.
  const partialFilterInputsRef = useRef<object | null>(null);
  // Row data, a field or a computed cell changed in place: every verdict is stale.
  const partialVerdictsStaleRef = useRef(false);

  // Check if there are active conditions (a search reads every row too)
  const hasConditions = (sorts?.length ?? 0) > 0 || hasEffectiveFilters(filters, fields) || searchQuery !== '';

  // Background loading of row docs for sorting/filtering
  const { cachedRowDocs } = useBackgroundRowDocLoader(hasConditions);

  // Merge cached docs with main rowMap.
  // useDeferredValue lets React treat the filter/sort recompute as low-priority
  // so a burst of cache updates coalesces into fewer renders — React will
  // abandon in-progress filter work when a newer snapshot arrives.
  // Bumped when a live row doc that a cached copy shadows gets its row data:
  // the merge below is memoised on the maps' identities, so without it the
  // copy (a seed or IndexedDB snapshot taken before the row had its cells)
  // would keep answering the conditions after the live doc changed.
  const [liveRowDataVersion, setLiveRowDataVersion] = useState(0);
  const rowDocsForConditionsRaw = useMemo(() => {
    void liveRowDataVersion;
    if (isHistory) return rows ?? {};
    const next = { ...cachedRowDocs };

    Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows, isHistory, liveRowDataVersion]);
  const rowDocsForConditions = useDeferredValue(rowDocsForConditionsRaw);
  const rowDocsForConditionsRef = useRef(rowDocsForConditions);

  useFormulaRelationTitles(formulaConditionReferences.relations, { rows: rowDocsForConditions });

  useEffect(() => {
    rowDocsForConditionsRef.current = rowDocsForConditions;
  }, [rowDocsForConditions]);

  const markConditionRowsUnavailable = useCallback((missingRows: Row[]) => {
    let changed = false;

    missingRows.forEach(({ id: rowId }) => {
      if (!rowId || unavailableConditionRowsRef.current.has(rowId)) return;

      unavailableConditionRowsRef.current.add(rowId);
      changed = true;
    });

    if (changed) {
      setConditionLoadRevision((revision) => revision + 1);
    }
  }, []);

  const requestMissingConditionRows = useCallback(
    (missingRows: Row[]) => {
      if (!ensureRow && !loadRowFromSeed) {
        markConditionRowsUnavailable(missingRows);
        return;
      }

      const requestConditionSignature = conditionSignatureRef.current;

      missingRows
        .filter(({ id: rowId }) => rowId && !pendingConditionRowLoadsRef.current.has(rowId))
        .slice(0, CONDITION_ROW_LOAD_BATCH_SIZE)
        .forEach(({ id: rowId }) => {
          if (!rowId) return;

          pendingConditionRowLoadsRef.current.add(rowId);

          void (async () => {
            try {
              let seededDoc: YDoc | undefined;

              if (loadRowFromSeed) {
                try {
                  seededDoc = await loadRowFromSeed(rowId);
                } catch (error) {
                  if (!ensureRow) throw error;
                }
              }

              if (!hasRowConditionData(seededDoc)) {
                const ensuredDoc = await ensureRow?.(rowId);
                const ensuredHasConditionData = ensuredDoc ? hasRowConditionData(ensuredDoc) : false;
                // An opened row doc can still receive its row data from sync; don't settle it as unavailable yet.
                const rowDocOpenedForHydration = Boolean(seededDoc || ensuredDoc);

                const shouldMarkUnavailable =
                  !ensuredHasConditionData &&
                  !hasRowConditionData(rowDocsForConditionsRef.current[rowId]) &&
                  (!rowDocOpenedForHydration || seedsReady || blobPrefetchComplete);

                if (conditionSignatureRef.current === requestConditionSignature && shouldMarkUnavailable) {
                  markConditionRowsUnavailable([{ id: rowId, height: 0 }]);
                }
              }
            } catch (error) {
              if (conditionSignatureRef.current === requestConditionSignature) {
                markConditionRowsUnavailable([{ id: rowId, height: 0 }]);
              }

              if (shouldLogDatabaseConditionPerformance()) {
                console.debug('[Database] failed to hydrate row for conditions', { rowId, error });
              }
            } finally {
              pendingConditionRowLoadsRef.current.delete(rowId);
            }
          })();
        });
    },
    [blobPrefetchComplete, ensureRow, loadRowFromSeed, markConditionRowsUnavailable, seedsReady]
  );

  const readVisibleRowOrders = useCallback(() => {
    const rawRowOrders = rowOrders?.toJSON() as Row[] | undefined;
    const canonicalRowOrders = inlineRowOrders?.toJSON() as Row[] | undefined;

    return materializeVisibleRowOrders(rawRowOrders, canonicalRowOrders);
  }, [inlineRowOrders, rowOrders]);

  const syncUnconditionedRowOrders = useCallback(() => {
    const originalRowOrders = readVisibleRowOrders();

    if (!originalRowOrders) return false;

    const conditionSignature = getConditionSignature(sorts, filters, fields);
    const conditionStateKey = `${viewId ?? ''}:${conditionSignature}${searchKey}`;
    const currentHasConditions = conditionSignature !== '' || searchKey !== '';

    if (conditionSignatureRef.current !== conditionStateKey) {
      conditionSignatureRef.current = conditionStateKey;
      filtersAppliedRef.current = false;
      pendingConditionRowLoadsRef.current.clear();
      unavailableConditionRowsRef.current.clear();
    }

    if (currentHasConditions) return false;

    filtersAppliedRef.current = false;
    publishRows(originalRowOrders, conditionStateKey);
    return true;
  }, [fields, filters, publishRows, readVisibleRowOrders, searchKey, sorts, viewId]);

  // Getter for relation cell text (used in sorting/filtering)
  const relationTextGetter = useCallback(
    (rowId: string, fieldId: string) => {
      if (!fields || !database) return '';
      const field = fields.get(fieldId);

      if (!field || Number(field.get(YjsDatabaseKey.type)) !== FieldType.Relation) return '';
      const rowDoc = rowDocsForConditions[rowId];
      const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
      const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

      if (!row) return '';
      if (isHistory) {
        return readHistoricalRelationText(database, parseRelationTypeOption(field).database_id,
          getRelationRowIdsFromCell(row.get(YjsDatabaseKey.cells)?.get(fieldId)), rowDocsForConditions);
      }

      return readRelationCellText({
        baseDoc: databaseDoc,
        database,
        relationField: field,
        row,
        rowId,
        fieldId,
        loadView,
        createRow,
        getViewIdFromDatabaseId,
      });
    },
    [rowDocsForConditions, fields, database, databaseDoc, loadView, createRow, getViewIdFromDatabaseId, isHistory]
  );

  // Getter for rollup cell value (used in sorting/filtering)
  const rollupValueGetter = useCallback(
    (rowId: string, fieldId: string) => {
      if (!fields || !database) return { value: '' };
      const field = fields.get(fieldId);

      if (!field || Number(field.get(YjsDatabaseKey.type)) !== FieldType.Rollup) return { value: '' };
      const rowDoc = rowDocsForConditions[rowId];
      const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
      const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

      if (!row) return { value: '' };
      return readRollupCellSync({
        baseDoc: databaseDoc,
        workspaceId,
        database,
        rollupField: field,
        row,
        rowId,
        fieldId,
        loadView,
        createRow,
        getViewIdFromDatabaseId,
      });
    },
    [rowDocsForConditions, fields, database, databaseDoc, loadView, createRow, getViewIdFromDatabaseId, workspaceId]
  );

  const formulaContextGetter = useCallback(
    (rowId: string) => {
      if (isHistory) {
        const row = rowDocsForConditions[rowId]?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

        return historicalFormulaRowContext(rowId, row, { database, baseDoc: databaseDoc, rows: rowDocsForConditions });
      }

      return formulaConditionContext(rowId, {
        members: conditionMembers,
        loaders: { loadView, createRow, getViewIdFromDatabaseId },
        getRollupValue: rollupValueGetter,
      });
    },
    [conditionMembers, loadView, createRow, getViewIdFromDatabaseId, rollupValueGetter, isHistory, rowDocsForConditions, database, databaseDoc]
  );

  const rollupTextGetter = useCallback(
    (rowId: string, fieldId: string) => {
      return rollupValueGetter(rowId, fieldId).value;
    },
    [rollupValueGetter]
  );
  // How the search reads cells that reference other rows or people.
  const searchTextOptions = useMemo<SearchTextOptions>(
    () => ({
      getRelationCellText: relationTextGetter,
      getRollupCellText: rollupTextGetter,
      getUserName: searchNameGetter,
    }),
    [relationTextGetter, rollupTextGetter, searchNameGetter]
  );

  // Changes whenever something the conditions read, other than the row docs,
  // is replaced: what the partial filter judged with the old value is stale.
  const conditionInputs = useMemo(
    () => ({
      fields,
      filters,
      database,
      databaseDoc,
      workspaceId,
      loadView,
      createRow,
      getViewIdFromDatabaseId,
      conditionMembers,
      isHistory,
      formulaClock,
    }),
    [
      fields,
      filters,
      database,
      databaseDoc,
      workspaceId,
      loadView,
      createRow,
      getViewIdFromDatabaseId,
      conditionMembers,
      isHistory,
      formulaClock,
    ]
  );

  // Main computation: apply sorts and filters to row orders
  const onConditionsChange = useCallback((options?: { holdRemovedRows?: boolean }) => {
    const shouldLogConditionCompute = shouldLogDatabaseConditionPerformance();
    const computeStartedAt = shouldLogConditionCompute ? performance.now() : 0;
    const originalRowOrders = readVisibleRowOrders();

    if (!originalRowOrders) return;

    const logConditionCompute = (readyRows: number, outputRows?: number) => {
      if (!shouldLogConditionCompute) return;

      const durationMs = performance.now() - computeStartedAt;
      const logState = conditionComputeLogRef.current;
      const now = performance.now();
      const shouldLog = durationMs > 16 || now - logState.lastLoggedAt > 1000;

      logState.count += 1;
      if (!shouldLog) return;

      logState.lastLoggedAt = now;
      console.debug('[Database] row conditions computed', {
        computeCount: logState.count,
        durationMs: Math.round(durationMs),
        totalRows: originalRowOrders.length,
        readyRows,
        outputRows,
        filters: filters?.length ?? 0,
        sorts: sorts?.length ?? 0,
      });
    };

    // Read current filter/sort state directly from Yjs refs instead of the
    // closed-over `hasConditions`.  The Yjs YArray references are stable but
    // their `.length` always reflects the live document state, so this avoids
    // a stale-closure problem when the callback is invoked by a Yjs observer
    // before React has re-rendered (e.g. remote filter/sort sync from desktop).
    const conditionSignature = getConditionSignature(sorts, filters, fields);
    const conditionStateKey = `${viewId ?? ''}:${conditionSignature}${searchKey}`;
    const currentHasConditions = conditionSignature !== '' || searchKey !== '';

    if (conditionSignatureRef.current !== conditionStateKey) {
      conditionSignatureRef.current = conditionStateKey;
      filtersAppliedRef.current = false;
      pendingConditionRowLoadsRef.current.clear();
      unavailableConditionRowsRef.current.clear();
    }

    if (!currentHasConditions) {
      filtersAppliedRef.current = false;
      partialFilterRef.current = null;
      publishRows(originalRowOrders, conditionStateKey);
      logConditionCompute(originalRowOrders.length, originalRowOrders.length);

      return;
    }

    // Only a consumer that shows a partial result pays for one, and only until
    // the first complete result: after it, rows that still load are appended
    // by the next complete result.
    let partialFilter: PartialFilterState | undefined;

    if (partial && !filtersAppliedRef.current && !sorts?.length) {
      const previous = partialFilterRef.current;

      if (previous?.conditionStateKey !== conditionStateKey) {
        partialFilter = createPartialFilterState(conditionStateKey);
      } else {
        partialFilter = previous;
        // The rows already shown stay; each is judged again and only leaves when it no longer matches.
        if (partialVerdictsStaleRef.current || partialFilterInputsRef.current !== conditionInputs) {
          partialFilter.verdicts.clear();
        }
      }

      partialFilterRef.current = partialFilter;
      partialFilterInputsRef.current = conditionInputs;
      partialVerdictsStaleRef.current = false;
    }

    // The result kept for these conditions, while nothing it was computed from changed.
    const derived =
      unavailableConditionRowsRef.current.size === 0
        ? derivedRowOrdersOf(originalRowOrders, conditionStateKey, rowDocsForConditions)
        : null;
    const kept = derived ? derivedRowOrders.read(derived.key, derived.inputs) : undefined;

    if (derived && kept) {
      derivedRowOrdersKeyRef.current = derived.key;
      filtersAppliedRef.current = true;
      partialFilterRef.current = null;
      publishRows(kept, conditionStateKey, { conditioned: true });
      logConditionCompute(originalRowOrders.length, kept.length);
      return;
    }

    const result = computeRowOrders({
      rowOrders: originalRowOrders,
      docs: rowDocsForConditions,
      unavailable: unavailableConditionRowsRef.current,
      sort: sorts?.length
        ? (rows) =>
            sortBy(rows, sorts, fields, rowDocsForConditions, {
              getRelationCellText: relationTextGetter,
              getRollupCellValue: rollupValueGetter,
              getAttributionName: attributionNameGetter,
              getFormulaContext: formulaContextGetter,
            })
        : undefined,
      filter:
        filters?.length || searchQuery
          ? (rows) => {
              const filtered = filters?.length
                ? filterBy(rows, filters, fields, rowDocsForConditions, {
                    getRelationCellText: relationTextGetter,
                    getRollupCellText: rollupTextGetter,
                    getRollupCellValue: rollupValueGetter,
                    getFormulaContext: formulaContextGetter,
                  })
                : rows;

              // The search is one more AND term: after the filters, in their order.
              return searchQuery
                ? searchRows(filtered, searchQuery, fields, view, rowDocsForConditions, searchTextOptions)
                : filtered;
            }
          : undefined,
      partial: partialFilter,
    });

    // Keep conditioned views in an explicit loading state until every row can
    // be evaluated. Otherwise an early zero-match partial result renders as a
    // blank grid, which looks like the database finished with no rows.
    if (result.hydrating) {
      requestMissingConditionRows(result.unresolved);

      if (!filtersAppliedRef.current) {
        // Either way the result stays `hydrating`, so an empty partial result
        // never reads as a finished empty view. A consumer that waits for the
        // complete result gets neither rows nor progress, and so no update.
        publishRows(result.rows, conditionStateKey, {
          hydrating: partial ? result.hydrating : HYDRATING_WITHOUT_PROGRESS,
          conditioned: true,
        });
      } else {
        // New rows cannot be filtered until their docs load, but removals are
        // authoritative in row_orders. Prune them from the last complete result
        // so a remotely deleted row cannot remain visible during hydration.
        const sourceRowIds = new Set(originalRowOrders.map(({ id }) => id));

        setRowOrdersState((previousState) => {
          if (previousState.conditionSignature !== conditionStateKey || !previousState.rows) {
            return previousState;
          }

          const retainedRows = previousState.rows.filter(({ id }) => sourceRowIds.has(id));

          if (retainedRows.length === previousState.rows.length) {
            return previousState;
          }

          return { ...previousState, rows: retainedRows };
        });
      }

      logConditionCompute(result.readable, result.rows?.length);
      return;
    }

    // The user's own edit filtered out a row the view shows: as before, the
    // row leaves after the trailing debounce (`CONDITION_REMOTE_CHANGE_DEBOUNCE_MS`),
    // so an editor open on it (a select menu mid-pick) is not torn down under
    // the pointer. An edit that only changes values or order shows at once.
    const shown = shownResultRef.current;

    if (options?.holdRemovedRows && shown?.conditionStateKey === conditionStateKey && result.rows) {
      const kept = new Set(result.rows.map(({ id }) => id));
      const ordered = new Set(originalRowOrders.map(({ id }) => id));

      if (shown.rows.some(({ id }) => !kept.has(id) && ordered.has(id))) {
        holdRemovedRowsRef.current?.();
        logConditionCompute(result.readable, result.rows.length);
        return;
      }
    }

    filtersAppliedRef.current = true;
    partialFilterRef.current = null;
    dashboardLoadStats.recordDerivedCompute(`${viewId ?? ''}:${hashConditionSignature(conditionSignature)}`);
    if (derived && result.rows) {
      derivedRowOrders.store(derived.key, derived.inputs, result.rows);
      derivedRowOrdersKeyRef.current = derived.key;
    }

    publishRows(result.rows, conditionStateKey, { conditioned: true });
    logConditionCompute(result.readable, result.rows?.length);
  }, [
    fields,
    attributionNameGetter,
    conditionInputs,
    derivedRowOrdersOf,
    formulaContextGetter,
    filters,
    partial,
    rowDocsForConditions,
    sorts,
    readVisibleRowOrders,
    relationTextGetter,
    rollupValueGetter,
    rollupTextGetter,
    requestMissingConditionRows,
    publishRows,
    searchKey,
    searchQuery,
    searchTextOptions,
    view,
    viewId,
  ]);

  // Recomputes after something the conditions read changed in place (row data,
  // a field, a related or rolled-up cell, the day of a relative date filter).
  const refreshConditions = useCallback(
    (trigger?: ConditionChangeTrigger) => {
      partialVerdictsStaleRef.current = true;
      onConditionsChange(trigger === 'frame' ? HOLD_REMOVED_ROWS : undefined);
    },
    [onConditionsChange]
  );

  // Trigger computation when dependencies change
  useEffect(() => {
    onConditionsChange();
  }, [conditionLoadRevision, onConditionsChange, formulaClock]);

  // Subscribe to relation/rollup cache changes
  useEffect(() => {
    if (isHistory) return;
    const handleCacheChange = debounce(refreshConditions, 200);
    const unsubscribeRelation = subscribeRelationCache(() => handleCacheChange());
    const unsubscribeRollup = subscribeRollupCache(() => handleCacheChange());
    // Formula conditions read related row titles from the group-label cache.
    const unsubscribeLabels = conditionReadsRelatedTitles
      ? subscribeRelationGroupLabels(() => handleCacheChange())
      : () => undefined;

    return () => {
      handleCacheChange.cancel();
      unsubscribeRelation();
      unsubscribeRollup();
      unsubscribeLabels();
    };
  }, [refreshConditions, conditionReadsRelatedTitles, isHistory]);

  // Observe Yjs data changes
  useEffect(() => {
    // A complete historical snapshot cannot change. Registering every row
    // would also retain the full CRDT graph outside its bounded row store.
    if (isHistory) return;
    // One scheduler for every data change: the user's own writes recompute on
    // the next frame, remote bursts once after they pause.
    const scheduleChange = createConditionChangeScheduler((trigger) => {
      setRollupWatchVersion((prev) => prev + 1);
      refreshConditions(trigger);
    });

    // A row the user's own edit filtered out leaves with the trailing debounce.
    holdRemovedRowsRef.current = () => scheduleChange();

    // A change can replace these observers before its recompute ran (a field
    // whose type changed turns the conditions off or on): it still runs.
    if (carriedConditionChangeRef.current) {
      carriedConditionChangeRef.current = false;
      scheduleChange(CARRIED_OVER_CHANGE);
    }

    const handleRowOrdersChange = (_events: unknown, transaction: Transaction) => {
      // Row mutations normally update every view in one Yjs transaction. The
      // selected and inline observers therefore receive the same transaction;
      // reconcile it once instead of serializing both row-order arrays twice.
      if (lastProcessedRowOrderTransactionRef.current === transaction) return;

      lastProcessedRowOrderTransactionRef.current = transaction;

      if (!syncUnconditionedRowOrders()) {
        scheduleChange(transaction);
      }
    };

    rowOrders?.observeDeep(handleRowOrdersChange);
    if (inlineRowOrders !== rowOrders) {
      inlineRowOrders?.observeDeep(handleRowOrdersChange);
    }

    const observers = new Map<string, (events: unknown, transaction: Transaction) => void>();
    let relationFieldIds: string[] = [];
    let rollupFieldIds: string[] = [];

    const refreshConditionFieldIds = () => {
      const computedFieldIds = getComputedConditionFieldIds(sorts, filters, fields);

      relationFieldIds = computedFieldIds.relationFieldIds;
      rollupFieldIds = computedFieldIds.rollupFieldIds;
    };

    const handleSortFilterChange = () => {
      refreshConditionFieldIds();
      const nextConditionStateKey = `${viewId ?? ''}:${getConditionSignature(sorts, filters, fields)}${searchKey}`;

      if (conditionSignatureRef.current === nextConditionStateKey) return;

      // Recompute immediately so a filter change does not replace already-loaded
      // rows with the loading placeholder. onConditionsChange still publishes
      // the loading state when row documents genuinely need hydration.
      onConditionsChange();
      setRollupWatchVersion((prev) => prev + 1);
    };

    const handleFieldChange = (_events: unknown, transaction: Transaction) => {
      // Schema changes cannot affect row order when the view has no configured
      // filters or sorts. Avoid serializing every row for unrelated field edits
      // such as renames while an unconditioned Grid view is open.
      // Injected dashboard filters count even while a field-type mismatch hides
      // them: changing the type back must recompute too.
      // A search reads option names and field visibility, so it counts too.
      if (
        (sorts?.length ?? 0) === 0 &&
        (viewFilters?.length ?? 0) === 0 &&
        (extraFilters?.length ?? 0) === 0 &&
        !searchKey
      ) {
        return;
      }

      refreshConditionFieldIds();

      Object.values(rowDocsForConditionsRef.current).forEach((rowDoc) => {
        invalidateRowConditionCache(rowDoc);
      });

      if (rows) {
        Object.keys(rows).forEach((rowId) => {
          for (const fieldId of rollupFieldIds) {
            invalidateRollupCell(`${rowId}:${fieldId}`);
          }
        });
      }

      scheduleChange(transaction);
    };

    sorts?.observeDeep(handleSortFilterChange);
    viewFilters?.observeDeep(handleSortFilterChange);
    fields?.observeDeep(handleFieldChange);

    // Keep relation/rollup field IDs updated as schema changes to avoid stale invalidation.
    refreshConditionFieldIds();

    if (hasConditions) {
      Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
        const observerRowsEvent = (_events: unknown, transaction: Transaction) => {
          invalidateRowConditionCache(rowDoc);
          // The conditions read a cached copy of this row (its live doc had no
          // row data when the docs were merged): merge again now that it has.
          if (rowDocsForConditionsRef.current[rowId] !== rowDoc && hasRowConditionData(rowDoc)) {
            setLiveRowDataVersion((version) => version + 1);
          }

          // A regular field sort/filter reads row data directly. Invalidating
          // unrelated computed cells here can supersede their own observer's
          // in-flight refresh without scheduling a replacement computation.
          for (const fieldId of relationFieldIds) {
            invalidateRelationCell(`${rowId}:${fieldId}`);
          }

          for (const fieldId of rollupFieldIds) {
            invalidateRollupCell(`${rowId}:${fieldId}`);
          }

          scheduleChange(transaction);
        };

        observers.set(rowId, observerRowsEvent);
        rowDoc.getMap(YjsEditorKey.data_section).observeDeep(observerRowsEvent);
      });
    }

    return () => {
      rowOrders?.unobserveDeep(handleRowOrdersChange);
      if (inlineRowOrders !== rowOrders) {
        inlineRowOrders?.unobserveDeep(handleRowOrdersChange);
      }

      sorts?.unobserveDeep(handleSortFilterChange);
      viewFilters?.unobserveDeep(handleSortFilterChange);
      fields?.unobserveDeep(handleFieldChange);
      if (scheduleChange.pending()) carriedConditionChangeRef.current = true;
      scheduleChange.cancel();
      observers.forEach((observer, rowId) => {
        rows?.[rowId]?.getMap(YjsEditorKey.data_section).unobserveDeep(observer);
      });
    };
  }, [
    onConditionsChange,
    refreshConditions,
    rowOrders,
    inlineRowOrders,
    fields,
    filters,
    viewFilters,
    extraFilters,
    sorts,
    rows,
    viewId,
    searchKey,
    syncUnconditionedRowOrders,
    hasConditions,
    isHistory,
  ]);

  // Set up rollup field observers (extracted hook)
  useRollupFieldObservers(refreshConditions, rollupWatchVersion, { rows: rowDocsForConditions });
  useRelativeDateFilterRefresh(filters, fields, refreshConditions);

  const liveConditionSignature = `${viewId ?? ''}:${getConditionSignature(sorts, filters, fields)}${searchKey}`;
  // The published result is shown when it is the one for the live conditions.
  // It is also shown, knowingly stale, for one render: dashboard global filters
  // and the search query arrive through React, not a Yjs observer, so the
  // render that brings new ones (a new combined list, a new query) precedes
  // their recompute (an effect). Keeping this view's last result for that
  // render avoids flashing the loading state on each keystroke, which unmounts
  // every row and replays chart animations.
  const showsPublishedResult =
    rowOrdersState.conditionSignature === liveConditionSignature ||
    (rowOrdersState.viewId === viewId &&
      (rowOrdersState.filters !== filters || (rowOrdersState.query ?? '') !== searchQuery));
  const { rows: publishedRows, hydrating: publishedHydration } = rowOrdersState;

  return useMemo(
    () => (showsPublishedResult ? { rows: publishedRows, hydrating: publishedHydration } : EMPTY_ROW_ORDERS_SNAPSHOT),
    [showsPublishedResult, publishedHydration, publishedRows]
  );
}

export function useRowDataSelector(rowId: string) {
  const rowSharedRoot = useRow(rowId);
  const row = rowSharedRoot?.get(YjsEditorKey.database_row);

  return {
    row,
  };
}

function useRollupCellValue({
  row,
  field,
  rowId,
  fieldId,
  fieldClock,
}: {
  row?: YDatabaseRow;
  field?: YDatabaseField;
  rowId: string;
  fieldId: string;
  fieldClock: number;
}) {
  const database = useDatabase();
  const {
    databaseDoc,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    workspaceId,
    bindViewSync,
    scheduleDeferredCleanup,
    dataSource,
  } = useDatabaseContext();
  const [value, setValue] = useState<RollupCellValue>({ value: '' });
  const [relationRowIdsKey, setRelationRowIdsKey] = useState('');
  const [relatedObserverRevision, setRelatedObserverRevision] = useState(0);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const restoreRevision = useDatabaseDependencyRestoreRevision(fieldType === FieldType.Rollup && dataSource?.type !== 'history');
  const cellId = `${rowId}:${fieldId}`;
  const rollupOption = useMemo(() => {
    if (!field) return undefined;
    // Recompute when fieldClock updates even if the field reference is stable.
    void fieldClock;
    return parseRollupTypeOption(field);
  }, [field, fieldClock]);
  const rollupContext = useMemo(() => {
    if (!database || !row || !field || dataSource?.type === 'history') return null;
    return {
      baseDoc: databaseDoc,
      database,
      rollupField: field,
      row,
      rowId,
      fieldId,
      loadView,
      createRow,
      getViewIdFromDatabaseId,
      workspaceId,
      bindViewSync,
      scheduleDeferredCleanup,
    };
  }, [
    database, row, field, rowId, fieldId, databaseDoc, loadView, createRow,
    getViewIdFromDatabaseId, workspaceId, bindViewSync, scheduleDeferredCleanup, dataSource,
  ]);

  useEffect(() => {
    if (!rollupContext || fieldType !== FieldType.Rollup) {
      setValue({ value: '' });
      return;
    }

    let cancelled = false;

    // Empty relations attach no replacement Formula observer after a membership
    // change. The display read must rerun even if the previous observer disposed
    // after invalidating an in-flight read.
    invalidateRollupCell(cellId);
    void readRollupCell(rollupContext).then((next) => {
      if (!cancelled) {
        setValue(next);
      }
    });

    const unsubscribe = subscribeRollupCell(cellId, (next) => {
      if (!cancelled) {
        setValue(next);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rollupContext, fieldType, cellId, fieldClock, relationRowIdsKey, restoreRevision]);

  useEffect(() => {
    if (!rollupContext || fieldType !== FieldType.Rollup) return;
    const cells = row?.get(YjsDatabaseKey.cells);

    if (!cells) return;

    const updateRelationKey = () => {
      if (!rollupOption?.relation_field_id) return;
      const relationCell = cells.get(rollupOption.relation_field_id);
      const relatedRowIds = getRelationRowIdsFromCell(relationCell);
      const nextKey = relatedRowIds.join(',');

      setRelationRowIdsKey((prev) => (prev === nextKey ? prev : nextKey));
    };

    const handleChange = () => {
      invalidateRollupCell(cellId);
      void readRollupCell(rollupContext);
      updateRelationKey();
    };

    updateRelationKey();
    cells.observeDeep(handleChange);
    return () => {
      cells.unobserveDeep(handleChange);
    };
  }, [rollupContext, fieldType, cellId, row, fieldClock, rollupOption?.relation_field_id]);

  useEffect(() => {
    if (!rollupContext || fieldType !== FieldType.Rollup) return;
    if (!rollupOption?.relation_field_id || !rollupOption.target_field_id) return;
    if (!database || !row) return;

    const relationField = database.get(YjsDatabaseKey.fields)?.get(rollupOption.relation_field_id);
    const relationOption = relationField ? parseRelationTypeOption(relationField) : null;

    if (!relationOption?.database_id) return;

    const relationCell = row.get(YjsDatabaseKey.cells)?.get(rollupOption.relation_field_id);
    const relatedRowIds = getRelationRowIdsFromCell(relationCell);

    if (relatedRowIds.length === 0) return;

    let cancelled = false;
    const observerCleanups: Array<() => void> = [];

    const setupObservers = async () => {
      if (!loadView || !createRow) return;
      const viewId = await getViewIdFromDatabaseId?.(relationOption.database_id);

      if (cancelled || !viewId) return;
      const relatedDoc = await loadView(viewId, false, false, {
        databaseId: relationOption.database_id,
        databaseMetadataOnly: true,
      });

      if (cancelled || !relatedDoc) return;
      const docGuid = relatedDoc.guid;
      const refreshRollup = () => {
        invalidateRollupCell(cellId);
        void readRollupCell(rollupContext);
      };

      const targetFieldType = () => {
        const relatedDatabase = relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;

        return Number(relatedDatabase?.get(YjsDatabaseKey.fields)?.get(rollupOption.target_field_id)?.get(YjsDatabaseKey.type));
      };

      if (targetFieldType() === FieldType.Formula) {
        observerCleanups.push(observeRollupCell(rollupContext, refreshRollup));
        return;
      }

      observerCleanups.push(retainRollupSource(rollupContext, relatedDoc));

      let observedTargetType = targetFieldType();
      const readTargetRelationOption = () => {
        const relatedDatabase = relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as
          | YDatabase
          | undefined;
        const targetField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(rollupOption.target_field_id);

        return targetField && Number(targetField.get(YjsDatabaseKey.type)) === FieldType.Relation
          ? parseRelationTypeOption(targetField)
          : null;
      };

      let observedTargetDatabaseId = readTargetRelationOption()?.database_id ?? '';
      const handleRelatedSchemaChange = () => {
        refreshRollup();
        const nextTargetDatabaseId = readTargetRelationOption()?.database_id ?? '';

        if (nextTargetDatabaseId !== observedTargetDatabaseId || targetFieldType() !== observedTargetType) {
          observedTargetType = targetFieldType();
          observedTargetDatabaseId = nextTargetDatabaseId;
          setRelatedObserverRevision((revision) => revision + 1);
        }
      };

      // The metadata document may still hydrate after loadView resolves.
      // Observe it before looking up a nested Relation target so a target that
      // appears in that gap rebuilds the row observer chain.
      observerCleanups.push(
        subscribeSharedYjsDeep(relatedDoc.getMap(YjsEditorKey.data_section), handleRelatedSchemaChange)
      );
      const targetRelationOption = readTargetRelationOption();
      const nestedViewId = targetRelationOption?.database_id
        ? await getViewIdFromDatabaseId?.(targetRelationOption.database_id)
        : null;

      if (cancelled) return;
      const nestedRelatedDoc =
        nestedViewId && targetRelationOption?.database_id
          ? await loadView(nestedViewId, false, false, {
              databaseId: targetRelationOption.database_id,
              databaseMetadataOnly: true,
            })
          : null;

      if (cancelled) return;
      if (nestedRelatedDoc) {
        observerCleanups.push(retainRollupSource(rollupContext, nestedRelatedDoc));
        observerCleanups.push(subscribeSharedYjsDeep(nestedRelatedDoc.getMap(YjsEditorKey.data_section), refreshRollup));
      }

      const runWithPool = async <T>(items: readonly T[], task: (item: T) => Promise<void>) => {
        let index = 0;
        const poolSize = Math.min(ROLLUP_CELL_OBSERVER_POOL_SIZE, items.length);

        await Promise.all(
          Array.from({ length: poolSize }, async () => {
            while (!cancelled) {
              const currentIndex = index;

              if (currentIndex >= items.length) return;
              index += 1;
              await task(items[currentIndex]);
            }
          })
        );
      };

      const nestedRowIds = new Set<string>();

      await runWithPool(relatedRowIds, async (relatedRowId) => {
        const rowDoc = await createRow(getRowKey(docGuid, relatedRowId));

        if (cancelled || !rowDoc) return;
        const readNestedRowIds = () => {
          const relatedRow = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as
            | YDatabaseRow
            | undefined;
          const targetCell = relatedRow?.get(YjsDatabaseKey.cells)?.get(rollupOption.target_field_id);

          return getRelationRowIdsFromCell(targetCell);
        };

        let observedNestedRowIdsKey = readNestedRowIds().join(',');
        const handleRelatedRowChange = () => {
          refreshRollup();

          if (nestedRelatedDoc) {
            const nextNestedRowIdsKey = readNestedRowIds().join(',');

            if (nextNestedRowIdsKey !== observedNestedRowIdsKey) {
              observedNestedRowIdsKey = nextNestedRowIdsKey;
              setRelatedObserverRevision((revision) => revision + 1);
            }
          }
        };

        observerCleanups.push(subscribeSharedYjsDeep(rowDoc.getMap(YjsEditorKey.data_section), handleRelatedRowChange));

        if (!nestedRelatedDoc) return;
        readNestedRowIds().forEach((nestedRowId) => nestedRowIds.add(nestedRowId));
      });

      if (nestedRelatedDoc) {
        await runWithPool([...nestedRowIds], async (nestedRowId) => {
          const nestedRowDoc = await createRow(getRowKey(nestedRelatedDoc.guid, nestedRowId));

          if (cancelled || !nestedRowDoc) return;
          observerCleanups.push(subscribeSharedYjsDeep(nestedRowDoc.getMap(YjsEditorKey.data_section), refreshRollup));
        });
      }

      // Initial computation can finish while this asynchronous observer chain
      // is still loading. Once every discovered row is observed, invalidate
      // that generation and read again so edits from the setup gap are kept.
      if (!cancelled) {
        refreshRollup();
      }
    };

    void setupObservers().catch((error: unknown) => {
      if (cancelled) return;
      console.error('[Database] failed to set up rollup cell observers', error);
    });

    return () => {
      cancelled = true;
      observerCleanups.forEach((cleanup) => cleanup());
    };
  }, [
    rollupContext,
    rollupOption?.relation_field_id,
    rollupOption?.target_field_id,
    fieldType,
    database,
    row,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    cellId,
    relationRowIdsKey,
    relatedObserverRevision,
    restoreRevision,
  ]);

  if (!rollupContext || fieldType !== FieldType.Rollup) return undefined;

  return {
    createdAt: 0,
    lastModified: 0,
    fieldType: FieldType.Rollup,
    data: value.value,
    rawNumeric: value.rawNumeric,
    list: value.list,
    listItems: value.listItems,
    targetFieldType: value.targetFieldType,
    calculationType: (rollupOption?.calculation_type ?? CalculationType.Count) as CalculationType,
    showAs: (rollupOption?.show_as ?? RollupDisplayMode.Calculated) as RollupDisplayMode,
    visualization: parseRollupVisualizationOption(rollupOption),
  } as RollupCell;
}

/**
 * Formula cells are computed synchronously from the row's own cells, so the
 * value is derived during render and re-derived when the row's cells, the row
 * meta (created/edited time and actor) or any field in the schema changes —
 * other formulas, select option names and number formats all live on fields.
 */
export function useFormulaCellValue({
  row,
  field,
  rowId,
  fieldId,
  fieldClock,
}: {
  row?: YDatabaseRow;
  field?: YDatabaseField;
  rowId: string;
  fieldId: string;
  fieldClock: number;
}): FormulaCell | undefined {
  const fields = useDatabaseFields();
  const { dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isFormula = fieldType === FieldType.Formula;
  // Every cell runs this hook; only formula cells watch the schema, so other
  // cells do not re-render when any field is renamed or reconfigured.
  const fieldsVersion = useDatabaseFieldsVersion(isFormula);
  // The viewer's date and time formats are applied by FormulaCell, so the
  // cells of other fields do not re-render when the user record changes.
  const [rowClock, setRowClock] = useState(0);
  // Ordinary cells must skip schema validation as well as its subscription.
  const schema = useMemo(
    () => (isFormula ? readFormulaSchemaForVersion(fields, fieldsVersion) : []),
    [isFormula, fields, fieldsVersion]
  );
  const references = useMemo(() => {
    void fieldClock;
    return isFormula && field ? collectFormulaExternalReferences(field, schema) : NO_EXTERNAL_REFERENCES;
  }, [isFormula, field, fieldClock, schema]);
  const { context: readContext, revision: readRevision } = useFormulaReadContext({
    references,
    row,
    rowId,
    rowClock,
  });

  useEffect(() => {
    if (!isFormula || !row || isHistory) return;
    const bump = () => setRowClock((prev) => prev + 1);

    // Observe through the row so replacing its cells map also keeps subsequent
    // edits to the replacement subscribed, as happens during synchronization.
    row.observeDeep(bump);

    // Inputs may have changed since render, before these observers attached.
    // Refresh once after subscribing so that gap cannot leave a stale value.
    bump();

    return () => {
      row.unobserveDeep(bump);
    };
  }, [isFormula, row, isHistory]);

  return useMemo(() => {
    if (!isFormula || !row || !field) return undefined;
    // Recompute when the row or any field mutates even though the Yjs handles are stable.
    void rowClock;
    void fieldClock;
    void readRevision;
    const typeOption = parseFormulaTypeOption(field);
    const result = evaluateFormulaCell({
      ...readContext,
      schema,
      field,
      fieldId,
      row,
      rowId,
      format: { numberFormat: typeOption.format },
    });

    return {
      createdAt: 0,
      lastModified: 0,
      fieldType: FieldType.Formula,
      data: result.text,
      value: result.value,
      resultType: result.resultType,
      rawNumeric: result.rawNumeric,
      rawBoolean: result.rawBoolean,
      rawDate: result.rawDate,
      error: result.error,
      missingPropertyRef: result.missingPropertyRef,
      isBlank: typeOption.formula.trim() === '',
      numberFormat: typeOption.format,
      visualization: parseFormulaVisualizationOption(typeOption),
    };
  }, [isFormula, row, field, rowClock, fieldClock, readRevision, readContext, schema, fieldId, rowId]);
}

/**
 * The field type whose calculations a column uses: a formula calculates like
 * a Number column when it returns numbers and like a Checkbox column when it
 * returns booleans; every other field uses its own type.
 */
export function useCalculationFieldType(fieldId: string): FieldType {
  const fieldType = useFieldType(fieldId);
  const resultType = useFormulaResultType(fieldId);

  if (fieldType !== FieldType.Formula) return fieldType;
  if (resultType === 'number') return FieldType.Number;
  if (resultType === 'boolean') return FieldType.Checkbox;
  return FieldType.Formula;
}

/**
 * Static result type of a formula field (`number`, `text`, `boolean`, `date`,
 * a list type, `empty` for a blank expression or `any` when it is invalid).
 * Filters, sorts, the Calculate footer and the property menu key off this.
 */
export function useFormulaResultType(fieldId: string): FormulaType {
  const fields = useDatabaseFields();
  const { field, clock } = useFieldSelector(fieldId);
  const isFormula = Number(field?.get(YjsDatabaseKey.type)) === FieldType.Formula;
  // Footers and filter menus call this for every column; only formulas depend on other fields.
  const fieldsVersion = useDatabaseFieldsVersion(isFormula);

  return useMemo(() => {
    void clock;
    if (!field || !isFormula) return 'any';
    return compileFormula(
      parseFormulaTypeOption(field).formula,
      readFormulaSchemaForVersion(fields, fieldsVersion),
      fieldId
    ).resultType;
  }, [field, isFormula, fields, fieldId, fieldsVersion, clock]);
}

export function useCellSelector({ rowId, fieldId }: { rowId: string; fieldId: string }) {
  const { dataSource } = useDatabaseContext();
  const { row } = useRowDataSelector(rowId);
  const cells = row?.get(YjsDatabaseKey.cells);
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const cell = cells?.get(fieldId);
  const [clock, setClock] = useState<number>(0);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const rollupCell = useRollupCellValue({ row, field, rowId, fieldId, fieldClock });
  const formulaCell = useFormulaCellValue({ row, field, rowId, fieldId, fieldClock });

  // Parse during render rather than from an effect, and key on the field type
  // read from the doc rather than on a clock. Callers pick their cell component
  // from that same live type, so a value that lags even one render describes the
  // previous type and reaches a renderer that cannot read it.
  const cellValue = useMemo(() => {
    return cell ? parseYDatabaseCellToCell(cell, field) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, field, fieldType, fieldClock, clock]);

  // Lets the effect below compare a fresh parse against the value the UI
  // rendered without re-running on every clock bump.
  const cellValueRef = useRef(cellValue);

  cellValueRef.current = cellValue;

  useEffect(() => {
    if (!cells) return;

    const bump = () => {
      setClock((prev) => prev + 1);
    };

    const onCellsChange = (event: unknown) => {
      // Scoped to this column: replacing another cell in the row must not
      // re-parse every cell hook on the row.
      if (yjsEventChangesKey(event, fieldId)) bump();
    };

    cells.observe(onCellsChange);
    cell?.observeDeep(bump);

    // A mutation can land between render (which parsed the cell) and this
    // effect (which attaches the observers), and nothing reports it. Re-render
    // once when the value the UI rendered is already stale.
    const current = cells.get(fieldId);
    const fresh = current ? parseYDatabaseCellToCell(current, field) : undefined;

    if (JSON.stringify(fresh) !== JSON.stringify(cellValueRef.current)) {
      bump();
    }

    return () => {
      cells.unobserve(onCellsChange);
      cell?.unobserveDeep(bump);
    };
  }, [cells, cell, field, fieldId]);

  if (fieldType === FieldType.Rollup && dataSource?.type !== 'history') {
    return rollupCell;
  }

  if (fieldType === FieldType.Formula) {
    return formulaCell;
  }

  return cellValue;
}

export interface CalendarEvent {
  start?: Date;
  end?: Date;
  id: string;
  title: string;
  allDay: boolean;
  rowId: string;
  isRange?: boolean;
}

export function useCalendarEventsSelector() {
  const setting = useCalendarLayoutSetting();

  return useDateFieldEventsSelector(setting?.fieldId || '');
}

/**
 * Rows plotted on the timeline. With Notion's "separate start and end dates"
 * (`endFieldId` set) each bar runs from the start field's date to the end
 * field's date; a row whose end is missing or earlier than its start is a
 * single-unit bar, and a row without a start is undated.
 */
export function useTimelineEventsSelector() {
  const setting = useTimelineLayoutSetting();
  const startFieldId = setting?.fieldId || '';
  const endFieldId = setting?.endFieldId && setting.endFieldId !== startFieldId ? setting.endFieldId : '';
  const { field: startField, clock: startClock } = useFieldSelector(startFieldId);
  const { field: endField, clock: endClock } = useFieldSelector(endFieldId);
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField, clock: primaryClock } = useFieldSelector(primaryFieldId || '');
  const { rowOrders } = useTimelineRowSource();
  const isDateField = (field?: YDatabaseField | null) =>
    field &&
    [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime].includes(
      Number(field.get(YjsDatabaseKey.type))
    );
  const hasStartField = Boolean(isDateField(startField));
  const hasEndField = Boolean(endFieldId && isDateField(endField));
  const parseRow = useCallback(
    (rowId: string, doc: YDoc): CalendarEvent | undefined => {
      // Y.Map identity stays stable when field formats change.
      void startClock;
      void endClock;
      void primaryClock;
      if (!startField || !hasStartField || !primaryFieldId) return undefined;
      const docs = { [rowId]: doc };
      const primaryCell = getCell(rowId, primaryFieldId, docs);
      const title = primaryCell && primaryField ? decodeCellToText(primaryCell, primaryField) : '';
      const row = (doc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database_row);

      if (!row) return undefined;
      const getDate = (timestamp: string) =>
        dayjs(timestamp.length === 10 ? Number(timestamp) * 1000 : timestamp).toDate();
      const readDate = (field: YDatabaseField, fieldId: string): CalendarEvent => {
        const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
        const cell = getCell(rowId, fieldId, docs);
        const value = cell ? (parseYDatabaseCellToCell(cell, field) as DateTimeCell) : undefined;
        const event: CalendarEvent = { id: rowId, rowId, title, allDay: !value?.includeTime };
        const timestamp =
          fieldType === FieldType.CreatedTime
            ? row.get(YjsDatabaseKey.created_at)?.toString()
            : fieldType === FieldType.LastEditedTime
            ? row.get(YjsDatabaseKey.last_modified)?.toString()
            : value?.data;

        if (!timestamp) return event;
        event.start = getDate(timestamp);
        if (fieldType === FieldType.DateTime) {
          event.isRange = Boolean(value?.isRange);
          event.end =
            value?.endTimestamp && value.isRange
              ? getDate(value.endTimestamp)
              : dayjs(event.start).add(30, 'minute').toDate();
        }

        return event;
      };

      const event = readDate(startField, startFieldId);

      if (event.start && hasEndField && endField) {
        const end = readDate(endField, endFieldId).start;

        event.end = end && end >= event.start ? end : undefined;
        event.isRange = Boolean(event.end);
      }

      return event;
    },
    [
      endClock,
      endField,
      endFieldId,
      hasEndField,
      hasStartField,
      primaryClock,
      primaryField,
      primaryFieldId,
      startClock,
      startField,
      startFieldId,
    ]
  );
  // `complete` once every ordered row has its document: until then a row
  // without a bar may only be one whose date has not arrived.
  const { values, complete } = useTimelineRowValuesSnapshot(parseRow);
  const { events, emptyEvents } = useMemo(() => {
    const events: CalendarEvent[] = [];
    const emptyEvents: CalendarEvent[] = [];

    if (hasStartField && primaryFieldId) {
      (rowOrders ?? []).forEach(({ id }) => {
        const event = values.get(id) ?? { id, rowId: id, title: '', allDay: true };

        (event.start ? events : emptyEvents).push(event);
      });
    }

    return { events, emptyEvents };
  }, [hasStartField, primaryFieldId, rowOrders, values]);

  return { events, emptyEvents, hasEndField, loading: !complete };
}

/**
 * Rows plotted on a date-typed field. Rows without a value (or not yet loaded)
 * land in `emptyEvents`; ranges keep `isRange` so consumers can tell a real end
 * date from the synthetic 30-minute one.
 */
export function useDateFieldEventsSelector(fieldId: string) {
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField, clock: primaryFieldClock } = useFieldSelector(primaryFieldId || '');
  const rowOrders = useRowOrdersSelector();
  const rows = useRowMap();
  const { ensureRow, dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emptyEvents, setEmptyEvents] = useState<CalendarEvent[]>([]);
  // Rows whose document has not arrived cannot be placed: the month is not
  // the result yet. Counted at render, so no frame shows an empty month
  // before the effect below asked for them. A row whose load failed is not
  // waited for (`failedRowIds`, bumping the version to count again).
  const failedRowIdsRef = useRef(new Set<string>());
  const [failedRowsVersion, setFailedRowsVersion] = useState(0);
  const pendingRows = useMemo(() => {
    void failedRowsVersion;
    if (!rowOrders || !ensureRow) return 0;
    return rowOrders.reduce(
      (count, row) => count + (!rows?.[row.id] && !failedRowIdsRef.current.has(row.id) ? 1 : 0),
      0
    );
  }, [ensureRow, failedRowsVersion, rowOrders, rows]);
  // The rows and row orders `events` were read from: until the effect below
  // has read the current ones, the events on screen are the previous result.
  const [eventsReadFrom, setEventsReadFrom] = useState<{ rowOrders: Row[] | undefined; rows: unknown } | null>(
    null
  );

  useEffect(() => {
    if (!field || !rowOrders || !fieldId || !primaryFieldId) {
      setEvents([]);
      setEmptyEvents([]);
      return;
    }

    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

    if (![FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime].includes(fieldType)) {
      setEvents([]);
      setEmptyEvents([]);
      return;
    }

    const failedRowIds = failedRowIdsRef.current;
    const observerEvent = () => {
      const newEvents: CalendarEvent[] = [];
      const emptyEvents: CalendarEvent[] = [];

      rowOrders?.forEach((row) => {
        const doc = rows?.[row.id];

        // If row document isn't loaded yet, trigger loading and add to emptyEvents
        // The event will move to the correct position once the document loads
        if (!doc) {
          if (ensureRow) {
            const promise = ensureRow(row.id);

            if (promise) {
              promise.catch((error: unknown) => {
                console.error('[useCalendarEventsSelector] Failed to ensure row doc:', error);
                if (failedRowIds.has(row.id)) return;
                failedRowIds.add(row.id);
                setFailedRowsVersion((version) => version + 1);
              });
            }
          }

          emptyEvents.push({
            id: `${row.id}`,
            title: '',
            allDay: true,
            rowId: row.id,
          });
          return;
        }

        failedRowIds.delete(row.id);
        const cell = getCell(row.id, fieldId, rows);
        const primaryCell = getCell(row.id, primaryFieldId, rows);
        const title = primaryCell && primaryField ? decodeCellToText(primaryCell, primaryField) : '';

        const rowSharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const databaseRow = rowSharedRoot?.get(YjsEditorKey.database_row);

        if (!databaseRow) return;

        const rowCreatedTime = databaseRow.get(YjsDatabaseKey.created_at).toString();
        const rowLastEditedTime = databaseRow.get(YjsDatabaseKey.last_modified).toString();

        const value = cell ? (parseYDatabaseCellToCell(cell, field) as DateTimeCell) : undefined;
        const allDay = !value?.includeTime;

        if (
          (!value?.data && fieldType !== FieldType.CreatedTime && fieldType !== FieldType.LastEditedTime) ||
          (fieldType === FieldType.CreatedTime && !rowCreatedTime) ||
          (fieldType === FieldType.LastEditedTime && !rowLastEditedTime)
        ) {
          emptyEvents.push({
            id: `${row.id}`,
            title,
            allDay,
            rowId: row.id,
          });
          return;
        }

        const getDate = (timestamp: string) => {
          const dayjsResult = dayjs(timestamp.length === 10 ? Number(timestamp) * 1000 : timestamp);

          return dayjsResult.toDate();
        };

        if ([FieldType.CreatedTime, FieldType.LastEditedTime].includes(fieldType)) {
          newEvents.push({
            id: `${row.id}`,
            start: fieldType === FieldType.CreatedTime ? getDate(rowCreatedTime) : getDate(rowLastEditedTime),
            title,
            allDay,
            rowId: row.id,
          });
        } else if (value) {
          newEvents.push({
            id: `${row.id}`,
            start: getDate(value.data),
            isRange: value.isRange || false,
            end:
              value.endTimestamp && value.isRange
                ? getDate(value.endTimestamp)
                : dayjs(getDate(value.data)).add(30, 'minute').toDate(),
            title,
            allDay,
            rowId: row.id,
          });
        }
      });

      setEvents(newEvents);
      setEmptyEvents(emptyEvents);
      setEventsReadFrom((current) =>
        current?.rowOrders === rowOrders && current.rows === rows ? current : { rowOrders, rows }
      );
    };

    observerEvent();
    if (isHistory) return;

    // The user's own edits (a dropped calendar or timeline bar) re-read at
    // once; remote bursts stay debounced.
    const rowObserver = createLocalFirstObserver(observerEvent, 150);

    // for every row
    rowOrders?.forEach((row) => {
      const rowDoc = rows?.[row.id];

      if (!rowDoc) return;
      rowDoc.getMap(YjsEditorKey.data_section).observeDeep(rowObserver);
    });

    return () => {
      rowObserver.cancel();
      rowOrders?.forEach((row) => {
        const rowDoc = rows?.[row.id];

        if (!rowDoc) return;
        rowDoc.getMap(YjsEditorKey.data_section).unobserveDeep(rowObserver);
      });
    };
  }, [field, fieldClock, rowOrders, rows, fieldId, primaryFieldId, primaryField, primaryFieldClock, ensureRow, isHistory]);

  // The view's rows are still being read, some of their documents have not
  // arrived, or the events have not been read from the rows on hand yet: the
  // month is not the result yet. Never a frame of an empty month in between.
  const eventsStale = rowOrders !== undefined && (eventsReadFrom?.rowOrders !== rowOrders || eventsReadFrom.rows !== rows);

  return { events, emptyEvents, loading: rowOrders === undefined || pendingRows > 0 || eventsStale };
}

export function useCalendarLayoutSetting() {
  const currentUser = useCurrentUser();
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn] || 0);

  const timeFormat = currentUser?.metadata?.[MetadataKey.TimeFormat] || TimeFormat.TwelveHour;
  const { databaseDoc } = useDatabaseContext();

  const viewId = useDatabaseViewId();
  const store = useMemo(
    () => createCalendarLayoutStore(databaseDoc, viewId, startWeekOn, timeFormat === TimeFormat.TwentyFourHour),
    [databaseDoc, viewId, startWeekOn, timeFormat]
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useTimelineLayoutSetting() {
  const currentUser = useCurrentUser();
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn] || 0);
  const timeFormat = currentUser?.metadata?.[MetadataKey.TimeFormat] || TimeFormat.TwelveHour;
  const { databaseDoc } = useDatabaseContext();

  const viewId = useDatabaseViewId();
  const store = useMemo(
    () => createTimelineLayoutStore(databaseDoc, viewId, startWeekOn, timeFormat === TimeFormat.TwentyFourHour),
    [databaseDoc, viewId, startWeekOn, timeFormat]
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Rows, global filters and widget-title flag of the active dashboard view. */
export function useDashboardLayoutSetting() {
  const { databaseDoc } = useDatabaseContext();
  const viewId = useDatabaseViewId();
  const store = useMemo(() => createDashboardLayoutStore(databaseDoc, viewId), [databaseDoc, viewId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const SHOW_WIDGET_TITLES_FLAG = 1;
const SHOW_ICONS_IN_HEADING_FLAG = 2;

/**
 * Only the dashboard's display flags ("Show widget titles", "Show icons in
 * heading"): row or filter edits do not re-render the caller. Both are read
 * through one subscription to one layout store.
 */
export function useDashboardDisplaySettings() {
  const { databaseDoc } = useDatabaseContext();
  const viewId = useDatabaseViewId();
  const store = useMemo(() => createDashboardLayoutStore(databaseDoc, viewId), [databaseDoc, viewId]);
  // A primitive snapshot: it only changes when one of the two flags does.
  const getDisplayFlags = useCallback(() => {
    const { showWidgetTitles, showIconsInHeading } = store.getSnapshot();

    return (showWidgetTitles ? SHOW_WIDGET_TITLES_FLAG : 0) | (showIconsInHeading ? SHOW_ICONS_IN_HEADING_FLAG : 0);
  }, [store]);
  const flags = useSyncExternalStore(store.subscribe, getDisplayFlags, getDisplayFlags);

  return useMemo(
    () => ({
      showWidgetTitles: (flags & SHOW_WIDGET_TITLES_FLAG) !== 0,
      showIconsInHeading: (flags & SHOW_ICONS_IN_HEADING_FLAG) !== 0,
    }),
    [flags]
  );
}

export function getPrimaryFieldId(database: YDatabase) {
  const fields = database?.get(YjsDatabaseKey.fields);

  return Array.from(fields?.keys() || []).find((fieldId) => {
    return fields?.get(fieldId)?.get(YjsDatabaseKey.is_primary);
  });
}

export function usePrimaryFieldId() {
  const database = useDatabase();
  const [primaryFieldId, setPrimaryFieldId] = useState<string | null>(null);

  useEffect(() => {
    setPrimaryFieldId(getPrimaryFieldId(database) || null);
  }, [database]);

  return primaryFieldId;
}

function readRowMeta(rowId: string, rowDoc: YDoc | null): RowMeta | null {
  if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) return null;

  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const yMeta = rowSharedRoot.get(YjsEditorKey.meta) as YDatabaseMetas | undefined;

  return yMeta ? getMetaJSON(rowId, yMeta) : null;
}

export const useRowMetaSelector = (rowId: string) => {
  const { rowMap, ensureRow } = useDatabaseContext();
  const mappedRowDoc = rowMap?.[rowId] ?? null;
  const [resolvedRowDoc, setResolvedRowDoc] = useState<{
    rowId: string;
    mappedRowDoc: YDoc | null;
    rowDoc: YDoc;
  } | null>(null);
  const rowDoc =
    resolvedRowDoc?.rowId === rowId && resolvedRowDoc.mappedRowDoc === mappedRowDoc
      ? resolvedRowDoc.rowDoc
      : mappedRowDoc;

  useEffect(() => retainDatabaseHistoryRow(rowMap, rowDoc ?? undefined), [rowMap, rowDoc]);
  const [observedMeta, setObservedMeta] = useState<{
    rowId: string;
    rowDoc: YDoc;
    value: RowMeta | null;
  } | null>(null);
  const meta =
    observedMeta?.rowId === rowId && observedMeta.rowDoc === rowDoc ? observedMeta.value : readRowMeta(rowId, rowDoc);

  // A seeded row is sufficient for the first paint but is not necessarily the
  // canonical realtime document. Resolve it even when rowMap already has data.
  useEffect(() => {
    let cancelled = false;

    if (ensureRow && rowId) {
      const promise = ensureRow(rowId);

      if (promise) {
        promise
          .then((doc) => {
            if (!cancelled && doc) {
              setResolvedRowDoc({ rowId, mappedRowDoc, rowDoc: doc });
            }
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              console.error('[useRowMetaSelector] Failed to ensure row doc:', error);
            }
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [ensureRow, mappedRowDoc, rowId]);

  // Read meta and observe changes on the row doc.
  // The meta key may not exist initially (empty Y.Map before sync completes),
  // so we observe the shared root to detect when the meta key is added.
  useEffect(() => {
    if (!rowDoc) return;

    // Create the named root before realtime hydration. A remote update mutates
    // this same Y.Map without replacing rowDoc, so waiting for share.has here
    // leaves the hook with no observer and no React state change to retry it.
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    let metaObserverCleanup: (() => void) | null = null;

    const attachMetaObserver = () => {
      // Clean up previous observer if any
      if (metaObserverCleanup) {
        metaObserverCleanup();
        metaObserverCleanup = null;
      }

      const yMeta = rowSharedRoot.get(YjsEditorKey.meta) as YDatabaseMetas | undefined;

      if (!yMeta) {
        setObservedMeta({ rowId, rowDoc, value: null });
        return;
      }

      const updateMeta = () => {
        setObservedMeta({ rowId, rowDoc, value: getMetaJSON(rowId, yMeta) });
      };

      updateMeta();
      yMeta.observeDeep(updateMeta);
      metaObserverCleanup = () => {
        try {
          yMeta.unobserveDeep(updateMeta);
        } catch {
          // Ignore errors from unobserving destroyed Yjs objects
        }
      };
    };

    // Watch for the meta key being added, replaced, or removed.
    const handleRootChange = (event: { keysChanged?: Set<string> }) => {
      if (event.keysChanged?.has(YjsEditorKey.meta)) {
        attachMetaObserver();
      }
    };

    rowSharedRoot.observe(handleRootChange);
    // Try attaching immediately in case meta already exists
    attachMetaObserver();

    return () => {
      if (metaObserverCleanup) {
        metaObserverCleanup();
      }

      rowSharedRoot.unobserve(handleRootChange);
    };
  }, [rowId, rowDoc]);

  return meta;
};

/**
 * Evaluates a formula column for footer calculations: numbers stay numeric so
 * Sum and Average work. Undefined for other fields. The evaluator changes
 * whenever results can change: the schema, member names, or related titles
 * and rollup results arriving.
 */
export function useFormulaColumnEvaluator(fieldId: string, rowSources?: FormulaRowSources) {
  const fields = useDatabaseFields();
  const rowMap = useRowMap();
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const isFormula = Number(field?.get(YjsDatabaseKey.type)) === FieldType.Formula;
  // Only a formula column recalculates when another field changes.
  const fieldsVersion = useDatabaseFieldsVersion(isFormula);
  const database = useDatabase();
  const { databaseDoc, loadView, createRow, getViewIdFromDatabaseId, workspaceId, dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const references = useMemo(() => {
    void fieldsVersion;
    return isFormula && field ? collectFormulaExternalReferences(field, readFormulaSchema(fields)) : NO_EXTERNAL_REFERENCES;
  }, [isFormula, field, fields, fieldsVersion]);

  useFormulaRelationTitles(references.relations, rowSources ?? { rows: rowMap });
  const clock = useFormulaClock(!isHistory && references.clock);
  const { users } = useMentionableUsersWithAutoFetch(!isHistory && references.people);
  const members = useMemo(() => memberNames(isHistory ? [] : users), [users, isHistory]);
  // Related titles and rollup results arrive asynchronously; recalculate once they settle.
  const [externalRevision, setExternalRevision] = useState(0);
  const readsRelatedData = references.relations.length > 0 || references.rollups.length > 0;
  const rollupFieldIds = useMemo(() => references.rollups.map((entry) => entry.id), [references]);
  const refreshRollups = useCallback(() => setExternalRevision((revision) => revision + 1), []);

  useRollupFieldObservers(refreshRollups, fieldsVersion, {
    ...rowSources,
    rollupFieldIds,
    observeConditions: false,
  });

  useEffect(() => {
    if (isHistory || !readsRelatedData) return;
    const bump = debounce(() => setExternalRevision((revision) => revision + 1), 300);
    const unsubscribeLabels = subscribeRelationGroupLabels(bump);
    const unsubscribeRollups = subscribeRollupCache(bump);

    return () => {
      bump.cancel();
      unsubscribeLabels();
      unsubscribeRollups();
    };
  }, [readsRelatedData, isHistory]);

  return useMemo(() => {
    if (!isFormula || !field) return undefined;
    void fieldClock;
    void fieldsVersion;
    void externalRevision;
    void clock;
    const schema = readFormulaSchema(fields);
    const loaders = { loadView, createRow, getViewIdFromDatabaseId, workspaceId };

    return (rowId: string, row: YDatabaseRow): number | string => {
      const result = evaluateFormulaCell({
        ...(isHistory
          ? historicalFormulaRowContext(rowId, row, { database, baseDoc: databaseDoc, rows: rowMap })
          : formulaRowContext(rowId, row, { members, database, baseDoc: databaseDoc, loaders })),
        schema,
        field,
        fieldId,
        row,
        rowId,
      });

      return result.rawNumeric ?? result.text;
    };
  }, [
    isFormula,
    field,
    fieldClock,
    fieldsVersion,
    externalRevision,
    clock,
    fields,
    fieldId,
    members,
    database,
    databaseDoc,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    workspaceId,
    isHistory,
    rowMap,
  ]);
}

export const useFieldCellsByRowsSelector = (fieldId: string, rows?: Row[]) => {
  const [cells, setCells] = useState<Map<string, unknown> | null>(null);
  const rowMap = useRowMap();
  const { dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  // A formula column has no stored cell; the footer calculates over its results.
  const rowIds = useMemo(() => rows?.map(({ id }) => id) ?? [], [rows]);
  const evaluateFormula = useFormulaColumnEvaluator(fieldId, { rows: rowMap, rowIds });

  useEffect(() => {
    if (!rows || !rowMap) {
      setCells(null);
      return;
    }

    const nextCells = new Map<string, unknown>();
    const unobserveCells: Array<() => void> = [];

    rows.forEach((row) => {
      const rowDoc = rowMap?.[row.id];
      const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);

      const databaseRow = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;

      if (!databaseRow) return;

      const cells = databaseRow.get(YjsDatabaseKey.cells);
      const getCellValue = () => {
        if (evaluateFormula) return evaluateFormula(row.id, databaseRow);
        const cell = databaseRow.get(YjsDatabaseKey.cells)?.get(fieldId);

        const value = cell ? parseYDatabaseCellToCell(cell, field).data : '';

        // Aggregations keep values, never a Yjs type that owns the whole row.
        return isHistory && value instanceof AbstractType ? value.toJSON() : value;
      };

      const observerEvent = () => {
        setCells((prev) => {
          const newMap = new Map(prev);

          newMap.set(row.id, getCellValue());

          return newMap;
        });
      };

      nextCells.set(row.id, getCellValue());
      if (isHistory) return;
      // Formula inputs include created/edited timestamps and actors on the row.
      const observed = evaluateFormula ? databaseRow : cells;

      observed?.observeDeep(observerEvent);

      unobserveCells.push(() => {
        observed?.unobserveDeep(observerEvent);
      });
    });

    setCells(nextCells);

    return () => {
      unobserveCells.forEach((unobserverEvent) => {
        unobserverEvent();
      });
    };
  }, [rows, rowMap, fieldId, field, fieldClock, evaluateFormula, isHistory]);

  return {
    cells,
  };
};

export const useFieldCellsSelector = (fieldId: string) => {
  const rows = useRowOrdersSelector();

  return useFieldCellsByRowsSelector(fieldId, rows);
};

export const usePropertiesSelector = (isFilterHidden?: boolean) => {
  const database = useDatabase();
  const view = useDatabaseView();

  const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
  const fields = database?.get(YjsDatabaseKey.fields);
  const [hiddenProperties, setHiddenProperties] = useState<
    {
      id: string;
      visible: boolean;
      name: string;
      type: FieldType;
    }[]
  >([]);
  const [properties, setProperties] = useState<{ id: string; visible: boolean; name: string; type: FieldType }[]>([]);

  useEffect(() => {
    if (!fieldOrders) return;

    const observeEvent = () => {
      const newProperties: {
        id: string;
        visible: boolean;
        name: string;
        type: FieldType;
      }[] = [];
      const hiddenProperties: {
        id: string;
        visible: boolean;
        name: string;
        type: FieldType;
      }[] = [];

      fieldOrders.toArray().forEach((item) => {
        const fieldSetting = fieldSettings?.get(item.id);
        const visible = fieldSetting
          ? Number(fieldSetting.get(YjsDatabaseKey.visibility)) !== FieldVisibility.AlwaysHidden
          : true;
        const field = fields?.get(item.id);

        if (!visible) {
          hiddenProperties.push({
            id: item.id,
            name: field?.get(YjsDatabaseKey.name) || '',
            visible,
            type: Number(field?.get(YjsDatabaseKey.type)) as FieldType,
          });
        }

        if (isFilterHidden && !visible) {
          return;
        } else {
          newProperties.push({
            id: item.id,
            name: field?.get(YjsDatabaseKey.name) || '',
            visible,
            type: Number(field?.get(YjsDatabaseKey.type)) as FieldType,
          });
        }
      });

      setProperties(newProperties);
      setHiddenProperties(hiddenProperties);
    };

    observeEvent();

    fields.observeDeep(observeEvent);
    fieldOrders.observeDeep(observeEvent);
    fieldSettings?.observeDeep(observeEvent);

    return () => {
      fields.unobserveDeep(observeEvent);
      fieldOrders.unobserveDeep(observeEvent);
      fieldSettings?.unobserveDeep(observeEvent);
    };
  }, [fieldOrders, fieldSettings, fields, isFilterHidden]);

  return {
    properties,
    hiddenProperties,
  };
};

export const useDateTimeCellString = (cell: DateTimeCell | undefined, fieldId: string) => {
  const currentUser = useCurrentUser();
  const { field, clock } = useFieldSelector(fieldId);

  return useMemo(() => {
    if (!cell) return null;
    return getDateCellStr({ cell, field, currentUser });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, field, clock, currentUser]);
};

export const useRowTimeString = (rowId: string, fieldId: string, attrName: string) => {
  const currentUser = useCurrentUser();
  const { field, clock } = useFieldSelector(fieldId);

  const typeOptionValue = useMemo(() => {
    const typeOption = getTypeOptions(field);

    const { dateFormat, timeFormat } = getFieldDateTimeFormats(typeOption, currentUser);
    const includeTimeRaw = typeOption?.get(YjsDatabaseKey.include_time);

    return {
      dateFormat,
      timeFormat,
      includeTime: typeof includeTimeRaw === 'boolean' ? includeTimeRaw : Boolean(includeTimeRaw),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock, currentUser?.metadata]);

  const getDateTimeStr = useCallback(
    (timeStamp: string, includeTime?: boolean) => {
      if (!typeOptionValue || !timeStamp) return null;
      const timeFormat = getTimeFormat(typeOptionValue.timeFormat);
      const dateFormat = getDateFormat(typeOptionValue.dateFormat);
      const format = [dateFormat];

      if (includeTime || typeOptionValue.includeTime) {
        format.push(timeFormat);
      }

      return renderDate(timeStamp, format.join(' '), true);
    },
    [typeOptionValue]
  );

  const { row: rowData } = useRowDataSelector(rowId);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (!rowData) return;
    const observeHandler = () => {
      setValue(rowData.get(attrName));
    };

    observeHandler();

    rowData.observe(observeHandler);
    return () => {
      rowData.unobserve(observeHandler);
    };
  }, [rowData, attrName]);

  const time = useMemo(() => {
    if (!value) return null;
    return getDateTimeStr(value);
  }, [value, getDateTimeStr]);

  return time;
};

export const useSelectFieldOptions = (fieldId: string, searchValue?: string) => {
  const { field, clock } = useFieldSelector(fieldId);

  return useMemo(() => {
    const typeOption = field ? parseSelectOptionTypeOptions(field) : null;

    if (!typeOption) return [] as SelectOption[];

    const normalizedOptions = typeOption.options.filter((option) => {
      return Boolean(option && option.id);
    });

    return normalizedOptions.filter((option) => {
      const optionName = typeof option.name === 'string' ? option.name : '';

      if (!searchValue) return true;
      return optionName.toLowerCase().includes(searchValue.toLowerCase());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, searchValue, clock]);
};

export function useRowPrimaryContentSelector(rowDoc: YDoc | null, primaryFieldId: string) {
  const [primaryContent, setPrimaryContent] = useState<string | null>(null);
  const { field, clock: fieldClock } = useFieldSelector(primaryFieldId);

  const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
  const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;

  useEffect(() => {
    const observerEvent = () => {
      if (!row) {
        setPrimaryContent(null);
        return;
      }

      const cell = row.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

      if (!cell) {
        setPrimaryContent(null);
        return;
      }

      setPrimaryContent(field ? decodeCellToText(cell, field) : String(parseYDatabaseCellToCell(cell).data ?? ''));
    };

    observerEvent();

    row?.observeDeep(observerEvent);

    return () => {
      row?.unobserveDeep(observerEvent);
    };
  }, [primaryFieldId, row, rowDoc, field, fieldClock]);

  return primaryContent;
}

/**
 * Display names of person, created-by / last-edited-by and relation group ids,
 * shared by board groups and chart categories (WP11): Person ids from the
 * field's type option, then the workspace members (name, else email); user
 * uids (canonical) from the members; relation row ids through
 * `readRelationLabel`. Ids without a name are left out.
 */
export function buildIdentifierLabels({
  fieldType,
  field,
  mentionableUsers,
  relationIds = [],
  readRelationLabel,
}: {
  fieldType: FieldType;
  field: YDatabaseField;
  mentionableUsers: ReadonlyArray<Pick<MentionablePerson, 'person_id' | 'uid' | 'name' | 'email'>>;
  relationIds?: readonly string[];
  readRelationLabel?: (id: string) => string;
}): Map<string, string> {
  const identifierLabels = new Map<string, string>();

  if (fieldType === FieldType.Person) {
    // Seed from the field's own type option once. getGroupLabel falls back to
    // parsing it per group otherwise, which is a JSON.parse for every header.
    parsePersonTypeOptions(field).persons.forEach((person) => {
      const label = person.name?.trim();

      if (label) identifierLabels.set(person.id, label);
    });
    mentionableUsers.forEach((person) => {
      const label = person.name?.trim() || person.email?.trim();

      if (label) identifierLabels.set(person.person_id, label);
    });
  } else if (fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy) {
    mentionableUsers.forEach((person) => {
      const label = person.name?.trim() || person.email?.trim();
      const uid = canonicalizeUserUid(person.uid);

      if (label && uid) identifierLabels.set(uid, label);
    });
  } else if (fieldType === FieldType.Relation && readRelationLabel) {
    relationIds.forEach((id) => {
      const label = readRelationLabel(id);

      if (label) identifierLabels.set(id, label);
    });
  }

  return identifierLabels;
}

function chartSettingsEqual(a: ChartLayoutSettings | null, b: ChartLayoutSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.chartType === b.chartType &&
    a.xFieldId === b.xFieldId &&
    a.showEmptyValues === b.showEmptyValues &&
    a.aggregationType === b.aggregationType &&
    a.yFieldId === b.yFieldId &&
    a.cumulative === b.cumulative &&
    a.dateCondition === b.dateCondition &&
    a.numberFormat === b.numberFormat &&
    a.titleText === b.titleText &&
    // The `chart-extended-settings.ts` keys compare there, so chart packages add keys without editing this file.
    sameChartExtendedSettings(a.extended, b.extended)
  );
}

/**
 * Subscribe to the chart layout setting persisted at
 * `view.layout_settings['3']`.
 *
 * Uses `observeDeep` on the view to robustly catch initial Yjs sync (which
 * may deliver layout_settings + its '3' key via nested deltas that wouldn't
 * fire a direct `observe` on the view). The expensive part — re-rendering
 * downstream consumers — is gated by `chartSettingsEqual`, so the wider
 * observer only costs a handful of equality checks per Yjs event.
 *
 * Returns the strongly-typed `ChartLayoutSettings` (see
 * `parseChartLayoutSettings` for the key fallback and defaults).
 */
export function useChartLayoutSetting(): ChartLayoutSettings | null {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [setting, setSetting] = useState<ChartLayoutSettings | null>(null);

  useEffect(() => {
    const view = database.get(YjsDatabaseKey.views)?.get(viewId);

    if (!view) return;

    const observerHandler = () => {
      const chartSettingMap = view.get(YjsDatabaseKey.layout_settings)?.get('3') as
        | YDatabaseChartLayoutSetting
        | undefined;

      if (!chartSettingMap) {
        setSetting((prev) => (prev === null ? prev : null));
        return;
      }

      const next = parseChartLayoutSettings(chartSettingMap);

      setSetting((prev) => (chartSettingsEqual(prev, next) ? prev : next));
    };

    observerHandler();
    view.observeDeep(observerHandler);

    return () => {
      view.unobserveDeep(observerHandler);
    };
  }, [database, viewId]);

  return setting;
}

function readGalleryLayoutSettings(view?: YDatabaseView): GalleryLayoutSettings {
  const map = view?.get(YjsDatabaseKey.layout_settings)?.get('5');
  const coverFieldId = map?.get(YjsDatabaseKey.cover_field_id);

  return {
    // Flutter Desktop always renders Gallery covers and writes true whenever
    // settings are saved. Ignore stale cross-client false values so existing
    // cards and the add-row card keep the same geometry.
    showCover: true,
    fitImage: map?.get(YjsDatabaseKey.fit_image) ?? DEFAULT_GALLERY_LAYOUT_SETTINGS.fitImage,
    cardSize: Number(map?.get(YjsDatabaseKey.card_size) ?? DEFAULT_GALLERY_LAYOUT_SETTINGS.cardSize) as GalleryCardSize,
    cardWidth: Number(map?.get(YjsDatabaseKey.card_width) ?? DEFAULT_GALLERY_LAYOUT_SETTINGS.cardWidth),
    cardPreview: Number(
      map?.get(YjsDatabaseKey.card_preview) ?? DEFAULT_GALLERY_LAYOUT_SETTINGS.cardPreview
    ) as GalleryCardPreview,
    coverFieldId: coverFieldId ? String(coverFieldId) : undefined,
  };
}

/** Subscribe to Desktop-compatible Gallery settings at `layout_settings['5']`. */
export function useGalleryLayoutSettings(): GalleryLayoutSettings {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database.get(YjsDatabaseKey.views)?.get(viewId);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!view) return () => undefined;

      view.observeDeep(onStoreChange);
      return () => view.unobserveDeep(onStoreChange);
    },
    [view]
  );
  const getSnapshot = useCallback(() => JSON.stringify(readGalleryLayoutSettings(view)), [view]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => JSON.parse(snapshot) as GalleryLayoutSettings, [snapshot]);
}
