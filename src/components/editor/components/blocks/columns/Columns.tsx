import { ColumnsNode, EditorElementProps } from '@/components/editor/editor.type';
import React, { forwardRef, memo } from 'react';

export const Columns = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ColumnsNode>>(({ node: _node, children, ...attributes }, ref) => {

    return (
      <div
        ref={ref}
        {...attributes}
        className={`${attributes.className ?? ''} flex !flex-row w-full overflow-hidden gap-14`}
      >
        {children}
      </div>
    );
  }),
);