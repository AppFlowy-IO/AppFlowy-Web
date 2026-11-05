import { forwardRef, memo } from 'react';

import { ColumnsNode, EditorElementProps } from '@/components/editor/editor.type';

export const Columns = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ColumnsNode>>(({ node: _node, children, ...attributes }, ref) => {
    return (
      <div
        ref={ref}
        {...attributes}
        className={`${attributes.className ?? ''} flex w-full !flex-row gap-[6px] overflow-hidden`}
      >
        {children}
      </div>
    );
  })
);
