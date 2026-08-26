import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { isUngroupedColumnHidden, resolveBoardColumnVisibility } from '@/application/database-yjs/board-visibility';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell, RollupCell } from '@/application/database-yjs/cell.type';
import { hasRowConditionData, invalidateRowConditionCache } from '@/application/database-yjs/condition-value-cache';
import { DEFAULT_FIELD_WRAP, getCell, MIN_COLUMN_WIDTH } from '@/application/database-yjs/const';
import {
  useDatabase,
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useDatabaseViewId,
  useRow,
  useRowMap,
} from '@/application/database-yjs/context';
import { decodeCellToText } from '@/application/database-yjs/decode';
import {
  getDateCellStr,
  getFieldDateTimeFormats,
  getTypeOptions,
  parsePersonTypeOptions,
  parseRelationTypeOption,
  parseRollupTypeOption,
  parseRollupVisualizationOption,
  parseSelectOptionTypeOptions,
  SelectOption,
} from '@/application/database-yjs/fields';
import {
  filterBy,
  flattenFilterTree,
  getEffectiveFiltersSnapshot,
  hasEffectiveFilters,
  parseFilter,
} from '@/application/database-yjs/filter';
import { DEFAULT_GALLERY_LAYOUT_SETTINGS } from '@/application/database-yjs/gallery-layout';
import {
  areGroupRowsHydrated,
  getGroupColumns,
  getGroupLabel,
  groupByField,
  isDatabaseGroupableFieldType,
  isDynamicDatabaseGroupFieldType,
} from '@/application/database-yjs/group';
import { canonicalizeUserUid } from '@/application/user-uid';
import {
  hasPendingLocalDatabaseGroupInitialization,
  normalizeDatabaseGroupColumn,
  normalizeUniqueDatabaseGroupColumns,
} from '@/application/database-yjs/group-column';
import type { DatabaseGroupColumn } from '@/application/database-yjs/group-column';
import {
  type BackgroundRowDocChange,
  useBackgroundRowDocLoader,
  useRollupFieldObservers,
} from '@/application/database-yjs/hooks';
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
import {
  invalidateRollupCell,
  readRollupCell,
  readRollupCellSync,
  RollupCellValue,
  subscribeRollupCell,
  subscribeRollupCache,
} from '@/application/database-yjs/rollup/cache';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { sortBy } from '@/application/database-yjs/sort';
import {
  DatabaseViewLayout,
  FieldId,
  GalleryCardPreview,
  GalleryCardSize,
  GalleryLayoutSettings,
  RowId,
  SortId,
  TimeFormat,
  YDatabase,
  YDatabaseChartLayoutSetting,
  YDatabaseField,
  YDatabaseFields,
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
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { ChartLayoutSettings } from './chart.type';
import {
  CalendarLayoutSetting,
  CalculationType,
  DateGroupCondition,
  FieldType,
  FieldVisibility,
  Filter,
  FilterType,
  RowMeta,
  RollupDisplayMode,
  SortCondition,
} from './database.type';

import type { Transaction, YEvent } from 'yjs';

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

function getConditionSignature(sorts?: YDatabaseSorts, filters?: YDatabaseFilters, fields?: YDatabaseFields) {
  const effectiveFilters = getEffectiveFiltersSnapshot(filters, fields);
  const hasConditions = (sorts?.length ?? 0) > 0 || effectiveFilters.length > 0;

  if (!hasConditions) return '';

  return stringifyConditionSignature({
    filters: effectiveFilters,
    sorts: sorts?.toJSON?.() ?? [],
  });
}

const CONDITION_ROW_LOAD_BATCH_SIZE = 24;
const defaultVisible = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty];

type ConditionReference = { id: string; fieldId: string };

function areConditionReferencesEqual(left: ConditionReference[], right: ConditionReference[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const rightItem = right[index];

      return item.id === rightItem?.id && item.fieldId === rightItem.fieldId;
    })
  );
}

/**
 * Hook to get all database views (tabs) for the database.
 * @param databasePageId - The main database page ID in the folder structure
 * @param visibleViewIds - Optional filter for embedded databases to show only specific views
 */
export function useDatabaseViewsSelector(databasePageId: string, visibleViewIds?: string[]) {
  const database = useDatabase();

  const views = database?.get(YjsDatabaseKey.views);
  const [viewIds, setViewIds] = useState<string[]>([]);
  const [childViews, setChildViews] = useState<ReturnType<typeof views.get>[]>([]);

  // Stabilize visibleViewIds reference to avoid unnecessary effect re-runs
  const visibleViewIdsKey = visibleViewIds?.join(',') ?? '';

  useEffect(() => {
    if (!views) return;

    // Parse the stabilized key back to array (or undefined)
    const stableVisibleViewIds = visibleViewIdsKey ? visibleViewIdsKey.split(',') : undefined;

    const observerEvent = () => {
      const viewsObj = views.toJSON() as Record<
        string,
        {
          created_at: string;
        }
      >;

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
      let allViewIds = Object.keys(viewsObj).filter((viewId) => {
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
      }

      setViewIds(allViewIds);
      setChildViews(allViewIds.map((viewId) => views.get(viewId)));
    };

    observerEvent();
    views.observeDeep(observerEvent);

    return () => {
      views.unobserveDeep(observerEvent);
    };
  }, [views, visibleViewIdsKey]);

  return {
    childViews,
    viewIds,
  };
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
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
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
  const viewId = useDatabaseViewId();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const filter = view
    ?.get(YjsDatabaseKey.filters)
    ?.toArray()
    .find((filter) => filter.get(YjsDatabaseKey.id) === filterId);
  const [filterValue, setFilterValue] = useState<Filter | null>(null);

  useEffect(() => {
    if (!filter || !fields) {
      setFilterValue(null);
      return;
    }

    const observerEvent = () => {
      const field = fields.get(filter.get(YjsDatabaseKey.field_id));

      if (!field) {
        setFilterValue(null);
        return;
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      setFilterValue(parseFilter(fieldType, filter));
    };

    observerEvent();
    fields.observeDeep(observerEvent);
    filter.observeDeep(observerEvent);
    return () => {
      fields.unobserveDeep(observerEvent);
      filter.unobserveDeep(observerEvent);
    };
  }, [fields, filter]);
  return filterValue;
}

const DEFAULT_ROOT_INFO = { isHierarchical: false, rootType: null, childCount: 0 } as const;

/**
 * Returns information about the root filter structure for determining if advanced mode should be enabled
 */
export function useRootFilterInfo() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
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
  const viewId = useDatabaseViewId();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
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

            return undefined;
          },
        };

        const parsed = parseFilter(ft, proxy as Parameters<typeof parseFilter>[1]);

        return {
          ...parsed,
          operator: draft.operator,
          fieldType: ft,
          rollupTargetFieldType: draft.rollupTargetFieldType,
        } as Filter;
      });

      setFilters(parsedFilters);
    };

    observerEvent();
    filtersArray.observeDeep(observerEvent);

    return () => {
      filtersArray.unobserveDeep(observerEvent);
    };
  }, [fields, filtersArray]);

  return filters;
}

/**
 * Returns a single filter from the advanced mode children array
 */
export function useAdvancedFilterSelector(filterId: string) {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const fields = database?.get(YjsDatabaseKey.fields);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
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

      setFilterValue(parseFilter(fieldType, filterProxy as Parameters<typeof parseFilter>[1]));
    };

    observerEvent();
    filtersArray.observeDeep(observerEvent);

    return () => {
      filtersArray.unobserveDeep(observerEvent);
    };
  }, [fields, filterId, filtersArray]);

  return filterValue;
}

export function useSortsSelector() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
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
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [sortValue, setSortValue] = useState<Sort | null>(null);
  const views = database?.get(YjsDatabaseKey.views);
  const view = views?.get(viewId);
  const sort = view
    ?.get(YjsDatabaseKey.sorts)
    ?.toArray()
    .find((sort) => sort.get(YjsDatabaseKey.id) === sortId);

  useEffect(() => {
    if (!sort) {
      setSortValue(null);
      return;
    }

    const observerEvent = () => {
      setSortValue({
        fieldId: sort.get(YjsDatabaseKey.field_id),
        condition: Number(sort.get(YjsDatabaseKey.condition)),
        id: sort.get(YjsDatabaseKey.id),
      });
    };

    observerEvent();
    sort.observe(observerEvent);

    return () => {
      sort.unobserve(observerEvent);
    };
  }, [sort]);

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

function getFallbackGroupColumns(field?: YDatabaseField): GroupColumn[] {
  if (!field) return [];

  return (getGroupColumns(field) ?? []).map((column) => ({
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

export function useBoardLayoutSettings() {
  const view = useDatabaseView();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hideUnGroup, setHideUnGroup] = useState(false);
  const [hideEmptyGroups, setHideEmptyGroups] = useState(false);
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

  return {
    isCollapsed,
    hideUnGroup,
    hideEmptyGroups,
    shownEmptyGroupIds,
    fieldId,
    ungroupedColumnHidden,
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

export function useRowsByGroup(groupId: string) {
  const { columns, fieldId } = useGroup(groupId);
  const rows = useRowMap();
  const rowOrders = useRowOrdersSelector();
  const viewId = useDatabaseViewId();
  const { databaseDoc } = useDatabaseContext();
  const { cachedRowDocs } = useBackgroundRowDocLoader(Boolean(fieldId), 'board-grouping');
  const groupingRows = useMemo(() => {
    const next = { ...cachedRowDocs };

    Object.entries(rows ?? {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows]);

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

  useEffect(() => {
    if (!fieldId || !rowOrders) {
      setGroupResult(new Map());
      return;
    }

    const onConditionsChange = () => {
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

      const groupResult = groupByField(rowOrders, groupingRows, field, filter);

      if (!groupResult) {
        setGroupResult(newResult);
        return;
      }

      setGroupResult(groupResult);
      const rowsHydrated = areGroupRowsHydrated(rowOrders, groupingRows);

      if (rowsHydrated && groupingKey) {
        setHydratedGroupingIdentity((current) =>
          current?.databaseDoc === databaseDoc && current.groupingKey === groupingKey
            ? current
            : { databaseDoc, groupingKey }
        );
      }
    };

    onConditionsChange();

    fields.observeDeep(onConditionsChange);
    filters?.observeDeep(onConditionsChange);

    const debouncedConditionsChange = debounce(onConditionsChange, 150);

    const observerRowsEvent = () => {
      debouncedConditionsChange();
    };

    Object.values(groupingRows).forEach((row) => {
      row.getMap(YjsEditorKey.data_section).observeDeep(observerRowsEvent);
    });
    return () => {
      debouncedConditionsChange.cancel();

      fields.unobserveDeep(onConditionsChange);
      filters?.unobserveDeep(onConditionsChange);
      Object.values(groupingRows).forEach((row) => {
        row.getMap(YjsEditorKey.data_section).unobserveDeep(observerRowsEvent);
      });
    };
  }, [databaseDoc, fieldId, fields, rowOrders, groupingRows, filters, groupingKey]);

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
  /** The filtered and sorted rows used to build group membership. */
  rowOrders?: Row[];
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

function getNumberGroupStart(groupId: string) {
  const match = /^number_range_(-?\d+(?:\.\d+)?)_/.exec(groupId);

  return match ? Number(match[1]) : undefined;
}

function orderNumberGroupIds(groupIds: string[], defaultGroupId: string) {
  return [...groupIds].sort((left, right) => {
    if (left === defaultGroupId) return -1;
    if (right === defaultGroupId) return 1;

    const leftStart = getNumberGroupStart(left);
    const rightStart = getNumberGroupStart(right);

    if (leftStart === undefined) return rightStart === undefined ? 0 : 1;
    if (rightStart === undefined) return -1;
    return leftStart - rightStart;
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
    createRow,
    getCellLocalMutationRevision,
    getViewIdFromDatabaseId,
    hasCellLocalMutation,
    loadView,
    subscribeToCellLocalMutations,
  } = useDatabaseContext();
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const database = useDatabase();
  const fields = useDatabaseFields();
  const rowOrders = useRowOrdersSelector();
  const rows = useRowMap();
  const persistedGroups = view?.get(YjsDatabaseKey.groups);
  const persistedGroup = persistedGroups?.toArray()?.[0];
  const fieldId = persistedGroup?.get(YjsDatabaseKey.field_id);
  const persistedGroupingField = fieldId ? fields?.get(fieldId) : undefined;
  const persistedGroupingFieldType = Number(persistedGroupingField?.get(YjsDatabaseKey.type)) as FieldType;
  const isPersonGroupingField = [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(
    persistedGroupingFieldType
  );
  const { users: mentionableUsers } = useMentionableUsersWithAutoFetch(isPersonGroupingField);
  const rawRowOrders = view?.get(YjsDatabaseKey.row_orders);
  const inlineRowOrders = getInlineViewRowOrders(database);
  const { cachedRowDocs, getCachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(
    Boolean(fieldId),
    `${layout === DatabaseViewLayout.List ? 'list' : 'grid'}-grouping`
  );
  const groupingRows = useMemo(() => {
    const next = { ...cachedRowDocs };

    Object.entries(rows ?? {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows]);
  const groupingRowsStore = useMemo(() => {
    // The same database field can group multiple views; each view owns its
    // observer lifecycle even when the field ID is identical.
    void viewId;
    return createDatabaseGroupingRowsStore(fieldId);
  }, [fieldId, viewId]);

  useLayoutEffect(() => {
    // Live row-map changes are small and may be followed by another layout
    // effect that edits a cell, so close that commit-phase observation gap.
    groupingRowsStore.replaceLiveRows(rows ?? {});
  }, [groupingRowsStore, rows]);
  useEffect(() => {
    // Seed hydration publishes bounded add/remove deltas before its React
    // snapshot. Subscribe once instead of rescanning every accumulated seed doc
    // in a layout effect for each 128-row batch.
    const unsubscribe = subscribeToCachedRowDocChanges(groupingRowsStore.applyCachedRowsChange);

    groupingRowsStore.replaceCachedRows(getCachedRowDocs());
    return unsubscribe;
  }, [getCachedRowDocs, groupingRowsStore, subscribeToCachedRowDocChanges]);
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
  const groupsByRelation = persistedGroupingFieldType === FieldType.Relation;
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

  const grouping = useMemo(() => {
    void groupingViewRevision;
    void cellLocalMutationRevision;
    void relationGroupLabelRevision;

    const group = view?.get(YjsDatabaseKey.groups)?.toArray()?.[0];
    const currentFieldId = group?.get(YjsDatabaseKey.field_id);
    const field = currentFieldId ? fields?.get(currentFieldId) : undefined;
    const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

    if (!group || !field || !isDatabaseGroupableFieldType(fieldType)) {
      return { ...EMPTY_DATABASE_GROUPING, rowOrders };
    }

    const groupingFieldId = field.get(YjsDatabaseKey.id);
    const content = group.get(YjsDatabaseKey.content);
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
    const persistedColumns = normalizeUniqueDatabaseGroupColumns(rawColumns);
    const fallbackColumns = getFallbackGroupColumns(field);
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
    const orderedIds =
      fieldType === FieldType.Number
        ? orderNumberGroupIds(persistedAndDerivedIds, groupingFieldId)
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
    const orderedMetadataGroupIds =
      fieldType === FieldType.Number ? orderNumberGroupIds(metadataGroupIds, groupingFieldId) : metadataGroupIds;

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
      primarySortCondition === undefined
        ? orderedIds
        : orderDatabaseGroupsForPrimarySort(orderedIds, result, rowOrders, primarySortCondition);
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
    } else if (fieldType === FieldType.Relation) {
      displayIds.forEach((id) => {
        if (id === currentFieldId) return;

        const label = readRelationGroupLabel({ relationField: field, relatedRowId: id });

        if (label) identifierLabels.set(id, label);
      });
    }

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
        (hideEmptyGroups || (id !== currentFieldId && isDynamicDatabaseGroupFieldType(fieldType)));

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
    groupingViewRevision,
    hasCellLocalMutation,
    layout,
    metadataSyncKey,
    mentionableUsers,
    relationGroupLabelRevision,
    cellLocalMutationRevision,
    rowOrders,
    rowsHydrated,
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
    if (!groupingField || !relationDatabaseId || !relationGroupLabelIds) return;

    return retainRelationGroupLabels(
      relationGroupLabelIds.map((relatedRowId) => ({ relationField: groupingField, relatedRowId }))
    );
  }, [groupingField, relationDatabaseId, relationGroupLabelIds]);

  useEffect(() => {
    // Resolving a title loads a related document, so it belongs after commit
    // rather than inside the memo. Each resolution publishes on the group-label
    // channel, which brings the memo back through relationGroupLabelRevision.
    void relationGroupLabelRevision;
    if (!groupingField || !relationDatabaseId || !relationGroupLabelIds) return;

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
  ]);

  return grouping;
}

export function useGridGroupingSelector(): GridGrouping {
  return useDatabaseGroupingSelector(DatabaseViewLayout.Grid);
}

export function useListGroupingSelector(): DatabaseGrouping {
  return useDatabaseGroupingSelector(DatabaseViewLayout.List);
}

/**
 * Hook to get sorted and filtered row orders.
 *
 * This hook is composed of smaller, focused hooks (like BLoC pattern):
 * - useBackgroundRowDocLoader: Handles background loading of row docs
 * - useRollupFieldObservers: Handles rollup field change observers
 *
 * The main hook handles:
 * - Applying sorts and filters to row orders
 * - Observing data changes to trigger re-computation
 */
export function useRowOrdersSelector() {
  const rows = useRowMap();
  const view = useDatabaseView();
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const viewId = useDatabaseViewId();
  const sorts = view?.get(YjsDatabaseKey.sorts);
  const fields = useDatabaseFields();
  const filters = view?.get(YjsDatabaseKey.filters);
  const database = useDatabase();
  const inlineRowOrders = getInlineViewRowOrders(database);
  const {
    databaseDoc,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    ensureRow,
    loadRowFromSeed,
    blobPrefetchComplete,
    seedsReady,
  } = useDatabaseContext();
  const hasAttributionSort =
    sorts?.toArray().some((sort) => {
      const field = fields?.get(sort.get(YjsDatabaseKey.field_id));
      const fieldType = Number(field?.get(YjsDatabaseKey.type));

      return fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;
    }) ?? false;
  const { users: conditionMentionableUsers } = useMentionableUsersWithAutoFetch(hasAttributionSort);
  const attributionNameByUid = useMemo(() => {
    const names = new Map<string, string>();

    conditionMentionableUsers.forEach((person) => {
      const name = person.name?.trim() || person.email?.trim();
      const uid = canonicalizeUserUid(person.uid);

      if (name && uid) names.set(uid, name);
    });

    return names;
  }, [conditionMentionableUsers]);
  const attributionNameGetter = useCallback((uid: string) => attributionNameByUid.get(uid), [attributionNameByUid]);

  const [rowOrdersState, setRowOrdersState] = useState<{
    rows?: Row[];
    conditionSignature: string;
  }>({ conditionSignature: '' });
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

  // Check if there are active conditions
  const hasConditions = (sorts?.length ?? 0) > 0 || hasEffectiveFilters(filters, fields);

  // Background loading of row docs for sorting/filtering
  const { cachedRowDocs } = useBackgroundRowDocLoader(hasConditions);

  // Merge cached docs with main rowMap.
  // useDeferredValue lets React treat the filter/sort recompute as low-priority
  // so a burst of cache updates coalesces into fewer renders — React will
  // abandon in-progress filter work when a newer snapshot arrives.
  const rowDocsForConditionsRaw = useMemo(() => {
    const next = { ...cachedRowDocs };

    Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
      if (hasRowConditionData(rowDoc) || !next[rowId]) {
        next[rowId] = rowDoc;
      }
    });

    return next;
  }, [cachedRowDocs, rows]);
  const rowDocsForConditions = useDeferredValue(rowDocsForConditionsRaw);
  const rowDocsForConditionsRef = useRef(rowDocsForConditions);

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
    const conditionStateKey = `${viewId ?? ''}:${conditionSignature}`;
    const currentHasConditions = conditionSignature !== '';

    if (conditionSignatureRef.current !== conditionStateKey) {
      conditionSignatureRef.current = conditionStateKey;
      filtersAppliedRef.current = false;
      pendingConditionRowLoadsRef.current.clear();
      unavailableConditionRowsRef.current.clear();
    }

    if (currentHasConditions) return false;

    filtersAppliedRef.current = false;
    setRowOrdersState({ rows: originalRowOrders, conditionSignature: conditionStateKey });
    return true;
  }, [fields, filters, readVisibleRowOrders, sorts, viewId]);

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
    [rowDocsForConditions, fields, database, databaseDoc, loadView, createRow, getViewIdFromDatabaseId]
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
    [rowDocsForConditions, fields, database, databaseDoc, loadView, createRow, getViewIdFromDatabaseId]
  );

  const rollupTextGetter = useCallback(
    (rowId: string, fieldId: string) => {
      return rollupValueGetter(rowId, fieldId).value;
    },
    [rollupValueGetter]
  );

  // Main computation: apply sorts and filters to row orders
  const onConditionsChange = useCallback(() => {
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
    const conditionStateKey = `${viewId ?? ''}:${conditionSignature}`;
    const currentHasConditions = conditionSignature !== '';

    if (conditionSignatureRef.current !== conditionStateKey) {
      conditionSignatureRef.current = conditionStateKey;
      filtersAppliedRef.current = false;
      pendingConditionRowLoadsRef.current.clear();
      unavailableConditionRowsRef.current.clear();
    }

    if (!currentHasConditions) {
      filtersAppliedRef.current = false;
      setRowOrdersState({ rows: originalRowOrders, conditionSignature: conditionStateKey });
      logConditionCompute(originalRowOrders.length, originalRowOrders.length);

      return;
    }

    const rowsWithDocs = originalRowOrders.filter((row) => hasRowConditionData(rowDocsForConditions[row.id]));
    const unresolvedRows = originalRowOrders.filter(
      (row) => !hasRowConditionData(rowDocsForConditions[row.id]) && !unavailableConditionRowsRef.current.has(row.id)
    );

    // Keep conditioned views in an explicit loading state until every row can
    // be evaluated. Otherwise an early zero-match partial result renders as a
    // blank grid, which looks like the database finished with no rows.
    if (unresolvedRows.length > 0) {
      requestMissingConditionRows(unresolvedRows);

      if (!filtersAppliedRef.current) {
        setRowOrdersState({ rows: undefined, conditionSignature: conditionStateKey });
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

          return { rows: retainedRows, conditionSignature: conditionStateKey };
        });
      }

      logConditionCompute(rowsWithDocs.length);
      return;
    }

    let computedRowOrders: Row[] | undefined;

    if (sorts?.length) {
      computedRowOrders = sortBy(rowsWithDocs, sorts, fields, rowDocsForConditions, {
        getRelationCellText: relationTextGetter,
        getRollupCellValue: rollupValueGetter,
        getAttributionName: attributionNameGetter,
      });
    }

    if (filters?.length) {
      computedRowOrders = filterBy(computedRowOrders ?? rowsWithDocs, filters, fields, rowDocsForConditions, {
        getRelationCellText: relationTextGetter,
        getRollupCellText: rollupTextGetter,
        getRollupCellValue: rollupValueGetter,
      });
    }

    const nextRowOrders = computedRowOrders ?? rowsWithDocs;

    filtersAppliedRef.current = true;
    setRowOrdersState({ rows: nextRowOrders, conditionSignature: conditionStateKey });
    logConditionCompute(rowsWithDocs.length, nextRowOrders.length);
  }, [
    fields,
    attributionNameGetter,
    filters,
    rowDocsForConditions,
    sorts,
    readVisibleRowOrders,
    relationTextGetter,
    rollupValueGetter,
    rollupTextGetter,
    requestMissingConditionRows,
    viewId,
  ]);

  // Trigger computation when dependencies change
  useEffect(() => {
    onConditionsChange();
  }, [conditionLoadRevision, onConditionsChange]);

  // Subscribe to relation/rollup cache changes
  useEffect(() => {
    const handleCacheChange = debounce(onConditionsChange, 200);
    const unsubscribeRelation = subscribeRelationCache(() => handleCacheChange());
    const unsubscribeRollup = subscribeRollupCache(() => handleCacheChange());

    return () => {
      handleCacheChange.cancel();
      unsubscribeRelation();
      unsubscribeRollup();
    };
  }, [onConditionsChange]);

  // Observe Yjs data changes
  useEffect(() => {
    // Single debounced handler for all data changes (consolidated from 4 separate debounced callbacks)
    const debouncedChange = debounce(() => {
      setRollupWatchVersion((prev) => prev + 1);
      onConditionsChange();
    }, 200);

    const handleRowOrdersChange = (_events: unknown, transaction: Transaction) => {
      // Row mutations normally update every view in one Yjs transaction. The
      // selected and inline observers therefore receive the same transaction;
      // reconcile it once instead of serializing both row-order arrays twice.
      if (lastProcessedRowOrderTransactionRef.current === transaction) return;

      lastProcessedRowOrderTransactionRef.current = transaction;

      if (!syncUnconditionedRowOrders()) {
        debouncedChange();
      }
    };

    rowOrders?.observeDeep(handleRowOrdersChange);
    if (inlineRowOrders !== rowOrders) {
      inlineRowOrders?.observeDeep(handleRowOrdersChange);
    }

    const observers = new Map<string, () => void>();
    let relationFieldIds: string[] = [];
    let rollupFieldIds: string[] = [];

    const refreshConditionFieldIds = () => {
      relationFieldIds = [];
      rollupFieldIds = [];

      fields?.forEach((field, fieldId) => {
        const fieldType = Number(field.get(YjsDatabaseKey.type));

        if (fieldType === FieldType.Relation) {
          relationFieldIds.push(fieldId);
        }

        if (fieldType === FieldType.Rollup) {
          rollupFieldIds.push(fieldId);
        }
      });
    };

    const handleSortFilterChange = () => {
      const nextConditionStateKey = `${viewId ?? ''}:${getConditionSignature(sorts, filters, fields)}`;

      if (conditionSignatureRef.current === nextConditionStateKey) return;

      // Recompute immediately so a filter change does not replace already-loaded
      // rows with the loading placeholder. onConditionsChange still publishes
      // the loading state when row documents genuinely need hydration.
      onConditionsChange();
      setRollupWatchVersion((prev) => prev + 1);
    };

    const handleFieldChange = () => {
      // Schema changes cannot affect row order when the view has no configured
      // filters or sorts. Avoid serializing every row for unrelated field edits
      // such as renames while an unconditioned Grid view is open.
      if ((sorts?.length ?? 0) === 0 && (filters?.length ?? 0) === 0) return;

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

      debouncedChange();
    };

    sorts?.observeDeep(handleSortFilterChange);
    filters?.observeDeep(handleSortFilterChange);
    fields?.observeDeep(handleFieldChange);

    // Keep relation/rollup field IDs updated as schema changes to avoid stale invalidation.
    refreshConditionFieldIds();

    if (hasConditions) {
      Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
        const observerRowsEvent = () => {
          invalidateRowConditionCache(rowDoc);

          // Only invalidate relation/rollup fields (O(relation+rollup) instead of O(allFields)).
          for (const fieldId of relationFieldIds) {
            invalidateRelationCell(`${rowId}:${fieldId}`);
          }

          for (const fieldId of rollupFieldIds) {
            invalidateRollupCell(`${rowId}:${fieldId}`);
          }

          debouncedChange();
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
      filters?.unobserveDeep(handleSortFilterChange);
      fields?.unobserveDeep(handleFieldChange);
      debouncedChange.cancel();
      observers.forEach((observer, rowId) => {
        rows?.[rowId]?.getMap(YjsEditorKey.data_section).unobserveDeep(observer);
      });
    };
  }, [
    onConditionsChange,
    rowOrders,
    inlineRowOrders,
    fields,
    filters,
    sorts,
    rows,
    viewId,
    syncUnconditionedRowOrders,
    hasConditions,
  ]);

  // Set up rollup field observers (extracted hook)
  useRollupFieldObservers(onConditionsChange, rollupWatchVersion);

  const liveConditionSignature = `${viewId ?? ''}:${getConditionSignature(sorts, filters, fields)}`;

  return rowOrdersState.conditionSignature === liveConditionSignature ? rowOrdersState.rows : undefined;
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
  const { databaseDoc, loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();
  const [value, setValue] = useState<RollupCellValue>({ value: '' });
  const [relationRowIdsKey, setRelationRowIdsKey] = useState('');
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const cellId = `${rowId}:${fieldId}`;
  const rollupOption = useMemo(() => {
    if (!field) return undefined;
    // Recompute when fieldClock updates even if the field reference is stable.
    void fieldClock;
    return parseRollupTypeOption(field);
  }, [field, fieldClock]);
  const rollupContext = useMemo(() => {
    if (!database || !row || !field) return null;
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
    };
  }, [database, row, field, rowId, fieldId, databaseDoc, loadView, createRow, getViewIdFromDatabaseId]);

  useEffect(() => {
    if (!rollupContext || fieldType !== FieldType.Rollup) {
      setValue({ value: '' });
      return;
    }

    let cancelled = false;

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
  }, [rollupContext, fieldType, cellId, fieldClock]);

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

    void (async () => {
      if (!loadView || !createRow) return;
      const viewId = await getViewIdFromDatabaseId?.(relationOption.database_id);

      if (cancelled || !viewId) return;
      const relatedDoc = await loadView(viewId, false, false, {
        databaseId: relationOption.database_id,
        databaseMetadataOnly: true,
      });

      if (cancelled || !relatedDoc) return;
      const docGuid = relatedDoc.guid;
      const handleRelatedSchemaChange = () => {
        invalidateRollupCell(cellId);
        void readRollupCell(rollupContext);
      };

      observerCleanups.push(
        subscribeSharedYjsDeep(relatedDoc.getMap(YjsEditorKey.data_section), handleRelatedSchemaChange)
      );

      for (const relatedRowId of relatedRowIds) {
        if (cancelled) return;
        const rowDoc = await createRow(getRowKey(docGuid, relatedRowId));

        if (cancelled) return;
        if (!rowDoc) continue;
        const handler = () => {
          invalidateRollupCell(cellId);
          void readRollupCell(rollupContext);
        };

        observerCleanups.push(subscribeSharedYjsDeep(rowDoc.getMap(YjsEditorKey.data_section), handler));
      }
    })();

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

export function useCellSelector({ rowId, fieldId }: { rowId: string; fieldId: string }) {
  const { row } = useRowDataSelector(rowId);
  const cells = row?.get(YjsDatabaseKey.cells);
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const cell = cells?.get(fieldId);
  const [clock, setClock] = useState<number>(0);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const rollupCell = useRollupCellValue({ row, field, rowId, fieldId, fieldClock });

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

  if (fieldType === FieldType.Rollup) {
    return rollupCell;
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
  const fieldId = setting?.fieldId || '';
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField, clock: primaryFieldClock } = useFieldSelector(primaryFieldId || '');
  const rowOrders = useRowOrdersSelector();
  const rows = useRowMap();
  const { ensureRow } = useDatabaseContext();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emptyEvents, setEmptyEvents] = useState<CalendarEvent[]>([]);

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
    };

    observerEvent();

    const debouncedObserverEvent = debounce(observerEvent, 150);

    // for every row
    rowOrders?.forEach((row) => {
      const rowDoc = rows?.[row.id];

      if (!rowDoc) return;
      rowDoc.getMap(YjsEditorKey.data_section).observeDeep(debouncedObserverEvent);
    });

    return () => {
      debouncedObserverEvent.cancel();
      rowOrders?.forEach((row) => {
        const rowDoc = rows?.[row.id];

        if (!rowDoc) return;
        rowDoc.getMap(YjsEditorKey.data_section).unobserveDeep(debouncedObserverEvent);
      });
    };
  }, [field, fieldClock, rowOrders, rows, fieldId, primaryFieldId, primaryField, primaryFieldClock, ensureRow]);

  return { events, emptyEvents };
}

export function useCalendarLayoutSetting() {
  const currentUser = useCurrentUser();
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn] || 0);

  const timeFormat = currentUser?.metadata?.[MetadataKey.TimeFormat] || TimeFormat.TwelveHour;
  const database = useDatabase();

  const [setting, setSetting] = useState<CalendarLayoutSetting | null>(null);
  const viewId = useDatabaseViewId();

  useEffect(() => {
    const view = database.get(YjsDatabaseKey.views)?.get(viewId);
    const observerHandler = () => {
      const layoutSetting = view?.get(YjsDatabaseKey.layout_settings)?.get('2');
      const firstDayOfWeek =
        layoutSetting?.get(YjsDatabaseKey.first_day_of_week) === undefined
          ? startWeekOn
          : Number(layoutSetting?.get(YjsDatabaseKey.first_day_of_week) || 0);

      setSetting({
        fieldId: layoutSetting?.get(YjsDatabaseKey.field_id),
        firstDayOfWeek,
        showWeekNumbers: Boolean(layoutSetting?.get(YjsDatabaseKey.show_week_numbers)),
        showWeekends: Boolean(layoutSetting?.get(YjsDatabaseKey.show_weekends)),
        layout: Number(layoutSetting?.get(YjsDatabaseKey.layout_ty)),
        numberOfDays: layoutSetting?.get(YjsDatabaseKey.number_of_days) || 7,
        use24Hour: timeFormat === TimeFormat.TwentyFourHour,
      });
    };

    observerHandler();
    view?.observeDeep(observerHandler);
    return () => {
      view?.unobserveDeep(observerHandler);
    };
  }, [startWeekOn, timeFormat, database, viewId]);

  return setting;
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

export const useFieldCellsByRowsSelector = (fieldId: string, rows?: Row[]) => {
  const [cells, setCells] = useState<Map<string, unknown> | null>(null);
  const rowMap = useRowMap();
  const { field, clock: fieldClock } = useFieldSelector(fieldId);

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
        const cell = databaseRow.get(YjsDatabaseKey.cells)?.get(fieldId);

        return cell ? parseYDatabaseCellToCell(cell, field).data : '';
      };

      const observerEvent = () => {
        setCells((prev) => {
          const newMap = new Map(prev);

          newMap.set(row.id, getCellValue());

          return newMap;
        });
      };

      nextCells.set(row.id, getCellValue());
      cells?.observeDeep(observerEvent);

      unobserveCells.push(() => {
        cells?.unobserveDeep(observerEvent);
      });
    });

    setCells(nextCells);

    return () => {
      unobserveCells.forEach((unobserverEvent) => {
        unobserverEvent();
      });
    };
  }, [rows, rowMap, fieldId, field, fieldClock]);

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
    a.dateCondition === b.dateCondition
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
 * Returns the strongly-typed `ChartLayoutSettings`. Persisted Yjs values are
 * stored as numbers/strings/booleans and cast to enum types here so consumers
 * don't have to project again.
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

      // Persisted Yjs cells may be missing for fields that haven't been
      // explicitly written yet (e.g. only `aggregationType` was changed).
      // Apply desktop-parity defaults for those — most importantly
      // `showEmptyValues = true`, otherwise an empty grid renders "No data"
      // instead of a single "No <field>" bar after a partial write.
      const showEmptyRaw = chartSettingMap.get('showEmptyValues');
      // `DateGroupCondition.Relative` persists as `0`, so we must use an
      // undefined-only fallback — `|| 3` would silently coerce Relative back
      // to Month every time the chart loads.
      const dateConditionRaw = chartSettingMap.get('dateCondition');
      const next: ChartLayoutSettings = {
        chartType: Number(chartSettingMap.get('chartType') || 0) as ChartLayoutSettings['chartType'],
        xFieldId: String(chartSettingMap.get('xFieldId') || ''),
        showEmptyValues: showEmptyRaw === undefined ? true : Boolean(showEmptyRaw),
        aggregationType: Number(chartSettingMap.get('aggregationType') || 0) as ChartLayoutSettings['aggregationType'],
        yFieldId: chartSettingMap.get('yFieldId') ? String(chartSettingMap.get('yFieldId')) : undefined,
        cumulative: Boolean(chartSettingMap.get('cumulative')),
        dateCondition: (dateConditionRaw === undefined || dateConditionRaw === null
          ? DateGroupCondition.Month
          : Number(dateConditionRaw)) as ChartLayoutSettings['dateCondition'],
      };

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
