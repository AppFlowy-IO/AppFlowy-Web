import { useCallback, useEffect, useMemo, useState } from 'react';

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
   * Derived from allowedViewIds merged with any locally-added views.
   */
  visibleViewIds: string[];
  /**
   * Callback to add a new view ID when a view is created via the + button.
   * Updates visibleViewIds immediately before the Slate block data catches up.
   */
  onViewAdded: (viewId: string) => void;
}

/**
 * Hook to manage visible view IDs for embedded database blocks.
 *
 * Uses a two-source approach to avoid race conditions:
 * - `allowedViewIds` (from block data) is the source of truth for persisted views
 * - `locallyAddedViewIds` (local state) tracks views added via the + button
 *   that haven't yet propagated to block data
 *
 * `visibleViewIds` is derived via useMemo (synchronous, no effect needed),
 * which avoids the race condition where a useEffect-based sync would
 * discard pending state updates from onViewAdded.
 */
export function useEmbeddedVisibleViewIds({
  allowedViewIds,
}: UseEmbeddedVisibleViewIdsProps): UseEmbeddedVisibleViewIdsResult {
  // Track view IDs added locally via the + button.
  // These are temporary — once allowedViewIds (block data) catches up
  // and includes them, they're automatically filtered out by useMemo.
  const [locallyAddedViewIds, setLocallyAddedViewIds] = useState<string[]>([]);

  // Prune locally-added view IDs once they appear in allowedViewIds
  // (i.e., block data has caught up). This prevents stale IDs from
  // re-emerging if the view is later deleted from allowedViewIds.
  useEffect(() => {
    if (!allowedViewIds || allowedViewIds.length === 0) return;

    setLocallyAddedViewIds((current) => {
      if (current.length === 0) return current;
      const allowedSet = new Set(allowedViewIds);
      const remaining = current.filter((id) => !allowedSet.has(id));

      return remaining.length === current.length ? current : remaining;
    });
  }, [allowedViewIds]);

  // Derive visibleViewIds synchronously from both sources.
  // The useMemo still merges both sources for the render where
  // allowedViewIds has caught up but the effect hasn't pruned yet.
  const visibleViewIds = useMemo(() => {
    const base = allowedViewIds ?? [];

    if (locallyAddedViewIds.length === 0) return base;

    // Only include locally-added views that aren't yet in allowedViewIds
    const allowedSet = new Set(base);
    const additions = locallyAddedViewIds.filter((id) => !allowedSet.has(id));

    if (additions.length === 0) return base;

    return [...base, ...additions];
  }, [allowedViewIds, locallyAddedViewIds]);

  /**
   * Called when a new view is added to the database via the + button.
   * Adds the view ID to locallyAddedViewIds, which immediately updates
   * visibleViewIds via useMemo on the next render.
   */
  const onViewAdded = useCallback((newViewId: string) => {
    setLocallyAddedViewIds((current) => {
      if (current.includes(newViewId)) {
        return current;
      }

      return [...current, newViewId];
    });
  }, []);

  return { visibleViewIds, onViewAdded };
}
