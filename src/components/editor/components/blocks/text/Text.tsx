import { forwardRef, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useSlateStatic } from 'slate-react';

import Placeholder from '@/components/editor/components/blocks/text/Placeholder';
import { EditorElementProps, TextNode } from '@/components/editor/editor.type';

import { useStartIcon } from './StartIcon.hooks';

export const Text = forwardRef<HTMLSpanElement, EditorElementProps<TextNode>>(
  ({ node, children, className: classNameProp, ...attributes }, ref) => {
    const { hasStartIcon, renderIcon } = useStartIcon(node);
    const editor = useSlateStatic();
    const isEmpty = editor.isEmpty(node);
    const className = useMemo(() => {
      const classList = ['text-element', 'relative', 'flex', 'w-full', 'whitespace-pre-wrap', 'break-word'];

      if(classNameProp) classList.push(classNameProp);
      if(hasStartIcon) classList.push('has-start-icon');
      return classList.join(' ');
    }, [classNameProp, hasStartIcon]);

    const placeholder = useMemo(() => {
      if(!isEmpty) return null;
      return <ErrorBoundary fallback={null}>
        <Placeholder node={node} />
      </ErrorBoundary>;
    }, [isEmpty, node]);

    const content = useMemo(() => {
      return <>

        <span className={`relative text-content leading-[1.5em] ${isEmpty ? 'empty-text' : ''}`}>
          {placeholder}{children}</span>
      </>;
    }, [placeholder, isEmpty, children]);

    return (
      <span {...attributes} ref={ref}
            className={className}
      >
        {renderIcon()}
        {content}
      </span>
    );
  },
);
