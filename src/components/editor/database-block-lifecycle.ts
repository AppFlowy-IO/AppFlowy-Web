import type { LoadViewMeta } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';

/**
 * Recover the single linked database view owned by a document.
 *
 * A database block can lose its view id when a client persists a transient
 * empty tab projection. The database id alone is not enough to recover it:
 * using the original database view would cross the document's identity and
 * permission boundary. Only a unique, direct child of the block's document
 * with the same database id is safe to use.
 */
export async function resolveEmbeddedDatabaseViewId(
  parentViewId: string,
  databaseId: string,
  loadViewMeta: LoadViewMeta
): Promise<string | null> {
  if (!parentViewId || !databaseId) return null;

  const parentView = await loadViewMeta(parentViewId, undefined, { authoritative: true });
  const matchingViewIds = Array.from(
    new Set(
      (parentView?.children ?? [])
        .filter((view) => view.extra?.database_id === databaseId && !isDatabaseContainer(view))
        .map((view) => view.view_id)
        .filter(Boolean)
    )
  );

  return matchingViewIds.length === 1 ? matchingViewIds[0] : null;
}

/**
 * Resolve the folder view that owns deletion for an embedded database block.
 *
 * Inline databases own a database container, while linked database views are
 * direct children of the document. Match Desktop by deleting the parent only
 * when that parent is an actual database container; otherwise delete the
 * linked view itself and preserve the document.
 */
export async function resolveDatabaseBlockDeletionTarget(
  viewId: string,
  loadViewMeta: LoadViewMeta
): Promise<string | null> {
  const view = await loadViewMeta(viewId);

  if (!view) return null;

  const parentViewId = view.parent_view_id;

  if (!parentViewId) return viewId;

  try {
    const parentView = await loadViewMeta(parentViewId);

    return isDatabaseContainer(parentView) ? parentViewId : viewId;
  } catch {
    // Deleting the child is the recoverable choice when parent metadata is
    // temporarily unavailable. Never assume an arbitrary parent is a
    // database container because it may be the document itself.
    return viewId;
  }
}
