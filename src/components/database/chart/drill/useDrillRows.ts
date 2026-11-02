import { useMemo } from 'react';

import { useRowOrdersSelector } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs/selector';
import { RowId } from '@/application/types';

export interface DrillRows {
  /** `undefined` while the conditions hydrate or the rows load. */
  rows: Row[] | undefined;
  loading: boolean;
}

/**
 * The live drill rows (WP13 §3.3): call inside the drill providers. The
 * effective rows of the drill's own view (its private filters and sorts, the
 * widget's global filters and the category filters as extra filters) with the
 * drill search applied (`DatabaseSearchQueryContext`, WP09's `rowMatchesSearch`),
 * then the row-set fallback's allow-list: rows can leave, none join. Nothing
 * is a snapshot except the allow-list.
 */
export function useDrillRows({ rowAllowList }: { rowAllowList: RowId[] | null }): DrillRows {
  const rowOrders = useRowOrdersSelector();
  const allowKey = rowAllowList ? rowAllowList.join('\n') : null;

  return useMemo(() => {
    if (!rowOrders) return { rows: undefined, loading: true };
    const visible = rowOrders.filter((row) => !row.is_deleted);

    if (allowKey === null) return { rows: visible, loading: false };
    const allowed = new Set(allowKey ? allowKey.split('\n') : []);

    return { rows: visible.filter((row) => allowed.has(row.id)), loading: false };
  }, [rowOrders, allowKey]);
}
