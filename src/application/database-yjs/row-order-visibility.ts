import { YDatabase, YDatabaseRowOrders, YjsDatabaseKey } from '@/application/types';

export interface RowOrderVisibilityEntry {
  id: string;
  is_deleted?: boolean;
}

/**
 * Resolve the inline view that owns Desktop's canonical soft-delete state.
 * The metadata ID is authoritative; the flag fallback supports older imports.
 */
export function getInlineViewRowOrders(database?: YDatabase): YDatabaseRowOrders | undefined {
  if (!database) return undefined;

  const views = database.get(YjsDatabaseKey.views);

  if (!views) return undefined;

  const inlineViewId = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid);
  const metadataRowOrders = inlineViewId ? views.get(inlineViewId)?.get(YjsDatabaseKey.row_orders) : undefined;

  if (metadataRowOrders) return metadataRowOrders;

  let flaggedRowOrders: YDatabaseRowOrders | undefined;

  views.forEach((view) => {
    if (!flaggedRowOrders && view.get(YjsDatabaseKey.is_inline)) {
      flaggedRowOrders = view.get(YjsDatabaseKey.row_orders);
    }
  });

  return flaggedRowOrders;
}

/**
 * Match Desktop row visibility without changing the selected view's membership.
 *
 * The selected view supplies row membership and order. When the inline view has
 * the same row ID, its tombstone overrides the selected view's raw tombstone.
 * Linked-only rows therefore remain visible, which avoids hiding recoverable
 * data. Duplicate visible IDs are collapsed to one rendered row, matching the
 * Desktop row cache: the first visible position is retained and the last value
 * wins.
 */
export function materializeVisibleRowOrders<T extends RowOrderVisibilityEntry>(
  rawRowOrders?: T[],
  canonicalRowOrders?: RowOrderVisibilityEntry[]
): T[] | undefined {
  if (!rawRowOrders) return undefined;

  const canonicalDeletedById = new Map<string, boolean>();

  canonicalRowOrders?.forEach((rowOrder) => {
    canonicalDeletedById.set(rowOrder.id, Boolean(rowOrder.is_deleted));
  });

  const visibleRows: T[] = [];
  const visibleIndexById = new Map<string, number>();

  rawRowOrders.forEach((rowOrder) => {
    const hasCanonicalVisibility = canonicalDeletedById.has(rowOrder.id);
    const isDeleted = hasCanonicalVisibility
      ? canonicalDeletedById.get(rowOrder.id) === true
      : Boolean(rowOrder.is_deleted);

    if (isDeleted) return;

    const visibleRow =
      hasCanonicalVisibility && Boolean(rowOrder.is_deleted) !== isDeleted
        ? ({ ...rowOrder, is_deleted: isDeleted } as T)
        : rowOrder;
    const existingIndex = visibleIndexById.get(rowOrder.id);

    if (existingIndex === undefined) {
      visibleIndexById.set(rowOrder.id, visibleRows.length);
      visibleRows.push(visibleRow);
    } else {
      visibleRows[existingIndex] = visibleRow;
    }
  });

  return visibleRows;
}
