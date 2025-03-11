import { ColumnNode, EditorElementProps } from '@/components/editor/editor.type';
import React, { forwardRef, memo } from 'react';

export const Column = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ColumnNode>>(({ node: _node, children, ...attributes }, ref) => {
    return (
      <div
        ref={ref}
        {...attributes}
        className={`${attributes.className ?? ''} overflow-hidden`}
      >
        {children}
      </div>
    );
  }),
);