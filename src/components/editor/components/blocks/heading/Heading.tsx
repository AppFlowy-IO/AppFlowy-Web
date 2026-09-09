import { forwardRef, memo } from 'react';

import { HEADER_HEIGHT } from '@/application/constants';
import { EditorElementProps, HeadingNode } from '@/components/editor/editor.type';
import { useEditorPreviewId } from '@/components/editor/EditorPreviewContext';

export const Heading = memo(
  forwardRef<HTMLDivElement, EditorElementProps<HeadingNode>>(({ node, children, ...attributes }, ref) => {
    const level = node.data.level;
    const previewId = useEditorPreviewId();

    const className = `${attributes.className ?? ''} heading level-${level}`;

    return (
      <div
        {...attributes}
        ref={ref}
        id={`${previewId ?? ''}heading-${node.blockId}`}
        style={{
          scrollMarginTop: HEADER_HEIGHT,
          ...attributes.style,
        }}
        className={className}
      >
        {children}
      </div>
    );
  }),
);

export default Heading;
