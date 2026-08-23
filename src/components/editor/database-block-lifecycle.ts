import type { LoadViewMeta, ViewLayout } from '@/application/types';
import { isDatabaseContainer, isEmbeddedDatabaseViewWithoutChildren } from '@/application/view-utils';

export const DATABASE_VIEW_IDS_PERSIST_RETRY_DELAYS_MS = [100, 500, 1500] as const;

type PersistRecoveredDatabaseViewIdOptions = {
  isCancelled?: () => boolean;
  retryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
};

/**
 * Persist a recovered database tab id, retrying while Slate finishes mounting
 * the block path. A failed path lookup must not make recovery permanently look
 * complete for the lifetime of the component.
 */
export async function persistRecoveredDatabaseViewId(
  recoveredViewId: string,
  persistViewIds: (viewIds: string[]) => boolean,
  options: PersistRecoveredDatabaseViewIdOptions = {}
): Promise<boolean> {
  const {
    isCancelled = () => false,
    retryDelaysMs = DATABASE_VIEW_IDS_PERSIST_RETRY_DELAYS_MS,
    wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled()) return false;
    if (persistViewIds([recoveredViewId])) return true;

    const retryDelayMs = retryDelaysMs[attempt];

    if (retryDelayMs === undefined) return false;
    await wait(retryDelayMs);
  }
}

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
  loadViewMeta: LoadViewMeta,
  preferredLayout?: ViewLayout
): Promise<string | null> {
  if (!parentViewId || !databaseId) return null;

  // Force the direct, child-preserving folder response. A metadata-only
  // refresh intentionally flattens children and cannot recover the link.
  const parentView = await loadViewMeta(parentViewId, undefined, {
    authoritative: true,
    metadataOnly: false,
  });
  const matchingViewIds = Array.from(
    new Set(
      (parentView?.children ?? [])
        .filter(
          (view) =>
            view.extra?.database_id === databaseId &&
            (preferredLayout === undefined || view.layout === preferredLayout) &&
            (!isDatabaseContainer(view) || isEmbeddedDatabaseViewWithoutChildren(view))
        )
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
