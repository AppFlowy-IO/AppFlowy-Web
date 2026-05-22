import axios from 'axios';
import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { BlockType, LinkPreviewType } from '@/application/types';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import emptyImageSrc from '@/assets/images/empty.png';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, LinkPreviewNode } from '@/components/editor/editor.type';
import { openUrl } from '@/utils/url';

export const LinkPreview = memo(
  forwardRef<HTMLDivElement, EditorElementProps<LinkPreviewNode>>(({ node, children, ...attributes }, ref) => {
    const [data, setData] = useState<{
      image?: { url: string };
      title: string;
      description: string;
    } | null>(null);
    const [notFound, setNotFound] = useState<boolean>(false);
    const url = node.data.url;
    const previewType = node.data.preview_type ?? LinkPreviewType.Bookmark;
    const isEmbed = previewType === LinkPreviewType.Embed;
    const editor = useSlateStatic() as YjsEditor;
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const emptyRef = useRef<HTMLDivElement>(null);
    const { openPopover } = usePopoverContext();

    useEffect(() => {
      if (!url) return;

      setData(null);
      void (async () => {
        try {
          setNotFound(false);
          const response = await axios.get(`https://api.microlink.io/?url=${url}`);

          if (response.data.statusCode !== 200) {
            setNotFound(true);
            return;
          }

          const data = response.data.data;

          setData(data);
        } catch (_) {
          setNotFound(true);
        }
      })();
    }, [url]);
    const imageUrl = data?.image?.url;
    const handleClick = useCallback(() => {
      if (!url) {
        if (!readOnly && emptyRef.current) {
          openPopover(node.blockId, BlockType.LinkPreview, emptyRef.current);
        }

        return;
      }

      void openUrl(url, '_blank');
    }, [node.blockId, openPopover, readOnly, url]);

    return (
      <div
        onClick={handleClick}
        contentEditable={readOnly ? false : undefined}
        {...attributes}
        ref={ref}
        className={'link-preview-block relative w-full min-w-0 cursor-pointer'}
      >
        <div
          className={`link-preview-card link-preview-card-${previewType} embed-block min-w-0 ${
            isEmbed ? 'flex-col items-stretch p-0' : 'items-center p-4'
          }`}
          contentEditable={false}
        >
          {!url ? (
            <div ref={emptyRef} className={'flex w-full min-w-0 items-center gap-3 text-text-secondary'}>
              <LinkIcon className={'h-6 w-6 flex-none'} />
              <div className={'truncate'}>{isEmbed ? 'Paste a link to embed' : 'Paste a link to create a bookmark'}</div>
            </div>
          ) : notFound ? (
            <div className={`link-preview-not-found flex w-full min-w-0 ${isEmbed ? 'flex-col' : 'items-center'}`}>
              {!isEmbed && (
                <div
                  className={
                    'link-preview-empty-thumb mr-2 flex h-[80px] w-[120px] min-w-[80px] items-center justify-center rounded border text-text-primary'
                  }
                >
                  <img
                    src={emptyImageSrc}
                    alt={'Empty state'}
                    className={'link-preview-empty-image h-full object-cover object-center'}
                  />
                </div>
              )}
              <div className={`link-preview-content flex min-w-0 flex-1 flex-col ${isEmbed ? 'p-4' : ''}`}>
                <div className={'link-preview-title text-function-error'}>
                  The link cannot be previewed. Click to open in a new tab.
                </div>
                <div className={'link-preview-url text-sm text-text-secondary'}>{url}</div>
              </div>
            </div>
          ) : (
            <>
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={''}
                  className={
                    isEmbed
                      ? 'link-preview-image link-preview-embed-image max-h-[320px] w-full object-cover object-center'
                      : 'link-preview-image h-[80px] w-[120px] flex-none rounded object-cover object-center max-sm:w-[25%]'
                  }
                />
              )}
              <div
                className={`link-preview-content flex min-w-0 flex-1 flex-col justify-center gap-2 overflow-hidden ${
                  isEmbed ? 'p-4' : ''
                }`}
              >
                <div
                  className={
                    'link-preview-title max-h-[48px] overflow-hidden truncate text-base font-bold text-text-primary'
                  }
                >
                  {data?.title}
                </div>
                <div
                  className={'link-preview-description max-h-[64px] overflow-hidden truncate text-sm text-text-primary'}
                >
                  {data?.description}
                </div>
                <div className={'link-preview-url truncate whitespace-nowrap text-xs text-text-secondary'}>{url}</div>
              </div>
            </>
          )}
        </div>
        <div ref={ref} className={'absolute left-0 top-0 h-full w-full caret-transparent'}>
          {children}
        </div>
      </div>
    );
  }),
  (prev, next) =>
    prev.node.data.url === next.node.data.url && prev.node.data.preview_type === next.node.data.preview_type
);
export default LinkPreview;
