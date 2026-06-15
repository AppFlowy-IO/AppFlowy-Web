import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useMemo, useState } from 'react';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { canDragBlock } from '@/components/editor/components/drag-drop/validation';

interface UseBlockDragProps {
  blockId?: string;
  parentId?: string;
  dragHandleRef: React.RefObject<HTMLElement>;
  disabled?: boolean;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * Generates a custom drag preview element
 */
function generateDragPreview(sourceElement: HTMLElement): HTMLElement {
  const container = document.createElement('div');
  const clone = sourceElement.cloneNode(true) as HTMLElement;
  const computedStyle = window.getComputedStyle(sourceElement);
  const blockType = sourceElement.getAttribute('data-block-type');
  const isImage = blockType === 'image';
  
  let targetWidth = sourceElement.offsetWidth;

  if (isImage) {
    const img = sourceElement.querySelector('img');

    if (img && img.offsetWidth > 0) {
      targetWidth = img.offsetWidth;
    }
  }

  // Clean up the clone
  clone.classList.remove('block-element--dragging');
  clone.style.margin = '0';
  clone.style.width = '100%';
  clone.style.pointerEvents = 'none';

  // Style the container to look like a card
  Object.assign(container.style, {
    width: `${targetWidth}px`,
    maxWidth: '600px',
    // Allow full height for images (clamped reasonably), clip text blocks short
    maxHeight: isImage ? '1000px' : '150px',
    backgroundColor: 'var(--bg-body, #ffffff)',
    borderRadius: '8px',
    boxShadow: 'var(--shadows-sm, 0 4px 20px rgba(0, 0, 0, 0.1))',
    overflow: 'hidden',
    position: 'absolute',
    top: '-1000px',
    left: '-1000px',
    zIndex: '9999',
    pointerEvents: 'none',
    border: '1px solid var(--line-divider, rgba(0, 0, 0, 0.1))',
    display: 'block',
    // Copy key typography styles
    fontFamily: computedStyle.fontFamily,
    color: computedStyle.color,
    lineHeight: computedStyle.lineHeight,
    textAlign: computedStyle.textAlign,
    direction: computedStyle.direction,
  });

  // Explicitly handle images to ensure they render correctly in the ghost
  const originalImages = sourceElement.querySelectorAll('img');
  const clonedImages = container.querySelectorAll('img');

  originalImages.forEach((orig, index) => {
    const clonedImg = clonedImages[index];

    if (clonedImg) {
      // Try to use canvas for better snapshot reliability
      try {
        if (orig.complete && orig.naturalWidth > 0) {
          const canvas = document.createElement('canvas');

          canvas.width = orig.offsetWidth;
          canvas.height = orig.offsetHeight;
          const ctx = canvas.getContext('2d');

          if (ctx) {
            ctx.drawImage(orig, 0, 0, canvas.width, canvas.height);
            
            // Copy styles - use responsive sizing
            canvas.style.maxWidth = '100%';
            canvas.style.height = 'auto';
            canvas.style.display = 'block';
            canvas.style.opacity = '1';
            canvas.style.pointerEvents = 'none';
            
            clonedImg.parentNode?.replaceChild(canvas, clonedImg);
            return; // Successfully replaced with canvas
          }
        }
      } catch (e) {
        // Fallback to img tag if canvas fails (e.g. CORS)
      }

      // Fallback logic: configure the cloned img tag
      clonedImg.src = orig.currentSrc || orig.src;
      clonedImg.loading = 'eager';
      clonedImg.style.maxWidth = '100%';
      clonedImg.style.height = 'auto';
      clonedImg.style.opacity = '1';
      clonedImg.style.display = 'block';
    }
  });

  container.appendChild(clone);
  document.body.appendChild(container);
  
  return container;
}

/**
 * Hook to make a block draggable via a drag handle
 */
export function useBlockDrag({
  blockId,
  parentId,
  dragHandleRef,
  disabled = false,
  onDragChange,
}: UseBlockDragProps) {
  const [isDragging, setIsDragging] = useState(false);
  const editor = useSlateStatic() as YjsEditor;

  // Determine if this block can be dragged
  const isDraggable = useMemo(() => {
    return canDragBlock(editor, blockId || '');
  }, [blockId, editor]);

  useEffect(() => {
    const element = dragHandleRef.current;

    if (!element || !blockId || !isDraggable || disabled) {
      return;
    }

    return draggable({
      element,
      getInitialData: () => ({
        type: 'editor-block',
        blockId,
        parentId,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        try {
          const entry = findSlateEntryByBlockId(editor, blockId);

          if (!entry) return;
          const [node] = entry;
          const blockElement = ReactEditor.toDOMNode(editor, node);

          if (blockElement) {
            const preview = generateDragPreview(blockElement);

            nativeSetDragImage?.(preview, 0, 0);
            
            // Cleanup after the browser takes the snapshot
            setTimeout(() => {
              document.body.removeChild(preview);
            }, 0);
          }
        } catch (e) {
          console.warn('Failed to generate drag preview:', e);
        }
      },
      onDragStart: () => {
        setIsDragging(true);
        onDragChange?.(true);
      },
      onDrop: () => {
        setIsDragging(false);
        onDragChange?.(false);
      },
    });
  }, [blockId, parentId, dragHandleRef, isDraggable, disabled, onDragChange, editor]);

  // Safety effect: Reset dragging state if blockId becomes invalid or component unmounts while dragging
  useEffect(() => {
    if ((!blockId || !isDraggable) && isDragging) {
      setIsDragging(false);
      onDragChange?.(false);
    }
  }, [blockId, isDraggable, isDragging, onDragChange]);

  return {
    isDragging,
    isDraggable,
  };
}