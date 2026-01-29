/**
 * Sort and Filter dispatch hooks
 *
 * Handles sorting and filtering operations:
 * - useClearSortingDispatch: Clear all sorts
 * - useAddSort: Add a new sort
 * - useRemoveSort: Remove a sort
 * - useUpdateSort: Update sort field or condition
 * - useReorderSorts: Reorder sorts
 * - useAddFilter: Add a new filter
 * - useRemoveFilter: Remove a filter
 * - useUpdateFilter: Update filter settings
 */

import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import * as Y from 'yjs';

import { useDatabaseFields, useDatabaseView, useSharedRoot } from '@/application/database-yjs/context';
import { FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { getDefaultFilterCondition } from '@/application/database-yjs/filter';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { YDatabaseFilter, YDatabaseFilters, YDatabaseSort, YDatabaseSorts, YjsDatabaseKey } from '@/application/types';
import { Log } from '@/utils/log';

export function useClearSortingDispatch() {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
          const sorting = view?.get(YjsDatabaseKey.sorts);

          if (!sorting) {
            throw new Error(`Sorting not found`);
          }

          sorting.delete(0, sorting.length);
        },
      ],
      'clearSortingDispatch'
    );
  }, [sharedRoot, view]);
}

export function useAddSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            let sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              sorts = new Y.Array() as YDatabaseSorts;
              view.set(YjsDatabaseKey.sorts, sorts);
            }

            const isExist = sorts.toArray().some((sort) => {
              const sortFieldId = sort.get(YjsDatabaseKey.field_id);

              if (sortFieldId === fieldId) {
                return true;
              }

              return false;
            });

            if (isExist) {
              return;
            }

            const sort = new Y.Map() as YDatabaseSort;
            const id = `${nanoid(6)}`;

            sort.set(YjsDatabaseKey.id, id);
            sort.set(YjsDatabaseKey.field_id, fieldId);
            sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);

            sorts.push([sort]);
          },
        ],
        'addSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useRemoveSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (sortId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const index = sorts.toArray().findIndex((sort) => sort.get(YjsDatabaseKey.id) === sortId);

            if (index === -1) {
              return;
            }

            sorts.delete(index);
          },
        ],
        'removeSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useUpdateSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    ({ sortId, fieldId, condition }: { sortId: string; fieldId?: string; condition?: SortCondition }) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const sort = sorts.toArray().find((sort) => sort.get(YjsDatabaseKey.id) === sortId);

            if (!sort) {
              return;
            }

            if (fieldId) {
              sort.set(YjsDatabaseKey.field_id, fieldId);
            }

            if (condition !== undefined) {
              sort.set(YjsDatabaseKey.condition, condition);
            }
          },
        ],
        'updateSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useReorderSorts() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (sortId: string, beforeId?: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const sortArray = sorts.toJSON() as {
              id: string;
            }[];

            const sourceIndex = sortArray.findIndex((sort) => sort.id === sortId);
            const targetIndex = beforeId !== undefined ? sortArray.findIndex((sort) => sort.id === beforeId) + 1 : 0;

            const sort = sorts.get(sourceIndex);

            const newSort = new Y.Map() as YDatabaseSort;

            sort.forEach((value, key) => {
              let newValue = value;

              // Because rust uses bigint for enum or some other values, so we need to convert it to string
              // Yjs cannot set bigint value directly
              if (typeof value === 'bigint') {
                newValue = value.toString();
              }

              newSort.set(key, newValue);
            });

            sorts.delete(sourceIndex);

            let adjustedTargetIndex = targetIndex;

            if (targetIndex > sourceIndex) {
              adjustedTargetIndex -= 1;
            }

            sorts.insert(adjustedTargetIndex, [newSort]);
          },
        ],
        'reorderSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useAddFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const fields = useDatabaseFields();

  return useCallback(
    (fieldId: string) => {
      Log.debug('[useAddFilter] Creating filter', { fieldId });

      // Guard: Don't create filter if fieldId is missing or empty
      if (!view || !fieldId || fieldId.trim() === '') {
        Log.warn('[useAddFilter] Skipping filter creation: view or fieldId is missing', {
          hasView: !!view,
          fieldId,
        });
        return;
      }

      const id = `${nanoid(6)}`;

      Log.debug('[useAddFilter] Generated filter id', { filterId: id, fieldId });

      executeOperations(
        sharedRoot,
        [
          () => {
            const field = fields.get(fieldId);

            if (!field) {
              Log.warn('[useAddFilter] Field not found for fieldId:', fieldId);
              return;
            }

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            Log.debug('[useAddFilter] Field info', { fieldId, fieldType });

            let filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              Log.debug('[useAddFilter] Creating new filters array');
              filters = new Y.Array() as YDatabaseFilters;
              view.set(YjsDatabaseKey.filters, filters);
            }

            const filter = new Y.Map() as YDatabaseFilter;

            filter.set(YjsDatabaseKey.id, id);
            filter.set(YjsDatabaseKey.field_id, fieldId);
            const conditionData = getDefaultFilterCondition(fieldType);

            if (!conditionData) {
              Log.warn('[useAddFilter] No default condition for fieldType:', fieldType);
              return;
            }

            Log.debug('[useAddFilter] Setting filter data', {
              filterId: id,
              fieldId,
              fieldType,
              condition: conditionData.condition,
              content: conditionData.content,
            });

            filter.set(YjsDatabaseKey.condition, conditionData.condition);
            if (conditionData.content !== undefined) {
              filter.set(YjsDatabaseKey.content, conditionData.content);
            }

            filter.set(YjsDatabaseKey.type, fieldType);
            filter.set(YjsDatabaseKey.filter_type, FilterType.Data);

            filters.push([filter]);

            Log.debug('[useAddFilter] Filter created successfully', { filterId: id, filter: filter.toJSON() });
          },
        ],
        'addFilter'
      );

      return id;
    },
    [view, sharedRoot, fields]
  );
}

export function useRemoveFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (filterId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              return;
            }

            const index = filters.toArray().findIndex((filter) => filter.get(YjsDatabaseKey.id) === filterId);

            if (index === -1) {
              return;
            }

            filters.delete(index);
          },
        ],
        'removeFilter'
      );
    },
    [view, sharedRoot]
  );
}

export interface UpdateFilterParams {
  filterId: string;
  fieldId?: string;
  condition?: number;
  content?: string;
}

export function useUpdateFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (params: UpdateFilterParams) => {
      const { filterId, fieldId, condition, content } = params;

      Log.debug('[useUpdateFilter] Updating filter', { filterId, fieldId, condition, content });

      // Guard: view must exist
      if (!view) {
        Log.warn('[useUpdateFilter] View is not available');
        return;
      }

      // Guard: fieldId is required for filter updates
      if (!fieldId) {
        Log.warn('[useUpdateFilter] FieldId is missing', { filterId });
        return;
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            // Get filters array from view
            const filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              Log.warn('[useUpdateFilter] No filters found in view', { filterId });
              return;
            }

            // Find the filter by id
            const filter = filters.toArray().find((f) => f.get(YjsDatabaseKey.id) === filterId);

            if (!filter) {
              Log.warn('[useUpdateFilter] Filter not found', { filterId });
              return;
            }

            // Update field_id (always required)
            filter.set(YjsDatabaseKey.field_id, fieldId);

            // Update condition if provided
            if (condition !== undefined) {
              filter.set(YjsDatabaseKey.condition, condition);
            }

            // Update content if provided
            if (content !== undefined) {
              filter.set(YjsDatabaseKey.content, content);
            }

            Log.debug('[useUpdateFilter] Filter updated successfully', {
              filterId,
              filter: filter.toJSON(),
            });
          },
        ],
        'updateFilter'
      );
    },
    [view, sharedRoot]
  );
}
