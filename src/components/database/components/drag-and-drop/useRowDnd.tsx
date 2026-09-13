import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';

import { ClearSortingConfirm } from '@/components/database/components/sorts/ClearSortingConfirm';

export type { Edge };

export interface UseRowDndOptions {
  dragHandleRef: MutableRefObject<HTMLDivElement | null>;
  enabled: boolean;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  rowId: string;
  /** The element that is picked up (and, by default, the drop target). */
  rowRef: MutableRefObject<HTMLDivElement | null>;
  /** A wider element to accept drops on, e.g. a whole timeline row. */
  dropTargetRef?: MutableRefObject<HTMLDivElement | null>;
  hasSorts: boolean;
  /** Drag payload type; rows only drop onto rows of the same kind. */
  dragType?: string;
}

/**
 * Vertical row reordering with a dedicated drag handle: the row is the drop
 * target (top / bottom edge), a manual sort is confirmed away first when the
 * view is sorted, and the click that follows a drag is swallowed.
 */
export function useRowDnd({
  dragHandleRef,
  enabled,
  onDropRow,
  rowId,
  rowRef,
  dropTargetRef,
  hasSorts,
  dragType = 'database-list-row',
}: UseRowDndOptions) {
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clearSortsOpen, setClearSortsOpen] = useState(false);
  const pendingDropRef = useRef<(() => void) | null>(null);
  const ignoreClickRef = useRef(false);

  useEffect(() => {
    const element = rowRef.current;
    const dropTarget = dropTargetRef?.current ?? element;
    const dragHandle = dragHandleRef.current;

    if (!enabled || !element || !dropTarget || !dragHandle || !onDropRow) return;

    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => ({ type: dragType, rowId }),
        onDragStart: () => {
          ignoreClickRef.current = true;
          setDragging(true);
        },
        onDrop: () => {
          setDragging(false);
          window.setTimeout(() => {
            ignoreClickRef.current = false;
          }, 0);
        },
      }),
      dropTargetForElements({
        element: dropTarget,
        canDrop: ({ source }) => source.data.type === dragType && source.data.rowId !== rowId,
        getData: ({ input, element: targetElement }) =>
          attachClosestEdge(
            { type: dragType, rowId },
            { allowedEdges: ['top', 'bottom'], element: targetElement, input }
          ),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ self, source }) => {
          const edge = extractClosestEdge(self.data);
          const sourceRowId = source.data.rowId;

          setClosestEdge(null);
          if (!edge || typeof sourceRowId !== 'string') return;

          const move = () => onDropRow(sourceRowId, rowId, edge);

          if (hasSorts) {
            pendingDropRef.current = move;
            setClearSortsOpen(true);
          } else {
            move();
          }
        },
      })
    );
  }, [dragHandleRef, dragType, dropTargetRef, enabled, hasSorts, onDropRow, rowId, rowRef]);

  return {
    clearSortsDialog:
      enabled && clearSortsOpen ? (
        <ClearSortingConfirm
          onClose={() => {
            pendingDropRef.current = null;
            setClearSortsOpen(false);
          }}
          onRemoved={() => {
            pendingDropRef.current?.();
            pendingDropRef.current = null;
          }}
          open={clearSortsOpen}
        />
      ) : null,
    closestEdge,
    dragging,
    ignoreClickRef,
  };
}
