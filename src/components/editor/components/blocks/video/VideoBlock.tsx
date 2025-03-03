import { YjsEditor } from '@/application/slate-yjs';
import { AlignType, BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import VideoEmpty from '@/components/editor/components/blocks/video/VideoEmpty';
import { EditorElementProps, VideoBlockNode } from '@/components/editor/editor.type';
import React, { forwardRef, memo, useCallback, useMemo, useRef } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import VideoRender from './VideoRender';

export const VideoBlock = memo(forwardRef<HTMLDivElement, EditorElementProps<VideoBlockNode>>(({
  node,
  children,
  ...attributes
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { blockId, data } = node;
  const { url, align } = data || {};
  const editor = useSlateStatic() as YjsEditor;
  const [error, setError] = React.useState<string | undefined>(undefined);

  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

  const className = useMemo(() => {
    const classList = ['w-full'];

    if(attributes.className) {
      classList.push(attributes.className);
    }

    return classList.join(' ');
  }, [attributes.className]);

  const alignCss = useMemo(() => {
    if(!align) return '';

    return align === AlignType.Center ? 'justify-center' : align === AlignType.Right ? 'justify-end' : 'justify-start';
  }, [align]);
  const {
    openPopover,
  } = usePopoverContext();

  const handleClick = useCallback(async() => {
    try {
      if(!url || error) {
        if(!readOnly && containerRef.current) {
          openPopover(blockId, BlockType.VideoBlock, containerRef.current);
        }

        return;
      }

      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e.message);
    }
  }, [url, error, readOnly, openPopover, blockId]);

  return (
    <div
      {...attributes}
      ref={containerRef}
      className={className}
      onClick={handleClick}
    >
      <div
        contentEditable={false}
        className={`embed-block relative ${alignCss} ${url && !error ? '!bg-transparent !border-none !rounded-none' : 'p-4'}`}
      >
        {url && !error ? <VideoRender
          node={node}
          onError={setError}
        /> : <VideoEmpty
          error={error}
          node={node}
        />}
      </div>
      <div
        ref={ref}
        className={'absolute left-0 top-0 h-full w-full select-none caret-transparent'}
      >
        {children}
      </div>
    </div>
  );
}));

export default VideoBlock;

