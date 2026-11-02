/**
 * Who still references the live row docs of a database.
 *
 * A row doc stays in memory while a row map or a sync context references it:
 * - a mounted database view retains its database, and its row map may hold any
 *   row of it;
 * - a registered sync context holds one row.
 *
 * This module only keeps the bookkeeping. The row doc cache subscribes and
 * evicts the docs; the blob module and the sync lifecycle report the changes.
 */
import type { YDoc } from '@/application/types';

export interface RowDocReleaseListener {
  /** No view retains the database any more. */
  onDatabaseReleased: (databaseId: string) => void;
  /** The last sync context of a row was unregistered. `docDestroyed`: because its doc is being destroyed. */
  onRowUnbound: (rowId: string, doc: YDoc, options: { docDestroyed: boolean }) => void;
}

/** Databases that no mounted view retains. */
const releasedDatabaseIds = new Set<string>();
/** Sync contexts registered per row object id: one for every sync provider that bound the row. */
const rowSyncBindings = new Map<string, number>();
const listeners = new Set<RowDocReleaseListener>();

export function subscribeRowDocRelease(listener: RowDocReleaseListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A view retains the database again: its row docs are kept. */
export function retainDatabaseRowDocs(databaseId: string) {
  releasedDatabaseIds.delete(databaseId);
}

/** No view retains the database any more: its row docs go, each as soon as no sync context references it. */
export function releaseDatabaseRowDocs(databaseId: string) {
  if (!databaseId) return;
  releasedDatabaseIds.add(databaseId);
  listeners.forEach((listener) => listener.onDatabaseReleased(databaseId));
}

export function areDatabaseRowDocsReleased(databaseId: string) {
  return releasedDatabaseIds.has(databaseId);
}

/** A sync context was registered for the row. */
export function retainRowDocSyncBinding(rowId: string) {
  rowSyncBindings.set(rowId, (rowSyncBindings.get(rowId) ?? 0) + 1);
}

/** A sync context of the row, bound to `doc`, was unregistered. */
export function releaseRowDocSyncBinding(rowId: string, doc: YDoc, options?: { docDestroyed?: boolean }) {
  const count = rowSyncBindings.get(rowId) ?? 0;

  if (count > 1) {
    rowSyncBindings.set(rowId, count - 1);
    return;
  }

  rowSyncBindings.delete(rowId);
  listeners.forEach((listener) => listener.onRowUnbound(rowId, doc, { docDestroyed: options?.docDestroyed === true }));
}

export function hasRowDocSyncBinding(rowId: string) {
  return rowSyncBindings.has(rowId);
}
