import TextareaAutosize from '@mui/material/TextareaAutosize';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { openUrl } from '@/utils/url';

import { imageLink, imageURL } from './image-data';
import { writableImage } from './image-upload';
import { ImageIcon } from './ImageIcons';
import ImageResizeHandle from './ImageResizeHandle';
import ImageToolbar from './ImageToolbar';
import Img from './Img';

export default function ImageRender({
  node,
  localUrl,
  captionRef,
}: {
  node: ImageBlockNode;
  localUrl?: string;
  captionRef?: RefObject<HTMLTextAreaElement>;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const context = useEditorContext();
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [width, setWidth] = useState(node.data.width);
  const [maxWidth, setMaxWidth] = useState(1000);
  // Slate publishes changes after the input event. Keep the immediate draft
  // controlled locally so React cannot restore the old value/caret.
  const [caption, setCaption] = useState(node.data.caption ?? '');

  useEffect(() => setCaption(node.data.caption ?? ''), [node.data.caption]);
  const url = localUrl || node.data.url;
  const rendered = loadedUrl === url;
  const link = imageLink(node.data.link);

  useEffect(() => setWidth(node.data.width), [node.data.width, node.data.align, url]);
  useEffect(() => {
    const parent = host.current?.parentElement;

    if (!parent) return;
    const observer = new ResizeObserver(() => setMaxWidth(parent.clientWidth));

    observer.observe(parent);
    setMaxWidth(parent.clientWidth);
    return () => observer.disconnect();
  }, []);
  const change = useCallback(
    (data: Record<string, unknown>) => {
      if (!readOnly && writableImage(editor, node.blockId)) CustomEditor.setBlockData(editor, node.blockId, data);
    },
    [editor, node.blockId, readOnly]
  );

  if (!url) return null;
  return (
    <div ref={host} className='image-render relative min-w-0 max-w-full' style={{ width: width || '100%' }}>
      <div className='image-selection-surface image-content relative min-h-12 rounded-xl'>
        <Img
          url={url}
          imgRef={img}
          width='100%'
          alt={node.data.caption || node.data.name || undefined}
          onLoad={() => setLoadedUrl(url)}
        />
        {!readOnly &&
          rendered &&
          (['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <ImageResizeHandle
              key={`${url}-${node.data.align}-${maxWidth}-${side}`}
              side={side}
              savedWidth={node.data.width}
              width={Math.min(width || img.current?.offsetWidth || maxWidth, maxWidth)}
              maxWidth={maxWidth}
              ratio={(img.current?.naturalWidth || 1) / (img.current?.naturalHeight || 1)}
              onWidthChange={setWidth}
              onCommit={(width) => change({ width, height: undefined })}
            />
          ))}
        {rendered && <ImageToolbar node={{ ...node, data: { ...node.data, url } }} />}
        {link && (
          <button
            type='button'
            className='absolute inset-0 z-10 cursor-pointer rounded-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-theme-thick'
            title={link.url}
            aria-label={t('web.imageBlock.openLink')}
            onClick={(event) => {
              event.stopPropagation();
              if (link.is_page_link && context.navigateToView) void context.navigateToView(link.page_id!);
              else if (link.is_page_link && context.openPageModal) context.openPageModal(link.page_id!);
              else if (imageURL(link.url)) void openUrl(link.url, '_blank', 'noopener,noreferrer');
            }}
          >
            <span className='image-link-badge pointer-events-none' aria-hidden='true'>
              <ImageIcon name='link' />
            </span>
          </button>
        )}
      </div>
      {typeof node.data.caption === 'string' && (
        <TextareaAutosize
          ref={captionRef}
          readOnly={readOnly}
          className='image-caption'
          aria-label={t('web.imageBlock.caption')}
          placeholder={t('document.plugins.pdf.captionPlaceholder')}
          value={caption}
          onChange={(event) => {
            setCaption(event.target.value);
            change({ caption: event.target.value });
          }}
          onCompositionStart={(event) => event.stopPropagation()}
          onCompositionEnd={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === 'Backspace' && !event.currentTarget.value) {
              event.preventDefault();
              change({ caption: undefined });
            }
          }}
        />
      )}
    </div>
  );
}
