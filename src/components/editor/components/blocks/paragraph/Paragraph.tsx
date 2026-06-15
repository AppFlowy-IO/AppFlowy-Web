import { forwardRef, memo } from 'react';

import { EditorElementProps, ParagraphNode } from '@/components/editor/editor.type';

export const Paragraph = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ParagraphNode>>(({ node: _, children, ...attributes }, ref) => {
    {
      return (
        <div ref={ref} {...attributes} className={`${attributes.className ?? ''}`}>
          {children}
        </div>
      );
    }
  })
);
