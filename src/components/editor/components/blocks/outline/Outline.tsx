import { forwardRef, memo, useMemo } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { useOutlineNavigation } from '@/components/editor/components/blocks/outline/OutlineNavigation';
import { nestHeadings } from '@/components/editor/components/blocks/outline/utils';
import { EditorElementProps, OutlineNode } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';

import { OutlineContent } from './OutlineContent';

export const Outline = memo(
  forwardRef<HTMLDivElement, EditorElementProps<OutlineNode>>(({ node, children, ...attributes }, ref) => {
    const editor = useSlateStatic();
    const { headings, hasHeadings, activeId, jumpToHeading } = useOutlineNavigation();
    const root = useMemo(
      () => nestHeadings(headings.filter((heading) => heading.data.level <= (node.data.depth || 6))),
      [headings, node.data.depth]
    );
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const { collapsedMap } = useEditorLocalState();

    return (
      <OutlineContent
        {...attributes}
        ref={ref}
        contentEditable={readOnly ? false : undefined}
        root={root}
        hasHeadings={hasHeadings}
        activeId={activeId}
        jumpToHeading={jumpToHeading}
        color={node.data.bgColor}
        isCollapsed={collapsedMap?.[node.blockId]}
      >
        {children}
      </OutlineContent>
    );
  })
);

export default Outline;
