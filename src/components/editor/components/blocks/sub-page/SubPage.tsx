import { forwardRef, memo, useMemo } from 'react';
import { useReadOnly } from 'slate-react';

import MentionPage from '@/components/editor/components/leaf/mention/MentionPage';
import { EditorElementProps, SubpageNode } from '@/components/editor/editor.type';

export const SubPage = memo(
  forwardRef<HTMLDivElement, EditorElementProps<SubpageNode>>(({ node, children, ...attributes }, ref) => {
    const className = useMemo(() => {
      const classList = [
        'subpage',
        attributes.className ?? '',
        'relative',
        'w-full',
        'h-full',
        'overflow-hidden',
        'hover:bg-fill-content-hover',
        'rounded-[8px] p-1 cursor-pointer',
      ];

      return classList.join(' ');
    }, [attributes.className]);

    const pageId = node.data?.view_id;
    const readOnly = useReadOnly();

    if (typeof pageId !== 'string' || !pageId) {
      // Keep Slate's children mounted even when an incomplete reference has
      // no page to display.
      return (
        <div {...attributes} ref={ref} className='hidden' contentEditable={false}>
          {children}
        </div>
      );
    }

    return (
      <div {...attributes} contentEditable={readOnly ? false : undefined} className={className}>
        <div ref={ref} className={'absolute left-0 top-0 h-full w-full select-none caret-transparent'}>
          {children}
        </div>
        <MentionPage text={node} pageId={pageId} />
      </div>
    );
  })
);

export default SubPage;
