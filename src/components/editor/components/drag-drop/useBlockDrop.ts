import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, Edge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useEffect, useState } from 'react';

interface UseBlockDropProps {
  blockId?: string;
  element: HTMLElement | null;
  onDrop: (args: { sourceBlockId: string; targetBlockId: string; edge: Edge }) => void;
}

interface DragData {
  type?: string;
  blockId?: string;
  parentId?: string;
}

/**
 * Hook to make a block a drop target for other blocks
 */
export function useBlockDrop({
  blockId,
  element,
  onDrop,
}: UseBlockDropProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dropEdge, setDropEdge] = useState<Edge | null>(null);

  useEffect(() => {
    if (!element || !blockId) {
      return;
    }

    return dropTargetForElements({
      element: element,
      canDrop: ({ source }) => {
        const data = source.data as DragData;

        // Only accept editor blocks
        if (data.type !== 'editor-block') return false;
        // Can't drop a block onto itself
        if (data.blockId === blockId) return false;
        return true;
      },
      getData: ({ input }) => {
        return attachClosestEdge(
          { blockId },
          {
            input,
            element: element,
            allowedEdges: ['top', 'bottom'],
          }
        );
      },
      onDragEnter: ({ self, source }) => {
        const data = source.data as DragData;

        if (data.blockId === blockId) return;
        
        const edge = extractClosestEdge(self.data);

        setIsDraggingOver(true);
        setDropEdge(edge);
      },
      onDrag: ({ self, source }) => {
        const data = source.data as DragData;

        if (data.blockId === blockId) return;
        
        const edge = extractClosestEdge(self.data);

        setDropEdge(edge);
      },
      onDragLeave: () => {
        setIsDraggingOver(false);
        setDropEdge(null);
      },
      onDrop: ({ self, source }) => {
        const data = source.data as DragData;
        const edge = extractClosestEdge(self.data);

        setIsDraggingOver(false);
        setDropEdge(null);

        if (data.blockId && edge) {
          onDrop({
            sourceBlockId: data.blockId,
            targetBlockId: blockId,
            edge,
          });
        }
      },
    });
  }, [blockId, element, onDrop]);

  return {
    isDraggingOver,
    dropEdge,
  };
}
