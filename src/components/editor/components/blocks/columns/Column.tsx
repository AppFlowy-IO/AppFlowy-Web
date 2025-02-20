import { ColumnNode, EditorElementProps } from '@/components/editor/editor.type';
import React, { forwardRef, memo } from 'react';

export const Column = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ColumnNode>>(({ node, children, ...attributes }, ref) => {
    const data = node.data;

    return (
      <div
        ref={ref} {...attributes}
        className={`${attributes.className ?? ''} min-w-[120px] overflow-hidden`}
        style={{
          width: data.width ? `${data.width}px` : '100%',
        }}
      >
        {children}
      </div>
    );
  }),
);