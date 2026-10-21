import { useEffect } from 'react';

import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { YDatabase, YDatabaseView, YjsDatabaseKey } from '@/application/types';

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
      const orders = view.get(YjsDatabaseKey.row_orders);

      // A direct row link may mount before its database has hydrated.
      if (!orders) return;
      const rawOrders = orders.toArray();
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
