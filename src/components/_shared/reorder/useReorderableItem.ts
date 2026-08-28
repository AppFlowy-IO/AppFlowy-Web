import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  attachReorderableTreeItemData,
  extractReorderableTreeItemData,
  type ReorderableTreeItemData,
} from '@/components/_shared/reorder/treeItem';

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
  | { type: 'over'; closestEdge: Edge | null; instruction: Instruction | null };

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
  /** Optional metadata that lets this item move across lists in one tree. */
  treeItem?: ReorderableTreeItemData;
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
  treeItem,
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

    const baseData = {
      type: dragType,
      instanceId,
      id,
    };
    const data = treeItem ? attachReorderableTreeItemData(baseData, treeItem) : baseData;
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
        canDrop: ({ source }) => {
          if (source.data.type !== dragType || source.data.id === id) return false;

          const sameList = source.data.instanceId === instanceId;
          const sourceTreeItem = extractReorderableTreeItemData(source.data);

          if (!treeItem || !sourceTreeItem || sourceTreeItem.scopeId !== treeItem.scopeId) {
            return sameList;
          }

          const sourceId = String(source.data.id ?? '');

          // Moving an ancestor beside or inside one of its descendants would
          // create a cycle. The rendered target already knows its full path.
          if (treeItem.ancestorIds.includes(sourceId)) return false;

          if (!sameList && (!sourceTreeItem.canMoveAcrossParents || !treeItem.canAcceptMovedSiblings)) {
            return false;
          }

          return true;
        },
        getIsSticky: () => true,
        getData({ input, source }) {
          const sourceTreeItem = extractReorderableTreeItemData(source.data);

          if (treeItem && sourceTreeItem?.scopeId === treeItem.scopeId) {
            const block: Instruction['type'][] = [];

            if (!sourceTreeItem.canMoveAcrossParents || !treeItem.canAcceptChildren) {
              block.push('make-child');
            }

            return attachInstruction(data, {
              element,
              input,
              currentLevel: treeItem.currentLevel,
              indentPerLevel: treeItem.indentPerLevel,
              mode: 'standard',
              block,
            });
          }

          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: edges,
          });
        },
        onDrag({ self }) {
          const instruction = extractInstruction(self.data);
          const closestEdge = extractClosestEdge(self.data);
          const instructionEdge =
            instruction?.type === 'reorder-above' ? 'top' : instruction?.type === 'reorder-below' ? 'bottom' : null;

          setDragState((current) => {
            const nextClosestEdge = instruction ? instructionEdge : closestEdge;

            if (
              current.type === 'over' &&
              current.closestEdge === nextClosestEdge &&
              current.instruction === instruction
            ) {
              return current;
            }

            return { type: 'over', closestEdge: nextClosestEdge, instruction };
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
  }, [allowedEdgesKey, canDrag, dragType, elementRef, id, instanceId, treeItem]);

  return { dragState, shouldSuppressClick };
}
