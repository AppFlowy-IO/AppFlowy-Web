import { forwardRef, memo } from 'react';

import { EditorElementProps, NumberedListNode } from '@/components/editor/editor.type';

export const NumberedList = memo(
  forwardRef<HTMLDivElement, EditorElementProps<NumberedListNode>>(
    ({ node: _, children, className, ...attributes }, ref) => {
      return (
        <div ref={ref} {...attributes} className={`${className}`}>
          {children}
        </div>
      );
    }
  )
);

export default NumberedList;
