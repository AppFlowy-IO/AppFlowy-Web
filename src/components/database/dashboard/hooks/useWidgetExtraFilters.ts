import { useMemo, useRef } from 'react';

import { usesGlobalFilterOptionContent } from '@/application/database-yjs/dashboard-global-filters';
import {
  DashboardExtraFilter,
  DashboardGlobalFilter,
  resolveExtraFiltersForDatabase,
} from '@/application/database-yjs/dashboard.type';
import { YDoc } from '@/application/types';

import { useGlobalFilterSources } from '../global-filters/useGlobalFilterSources';

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

const NO_SOURCES: Record<string, never> = {};
const NO_DATABASE_IDS: string[] = [];

/** Whether a filter for this database stores option names its options must be matched against. */
function needsTargetOptions(filters: DashboardGlobalFilter[], databaseId: string) {
  return filters.some(
    (filter) =>
      Boolean(filter.targets[databaseId]) &&
      usesGlobalFilterOptionContent(filter.fieldType) &&
      (filter.optionNames?.length ?? 0) > 0
  );
}

/**
 * Global filters resolved for one source database. A select filter's options
 * are matched by name against this database's own options (WP08 §1.9), read
 * from `doc`, the widget's own source doc: it is observed only while such a
 * filter maps this database, and the ids are right on the first render the
 * doc is there for (nothing waits for the dashboard's source registry).
 * Keeps the previous array while the resolved filters are unchanged, so row
 * selectors do not recompute when an unrelated filter (or another database's
 * mapping) changes.
 */
export function useWidgetExtraFilters(globalFilters: DashboardGlobalFilter[], databaseId: string, doc?: YDoc | null) {
  const previousRef = useRef<DashboardExtraFilter[] | undefined>(undefined);
  const needsSource = Boolean(doc) && needsTargetOptions(globalFilters, databaseId);
  const sourceDocs = useMemo(
    () => (needsSource && doc ? { [databaseId]: doc } : NO_SOURCES),
    [databaseId, doc, needsSource]
  );
  const databaseIds = useMemo(() => (needsSource ? [databaseId] : NO_DATABASE_IDS), [databaseId, needsSource]);
  const [targetSource] = useGlobalFilterSources(sourceDocs, NO_SOURCES, { databaseIds });

  return useMemo(() => {
    const resolved = resolveExtraFiltersForDatabase(globalFilters, databaseId, targetSource);
    const next = resolved.length > 0 ? resolved : undefined;

    if (sameExtraFilters(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [databaseId, globalFilters, targetSource]);
}
