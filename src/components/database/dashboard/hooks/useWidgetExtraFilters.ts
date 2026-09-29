import { useMemo, useRef } from 'react';

import {
  DashboardExtraFilter,
  DashboardGlobalFilter,
  resolveExtraFiltersForDatabase,
} from '@/application/database-yjs/dashboard.type';

export function sameExtraFilters(a: DashboardExtraFilter[] | undefined, b: DashboardExtraFilter[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((filter, index) => {
    const other = b[index];

    return (
      filter.id === other.id &&
      filter.field_id === other.field_id &&
      filter.ty === other.ty &&
      filter.condition === other.condition &&
      filter.content === other.content
    );
  });
}

/**
 * Global filters resolved for one source database. Keeps the previous array
 * while the resolved filters are unchanged, so row selectors do not recompute
 * when an unrelated filter (or another database's mapping) changes.
 */
export function useWidgetExtraFilters(globalFilters: DashboardGlobalFilter[], databaseId: string) {
  const previousRef = useRef<DashboardExtraFilter[] | undefined>(undefined);

  return useMemo(() => {
    const resolved = resolveExtraFiltersForDatabase(globalFilters, databaseId);
    const next = resolved.length > 0 ? resolved : undefined;

    if (sameExtraFilters(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [databaseId, globalFilters]);
}
