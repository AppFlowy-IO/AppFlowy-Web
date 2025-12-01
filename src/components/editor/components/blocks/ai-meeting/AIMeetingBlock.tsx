import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';
import { forwardRef, memo } from 'react';

export const AIMeetingBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNode>>(
    ({ node, children, ...attributes }, ref) => {
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
                Please use the desktop or mobile application to view the meeting content.
              </p>
            </div>
          </div>
        </div>
      );
    }
  )
);

AIMeetingBlock.displayName = 'AIMeetingBlock';
