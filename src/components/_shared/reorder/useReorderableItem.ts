import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag state for a single reorderable item (sidebar row, database tab, …).
 *
 * - `idle`: not involved in a drag.
 * - `dragging`: this item is being dragged (render it dimmed).
 * - `over`: another item is hovering over this one; `closestEdge` is the edge the
 *   dragged item would land against (top/bottom for vertical lists, left/right
 *   for horizontal ones).
 */
export type ReorderableItemDragState =
  | { type: 'idle' }
  | { type: 'dragging' }
  | { type: 'over'; closestEdge: Edge | null };

const idleState: ReorderableItemDragState = { type: 'idle' };

const VERTICAL_EDGES: Edge[] = ['top', 'bottom'];

interface UseReorderableItemParams {
  /** The element that should become draggable / a drop target. */
  elementRef: React.RefObject<HTMLElement | null>;
  /** This item's id. */
  id: string;
  /** Drag-type discriminator; must match the owning monitor's `dragType`. */
  dragType: string;
  /**
   * The owning group's instance id. Items only interact with drags from the same
   * instance, which scopes reordering to a single group. When undefined the item
   * is inert.
   */
  instanceId: symbol | undefined;
  /**
   * Whether this item can be picked up. An item that cannot be dragged still acts
   * as a drop target so draggable siblings can be reordered around it.
   */
  canDrag: boolean;
  /**
   * Which edges the drop indicator may attach to. Use `['top', 'bottom']` for
   * vertical lists (default) and `['left', 'right']` for horizontal ones.
   */
  allowedEdges?: Edge[];
}

interface UseReorderableItemResult {
  dragState: ReorderableItemDragState;
  /**
   * Call at the start of the item's click handler. Returns true when the click
   * immediately follows a drag and should be ignored (prevents navigation /
   * selection from firing after a drop).
   */
  shouldSuppressClick: () => boolean;
}

/**
 * Wires an element up for drag-to-reorder using pragmatic-drag-and-drop.
 *
 * Shared by the sidebar (vertical) and the database tab bar (horizontal); the
 * persistence / ordering lives in {@link useReorderMonitor} and the owning
 * component.
 */
export function useReorderableItem({
  elementRef,
  id,
  dragType,
  instanceId,
  canDrag,
  allowedEdges = VERTICAL_EDGES,
}: UseReorderableItemParams): UseReorderableItemResult {
  const [dragState, setDragState] = useState<ReorderableItemDragState>(idleState);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number>();

  useEffect(() => {
    return () => {
      if (suppressClickTimeoutRef.current !== undefined) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, []);

  const shouldSuppressClick = useCallback(() => {
    if (!suppressClickRef.current) return false;

    suppressClickRef.current = false;
    if (suppressClickTimeoutRef.current !== undefined) {
      window.clearTimeout(suppressClickTimeoutRef.current);
      suppressClickTimeoutRef.current = undefined;
    }

    return true;
  }, []);

  // Serialize allowed edges so the effect re-runs only when the set changes,
  // not on every new array literal from the caller.
  const allowedEdgesKey = allowedEdges.join(',');

  useEffect(() => {
    const element = elementRef.current;

    if (!instanceId || !element) return;

    const data = {
      type: dragType,
      instanceId,
      id,
    };
    const edges = allowedEdgesKey.split(',') as Edge[];

    const cleanups: Array<() => void> = [];

    if (canDrag) {
      cleanups.push(
        draggable({
          element,
          getInitialData: () => data,
          onDragStart() {
            suppressClickRef.current = true;
            if (suppressClickTimeoutRef.current !== undefined) {
              window.clearTimeout(suppressClickTimeoutRef.current);
              suppressClickTimeoutRef.current = undefined;
            }

            setDragState({ type: 'dragging' });
          },
          onDrop() {
            suppressClickTimeoutRef.current = window.setTimeout(() => {
              suppressClickRef.current = false;
              suppressClickTimeoutRef.current = undefined;
            }, 0);

            setDragState(idleState);
          },
        })
      );
    }

    cleanups.push(
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === dragType && source.data.instanceId === instanceId && source.data.id !== id,
        getIsSticky: () => true,
        getData({ input }) {
          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: edges,
          });
        },
        onDrag({ self }) {
          const closestEdge = extractClosestEdge(self.data);

          setDragState((current) => {
            if (current.type === 'over' && current.closestEdge === closestEdge) return current;
            return { type: 'over', closestEdge };
          });
        },
        onDragLeave() {
          setDragState(idleState);
        },
        onDrop() {
          setDragState(idleState);
        },
      })
    );

    return combine(...cleanups);
  }, [allowedEdgesKey, canDrag, dragType, elementRef, id, instanceId]);

  return { dragState, shouldSuppressClick };
}
