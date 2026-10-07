import { forwardRef, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { useOutlineNavigation } from '@/components/editor/components/blocks/outline/OutlineNavigation';
import { nestHeadings, OutlineHeading } from '@/components/editor/components/blocks/outline/utils';
import { EditorElementProps, OutlineNode } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';
import { cn } from '@/lib/utils';
import { ColorEnum, renderColor, toBlockColor } from '@/utils/color';

export const Outline = memo(
  forwardRef<HTMLDivElement, EditorElementProps<OutlineNode>>(({ node, children, className, ...attributes }, ref) => {
    const editor = useSlateStatic();
    const { headings, hasHeadings, activeId, jumpToHeading } = useOutlineNavigation();
    const root = useMemo(
      () => nestHeadings(headings.filter((heading) => heading.data.level <= (node.data.depth || 6))),
      [headings, node.data.depth]
    );
    const noVisibleHeadings = root.length === 0;
    const { t } = useTranslation();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const { collapsedMap } = useEditorLocalState();

    const blockColor = useMemo(() => {
      return toBlockColor((node?.data?.bgColor || '') as ColorEnum);
    }, [node?.data?.bgColor]);

    const isCollapsed = collapsedMap ? collapsedMap[node.blockId] : false;

    const renderHeading = useCallback(
      (heading: OutlineHeading, indent: number = 0) => {
        const children = heading.children.map((heading) => renderHeading(heading, indent + 1));
        const { text } = heading.data as { text: string; level: number };

        return (
          <div
            key={heading.blockId}
            onClick={(e) => {
              e.stopPropagation();
              jumpToHeading(heading);
            }}
            className={'flex flex-col'}
          >
            <div className='group flex items-stretch'>
              <div
                className={cn(
                  'z-10 !min-h-full w-[3px] shrink-0 rounded-[100px] group-hover:bg-[var(--outline-accent-strip)]',
                  heading.blockId === activeId && 'bg-[var(--outline-accent-strip)]'
                )}
                style={{ '--outline-accent-strip': renderColor(blockColor.icon) } as React.CSSProperties}
              />
              <div className='shrink-0' style={{ width: `${(indent + 1) * 12}px` }} />
              <div
                className={'flex-grow cursor-pointer rounded-md px-2 py-1 group-hover:bg-[var(--outline-heading-bg)]'}
                style={{ '--outline-heading-bg': renderColor(blockColor.bgHover) } as React.CSSProperties}
              >
                {text}
              </div>
            </div>
            {!isCollapsed && children.length > 0 && children}
          </div>
        );
      },
      [blockColor, jumpToHeading, isCollapsed, activeId]
    );

    return (
      <div
        {...attributes}
        contentEditable={readOnly ? false : undefined}
        ref={ref}
        className={cn(
          'outline-block relative my-1 flex w-full flex-col overflow-hidden rounded-300 bg-fill-list-active',
          className || ''
        )}
        style={{
          backgroundColor: renderColor(blockColor.bg),
          color: renderColor(blockColor.text),
        }}
      >
        <div className={'absolute left-3 top-2 select-none caret-transparent'}>{children}</div>
        <div contentEditable={false} className={`flex w-full select-none flex-col`}>
          <div className={cn('text-md pl-5 pr-3 pt-4 font-bold', isCollapsed && 'pb-4')}>
            {t('document.plugins.outline.outlineBlock')}
          </div>
          {!isCollapsed ? (
            <div className='py-4 pl-5 pr-3'>
              {noVisibleHeadings ? (
                <div className={'text-text-secondary'}>
                  {hasHeadings
                    ? t('document.plugins.outline.noMatchHeadings')
                    : t('document.plugins.outline.addHeadingToCreateOutline')}
                </div>
              ) : (
                <div className='relative'>
                  <div className='flex w-full flex-col'>{root.map((heading) => renderHeading(heading))}</div>
                  <div className='absolute bottom-0 left-0 top-0 w-px bg-border-primary' />
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  })
);

export default Outline;
