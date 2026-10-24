import { useMemo } from 'react';

import { useDatabaseExtraFilters, useDatabaseFields, useDatabaseView } from '@/application/database-yjs/context';
import { combineFilters } from '@/application/database-yjs/filter';
import { YDatabaseFilters, YjsDatabaseKey } from '@/application/types';

/**
 * The filters a view applies right now (R-EFFECTIVE, WP07 §3.3): the view's
 * own filters (inside a dashboard widget in View mode, the viewer's private
 * copy) AND the dashboard's global filters resolved for this database. A
 * global filter whose field has since changed type is left out.
 *
 * New rows are prefilled from these, so a row added in a filtered widget
 * stays visible there. The list is virtual (`combineFilters`); it reads its
 * parts on every access and offers what the prefill reads (`length`,
 * `toArray`).
 */
export function useEffectiveViewFilters(): YDatabaseFilters | undefined {
  const view = useDatabaseView();
  const viewFilters = view?.get(YjsDatabaseKey.filters);
  const extraFilters = useDatabaseExtraFilters();
  const fields = useDatabaseFields();

  return useMemo(
    () => combineFilters(viewFilters, extraFilters, fields) as YDatabaseFilters | undefined,
    [extraFilters, fields, viewFilters]
  );
}
