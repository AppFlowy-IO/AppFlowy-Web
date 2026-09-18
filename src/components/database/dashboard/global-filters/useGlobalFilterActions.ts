import { useCallback, useMemo, useRef } from 'react';

import { dashboardSourceDatabaseIds, sameDashboardGlobalFilters } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import {
  useDashboardContext,
  useDashboardFilters,
  useDashboardLocalWidgetChanges,
  useDashboardSources,
} from '@/components/database/dashboard/DashboardContext';

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
 *
 * "Save for everybody" publishes the override as the whole filter list, a
 * snapshot like every dashboard layout write (last writer wins): a change a
 * collaborator saved to the same filters in the meantime is replaced, and a
 * filter they added while the override was open is dropped from it.
 */
export function useGlobalFilterActions() {
  const { canEdit, isEditing, updateSetting } = useDashboardContext();
  const {
    globalFilters,
    effectiveGlobalFilters,
    localGlobalFilters,
    setLocalGlobalFilters,
    resetViewOverlays,
    commitViewOverlays,
  } = useDashboardFilters();
  const localWidgetChanges = useDashboardLocalWidgetChanges();
  const persist = canEdit && isEditing;
  const persistedRef = useRef(globalFilters);
  const localRef = useRef(localGlobalFilters);

  persistedRef.current = globalFilters;
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

  const resetLocal = useCallback(() => {
    setLocal(null);
    resetViewOverlays();
  }, [resetViewOverlays, setLocal]);

  // Publishes the global-filter override and every widget's local filters / sorts.
  const saveForEverybody = useCallback(() => {
    const local = localRef.current;

    if (!canEdit) return;
    if (local) {
      persistedRef.current = local;
      updateSetting({ globalFilters: local });
      setLocal(null);
    }

    commitViewOverlays();
  }, [canEdit, commitViewOverlays, setLocal, updateSetting]);

  return {
    filters: effectiveGlobalFilters,
    hasLocalChanges: localGlobalFilters !== null || localWidgetChanges > 0,
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
  const { rows, hostDatabaseId } = useDashboardContext();
  const { sourceDocs, sourceNames } = useDashboardSources();
  const databaseIds = useMemo(() => dashboardSourceDatabaseIds(rows), [rows]);

  return useGlobalFilterSources(sourceDocs, sourceNames, { hostDatabaseId, databaseIds });
}
