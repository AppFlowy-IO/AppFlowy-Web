import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';

const treeItemDataKey = Symbol('reorderable-tree-item-data');

export type ActionableTreeInstruction = Extract<Instruction, { type: 'reorder-above' | 'reorder-below' | 'make-child' }>;

/**
 * Extra metadata used when a reorderable item participates in a tree.
 *
 * `instanceId` still identifies one sibling list. `scopeId` identifies the
 * whole tree, allowing a draggable item to cross sibling-list boundaries while
 * keeping unrelated trees (database tabs, move popovers, etc.) isolated.
 */
export interface ReorderableTreeItemData {
  scopeId: symbol;
  parentId: string;
  currentLevel: number;
  indentPerLevel: number;
  canMoveAcrossParents: boolean;
  canAcceptChildren: boolean;
  canAcceptMovedSiblings: boolean;
  ancestorIds: readonly string[];
  siblingIds: readonly string[];
  childIds: readonly string[];
}

export interface TreeMoveDestination {
  parentId: string;
  prevId: string | null;
}

export interface OrderedMoveResult {
  nextIds: string[];
  fromIndex: number;
  toIndex: number;
}

export function attachReorderableTreeItemData(
  data: Record<string | symbol, unknown>,
  treeItem: ReorderableTreeItemData
): Record<string | symbol, unknown> {
  return {
    ...data,
    [treeItemDataKey]: treeItem,
  };
}

export function extractReorderableTreeItemData(data: Record<string | symbol, unknown>): ReorderableTreeItemData | null {
  const value = data[treeItemDataKey];

  if (!value || typeof value !== 'object') return null;
  return value as ReorderableTreeItemData;
}

/** Resolve the API parent/previous-sibling pair for a tree drop. */
export function resolveTreeMoveDestination({
  instruction,
  sourceId,
  targetId,
  targetParentId,
  targetSiblingIds,
  targetChildIds,
}: {
  instruction: ActionableTreeInstruction;
  sourceId: string;
  targetId: string;
  targetParentId: string;
  targetSiblingIds: readonly string[];
  targetChildIds: readonly string[];
}): TreeMoveDestination | null {
  if (instruction.type === 'make-child') {
    let prevId: string | null = null;

    for (let index = targetChildIds.length - 1; index >= 0; index -= 1) {
      const childId = targetChildIds[index];

      if (childId && childId !== sourceId) {
        prevId = childId;
        break;
      }
    }

    return { parentId: targetId, prevId };
  }

  const siblingsWithoutSource = targetSiblingIds.filter((id) => id !== sourceId);
  const targetIndex = siblingsWithoutSource.indexOf(targetId);

  if (targetIndex < 0) return null;

  if (instruction.type === 'reorder-below') {
    return { parentId: targetParentId, prevId: targetId };
  }

  return {
    parentId: targetParentId,
    prevId: targetIndex > 0 ? siblingsWithoutSource[targetIndex - 1] ?? null : null,
  };
}

/** Apply the API's `prev_view_id` insertion semantics to one sibling order. */
export function moveIdAfterPrevious(
  orderedIds: readonly string[],
  movedId: string,
  prevId: string | null
): OrderedMoveResult | null {
  const fromIndex = orderedIds.indexOf(movedId);

  if (fromIndex < 0 || prevId === movedId) return null;

  const nextIds = orderedIds.filter((id) => id !== movedId);
  const insertionIndex = prevId === null ? 0 : nextIds.indexOf(prevId) + 1;

  if (insertionIndex < 0 || (prevId !== null && insertionIndex === 0)) return null;

  nextIds.splice(insertionIndex, 0, movedId);

  return {
    nextIds,
    fromIndex,
    toIndex: insertionIndex,
  };
}
