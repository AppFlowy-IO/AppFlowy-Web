import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PageService } from '@/application/services/domains';
import { View } from '@/application/types';
import { useRefreshOutline } from '@/components/app/app.hooks';
import { type ReorderResult, useReorderMonitor } from '@/components/_shared/reorder/useReorderMonitor';
import { Log } from '@/utils/log';

/** The user-applied order, plus the server order it was computed against. */
interface OptimisticOrder {
  /** Desired display order after the drag. */
  orderIds: string[];
  /** The server children order captured at drop time. */
  baseIds: string[];
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }

  return true;
}

interface UseReorderableSidebarListParams {
  /** The current sibling group, in server order. */
  items: View[];
  /**
   * The parent the items live under. For top-level spaces this is the workspace
   * id (the folder root); otherwise it is the parent view id.
   */
  parentId: string | undefined;
  workspaceId: string | undefined;
  /** Drag-type discriminator; must match the row hook's `dragType`. */
  dragType: string;
  /** Whether reordering is active for this group. */
  enabled: boolean;
  /**
   * Optional scroll container used to auto-scroll while dragging near its
   * edges. Omit for small nested groups that don't need it.
   */
  autoScrollElementRef?: React.RefObject<HTMLElement | null>;
  /** Toast message shown when the reorder request fails. */
  errorMessage?: string;
}

interface UseReorderableSidebarListResult {
  /** Items in their (optimistic) display order. */
  orderedItems: View[];
  /**
   * The group's drag instance id, passed down to each row. `undefined` when the
   * group is not reorderable so rows stay inert.
   */
  instanceId: symbol | undefined;
}

/**
 * Owns drag-to-reorder for a single sibling group in the sidebar.
 *
 * Reordering keeps items inside their existing parent: {@link useReorderMonitor}
 * reports the new order on drop, we optimistically apply it, and persist via
 * `movePageTo(workspaceId, movedId, parentId, prevViewId)`.
 *
 * The optimistic layer is derived during render against a snapshot of the server
 * order taken at drop time, so it clears itself once the real children catch up
 * (move confirmed, group switched, or a remote reorder) without an extra effect.
 */
export function useReorderableSidebarList({
  items,
  parentId,
  workspaceId,
  dragType,
  enabled,
  autoScrollElementRef,
  errorMessage = 'Failed to reorder items',
}: UseReorderableSidebarListParams): UseReorderableSidebarListResult {
  const refreshOutline = useRefreshOutline();
  const [instanceId] = useState(() => Symbol('sidebar-reorder-instance'));
  const [optimistic, setOptimistic] = useState<OptimisticOrder | null>(null);
  const requestSeqRef = useRef(0);

  // Derived during render (no state-syncing effect): the optimistic order is
  // applied only while the server children still match the snapshot taken at
  // drop time. Once they change — because the move was confirmed, the group
  // switched, or a remote client reordered — we drop back to the server order.
  const orderedItems = useMemo(() => {
    if (!optimistic) return items;
    if (
      !sameIds(
        items.map((item) => item.view_id),
        optimistic.baseIds
      )
    )
      return items;

    const itemById = new Map(items.map((item) => [item.view_id, item]));
    const ordered = optimistic.orderIds.map((id) => itemById.get(id)).filter((item): item is View => Boolean(item));
    const orderedIds = new Set(ordered.map((item) => item.view_id));

    return [...ordered, ...items.filter((item) => !orderedIds.has(item.view_id))];
  }, [optimistic, items]);

  // Mirror the current server / display order into refs so the monitor's drop
  // handler reads fresh values without re-subscribing. Synced in an effect (not
  // during render) so the refs track the last committed render.
  const itemsRef = useRef<View[]>(items);
  const orderedItemsRef = useRef<View[]>(orderedItems);

  useEffect(() => {
    itemsRef.current = items;
    orderedItemsRef.current = orderedItems;
  }, [items, orderedItems]);

  const getOrderedIds = useCallback(() => orderedItemsRef.current.map((item) => item.view_id), []);

  const handleReorder = useCallback(
    ({ movedId, prevId, nextIds }: ReorderResult) => {
      if (!workspaceId || !parentId) return;

      const requestSeq = ++requestSeqRef.current;

      setOptimistic({
        orderIds: nextIds,
        baseIds: itemsRef.current.map((item) => item.view_id),
      });

      void (async () => {
        try {
          await PageService.moveTo(workspaceId, movedId, parentId, prevId);
          // No explicit clear: the derived order drops the optimistic layer once
          // the refreshed/notified children differ from the snapshot above.
          await refreshOutline?.();
        } catch (error) {
          if (requestSeqRef.current !== requestSeq) return;

          setOptimistic(null);
          toast.error(errorMessage);
          Log.error('[Sidebar reorder] Failed to reorder', error);
        }
      })();
    },
    [errorMessage, parentId, refreshOutline, workspaceId]
  );

  useReorderMonitor({
    dragType,
    instanceId,
    axis: 'vertical',
    enabled,
    getOrderedIds,
    onReorder: handleReorder,
    autoScrollElementRef,
  });

  return { orderedItems, instanceId: enabled ? instanceId : undefined };
}
