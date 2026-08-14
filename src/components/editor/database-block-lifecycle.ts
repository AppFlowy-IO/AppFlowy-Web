import type { LoadViewMeta } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';

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
