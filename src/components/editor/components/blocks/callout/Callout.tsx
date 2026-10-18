import { CSSProperties, forwardRef, memo } from 'react';
import { Element } from 'slate';
import { useSlateStatic } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';
import { CalloutNode, EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';

import { CALLOUT_FIRST_CHILD_TEXT_TYPES, getCalloutColors, getCalloutIcon } from './callout.utils';
import CalloutIcon from './CalloutIcon';

export const Callout = memo(
  forwardRef<HTMLDivElement, EditorElementProps<CalloutNode>>(({ node, children, ...attributes }, ref) => {
    const { className, style, ...restAttributes } = attributes;
    const editor = useSlateStatic();
    const firstLine = node.children[0];
    const isContainer = Element.isElement(firstLine) && firstLine.type !== YjsEditorKey.text;
    const isEmpty = !Element.isElement(firstLine) || editor.isEmpty(firstLine);
    const colors = getCalloutColors(node.data);
    const hasIcon = !!getCalloutIcon(node.data);

    return (
      <div
        {...restAttributes}
        ref={ref}
        data-testid='callout'
        data-callout-icon={hasIcon ? 'visible' : 'removed'}
        data-callout-layout={isContainer ? 'blocks' : 'legacy'}
        className={cn(
          className,
          'callout-content relative my-1 flex w-full min-w-0 flex-col overflow-hidden rounded-[8px] py-2 pr-2',
          isEmpty ? 'pl-3' : 'pl-4'
        )}
        style={
          {
            ...style,
            backgroundColor: renderColor(colors.bg),
            color: renderColor(colors.text),
            '--callout-content-indent': hasIcon ? '36px' : '4px',
          } as CSSProperties
        }
      >
        <div
          aria-hidden='true'
          contentEditable={false}
          className='pointer-events-none absolute inset-y-0 left-0 w-1'
          style={{ backgroundColor: renderColor(colors.border) }}
        />
        {isContainer && hasIcon && !CALLOUT_FIRST_CHILD_TEXT_TYPES.has(firstLine.type as BlockType) && (
          <div className='callout-container-icon absolute left-4 top-2' contentEditable={false}>
            <CalloutIcon block={node} />
          </div>
        )}
        {children}
      </div>
    );
  })
);

export default Callout;
