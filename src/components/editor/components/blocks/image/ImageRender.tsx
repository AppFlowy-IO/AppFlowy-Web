import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import ImageResizer from '@/components/editor/components/blocks/image/ImageResizer';
import ImageToolbar from '@/components/editor/components/blocks/image/ImageToolbar';
import Img from '@/components/editor/components/blocks/image/Img';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReadOnly, useSlateStatic } from 'slate-react';
import { Element } from 'slate';

const MIN_WIDTH = 100;

function ImageRender({
  node,
  showToolbar,
  localUrl,
}: {
  selected: boolean;
  localUrl?: string;
  node: ImageBlockNode;
  showToolbar?: boolean;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState(false);

  const { width: imageWidth } = useMemo(() => node.data || {}, [node.data]);
  const url = node.data.url || localUrl;
  const [initialWidth, setInitialWidth] = useState<number | null>(null);
  const [newWidth, setNewWidth] = useState<number | null>(imageWidth ?? null);

  useEffect(() => {
    if(rendered && initialWidth === null && imgRef.current) {
      setInitialWidth(imgRef.current.offsetWidth);
    }
  }, [initialWidth, rendered]);

  const debounceSubmitWidth = useMemo(() => {
    return debounce((newWidth: number) => {
      CustomEditor.setBlockData(editor, node.blockId, {
        width: newWidth,
      });
    }, 300);
  }, [editor, node]);

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      setNewWidth(newWidth);
      debounceSubmitWidth(newWidth);
    },
    [debounceSubmitWidth],
  );

  if(!url) return null;

  return (
    <div
      style={{
        minWidth: MIN_WIDTH,
      }}
      className={`image-render relative min-h-[48px] ${!rendered ? 'w-full' : 'w-fit'}`}
    >
      <Img
        width={rendered ? (newWidth ?? '100%') : 0}
        imgRef={imgRef}
        url={url}
        onLoad={() => {
          setRendered(true);
        }}
      />

      {!readOnly && initialWidth && (
        <>
          <ImageResizer
            isLeft
            minWidth={MIN_WIDTH}
            width={imageWidth ?? initialWidth}
            onWidthChange={handleWidthChange}
          />
          <ImageResizer
            minWidth={MIN_WIDTH}
            width={imageWidth ?? initialWidth}
            onWidthChange={handleWidthChange}
          />
        </>
      )}
      {showToolbar && <ImageToolbar node={node} />}
    </div>
  );
}

export default ImageRender;
