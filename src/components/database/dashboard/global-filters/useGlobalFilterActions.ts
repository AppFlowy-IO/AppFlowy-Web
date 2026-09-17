import { useCallback, useMemo, useRef } from 'react';

import { dashboardSourceDatabaseIds, sameDashboardGlobalFilters } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { useDashboardContext } from '@/components/database/dashboard/DashboardContext';

import { removeGlobalFilter, replaceGlobalFilter } from './global-filter.utils';
import { useGlobalFilterSources } from './useGlobalFilterSources';

type FiltersUpdater = (filters: DashboardGlobalFilter[]) => DashboardGlobalFilter[];

/**
 * Read and write the dashboard's global filters.
 *
 * Writers in Edit mode persist every change for everybody; everyone else
 * (viewers, and writers in View mode) edits a local override that only they
 * see until a writer saves it. An override made in View mode stays private in
 * Edit mode: an Edit-mode change is applied to the saved filters and, on top
 * of the unsaved differences, to the override, and only "Save for everybody"
 * publishes the override. Updates are computed from the latest lists so
 * several writes in one event (for example two debounced inputs flushing on
 * close) never overwrite each other.
 */
export function useGlobalFilterActions() {
  const {
    setting,
    effectiveGlobalFilters,
    localGlobalFilters,
    setLocalGlobalFilters,
    canEdit,
    isEditing,
    updateSetting,
  } = useDashboardContext();
  const persist = canEdit && isEditing;
  const persistedRef = useRef(setting.globalFilters);
  const localRef = useRef(localGlobalFilters);

  persistedRef.current = setting.globalFilters;
  localRef.current = localGlobalFilters;

  const setLocal = useCallback(
    (next: DashboardGlobalFilter[] | null) => {
      const local = next && !sameDashboardGlobalFilters(next, persistedRef.current) ? next : null;

      localRef.current = local;
      setLocalGlobalFilters(local);
    },
    [setLocalGlobalFilters]
  );

  const commit = useCallback(
    (updater: FiltersUpdater) => {
      const persisted = persistedRef.current;
      const local = localRef.current;

      if (!persist) {
        const current = local ?? persisted;
        const next = updater(current);

        if (next !== current) setLocal(next);
        return;
      }

      const shared = updater(persisted);

      if (shared !== persisted && !sameDashboardGlobalFilters(shared, persisted)) {
        persistedRef.current = shared;
        updateSetting({ globalFilters: shared });
      }

      // The writer's private override gets the same edit and stays private.
      if (local) setLocal(updater(local));
    },
    [persist, setLocal, updateSetting]
  );

  const addFilter = useCallback((filter: DashboardGlobalFilter) => commit((filters) => [...filters, filter]), [commit]);

  const updateFilter = useCallback(
    (filterId: string, updater: (filter: DashboardGlobalFilter) => DashboardGlobalFilter) =>
      commit((filters) => replaceGlobalFilter(filters, filterId, updater)),
    [commit]
  );

  const deleteFilter = useCallback(
    (filterId: string) => commit((filters) => removeGlobalFilter(filters, filterId)),
    [commit]
  );

  const resetLocal = useCallback(() => setLocal(null), [setLocal]);

  const saveForEverybody = useCallback(() => {
    const local = localRef.current;

    if (!canEdit || !local) return;
    persistedRef.current = local;
    updateSetting({ globalFilters: local });
    setLocal(null);
  }, [canEdit, setLocal, updateSetting]);

  return {
    filters: effectiveGlobalFilters,
    hasLocalChanges: localGlobalFilters !== null,
    canEdit,
    isEditing,
    persist,
    addFilter,
    updateFilter,
    deleteFilter,
    resetLocal,
    saveForEverybody,
  };
}

/** Source databases of the dashboard's widgets, in widget order, with live property lists. */
export function useDashboardFilterSources() {
  const { rows, sourceDocs, sourceNames, hostDatabaseId } = useDashboardContext();
  const databaseIds = useMemo(() => dashboardSourceDatabaseIds(rows), [rows]);

  return useGlobalFilterSources(sourceDocs, sourceNames, { hostDatabaseId, databaseIds });
}
