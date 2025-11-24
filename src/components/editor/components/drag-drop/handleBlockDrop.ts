import { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import { YjsEditor } from '@/application/slate-yjs';
import {
  executeOperations,
  getBlock,
  getBlockIndex,
  moveNode,
} from '@/application/slate-yjs/utils/yjs';
import { CollabOrigin, YjsEditorKey } from '@/application/types';
import { wouldCreateCircularReference } from '@/components/editor/components/drag-drop/validation';

/**
 * Handle dropping a block onto another block
 */
export function handleBlockDrop({
  editor,
  sourceBlockId,
  targetBlockId,
  edge,
}: {
  editor: YjsEditor;
  sourceBlockId: string;
  targetBlockId: string;
  edge: Edge;
}): boolean {
  try {
    const { sharedRoot } = editor;

    if (!sharedRoot) {
      console.warn('No shared root available');
      return false;
    }

    // Get source and target blocks
    const sourceBlock = getBlock(sourceBlockId, sharedRoot);
    const targetBlock = getBlock(targetBlockId, sharedRoot);

    if (!sourceBlock || !targetBlock) {
      console.warn('Source or target block not found');
      return false;
    }

    // Prevent circular references
    if (wouldCreateCircularReference(sourceBlock, targetBlock, sharedRoot)) {
      console.warn('Cannot drop: would create circular reference');
      return false;
    }

    // Get the target's parent (source will move to same parent as target)
    const targetParentId = targetBlock.get(YjsEditorKey.block_parent);
    const targetParent = getBlock(targetParentId, sharedRoot);

    if (!targetParent) {
      console.warn('Target parent not found');
      return false;
    }

    // Calculate the new index
    const targetIndex = getBlockIndex(targetBlockId, sharedRoot);
    const sourceParentId = sourceBlock.get(YjsEditorKey.block_parent);
    
    // Determine new index based on edge
    const newIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    console.debug('Moving block:', {
      sourceBlockId,
      targetBlockId,
      edge,
      targetIndex,
      newIndex,
      sameParent: sourceParentId === targetParentId,
    });

    // Execute the move operation in a transaction
    executeOperations(
      sharedRoot,
      [
        () => {
          moveNode(sharedRoot, sourceBlock, targetParent, newIndex);
        },
      ],
      'handleBlockDrop',
      CollabOrigin.LocalManual
    );

    return true;
  } catch (error) {
    console.error('Error handling block drop:', error);
    return false;
  }
}
