import { forwardRef, memo, useMemo } from 'react';

import { EditorElementProps, QuoteNode } from '@/components/editor/editor.type';

export const Quote = memo(
  forwardRef<HTMLDivElement, EditorElementProps<QuoteNode>>(({ node: _, children, ...attributes }, ref) => {
    const className = useMemo(() => {
      return `${attributes.className ?? ''} quote-block`;
    }, [attributes.className]);

    return (
      <div
        {...attributes}
        ref={ref}
        className={className}
      >
        <span className='quote-rail' contentEditable={false} aria-hidden='true' />
        <div className='quote-content'>
          {children}
        </div>

      </div>
    );
  }),
);

export default Quote;
