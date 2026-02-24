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

// ============================================================================
// Advanced Filter Hooks
// ============================================================================

/**
 * Wraps existing flat filters in a root AND/OR group for advanced mode.
 * If already in advanced mode but there are sibling flat filters,
 * moves them into the existing root's children.
 */
export function useEnterAdvancedMode() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rootOperator: FilterType.And | FilterType.Or) => {
      if (!view) {
        return;
      }

      try {
        executeOperations(
          sharedRoot,
          [
            () => {
              try {
                const filters = view.get(YjsDatabaseKey.filters);

                if (!filters || filters.length === 0) {
                  Log.debug('[useEnterAdvancedMode] No filters to wrap');
                  return;
                }

                // Check if already in advanced mode (first filter is a group)
                const firstFilter = filters.get(0);

                if (firstFilter) {
                  const filterType = Number(firstFilter.get(YjsDatabaseKey.filter_type));

                  if (filterType === FilterType.And || filterType === FilterType.Or) {
                    // Already in advanced mode - check if there are sibling flat filters to move
                    if (filters.length > 1) {
                      Log.debug('[useEnterAdvancedMode] Moving sibling filters into root children');
                      let children = firstFilter.get(YjsDatabaseKey.children) as YDatabaseFilters;

                      if (!children) {
                        children = new Y.Array() as YDatabaseFilters;
                        firstFilter.set(YjsDatabaseKey.children, children);
                      }

                      // Move sibling filters (index 1 onwards) into children
                      const siblingFilters = filters.toArray().slice(1);

                      siblingFilters.forEach((f) => {
                        const clone = new Y.Map() as YDatabaseFilter;

                        f.forEach((val, key) => {
                          let newValue = val;

                          if (typeof val === 'bigint') {
                            newValue = val.toString();
                          }

                          clone.set(key, newValue);
                        });
                        children.push([clone]);
                      });

                      // Delete the sibling filters (keep only the root)
                      filters.delete(1, filters.length - 1);
                      Log.debug('[useEnterAdvancedMode] Moved sibling filters', { count: siblingFilters.length });
                    } else {
                      Log.debug('[useEnterAdvancedMode] Already in advanced mode, no siblings to move');
                    }

                    return;
                  }
                }

                // Create root filter
                const rootFilter = new Y.Map() as YDatabaseFilter;

                rootFilter.set(YjsDatabaseKey.id, nanoid(6));
                rootFilter.set(YjsDatabaseKey.filter_type, rootOperator);

                // Move existing filters as children
                const children = new Y.Array() as YDatabaseFilters;
                const existingFilters = filters.toArray();

                existingFilters.forEach((f) => {
                  const clone = new Y.Map() as YDatabaseFilter;

                  f.forEach((val, key) => {
                    let newValue = val;

                    if (typeof val === 'bigint') {
                      newValue = val.toString();
                    }

                    clone.set(key, newValue);
                  });
                  children.push([clone]);
                });
                rootFilter.set(YjsDatabaseKey.children, children);

                // Replace with root filter
                filters.delete(0, filters.length);
                filters.push([rootFilter]);

                Log.debug('[useEnterAdvancedMode] Wrapped filters in advanced mode', {
                  rootOperator,
                  childCount: children.length,
                });
              } catch (innerError) {
                Log.error('[useEnterAdvancedMode] Inner error:', innerError);
              }
            },
          ],
          'enterAdvancedMode'
        );
      } catch (outerError) {
        console.error('[useEnterAdvancedMode] Outer error:', outerError);
      }
    },
    [view, sharedRoot]
  );
}

/**
 * Changes the root filter operator between AND/OR in advanced mode
 */
export function useUpdateRootFilterType() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (newType: FilterType.And | FilterType.Or) => {
      if (!view) return;

      executeOperations(
        sharedRoot,
        [
          () => {
            const filters = view.get(YjsDatabaseKey.filters);
            const rootFilter = filters?.get(0);

            if (!rootFilter) {
              Log.warn('[useUpdateRootFilterType] No root filter found');
              return;
            }

            rootFilter.set(YjsDatabaseKey.filter_type, newType);

            Log.debug('[useUpdateRootFilterType] Updated root filter type', { newType });
          },
        ],
        'updateRootFilterType'
      );
    },
    [view, sharedRoot]
  );
}

/**
 * Adds a filter as a child of the root group in advanced mode
 */
export function useAddAdvancedFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const fields = useDatabaseFields();

  return useCallback(
    (fieldId: string) => {
      Log.debug('[useAddAdvancedFilter] Adding advanced filter', { fieldId });

      if (!view || !fieldId || fieldId.trim() === '') {
        Log.warn('[useAddAdvancedFilter] Invalid arguments');
        return;
      }

      const id = nanoid(6);

      executeOperations(
        sharedRoot,
        [
          () => {
            const field = fields.get(fieldId);

            if (!field) {
              Log.warn('[useAddAdvancedFilter] Field not found', { fieldId });
              return;
            }

            const fieldType = Number(field.get(YjsDatabaseKey.type));
            const filters = view.get(YjsDatabaseKey.filters);
            const rootFilter = filters?.get(0);

            if (!rootFilter) {
              Log.warn('[useAddAdvancedFilter] No root filter found');
              return;
            }

            let children = rootFilter.get(YjsDatabaseKey.children) as YDatabaseFilters;

            if (!children) {
              children = new Y.Array() as YDatabaseFilters;
              rootFilter.set(YjsDatabaseKey.children, children);
            }

            const filter = new Y.Map() as YDatabaseFilter;

            filter.set(YjsDatabaseKey.id, id);
            filter.set(YjsDatabaseKey.field_id, fieldId);
            filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
            filter.set(YjsDatabaseKey.type, fieldType);

            const conditionData = getDefaultFilterCondition(fieldType);

            if (conditionData) {
              filter.set(YjsDatabaseKey.condition, conditionData.condition);
              if (conditionData.content !== undefined) {
                filter.set(YjsDatabaseKey.content, conditionData.content);
              }
            }

            children.push([filter]);

            Log.debug('[useAddAdvancedFilter] Filter added to children', { id, fieldId });
          },
        ],
        'addAdvancedFilter'
      );

      return id;
    },
    [view, sharedRoot, fields]
  );
}

/**
 * Removes a filter from the children array in advanced mode.
 * If this was the last filter, also removes the root And/Or filter
 * to return to normal mode.
 */
export function useRemoveAdvancedFilter() {
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
            const rootFilter = filters?.get(0);

            if (!rootFilter) {
              Log.warn('[useRemoveAdvancedFilter] No root filter found');
              return;
            }

            const children = rootFilter.get(YjsDatabaseKey.children) as YDatabaseFilters;

            if (!children) {
              Log.warn('[useRemoveAdvancedFilter] No children found');
              return;
            }

            const index = children.toArray().findIndex((f) => {
              // Handle both Yjs Map (with .get() method) and plain object (from desktop sync)
              const isYjsMap = typeof (f as { get?: unknown }).get === 'function';
              const id = isYjsMap
                ? (f as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
                : (f as unknown as Record<string, unknown>)[YjsDatabaseKey.id];

              return id === filterId;
            });

            if (index === -1) {
              Log.warn('[useRemoveAdvancedFilter] Filter not found in children', { filterId });
              return;
            }

            children.delete(index);

            Log.debug('[useRemoveAdvancedFilter] Removed filter from children', { filterId, index });

            // If all children are removed, also remove the root And/Or filter
            // to properly exit advanced mode
            if (children.length === 0) {
              filters?.delete(0, filters.length);
              Log.debug('[useRemoveAdvancedFilter] All children removed, cleared root filter');
            }
          },
        ],
        'removeAdvancedFilter'
      );
    },
    [view, sharedRoot]
  );
}

/**
 * Updates a filter within the children array in advanced mode
 */
export function useUpdateAdvancedFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (params: UpdateFilterParams) => {
      const { filterId, fieldId, condition, content } = params;

      if (!view) {
        Log.warn('[useUpdateAdvancedFilter] View is not available');
        return;
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            const filters = view.get(YjsDatabaseKey.filters);
            const rootFilter = filters?.get(0);

            if (!rootFilter) {
              Log.warn('[useUpdateAdvancedFilter] No root filter found');
              return;
            }

            const children = rootFilter.get(YjsDatabaseKey.children) as YDatabaseFilters;

            if (!children) {
              Log.warn('[useUpdateAdvancedFilter] No children found');
              return;
            }

            // Find the filter - need to handle both Yjs Map and plain object (from desktop sync)
            let filterIndex = -1;
            const childrenArray = children.toArray();

            for (let i = 0; i < childrenArray.length; i++) {
              const f = childrenArray[i];
              const isYjsMap = typeof (f as { get?: unknown }).get === 'function';
              const id = isYjsMap
                ? (f as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
                : (f as unknown as Record<string, unknown>)[YjsDatabaseKey.id];

              if (id === filterId) {
                filterIndex = i;
                break;
              }
            }

            if (filterIndex === -1) {
              Log.warn('[useUpdateAdvancedFilter] Filter not found in children', { filterId });
              return;
            }

            // Get the actual Yjs Map from the children array using index
            const filter = children.get(filterIndex);

            if (!filter) {
              Log.warn('[useUpdateAdvancedFilter] Filter not found at index', { filterId, filterIndex });
              return;
            }

            if (fieldId) {
              filter.set(YjsDatabaseKey.field_id, fieldId);
            }

            if (condition !== undefined) {
              filter.set(YjsDatabaseKey.condition, condition);
            }

            if (content !== undefined) {
              filter.set(YjsDatabaseKey.content, content);
            }

            Log.debug('[useUpdateAdvancedFilter] Updated filter in children', { filterId });
          },
        ],
        'updateAdvancedFilter'
      );
    },
    [view, sharedRoot]
  );
}

/**
 * Exits advanced mode by flattening the hierarchical filters back to a flat list
 */
export function useExitAdvancedMode() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(() => {
    if (!view) return;

    executeOperations(
      sharedRoot,
      [
        () => {
          const filters = view.get(YjsDatabaseKey.filters);

          if (!filters || filters.length === 0) {
            return;
          }

          const rootFilter = filters.get(0);

          if (!rootFilter) {
            return;
          }

          const filterType = Number(rootFilter.get(YjsDatabaseKey.filter_type));

          // Only exit if currently in advanced mode
          if (filterType !== FilterType.And && filterType !== FilterType.Or) {
            Log.debug('[useExitAdvancedMode] Not in advanced mode');
            return;
          }

          const children = rootFilter.get(YjsDatabaseKey.children) as YDatabaseFilters;

          if (!children) {
            filters.delete(0, filters.length);
            return;
          }

          // Clone children and replace filters
          const childArray = children.toArray();
          const clonedFilters: YDatabaseFilter[] = [];

          childArray.forEach((f) => {
            const clone = new Y.Map() as YDatabaseFilter;

            f.forEach((val, key) => {
              let newValue = val;

              if (typeof val === 'bigint') {
                newValue = val.toString();
              }

              clone.set(key, newValue);
            });
            clonedFilters.push(clone);
          });

          filters.delete(0, filters.length);
          if (clonedFilters.length > 0) {
            filters.push(clonedFilters);
          }

          Log.debug('[useExitAdvancedMode] Exited advanced mode', { filterCount: clonedFilters.length });
        },
      ],
      'exitAdvancedMode'
    );
  }, [view, sharedRoot]);
}

/**
 * Clears all filters (works in both normal and advanced mode)
 */
export function useClearAllFilters() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(() => {
    if (!view) return;

    executeOperations(
      sharedRoot,
      [
        () => {
          const filters = view.get(YjsDatabaseKey.filters);

          if (!filters) {
            return;
          }

          filters.delete(0, filters.length);

          Log.debug('[useClearAllFilters] Cleared all filters');
        },
      ],
      'clearAllFilters'
    );
  }, [view, sharedRoot]);
}
