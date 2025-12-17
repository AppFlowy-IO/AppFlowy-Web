import { useCallback, useEffect, useRef, useState } from 'react';

interface UseEmbeddedVisibleViewIdsProps {
  /**
   * View IDs from the block data (`node.data.view_ids`).
   * These are the views that were added to this embedded database block.
   */
  allowedViewIds: string[] | undefined;
}

interface UseEmbeddedVisibleViewIdsResult {
  /**
   * The visible view IDs for this embedded database.
   * Initialized from allowedViewIds and updated when views are added.
   */
  visibleViewIds: string[];
  /**
   * Callback to add a new view ID when a view is created via the + button.
   * Updates visibleViewIds immediately before Yjs sync.
   */
  onViewAdded: (viewId: string) => void;
}

/**
 * Hook to manage visible view IDs for embedded database blocks.
 *
 * For embedded databases (databases inside documents), the visible views
 * are determined by the block data's `view_ids` array. This hook:
 *
 * 1. Initializes visibleViewIds from allowedViewIds (block data)
 * 2. Syncs when allowedViewIds changes (e.g., after Yjs update)
 * 3. Provides onViewAdded to immediately add new views before sync
 *
 * @example
 * const allowedViewIds = node.data?.view_ids;
 * const { visibleViewIds, onViewAdded } = useEmbeddedVisibleViewIds({ allowedViewIds });
 *
 * // Pass to Database component
 * <Database visibleViewIds={visibleViewIds} onViewAdded={onViewAdded} />
 */
export function useEmbeddedVisibleViewIds({
  allowedViewIds,
}: UseEmbeddedVisibleViewIdsProps): UseEmbeddedVisibleViewIdsResult {
  const [visibleViewIds, setVisibleViewIds] = useState<string[]>(() => allowedViewIds ?? []);
  const allowedViewIdsRef = useRef<string[] | undefined>(allowedViewIds);

  // Keep ref updated
  useEffect(() => {
    allowedViewIdsRef.current = allowedViewIds;
  }, [allowedViewIds]);

  // Sync visibleViewIds when allowedViewIds changes (e.g., after Yjs sync)
  useEffect(() => {
    if (!allowedViewIds || allowedViewIds.length === 0) {
      return;
    }

    setVisibleViewIds(allowedViewIds);
  }, [allowedViewIds]);

  /**
   * Called when a new view is added to the database via the + button.
   * Updates visibleViewIds immediately to ensure the new tab renders
   * before the Yjs sync completes.
   */
  const onViewAdded = useCallback((newViewId: string) => {
    setVisibleViewIds((current) => {
      if (current.includes(newViewId)) {
        return current;
      }

      return [...current, newViewId];
    });
  }, []);

  return { visibleViewIds, onViewAdded };
}
