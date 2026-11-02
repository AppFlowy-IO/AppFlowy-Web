import { forwardRef, useCallback, useMemo, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { ColorEnum, renderColor, toBlockColor } from '@/utils/color';

import type { OutlineHeading } from './utils';

interface OutlineContentProps extends HTMLAttributes<HTMLDivElement> {
  root: OutlineHeading[];
  hasHeadings: boolean;
  activeId?: string;
  isCollapsed?: boolean;
  color?: string;
  jumpToHeading: (heading: OutlineHeading) => void;
}

/** The native outline frame and hierarchy, independent of editor state. */
export const OutlineContent = forwardRef<HTMLDivElement, OutlineContentProps>(
  ({ root, hasHeadings, activeId, isCollapsed, color = '', jumpToHeading, children, className, ...attributes }, ref) => {
    const { t } = useTranslation();
    const blockColor = useMemo(() => toBlockColor(color as ColorEnum), [color]);
    const noVisibleHeadings = root.length === 0;
    const renderHeading = useCallback(
      (heading: OutlineHeading, indent: number = 0) => {
        const children = heading.children.map((heading) => renderHeading(heading, indent + 1));
        const { text } = heading.data as { text: string; level: number };

        return (
          <div key={heading.blockId} className={'flex flex-col'}>
            <div
              className='group flex items-stretch'
              role='button'
              tabIndex={0}
              data-outline-heading={heading.blockId}
              onClick={(event) => {
                event.stopPropagation();
                jumpToHeading(heading);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                jumpToHeading(heading);
              }}
            >
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
        ref={ref}
        className={cn(
          'outline-block relative my-1 flex w-full flex-col overflow-hidden rounded-300 bg-fill-list-active',
          className
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
  }
);
