import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import ImageResizer from '@/components/editor/components/blocks/image/ImageResizer';
import { MIN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';
import VideoToolbar from '@/components/editor/components/blocks/video/VideoToolbar';
import { VideoBlockNode } from '@/components/editor/editor.type';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';
import ReactPlayer from 'react-player';

function VideoRender({
  node,
  onError,
}: {
  node: VideoBlockNode;
  onError?: (e: string) => void;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const { width: imageWidth } = useMemo(() => node.data || {}, [node.data]);
  const url = node.data.url;
  const ref = useRef<HTMLDivElement>(null);
  const handleWidthChange = useCallback(
    (newWidth: number) => {
      CustomEditor.setBlockData(editor, node.blockId, {
        width: newWidth,
      });
    },
    [editor, node.blockId],
  );

  const playerProps = useMemo(() => {
    return {
      url,
      width: '100%',
      height: '100%',
    };
  }, [url]);
  const onDragStart = useCallback(() => {
    if(!ref.current) return;
    ref.current.style.pointerEvents = 'none';
  }, []);

  const onDragEnd = useCallback(() => {
    if(!ref.current) return;
    ref.current.style.pointerEvents = 'auto';
  }, []);
  const [showToolbar, setShowToolbar] = useState(false);

  if(!url) return null;

  return (
    <div
      style={{
        width: node.data.width ? `${node.data.width}px` : '100%',
      }}
      contentEditable={false}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
      className={`image-render w-full h-full relative min-h-[100px]`}
    >
      <div
        style={{
          paddingBottom: '56.25%',
          height: '0px',
          width: '100%',
        }}
      >
        <div
          ref={ref}
          className={'w-full absolute left-0 top-0 h-full'}
        >
          <ReactPlayer {...playerProps} onError={() => {
            if(onError) onError('The video embed couldn\'t be loaded');
          }}
          />
        </div>
      </div>

      {!readOnly ? (
        <>
          <ImageResizer
            isLeft
            minWidth={MIN_WIDTH}
            width={imageWidth || ref.current?.offsetWidth || 0}
            onWidthChange={handleWidthChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <ImageResizer
            minWidth={MIN_WIDTH}
            width={imageWidth || ref.current?.offsetWidth || 0}
            onWidthChange={handleWidthChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </>
      ) : null}

      {showToolbar && <VideoToolbar node={node} />}
    </div>
  );
}

export default VideoRender;
