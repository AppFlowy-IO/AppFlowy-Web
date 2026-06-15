import { useEffect, useState } from 'react';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import ControlActions from '@/components/editor/components/toolbar/block-controls/ControlActions';
import { useHoverControls } from '@/components/editor/components/toolbar/block-controls/HoverControls.hooks';

export function HoverControls () {
  const [openMenu, setOpenMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const editor = useSlateStatic() as YjsEditor;

  const { ref, cssProperty, hoveredBlockId, hoveredBlockParentId } = useHoverControls({
    disabled: openMenu || isDragging,
  });

  useEffect(() => {
    if (!hoveredBlockId) return;

    try {
      const entry = findSlateEntryByBlockId(editor, hoveredBlockId);

      if (!entry) return;

      const [node] = entry;
      const blockElement = ReactEditor.toDOMNode(editor, node);

      if (isDragging) {
        blockElement.classList.add('block-element--dragging');
      } else {
        blockElement.classList.remove('block-element--dragging');
      }

      return () => {
        blockElement.classList.remove('block-element--dragging');
      };
    } catch {
      // ignore
    }
  }, [editor, hoveredBlockId, isDragging]);

  return (
    <>
      <div
        ref={ref}
        data-testid={'hover-controls'}
        contentEditable={false}
        // Prevent the toolbar from being selected
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className={`absolute hover-controls w-[64px] px-1 z-10 opacity-0 flex items-center justify-end ${cssProperty} ${isDragging ? 'pointer-events-none opacity-0' : ''}`}
      >
        {/* Ensure the toolbar in middle */}
        <div className={`invisible hover-controls-placeholder`}>$</div>
        <ControlActions
          setOpenMenu={setOpenMenu}
          parentId={hoveredBlockParentId}
          blockId={hoveredBlockId}
          onDraggingChange={setIsDragging}
        />
      </div>

    </>
  );
}

export default HoverControls;
