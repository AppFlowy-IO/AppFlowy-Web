import { forwardRef, memo } from 'react';

import { BulletedListNode, EditorElementProps } from '@/components/editor/editor.type';

export const BulletedList = memo(
  forwardRef<HTMLDivElement, EditorElementProps<BulletedListNode>>(
    ({ node: _, children, className, ...attributes }, ref) => {
      return (
        <div ref={ref} {...attributes} className={`${className}`}>
          {children}
        </div>
      );
    }
  )
);

export default BulletedList;
