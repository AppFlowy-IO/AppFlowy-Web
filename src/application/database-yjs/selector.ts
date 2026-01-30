import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell, RollupCell } from '@/application/database-yjs/cell.type';
import { getCell, MIN_COLUMN_WIDTH } from '@/application/database-yjs/const';
import {
  useDatabase,
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useDatabaseViewId,
  useRow,
  useRowMap,
} from '@/application/database-yjs/context';
import {
  getDateCellStr,
  getFieldDateTimeFormats,
  getTypeOptions,
  parseRelationTypeOption,
  parseRollupTypeOption,
  parseSelectOptionTypeOptions,
  SelectOption,
} from '@/application/database-yjs/fields';
import { filterBy, parseFilter } from '@/application/database-yjs/filter';
import { groupByField } from '@/application/database-yjs/group';
import { useBackgroundRowDocLoader, useRollupFieldObservers } from '@/application/database-yjs/hooks';
import {
  invalidateRelationCell,
  readRelationCellText,
  subscribeRelationCache,
} from '@/application/database-yjs/relation/cache';
import {
  invalidateRollupCell,
  readRollupCell,
  readRollupCellSync,
  RollupCellValue,
  subscribeRollupCell,
  subscribeRollupCache,
} from '@/application/database-yjs/rollup/cache';
import { getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { sortBy } from '@/application/database-yjs/sort';
import {
  DatabaseViewLayout,
  FieldId,
  SortId,
  TimeFormat,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseMetas,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { CalendarLayoutSetting, FieldType, FieldVisibility, Filter, RowMeta, SortCondition } from './database.type';

export interface Column {
  fieldId: string;
  width: number;
  visibility: FieldVisibility;
  wrap?: boolean;
  isPrimary: boolean;
}

export interface Row {
  id: string;
  height: number;
}

const defaultVisible = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty];

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

      // Step 1: Get all non-inline views from Yjs (don't filter by embedded yet)
      // See: flowy-database2/src/services/database/database_editor.rs:get_database_view_ids()
      let allViewIds = Object.keys(viewsObj).filter((viewId) => {
        const view = views.get(viewId);

        if (!view) return false;

        const isInline = view.get(YjsDatabaseKey.is_inline);

        return !isInline;
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
            isPrimary: field?.get(YjsDatabaseKey.is_primary),
            width: parseInt(setting?.get(YjsDatabaseKey.width)) || MIN_COLUMN_WIDTH,
            visibility: Number(
              setting?.get(YjsDatabaseKey.visibility) || FieldVisibility.AlwaysShown
            ) as FieldVisibility,
            wrap: setting?.get(YjsDatabaseKey.wrap) ?? true,
            fieldType: Number(field?.get(YjsDatabaseKey.type)) as FieldType,
          };
        })
        .filter((column) => {
          return visibilitys.includes(column.visibility);
        });
    };

    const observerEvent = () => setColumns(getColumns());

    setColumns(getColumns());

    fieldsOrder?.observeDeep(observerEvent);
    fieldSettings?.observeDeep(observerEvent);
    fields?.observe(observerEvent);

    return () => {
      fieldsOrder?.unobserveDeep(observerEvent);
      fieldSettings?.unobserveDeep(observerEvent);
      fields?.unobserve(observerEvent);
    };
  }, [database, view, visibilitys]);

  return columns;
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

  const [wrap, setWrap] = useState(fieldSetting?.get(YjsDatabaseKey.wrap) ?? true);

  useEffect(() => {
    if (!view) return;

    const observerEvent = () => {
      setWrap(fieldSetting?.get(YjsDatabaseKey.wrap) ?? true);
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
  const [databaseId, setDatabaseId] = useState<string | null>(null);

  useEffect(() => {
    if (!field) return;

    const observerEvent = () => {
      setDatabaseId(parseRelationTypeOption(field)?.database_id);
    };

    observerEvent();

    field.observe(observerEvent);

    return () => {
      field.unobserve(observerEvent);
    };
  }, [database, field, fieldId]);

  return databaseId;
}

export function useFiltersSelector() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [filters, setFilters] = useState<{ id: string; fieldId: string }[]>([]);

  useEffect(() => {
    if (!viewId) return;
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const filterOrders = view?.get(YjsDatabaseKey.filters);

    if (!filterOrders) return;

    const getFilters = () => {
      return (filterOrders.toJSON() as { id: string; field_id: string }[]).map((item) => {
        return {
          id: item.id,
          fieldId: item.field_id,
        };
      });
    };

    const observerEvent = () => {
      setFilters(getFilters());
    };

    observerEvent();

    filterOrders.observe(observerEvent);

    return () => {
      filterOrders.unobserve(observerEvent);
    };
  }, [database, viewId]);

  return filters;
}

export function useFilterSelector(filterId: string) {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const fields = database?.get(YjsDatabaseKey.fields);
  const [filterValue, setFilterValue] = useState<Filter | null>(null);

  useEffect(() => {
    if (!viewId) return;
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const filter = view
      ?.get(YjsDatabaseKey.filters)
      .toArray()
      .find((filter) => filter.get(YjsDatabaseKey.id) === filterId);
    const field = fields?.get(filter?.get(YjsDatabaseKey.field_id) as FieldId);

    const observerEvent = () => {
      if (!filter || !field) return;
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      setFilterValue(parseFilter(fieldType, filter));
    };

    observerEvent();
    field?.observe(observerEvent);
    filter?.observe(observerEvent);
    return () => {
      field?.unobserve(observerEvent);
      filter?.unobserve(observerEvent);
    };
  }, [fields, viewId, filterId, database]);
  return filterValue;
}

export function useSortsSelector() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [sorts, setSorts] = useState<{ id: string; fieldId: string }[]>([]);

  useEffect(() => {
    if (!viewId) return;
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const sortOrders = view?.get(YjsDatabaseKey.sorts);

    if (!sortOrders) return;

    const getSorts = () => {
      return (sortOrders.toJSON() as { id: string; field_id: string }[]).map((item) => {
        return {
          id: item.id,
          fieldId: item.field_id,
        };
      });
    };

    const observerEvent = () => setSorts(getSorts());

    setSorts(getSorts());

    sortOrders.observe(observerEvent);

    return () => {
      sortOrders.unobserve(observerEvent);
    };
  }, [database, viewId]);

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

  useEffect(() => {
    if (!viewId) return;
    const view = views?.get(viewId);
    const sort = view
      ?.get(YjsDatabaseKey.sorts)
      .toArray()
      .find((sort) => sort.get(YjsDatabaseKey.id) === sortId);

    const observerEvent = () => {
      setSortValue({
        fieldId: sort?.get(YjsDatabaseKey.field_id) as FieldId,
        condition: Number(sort?.get(YjsDatabaseKey.condition)),
        id: sort?.get(YjsDatabaseKey.id) as SortId,
      });
    };

    observerEvent();
    sort?.observe(observerEvent);

    return () => {
      sort?.unobserve(observerEvent);
    };
  }, [viewId, sortId, views]);

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

export interface GroupColumn {
  id: string;
  visible: boolean;
}

export function useGroup(groupId: string) {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const group = view
    ?.get(YjsDatabaseKey.groups)
    ?.toArray()
    .find((group) => group.get(YjsDatabaseKey.id) === groupId);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [columns, setColumns] = useState<GroupColumn[]>([]);

  useEffect(() => {
    if (!viewId || !group) return;

    const observerEvent = () => {
      const groupFieldId = group.get(YjsDatabaseKey.field_id);

      setFieldId(groupFieldId);
      const groupColumnsVisible = group.get(YjsDatabaseKey.groups);
      const visibleArray = groupColumnsVisible?.toArray() || [];

      setColumns(visibleArray);
    };

    observerEvent();
    group?.observeDeep(observerEvent);

    return () => {
      group?.unobserveDeep(observerEvent);
    };
  }, [database, viewId, groupId, group]);

  return {
    columns,
    fieldId,
  };
}

export function useBoardLayoutSettings() {
  const view = useDatabaseView();
  const layoutSetting = view?.get(YjsDatabaseKey.layout_settings)?.get('1');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hideUnGroup, setHideUnGroup] = useState(false);
  const groups = view?.get(YjsDatabaseKey.groups);
  const [fieldId, setFieldId] = useState<string | null>(null);

  useEffect(() => {
    if (!layoutSetting) return;

    const observerEvent = () => {
      setIsCollapsed(Boolean(layoutSetting?.get(YjsDatabaseKey.collapse_hidden_groups)));
      setHideUnGroup(Boolean(layoutSetting?.get(YjsDatabaseKey.hide_ungrouped_column)));
    };

    observerEvent();
    layoutSetting.observe(observerEvent);

    return () => {
      layoutSetting.unobserve(observerEvent);
    };
  }, [view, layoutSetting]);

  useEffect(() => {
    const observerEvent = () => {
      const group = groups?.toArray()?.[0];

      if (!group) return;

      const groupFieldId = group.get(YjsDatabaseKey.field_id);

      setFieldId(groupFieldId);
    };

    observerEvent();
    groups?.observeDeep(observerEvent);

    return () => {
      groups?.unobserveDeep(observerEvent);
    };
  }, [groups]);

  return {
    isCollapsed,
    hideUnGroup,
    fieldId,
  };
}

export function useGetBoardHiddenGroup(groupId: string) {
  const { columns, fieldId } = useGroup(groupId);
  const [hiddenColumns, setHiddenColumns] = useState<GroupColumn[]>([]);
  const { hideUnGroup } = useBoardLayoutSettings();

  useEffect(() => {
    if (!columns) return;

    const hiddenColumns = columns.filter((column) => {
      if (column.id === fieldId) return hideUnGroup;

      return !column.visible;
    });

    setHiddenColumns(hiddenColumns);
  }, [columns, fieldId, hideUnGroup]);

  return {
    hiddenColumns,
  };
}

export function useRowsByGroup(groupId: string) {
  const { columns, fieldId } = useGroup(groupId);
  const rows = useRowMap();
  const rowOrders = useRowOrdersSelector();

  const [visibleColumns, setVisibleColumns] = useState<GroupColumn[]>([]);

  const fields = useDatabaseFields();
  const [notFound, setNotFound] = useState(false);
  const [groupResult, setGroupResult] = useState<Map<string, Row[]>>(new Map());
  const view = useDatabaseView();
  const layoutSetting = view?.get(YjsDatabaseKey.layout_settings)?.get('1');
  const filters = view?.get(YjsDatabaseKey.filters);

  useEffect(() => {
    if (!fieldId || !rowOrders || !rows) return;

    const onConditionsChange = () => {
      const newResult = new Map<string, Row[]>();

      const field = fields.get(fieldId);

      if (!field) {
        setNotFound(true);
        setGroupResult(newResult);
        return;
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (![FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(fieldType)) {
        setNotFound(true);
        setGroupResult(newResult);
        return;
      }

      const filter = filters?.toArray().find((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);

      const groupResult = groupByField(rowOrders, rows, field, filter);

      if (!groupResult) {
        setGroupResult(newResult);
        return;
      }

      setGroupResult(groupResult);
    };

    onConditionsChange();

    fields.observeDeep(onConditionsChange);
    filters?.observeDeep(onConditionsChange);

    const debouncedConditionsChange = debounce(onConditionsChange, 150);

    const observerRowsEvent = () => {
      debouncedConditionsChange();
    };

    Object.values(rows).forEach((row) => {
      row.getMap(YjsEditorKey.data_section).observeDeep(observerRowsEvent);
    });
    return () => {
      debouncedConditionsChange.cancel();

      fields.unobserveDeep(onConditionsChange);
      filters?.unobserveDeep(onConditionsChange);
      Object.values(rows).forEach((row) => {
        row.getMap(YjsEditorKey.data_section).unobserveDeep(observerRowsEvent);
      });
    };
  }, [fieldId, fields, rowOrders, rows, filters]);

  useEffect(() => {
    const observeEvent = () => {
      const newVisibleColumns = columns.filter((column) => {
        if (column.id === fieldId) return !layoutSetting?.get(YjsDatabaseKey.hide_ungrouped_column);
        return column.visible;
      });

      setVisibleColumns(newVisibleColumns);
    };

    observeEvent();

    layoutSetting?.observe(observeEvent);

    return () => {
      layoutSetting?.unobserve(observeEvent);
    };
  }, [layoutSetting, columns, fieldId]);

  return {
    fieldId,
    groupResult,
    columns: visibleColumns,
    notFound,
  };
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
  const sorts = view?.get(YjsDatabaseKey.sorts);
  const fields = useDatabaseFields();
  const filters = view?.get(YjsDatabaseKey.filters);
  const database = useDatabase();
  const { databaseDoc, loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();

  const [rowOrders, setRowOrders] = useState<Row[]>();
  const [rollupWatchVersion, setRollupWatchVersion] = useState(0);

  // Check if there are active conditions
  const hasConditions = (sorts?.length ?? 0) > 0 || (filters?.length ?? 0) > 0;

  // Background loading of row docs for sorting/filtering
  const { cachedRowDocs } = useBackgroundRowDocLoader(hasConditions);

  // Merge cached docs with main rowMap
  const rowDocsForConditions = useMemo(
    () => ({ ...cachedRowDocs, ...(rows || {}) }),
    [cachedRowDocs, rows]
  );

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
    const originalRowOrders = view?.get(YjsDatabaseKey.row_orders)?.toJSON();

    if (!originalRowOrders) return;

    if (!hasConditions) {
      setRowOrders(originalRowOrders);
      return;
    }

    const rowDocCount = Object.keys(rowDocsForConditions).length;
    const isRowDataComplete = rowDocCount >= originalRowOrders.length;

    if (!isRowDataComplete) {
      setRowOrders(originalRowOrders);
      return;
    }

    let computedRowOrders: Row[] | undefined;

    if (sorts?.length) {
      computedRowOrders = sortBy(originalRowOrders, sorts, fields, rowDocsForConditions, {
        getRelationCellText: relationTextGetter,
        getRollupCellValue: rollupValueGetter,
      });
    }

    if (filters?.length) {
      computedRowOrders = filterBy(computedRowOrders ?? originalRowOrders, filters, fields, rowDocsForConditions, {
        getRelationCellText: relationTextGetter,
        getRollupCellText: rollupTextGetter,
      });
    }

    setRowOrders(computedRowOrders ?? originalRowOrders);
  }, [
    fields,
    filters,
    hasConditions,
    rowDocsForConditions,
    sorts,
    view,
    relationTextGetter,
    rollupValueGetter,
    rollupTextGetter,
  ]);

  // Trigger computation when dependencies change
  useEffect(() => {
    onConditionsChange();
  }, [onConditionsChange]);

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
    const throttleChange = debounce(onConditionsChange, 200);
    const scheduleRollupRefresh = debounce(() => {
      setRollupWatchVersion((prev) => prev + 1);
    }, 200);

    view?.get(YjsDatabaseKey.row_orders)?.observeDeep(throttleChange);
    const debouncedConditionsChange = debounce(onConditionsChange, 150);

    const observers = new Map<string, () => void>();

    const handleSortFilterChange = () => {
      scheduleRollupRefresh();
      throttleChange();
    };

    const handleFieldChange = () => {
      if (rows && fields) {
        fields.forEach((field, fieldId) => {
          if (Number(field.get(YjsDatabaseKey.type)) === FieldType.Rollup) {
            Object.keys(rows).forEach((rowId) => {
              invalidateRollupCell(`${rowId}:${fieldId}`);
            });
          }
        });
      }

      scheduleRollupRefresh();
      throttleChange();
    };

    sorts?.observeDeep(handleSortFilterChange);
    filters?.observeDeep(handleSortFilterChange);
    fields?.observeDeep(handleFieldChange);

    Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
      const observerRowsEvent = () => {
        fields?.forEach((field, fieldId) => {
          if (Number(field.get(YjsDatabaseKey.type)) === FieldType.Relation) {
            invalidateRelationCell(`${rowId}:${fieldId}`);
          }

          if (Number(field.get(YjsDatabaseKey.type)) === FieldType.Rollup) {
            invalidateRollupCell(`${rowId}:${fieldId}`);
          }
        });
        scheduleRollupRefresh();
        debouncedConditionsChange();
      };

      observers.set(rowId, observerRowsEvent);
      rowDoc.getMap(YjsEditorKey.data_section).observeDeep(observerRowsEvent);
    });

    return () => {
      view?.get(YjsDatabaseKey.row_orders)?.unobserveDeep(throttleChange);
      sorts?.unobserveDeep(handleSortFilterChange);
      filters?.unobserveDeep(handleSortFilterChange);
      fields?.unobserveDeep(handleFieldChange);
      scheduleRollupRefresh.cancel();
      throttleChange.cancel();
      debouncedConditionsChange.cancel();
      Object.entries(rows || {}).forEach(([rowId, rowDoc]) => {
        const observer = observers.get(rowId);

        if (observer) {
          rowDoc.getMap(YjsEditorKey.data_section).unobserveDeep(observer);
        }
      });
    };
  }, [onConditionsChange, view, fields, filters, sorts, rows]);

  // Set up rollup field observers (extracted hook)
  useRollupFieldObservers(onConditionsChange, rollupWatchVersion);

  return rowOrders;
}

export function useRowDataSelector(rowId: string) {
  const rowSharedRoot = useRow(rowId);
  const row = rowSharedRoot?.get(YjsEditorKey.database_row);

  return {
    row,
  };
}

function getRelationRowIdsFromCell(cell?: YDatabaseCell): string[] {
  if (!cell) return [];
  const data = cell.get(YjsDatabaseKey.data);

  if (!data) return [];
  if (typeof data === 'object' && 'toJSON' in data) {
    const ids = (data as { toJSON: () => unknown }).toJSON();

    return Array.isArray(ids) ? (ids as string[]) : [];
  }

  return Array.isArray(data) ? (data as string[]) : [];
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
    const observers: Array<{ doc: YDoc; handler: () => void }> = [];

    void (async () => {
      if (!loadView || !createRow) return;
      const viewId = await getViewIdFromDatabaseId?.(relationOption.database_id);

      if (!viewId) return;
      const relatedDoc = await loadView(viewId);

      if (!relatedDoc) return;
      const docGuid = relatedDoc.guid;

      for (const relatedRowId of relatedRowIds) {
        if (cancelled) return;
        const rowDoc = await createRow(getRowKey(docGuid, relatedRowId));

        if (!rowDoc) continue;
        const handler = () => {
          invalidateRollupCell(cellId);
          void readRollupCell(rollupContext);
        };

        rowDoc.getMap(YjsEditorKey.data_section).observeDeep(handler);
        observers.push({ doc: rowDoc, handler });
      }
    })();

    return () => {
      cancelled = true;
      observers.forEach(({ doc, handler }) => {
        doc.getMap(YjsEditorKey.data_section).unobserveDeep(handler);
      });
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
  } as RollupCell;
}

export function useCellSelector({ rowId, fieldId }: { rowId: string; fieldId: string }) {
  const { row } = useRowDataSelector(rowId);
  const cells = row?.get(YjsDatabaseKey.cells);
  const { field, clock: fieldClock } = useFieldSelector(fieldId);

  const cell = cells?.get(fieldId);
  const [, setClock] = useState<number>(0);
  const [cellValue, setCellValue] = useState(() => {
    return cell ? parseYDatabaseCellToCell(cell, field) : undefined;
  });
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const rollupCell = useRollupCellValue({ row, field, rowId, fieldId, fieldClock });

  useEffect(() => {
    const observerEvent = () => {
      setClock((prev) => prev + 1);
      setCellValue(cell ? parseYDatabaseCellToCell(cell, field) : undefined);
    };

    observerEvent();
    cell?.observeDeep(observerEvent);

    return () => {
      cell?.unobserveDeep(observerEvent);
    };
  }, [cell, field]);

  useEffect(() => {
    if (!cells) return;

    const observerEvent = () => {
      const cell = cells.get(fieldId);

      if (!cell) {
        setCellValue(undefined);
        return;
      } else {
        const cellValue = parseYDatabaseCellToCell(cell, field);

        setCellValue(cellValue);
      }
    };

    observerEvent();

    cells.observe(observerEvent);

    return () => {
      cells.unobserve(observerEvent);
    };
  }, [cells, fieldId, field]);

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
  const filedId = setting?.fieldId || '';
  const { field } = useFieldSelector(filedId);
  const primaryFieldId = usePrimaryFieldId();
  const rowOrders = useRowOrdersSelector();
  const rows = useRowMap();
  const { ensureRow } = useDatabaseContext();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emptyEvents, setEmptyEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    if (!field || !rowOrders || !filedId) return;
    const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

    if (![FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime].includes(fieldType) || !primaryFieldId) return;

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

        const cell = getCell(row.id, filedId, rows);
        const primaryCell = getCell(row.id, primaryFieldId, rows);
        const allDay = !cell?.get(YjsDatabaseKey.include_time);

        const title = (primaryCell?.get(YjsDatabaseKey.data) as string) || '';

        const rowSharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const databbaseRow = rowSharedRoot?.get(YjsEditorKey.database_row);

        if (!databbaseRow) return;

        const rowCreatedTime = databbaseRow.get(YjsDatabaseKey.created_at).toString();
        const rowLastEditedTime = databbaseRow.get(YjsDatabaseKey.last_modified).toString();

        const value = cell ? parseYDatabaseCellToCell(cell, field) as DateTimeCell : undefined;

        if ((!value?.data && fieldType !== FieldType.CreatedTime && fieldType !== FieldType.LastEditedTime) ||
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
          const dayjsResult = timestamp.length === 10 ? dayjs.unix(Number(timestamp)) : dayjs(timestamp);

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
            end: value.endTimestamp && value.isRange ? getDate(value.endTimestamp) : dayjs(getDate(value.data)).add(30, 'minute').toDate(),
            title,
            allDay,
            rowId: row.id,
          });
        }


      });

      setEvents(newEvents);
      setEmptyEvents(emptyEvents);
    }

    observerEvent();

    field?.observeDeep(observerEvent);

    const debouncedObserverEvent = debounce(observerEvent, 150);

    // for every row
    rowOrders?.forEach((row) => {
      const rowDoc = rows?.[row.id];

      if (!rowDoc) return;
      rowDoc.getMap(YjsEditorKey.data_section).observeDeep(debouncedObserverEvent);
    });

    return () => {
      debouncedObserverEvent.cancel();
      field?.unobserveDeep(observerEvent);
      rowOrders?.forEach((row) => {
        const rowDoc = rows?.[row.id];

        if (!rowDoc) return;
        rowDoc.getMap(YjsEditorKey.data_section).unobserveDeep(debouncedObserverEvent);
      });
    };

  }, [field, rowOrders, rows, filedId, primaryFieldId, ensureRow]);

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
      const firstDayOfWeek = layoutSetting?.get(YjsDatabaseKey.first_day_of_week) === undefined ? startWeekOn : Number(layoutSetting?.get(YjsDatabaseKey.first_day_of_week) || 0);

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

export const useRowMetaSelector = (rowId: string) => {
  const [meta, setMeta] = useState<RowMeta | null>();
  const { rowMap, ensureRow } = useDatabaseContext();

  // Ensure the row document is loaded (same pattern as useRow)
  useEffect(() => {
    let cancelled = false;

    if (ensureRow && rowId) {
      const promise = ensureRow(rowId);

      if (promise) {
        promise.catch((error: unknown) => {
          if (!cancelled) {
            console.error('[useRowMetaSelector] Failed to ensure row doc:', error);
          }
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [ensureRow, rowId]);

  const updateMeta = useCallback(() => {
    const row = rowMap?.[rowId];

    if (!row || !row.share.has(YjsEditorKey.data_section)) return;

    const rowSharedRoot = row.getMap(YjsEditorKey.data_section);

    const yMeta = rowSharedRoot?.get(YjsEditorKey.meta);

    if (!yMeta) return;

    const meta = getMetaJSON(rowId, yMeta);

    setMeta(meta);
  }, [rowId, rowMap]);

  useEffect(() => {
    if (!rowMap) return;
    updateMeta();
    const observerEvent = () => updateMeta();

    const rowDoc = rowMap[rowId];

    if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) return;
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const meta = rowSharedRoot?.get(YjsEditorKey.meta) as YDatabaseMetas;

    meta?.observeDeep(observerEvent);
    return () => {
      meta?.unobserveDeep(observerEvent);
    };
  }, [rowId, rowMap, updateMeta]);

  return meta;
};

export const useFieldCellsSelector = (fieldId: string) => {
  const rows = useRowOrdersSelector();
  const [cells, setCells] = useState<Map<string, unknown> | null>(null);
  const rowMap = useRowMap();
  const cellObserverEventsRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!rows || !rowMap) return;

    setCells(null);

    rows.forEach((row) => {
      const rowDoc = rowMap?.[row.id];
      const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);

      const databaseRow = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;

      if (!databaseRow) return;

      const cells = databaseRow.get(YjsDatabaseKey.cells);

      const observerEvent = () => {
        const cell = databaseRow.get(YjsDatabaseKey.cells)?.get(fieldId);

        if (!cell) {
          setCells((prev) => {
            const newMap = new Map(prev);

            newMap.set(row.id, '');

            return newMap;
          });
          return;
        }

        const cellData = cell.get(YjsDatabaseKey.data);

        setCells((prev) => {
          const newMap = new Map(prev);

          newMap.set(row.id, cellData);

          return newMap;
        });
      };

      observerEvent();
      cells?.observeDeep(observerEvent);

      cellObserverEventsRef.current.push(() => {
        cells?.unobserveDeep(observerEvent);
      });
    });

    return () => {
      cellObserverEventsRef.current.forEach((unobserverEvent) => {
        unobserverEvent();
      });
      cellObserverEventsRef.current = [];
    };
  }, [rows, rowMap, fieldId]);

  return {
    cells,
  };
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
  const { field } = useFieldSelector(primaryFieldId);

  const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
  const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;

  useEffect(() => {
    const observerEvent = () => {
      if (!row) return;

      const cell = row.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

      if (!cell) return;

      const cellValue = parseYDatabaseCellToCell(cell, field);

      if (cellValue) {
        setPrimaryContent(cellValue.data as string);
      } else {
        setPrimaryContent(null);
      }
    };

    observerEvent();

    row?.observeDeep(observerEvent);

    return () => {
      row?.unobserveDeep(observerEvent);
    };
  }, [primaryFieldId, row, rowDoc, field]);

  return primaryContent;
}
