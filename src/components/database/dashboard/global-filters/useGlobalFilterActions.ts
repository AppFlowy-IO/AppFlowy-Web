import { useCallback, useMemo, useRef } from 'react';

import { dashboardSourceDatabaseIds, sameDashboardGlobalFilters } from '@/application/database-yjs/dashboard-layout';
import { globalFilterValueOf } from '@/application/database-yjs/dashboard-private';
import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import {
  useDashboardContext,
  useDashboardFilters,
  useDashboardLayout,
  useDashboardSources,
} from '@/components/database/dashboard/DashboardContext';

import {
  createGlobalFilterForField,
  findSingleTargetFilter,
  GlobalFilterSource,
  GlobalFilterSourceField,
  removeGlobalFilter,
  removeGlobalFilterTarget,
  replaceGlobalFilter,
  setGlobalFilterTarget,
} from './global-filter.utils';
import { requestGlobalFilterEditor } from './pendingEditorStore';
import { useGlobalFilterSources } from './useGlobalFilterSources';

type FiltersUpdater = (filters: DashboardGlobalFilter[]) => DashboardGlobalFilter[];
type FilterUpdater = (filter: DashboardGlobalFilter) => DashboardGlobalFilter;

/** A select filter's selection: the option ids and, in parallel, their names. */
export interface GlobalFilterSelection {
  content: string;
  optionNames: string[];
}

/**
 * Read and write the dashboard's global filters (WP07 §2, WP08 §1.1).
 *
 * Two paths:
 * - **Values** (condition, content, option names): a writer in Edit mode
 *   writes them for everyone; in View mode, and for readers, they are the
 *   viewer's private values until someone with write access saves them.
 * - **Structure** (add, delete, rename, re-map sources): shared writes that
 *   need write access in either mode. Readers cannot change it; the calls
 *   are ignored for them.
 *
 * Updates read the latest lists, so several writes in one event (two
 * debounced inputs flushing on close) never overwrite each other.
 *
 * The writers are stable; the returned object changes only with the filters,
 * the dirty ids, the access or the mode, so a consumer that depends on a
 * writer alone is not rebuilt on every render.
 */
export function useGlobalFilterActions() {
  const { canEdit, isEditing, updateSetting } = useDashboardContext();
  const { globalFilters, effectiveGlobalFilters, dirtyGlobalFilterIds, setPrivateGlobalValue } = useDashboardFilters();
  const persistValues = canEdit && isEditing;
  const persistedRef = useRef(globalFilters);
  const effectiveRef = useRef(effectiveGlobalFilters);

  persistedRef.current = globalFilters;
  effectiveRef.current = effectiveGlobalFilters;

  const persist = useCallback(
    (updater: FiltersUpdater) => {
      if (!canEdit) return;
      const persisted = persistedRef.current;
      const shared = updater(persisted);

      if (shared === persisted || sameDashboardGlobalFilters(shared, persisted)) return;
      persistedRef.current = shared;
      updateSetting({ globalFilters: shared });
    },
    [canEdit, updateSetting]
  );

  /** The value path: condition, content and option names. */
  const setFilterValue = useCallback(
    (filterId: string, updater: FilterUpdater) => {
      if (persistValues) {
        persist((filters) => replaceGlobalFilter(filters, filterId, updater));
        return;
      }

      const current = effectiveRef.current.find((filter) => filter.id === filterId);

      if (!current) return;
      const next = updater(current);

      if (next === current) return;
      effectiveRef.current = replaceGlobalFilter(effectiveRef.current, filterId, () => next);
      setPrivateGlobalValue(filterId, globalFilterValueOf(next));
    },
    [persist, persistValues, setPrivateGlobalValue]
  );

  /** A select filter's selection, content and names together (a viewer's pick stays private). */
  const setSelection = useCallback(
    (filterId: string, { content, optionNames }: GlobalFilterSelection) =>
      setFilterValue(filterId, (filter) => {
        const names = optionNames.length > 0 ? optionNames : undefined;
        const same =
          filter.content === content &&
          (filter.optionNames ?? []).length === optionNames.length &&
          (filter.optionNames ?? []).every((name, index) => name === optionNames[index]);

        return same ? filter : { ...filter, content, optionNames: names };
      }),
    [setFilterValue]
  );

  /** The structure path: name and mappings. Write access only, in either mode. */
  const updateFilterStructure = useCallback(
    (filterId: string, updater: FilterUpdater) => persist((filters) => replaceGlobalFilter(filters, filterId, updater)),
    [persist]
  );

  const addFilter = useCallback(
    (filter: DashboardGlobalFilter) => persist((filters) => [...filters, filter]),
    [persist]
  );

  const deleteFilter = useCallback(
    (filterId: string) => persist((filters) => removeGlobalFilter(filters, filterId)),
    [persist]
  );

  const setTarget = useCallback(
    (filterId: string, sources: GlobalFilterSource[], databaseId: string, fieldId: string) =>
      updateFilterStructure(filterId, (filter) => setGlobalFilterTarget(filter, sources, databaseId, fieldId)),
    [updateFilterStructure]
  );

  const removeTarget = useCallback(
    (filterId: string, sources: GlobalFilterSource[], databaseId: string) =>
      updateFilterStructure(filterId, (filter) => removeGlobalFilterTarget(filter, sources, databaseId)),
    [updateFilterStructure]
  );

  /**
   * A property picked in the menu (WP08 §1.3): the filter of exactly that
   * property if there is one, else a new one for it alone. Returns its id, or
   * `null` for a reader (who cannot add filters).
   */
  const createFromProperty = useCallback(
    (databaseId: string, field: Pick<GlobalFilterSourceField, 'id' | 'name' | 'type'>, typeName: string) => {
      if (!canEdit) return null;
      const existing = findSingleTargetFilter(persistedRef.current, databaseId, field.id);

      if (existing) return existing.id;
      const filter = createGlobalFilterForField(databaseId, field, typeName);

      addFilter(filter);
      return filter.id;
    },
    [addFilter, canEdit]
  );

  /** Pick from the toolbar or `+ Filter` menu: then that pill opens its editor with the value focused. */
  const pickProperty = useCallback(
    (databaseId: string, field: Pick<GlobalFilterSourceField, 'id' | 'name' | 'type'>, typeName: string) => {
      const id = createFromProperty(databaseId, field, typeName);

      if (id) requestGlobalFilterEditor(id);
      return id;
    },
    [createFromProperty]
  );

  return useMemo(
    () => ({
      /** What the pills show: the saved filters, with the viewer's private values in View mode. */
      filters: effectiveGlobalFilters,
      dirtyIds: dirtyGlobalFilterIds,
      canEdit,
      isEditing,
      /** Value edits are written for everyone (a writer in Edit mode). */
      persist: persistValues,
      setFilterValue,
      setSelection,
      updateFilterStructure,
      addFilter,
      deleteFilter,
      setTarget,
      removeTarget,
      pickProperty,
      createFromMultiPicker: createFromProperty,
    }),
    [
      addFilter,
      canEdit,
      createFromProperty,
      deleteFilter,
      dirtyGlobalFilterIds,
      effectiveGlobalFilters,
      isEditing,
      persistValues,
      pickProperty,
      removeTarget,
      setFilterValue,
      setSelection,
      setTarget,
      updateFilterStructure,
    ]
  );
}

export type GlobalFilterActions = ReturnType<typeof useGlobalFilterActions>;

/** Source databases of the dashboard's widgets, in widget order, with live property lists. */
export function useDashboardFilterSources() {
  const { hostDatabaseId } = useDashboardContext();
  const { rows } = useDashboardLayout();
  const { sourceDocs, sourceNames } = useDashboardSources();
  const databaseIds = useMemo(() => dashboardSourceDatabaseIds(rows), [rows]);

  return useGlobalFilterSources(sourceDocs, sourceNames, { hostDatabaseId, databaseIds });
}
