import { forwardRef, memo } from 'react';

import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';

export const AIMeetingBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNode>>(
    ({ node, children: _children, ...attributes }, ref) => {
      const { data } = node;

      const title = data?.title?.trim() || 'AI Meeting';

      return (
        <div
          {...attributes}
          ref={ref}
          className={`${attributes.className ?? ''} ai-meeting-block my-2 overflow-hidden rounded-2xl bg-fill-list-active`}
          contentEditable={false}
        >
          <div className="px-4 py-4">
            <h2 className="text-3xl font-semibold text-text-primary">
              {title}
            </h2>
          </div>

          <div className="mx-0.5 mb-0.5 rounded-2xl bg-bg-body">
            <div className="flex flex-col items-center justify-center px-8 py-10">
              <p className="text-base text-text-secondary">
                This content isn&apos;t supported on the web version yet.
              </p>
              <p className="text-base text-text-secondary">
                Please switch to the desktop or mobile app to view this content.
              </p>
            </div>
          </div>
        </div>
      );
    }
  )
);

AIMeetingBlock.displayName = 'AIMeetingBlock';
