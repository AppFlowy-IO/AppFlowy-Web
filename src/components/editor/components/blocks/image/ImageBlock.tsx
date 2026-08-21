import { CircularProgress } from '@mui/material';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { ReactEditor, useReadOnly, useSelected, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { AlignType, BlockType, ImageBlockData, ImageType } from '@/application/types';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { notify } from '@/components/_shared/notify';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, ImageBlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { constructFileUrl } from '@/components/editor/utils/file-url';
import { FileHandler } from '@/utils/file';

import ImageEmpty from './ImageEmpty';
import ImageRender from './ImageRender';

export const ImageBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ImageBlockNode>>(({ node, children, ...attributes }, ref) => {
    const { t } = useTranslation();

    const { blockId, data } = node;
    const retry_local_url = data?.retry_local_url;
    const { uploadFile, workspaceId, viewId } = useEditorContext();
    const editor = useSlateStatic() as YjsEditor;
    const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);

    const fileHandler = useMemo(() => new FileHandler(), []);
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const selected = useSelected();
    const { url: dataUrl, align, pending_upload_id } = useMemo(() => data || {}, [data]);
    const url = useMemo(() => constructFileUrl(dataUrl, workspaceId, viewId), [dataUrl, workspaceId, viewId]);
    const isUploading = Boolean(pending_upload_id && !dataUrl);
    const hasImage = Boolean(url || localUrl);
    const needRetry = Boolean(retry_local_url && localUrl && !dataUrl && !isUploading);

    const containerRef = useRef<HTMLDivElement>(null);
    const onFocusNode = useCallback(() => {
      ReactEditor.focus(editor);
      const path = ReactEditor.findPath(editor, node);

      editor.select(path);
    }, [editor, node]);

    const className = useMemo(() => {
      const classList = ['w-full'];

      if (!readOnly) {
        classList.push('cursor-pointer');
      }

      if (attributes.className) {
        classList.push(attributes.className);
      }

      return classList.join(' ');
    }, [attributes.className, readOnly]);

    const alignCss = useMemo(() => {
      if (!align) return '';

      return align === AlignType.Center ? 'justify-center' : align === AlignType.Right ? 'justify-end' : 'justify-start';
    }, [align]);
    const [showToolbar, setShowToolbar] = useState(false);
    const { openPopover } = usePopoverContext();

    const handleClick = useCallback(async () => {
      try {
        if (!hasImage && !isUploading && !needRetry) {
          if (containerRef.current && !readOnly) {
            openPopover(blockId, BlockType.ImageBlock, containerRef.current);
          }

          return;
        }

        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    }, [blockId, hasImage, isUploading, needRetry, openPopover, readOnly]);

    useEffect(() => {
      if (readOnly) return;

      let cancelled = false;

      if (!retry_local_url || dataUrl) {
        setLocalUrl(undefined);
        return;
      }

      void (async () => {
        const fileData = await fileHandler.getStoredFile(retry_local_url);

        if (!cancelled) {
          setLocalUrl(fileData?.url);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [dataUrl, fileHandler, readOnly, retry_local_url]);

    const uploadFileRemote = useCallback(
      async (file: File) => {
        try {
          if (uploadFile) {
            return await uploadFile(file);
          }
          // eslint-disable-next-line
        } catch (e: any) {
          return;
        }
      },
      [uploadFile]
    );

    const handleRetry = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!retry_local_url) return;
        const fileData = await fileHandler.getStoredFile(retry_local_url);
        const file = fileData?.file;

        if (!file) return;

        const url = await uploadFileRemote(file);

        if (!url) {
          return;
        }

        setLoading(true);
        try {
          await fileHandler.cleanup(retry_local_url);
          CustomEditor.setBlockData(editor, blockId, {
            url,
            image_type: ImageType.External,
            retry_local_url: '',
            pending_upload_id: '',
          } as ImageBlockData);
        } catch (e) {
          // do noting
        } finally {
          setLoading(false);
        }
      },
      [blockId, editor, fileHandler, retry_local_url, uploadFileRemote]
    );

    return (
      <div
        {...attributes}
        ref={containerRef}
        contentEditable={readOnly ? false : undefined}
        onMouseEnter={() => {
          if (!url) return;
          setShowToolbar(true);
        }}
        onMouseLeave={() => setShowToolbar(false)}
        className={className}
        onClick={handleClick}
      >
        <div
          contentEditable={false}
          className={`embed-block relative ${alignCss} ${hasImage ? '!rounded-none !border-none !bg-transparent' : 'p-4'}`}
        >
          {hasImage ? (
            <ImageRender
              showToolbar={showToolbar}
              selected={selected}
              node={{
                ...node,
                data: {
                  ...data,
                  url,
                },
              }}
              localUrl={localUrl}
            />
          ) : (
            <ImageEmpty
              node={{
                ...node,
                data: {
                  ...data,
                  url,
                },
              }}
              onEscape={onFocusNode}
              containerRef={containerRef}
            />
          )}
          {isUploading && (
            <div
              data-testid='image-upload-pending'
              className={'absolute bottom-2 right-4 flex items-center gap-2 text-text-secondary'}
            >
              <CircularProgress size={16} />
              <div className={'font-normal'}>{t('fileDropzone.uploading')}</div>
            </div>
          )}
          {needRetry && (
            <div className={'absolute bottom-2 right-4 flex items-center gap-2'}>
              <ErrorIcon className={'h-5 w-5 text-function-error'} />
              <div className={'font-normal'}>{t('button.uploadFailed')}</div>
              {loading ? (
                <CircularProgress size={16} />
              ) : (
                <button onClick={handleRetry} className={'text-text-action hover:underline'}>
                  {t('button.retry')}
                </button>
              )}
            </div>
          )}
        </div>
        <div ref={ref} className={'absolute left-0 top-0 h-full w-full select-none caret-transparent'}>
          {children}
        </div>
      </div>
    );
  })
);

export default ImageBlock;
