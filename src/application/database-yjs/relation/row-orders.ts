import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { YDatabase, YDatabaseRowOrders, YjsDatabaseKey } from '@/application/types';

interface RelationRowOrder {
  id: string;
  is_deleted?: boolean;
}

export function getLiveRelationRowIds(rowOrders: readonly RelationRowOrder[]) {
  return rowOrders.filter((row) => !row.is_deleted).map((row) => row.id);
}

/**
 * Database membership is the union of every view's live row orders. Filters,
 * groups, and view-local visibility can omit a valid row from one view without
 * deleting it from the database.
 */
export function getLiveDatabaseRowIds(database: YDatabase): string[] | null {
  const views = database.get(YjsDatabaseKey.views);

  if (!views) return null;

  const canonicalRowOrders = getInlineViewRowOrders(database)?.toArray();
  const rowIds = new Set<string>();
  let foundRowOrders = false;

  for (const viewId of views.keys()) {
    const rowOrders = views.get(viewId)?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders) continue;
    foundRowOrders = true;
    const visibleRowOrders = materializeVisibleRowOrders(rowOrders.toArray(), canonicalRowOrders) ?? [];

    visibleRowOrders.forEach(({ id }) => rowIds.add(id));
  }

  return foundRowOrders ? Array.from(rowIds).sort() : null;
}

/**
 * Rows belong to a database, not to one specific view. Prefer the requested
 * view when it is registered, then fall back to any view carrying row orders
 * (relations can point at the database container rather than an inner view).
 */
export function getRelationRowOrders(database: YDatabase, viewId: string): YDatabaseRowOrders | null {
  const views = database.get(YjsDatabaseKey.views);

  if (!views) return null;

  const named = views.get(viewId)?.get(YjsDatabaseKey.row_orders);

  if (named) return named;

  for (const id of views.keys()) {
    const rowOrders = views.get(id)?.get(YjsDatabaseKey.row_orders);

    if (rowOrders) return rowOrders;
  }

  return null;
}
