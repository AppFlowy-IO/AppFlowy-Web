import { EditorElementProps, QuoteNode } from '@/components/editor/editor.type';
import React, { forwardRef, memo, useMemo } from 'react';

export const Quote = memo(
  forwardRef<HTMLDivElement, EditorElementProps<QuoteNode>>(({ node: _, children, ...attributes }, ref) => {
    const className = useMemo(() => {
      return `${attributes.className ?? ''} pl-[9px] quote-block`;
    }, [attributes.className]);

    return (
      <div
        {...attributes}
        ref={ref}
        className={className}
      >
        <div className={'border-l-4 border-fill-default pl-[13px]'}>
          {children}
        </div>

      </div>
    );
  }),
);

export default Quote;
