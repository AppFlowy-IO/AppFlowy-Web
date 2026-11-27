import { useEffect } from 'react';

import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { databaseOfView, viewRowOrderEntries } from '@/application/database-yjs/row-placements-doc';
import { YDatabase, YDatabaseView } from '@/application/types';

/** Filtered navigation orders cannot distinguish hidden rows from deleted rows. */
export function useRowPeekRowDeletion(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined,
  rowId: string,
  onDeleted: () => void
) {
  useEffect(() => {
    if (!view) return;
    let wasPresent = false;
    let dismissed = false;
    const checkRow = () => {
      if (dismissed) return;
      // The rows of the view in either mode: an anchored view lists none of its own.
      const rawOrders = viewRowOrderEntries(database ?? databaseOfView(view), view);

      // A direct row link may mount before its database has hydrated.
      if (!rawOrders) return;
      const visibleOrders = materializeVisibleRowOrders(rawOrders, getInlineViewRowOrders(database)?.toArray());
      const isPresent = visibleOrders?.some((order) => order.id === rowId);

      if (isPresent) {
        wasPresent = true;
      } else if (wasPresent || rawOrders.some((order) => order.id === rowId)) {
        dismissed = true;
        onDeleted();
      }
    };

    checkRow();
    // Desktop's inline view owns canonical tombstones, even when the peek was
    // opened from a linked view. Also handle replacement of row_orders arrays.
    const source = database ?? view;

    source.observeDeep(checkRow);
    return () => source.unobserveDeep(checkRow);
  }, [database, onDeleted, rowId, view]);
}
