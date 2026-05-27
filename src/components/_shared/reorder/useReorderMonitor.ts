import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import React, { useEffect, useRef } from 'react';

export interface ReorderResult {
  /** The dragged item's id. */
  movedId: string;
  /** The id now directly before the moved item, or null when it lands first. */
  prevId: string | null;
  /** The full id order after the move. */
  nextIds: string[];
  fromIndex: number;
  toIndex: number;
}

interface UseReorderMonitorParams {
  /** Drag-type discriminator; must match the items' `dragType`. */
  dragType: string;
  /** Instance id shared with the items of this group. */
  instanceId: symbol;
  axis: 'vertical' | 'horizontal';
  /** Whether the monitor is active. */
  enabled: boolean;
  /** Returns the current ordered ids to reorder from (read fresh on each drop). */
  getOrderedIds: () => string[];
  /** Called once a drop produces a real position change. */
  onReorder: (result: ReorderResult) => void;
  /** Optional scroll container to auto-scroll while dragging near its edges. */
  autoScrollElementRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Owns the drop handling for one reorderable group: a pragmatic-drag-and-drop
 * element monitor (+ optional auto-scroll) that, on drop, computes the
 * destination index and reports the resulting order via `onReorder`.
 *
 * `getOrderedIds` and `onReorder` are read through refs so the global monitor
 * subscribes once per (enabled) group and is not torn down whenever those
 * callbacks change identity.
 */
export function useReorderMonitor({
  dragType,
  instanceId,
  axis,
  enabled,
  getOrderedIds,
  onReorder,
  autoScrollElementRef,
}: UseReorderMonitorParams): void {
  const getOrderedIdsRef = useRef(getOrderedIds);
  const onReorderRef = useRef(onReorder);

  useEffect(() => {
    getOrderedIdsRef.current = getOrderedIds;
    onReorderRef.current = onReorder;
  });

  useEffect(() => {
    if (!enabled) return;

    function canRespond({ source }: { source: { data: Record<string, unknown> } }) {
      return source.data.type === dragType && source.data.instanceId === instanceId;
    }

    const cleanups: Array<() => void> = [
      monitorForElements({
        canMonitor: canRespond,
        onDrop({ location, source }) {
          const target = location.current.dropTargets[0];

          if (!target) return;

          const sourceId = String(source.data.id ?? '');
          const targetId = String(target.data.id ?? '');

          if (!sourceId || !targetId || sourceId === targetId) return;

          const orderedIds = getOrderedIdsRef.current();
          const startIndex = orderedIds.indexOf(sourceId);
          const indexOfTarget = orderedIds.indexOf(targetId);

          if (startIndex < 0 || indexOfTarget < 0) return;

          const finishIndex = getReorderDestinationIndex({
            startIndex,
            indexOfTarget,
            closestEdgeOfTarget: extractClosestEdge(target.data),
            axis,
          });

          if (finishIndex === startIndex) return;

          const nextIds = reorder({ list: orderedIds, startIndex, finishIndex });
          const prevId = finishIndex > 0 ? nextIds[finishIndex - 1] ?? null : null;

          onReorderRef.current({ movedId: sourceId, prevId, nextIds, fromIndex: startIndex, toIndex: finishIndex });
        },
      }),
    ];

    const autoScrollElement = autoScrollElementRef?.current;

    if (autoScrollElement) {
      cleanups.push(
        autoScrollForElements({
          canScroll: canRespond,
          element: autoScrollElement,
        })
      );
    }

    return combine(...cleanups);
  }, [autoScrollElementRef, axis, dragType, enabled, instanceId]);
}
