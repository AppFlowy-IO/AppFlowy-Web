import { CircularProgress } from '@mui/material';
import React, { forwardRef, lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { ERROR_CODE } from '@/application/constants';
import { readErrorIdentity } from '@/application/errors/error-message';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { AlignType, BlockType } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { GalleryPreview } from '@/components/_shared/gallery-preview';
import { notify } from '@/components/_shared/notify';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, ImageBlockNode } from '@/components/editor/editor.type';
import { useBlockSelected, useEditorContext } from '@/components/editor/EditorContext';
import { constructFileUrl } from '@/components/editor/utils/file-url';
import { Button } from '@/components/ui/button';
import { FileHandler } from '@/utils/file';
import { isLocalFilePath } from '@/utils/file-storage-url';

import { PDFUploadLimitDialog } from '../pdf/PDFUploadLimitDialog';

import { IMAGE_ACTION_EVENT, ImageAction } from './image-actions';
import { imageName, isImageUploadLimit, isSupportedImage } from './image-data';
import { writableImage, retryImageUpload, uploadImageBlocks } from './image-upload';
import {
  clearImageUploadError,
  useImageUploadError,
  useImageUploading,
  reportImageUploadError,
} from './image-upload-state';
import { ImageBlockMenu } from './ImageBlockMenu';
import { ImageIcon } from './ImageIcons';
import ImageLinkPopover from './ImageLinkPopover';
import ImageRender from './ImageRender';
import './image.scss';

const MediaAssistant = lazy(() => import('../media/MediaAssistant'));

export const ImageBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<ImageBlockNode>>(({ node, children, ...attributes }, ref) => {
    const { t } = useTranslation();

    const { blockId, data } = node;
    const supported = isSupportedImage(data);
    const retry_local_url = data?.retry_local_url;
    const { uploadFile, workspaceId, viewId } = useEditorContext();
    const editor = useSlateStatic() as YjsEditor;
    const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);

    const fileHandler = useMemo(() => new FileHandler(), []);
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const selected = useBlockSelected(blockId);
    const { url: dataUrl, align, pending_upload_id } = useMemo(() => data || {}, [data]);
    const url = useMemo(() => constructFileUrl(dataUrl, workspaceId, viewId), [dataUrl, workspaceId, viewId]);
    const isDeviceLocalImage = isLocalFilePath(dataUrl);
    const localFileIdRef = useRef<string>();
    const previewRemoteUrlRef = useRef<string>();
    const previousPendingUploadIdRef = useRef(pending_upload_id);
    const uploadJustSucceeded = Boolean(dataUrl && localUrl && previousPendingUploadIdRef.current && !pending_upload_id);
    const shouldUseLocalPreview = Boolean(
      localUrl && (!dataUrl || uploadJustSucceeded || previewRemoteUrlRef.current === dataUrl)
    );
    const renderedLocalUrl = shouldUseLocalPreview ? localUrl : undefined;
    const activelyUploading = useImageUploading(editor, blockId);
    const isUploading = Boolean(activelyUploading || (pending_upload_id && data.source !== 'upload' && !dataUrl));
    const hasImage = Boolean(url || renderedLocalUrl);
    const needRetry = Boolean((retry_local_url || data.upload_error || pending_upload_id) && !dataUrl && !isUploading);

    const containerRef = useRef<HTMLDivElement>(null);
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
    const { openPopover, open: popoverOpen, blockId: popoverBlockId } = usePopoverContext();
    const uploadOpen = popoverOpen && popoverBlockId === blockId;
    const aiEnabled = useAIEnabled();
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [action, setAction] = useState<ImageAction>();
    const captionRef = useRef<HTMLTextAreaElement>(null);
    const [focusCaption, setFocusCaption] = useState(false);
    const [limit, setLimit] = useState(false);
    const uploadError = useImageUploadError(editor, blockId);

    useEffect(() => {
      if (!uploadError) return;
      const identity = readErrorIdentity(uploadError.error);

      if (
        identity.sourceDomain === 'appflowy.server' &&
        identity.code === ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED &&
        getWorkspacePlanPolicy().usesHostedBilling
      )
        setLimit(true);
      clearImageUploadError(editor, blockId);
    }, [uploadError, editor, blockId]);
    useEffect(() => {
      const live = findSlateEntryByBlockId(editor, blockId)?.[0];
      const element = live && ReactEditor.toDOMNode(editor, live);
      const listener = (event: Event) => {
        const requested = (event as CustomEvent<ImageAction>).detail;

        if (requested !== 'fullscreen' && (!writableImage(editor, blockId) || readOnly)) return;
        if (requested === 'caption') {
          const live = writableImage(editor, blockId);

          if (live && typeof live.data.caption !== 'string') CustomEditor.setBlockData(editor, blockId, { caption: '' });
          setFocusCaption(true);
        } else setAction(requested);
      };

      element?.addEventListener(IMAGE_ACTION_EVENT, listener);
      return () => element?.removeEventListener(IMAGE_ACTION_EVENT, listener);
    }, [editor, blockId, readOnly]);
    useEffect(() => setAction(undefined), [dataUrl, readOnly]);
    useEffect(() => {
      if (!focusCaption || (!readOnly && typeof data.caption !== 'string')) return;
      if (!readOnly) captionRef.current?.focus();
      setFocusCaption(false);
    }, [focusCaption, data.caption, readOnly]);

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
      if (uploadJustSucceeded && dataUrl) {
        previewRemoteUrlRef.current = dataUrl;
      }

      previousPendingUploadIdRef.current = pending_upload_id;
    }, [dataUrl, pending_upload_id, uploadJustSucceeded]);

    useEffect(() => {
      if (!supported || readOnly || !retry_local_url) return;

      let cancelled = false;
      const previousFileId = localFileIdRef.current;

      if (previousFileId && previousFileId !== retry_local_url) {
        localFileIdRef.current = undefined;
        previewRemoteUrlRef.current = undefined;
        setLocalUrl(undefined);
        void fileHandler.cleanup(previousFileId).catch(() => undefined);
      }

      void (async () => {
        try {
          const fileData = await fileHandler.getStoredFile(retry_local_url);

          if (!cancelled) {
            localFileIdRef.current = retry_local_url;
            previewRemoteUrlRef.current = undefined;
            setLocalUrl(fileData?.url);
          } else {
            fileHandler.releaseUrl(retry_local_url);
          }
        } catch {
          // The remote upload can still finish even if the local preview is unavailable.
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [fileHandler, readOnly, retry_local_url, supported]);

    useEffect(() => {
      if (!localUrl || !dataUrl || shouldUseLocalPreview) return;

      const localFileId = localFileIdRef.current;

      localFileIdRef.current = undefined;
      previewRemoteUrlRef.current = undefined;
      setLocalUrl(undefined);

      if (localFileId) {
        void fileHandler.cleanup(localFileId).catch(() => undefined);
      }
    }, [dataUrl, fileHandler, localUrl, shouldUseLocalPreview]);

    useEffect(() => {
      return () => {
        const localFileId = localFileIdRef.current;

        if (!localFileId) return;

        if (previewRemoteUrlRef.current) {
          void fileHandler.cleanup(localFileId).catch(() => undefined);
        } else {
          fileHandler.releaseUrl(localFileId);
        }
      };
    }, [fileHandler]);

    const handleRetry = async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (loading || readOnly || isImageUploadLimit(data.upload_error_code)) return;
      if (!retry_local_url) {
        openPopover(blockId, BlockType.ImageBlock, containerRef.current);
        return;
      }

      setLoading(true);
      try {
        await retryImageUpload(editor, blockId, uploadFile);
      } catch (error) {
        reportImageUploadError(editor, blockId, error);
      } finally {
        setLoading(false);
      }
    };

    if (!supported) {
      return (
        <div {...attributes} ref={ref} contentEditable={false} role='status' className='text-text-secondary'>
          {t('web.imageBlock.unsupportedSource')}
          {children}
        </div>
      );
    }

    return (
      <div
        {...attributes}
        ref={containerRef}
        contentEditable={readOnly ? false : undefined}
        className={`${className} image-block relative`}
        data-selected={!!selected || !!menu}
        data-upload-open={!!uploadOpen}
        onDrop={(event) => {
          if (readOnly || !event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));

          void uploadImageBlocks({
            editor,
            blockId,
            files,
            uploadFile,
            onError: (error) => reportImageUploadError(editor, blockId, error),
          });
        }}
        onDragOver={(event) => {
          if (!readOnly && event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div contentEditable={false} className={`relative flex w-full ${alignCss}`}>
          {isDeviceLocalImage ? (
            <div role='status' className='flex w-full flex-col gap-3 text-text-secondary'>
              <div className='flex items-center gap-2'>
                <ErrorIcon className='h-5 w-5 shrink-0' aria-hidden='true' />
                <span>{t('editor.imageLocalFileUnavailable')}</span>
              </div>
              {!readOnly && (
                <button
                  type='button'
                  onClick={() => openPopover(blockId, BlockType.ImageBlock, containerRef.current)}
                  className='self-start text-text-action hover:underline'
                >
                  {t('editor.replaceImage')}
                </button>
              )}
            </div>
          ) : hasImage ? (
            <ImageRender
              captionRef={captionRef}
              node={{
                ...node,
                data: {
                  ...data,
                  url,
                },
              }}
              localUrl={renderedLocalUrl}
            />
          ) : (
            <div className='image-empty image-selection-surface relative flex h-11 w-full items-center gap-2 rounded-lg bg-[var(--block-bg-color-20)] py-2 pl-3 pr-2 text-sm leading-5 text-text-tertiary hover:bg-[var(--block-bg-hover-color-20)]'>
              <button
                type='button'
                className='flex min-w-0 flex-1 items-center gap-2 text-left'
                onClick={handleClick}
                disabled={readOnly}
                aria-label={t('document.plugins.image.addAnImageDesktop')}
              >
                <ImageIcon name='image' />
                {t('document.plugins.image.addAnImageDesktop')}
              </button>
              {!readOnly && (
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('web.imageBlock.options')}
                  className='relative z-30 !h-7 !w-7 !p-1'
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu(event.currentTarget);
                  }}
                >
                  <ImageIcon name='more' />
                </Button>
              )}
            </div>
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
              <div className={'font-normal'}>
                {t(
                  data.upload_error_code === ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED
                    ? 'web.imageBlock.fileSizeLimit'
                    : data.upload_error_code === ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED
                    ? 'web.imageBlock.storageLimit'
                    : 'button.uploadFailed'
                )}
              </div>
              {!readOnly &&
                !isImageUploadLimit(data.upload_error_code) &&
                (loading ? (
                  <CircularProgress size={16} />
                ) : (
                  <button onClick={handleRetry} className={'text-text-action hover:underline'}>
                    {t('button.retry')}
                  </button>
                ))}
            </div>
          )}
        </div>
        {menu && <ImageBlockMenu node={node} anchorEl={menu} onClose={() => setMenu(null)} />}
        {action === 'link' && containerRef.current && !readOnly && (
          <ImageLinkPopover
            value={data.link}
            anchor={containerRef.current}
            onClose={() => setAction(undefined)}
            onChange={(link) => {
              if (writableImage(editor, blockId)) CustomEditor.setBlockData(editor, blockId, { link });
            }}
          />
        )}
        {action === 'fullscreen' && url && (
          <Suspense>
            <GalleryPreview
              workspaceId={workspaceId}
              viewId={viewId}
              images={[{ src: renderedLocalUrl || url }]}
              previewIndex={0}
              open
              onClose={() => setAction(undefined)}
            />
          </Suspense>
        )}
        {action === 'ask' && aiEnabled && !readOnly && (
          <Suspense>
            <MediaAssistant
              key={dataUrl}
              node={node}
              mode='ask'
              text={`Image: ${imageName(data)}\n${url || ''}`}
              onClose={() => setAction(undefined)}
            />
          </Suspense>
        )}
        <PDFUploadLimitDialog open={limit} onClose={() => setLimit(false)} />
        <div
          ref={ref}
          className={'pointer-events-none absolute left-0 top-0 h-full w-full select-none caret-transparent'}
        >
          {children}
        </div>
      </div>
    );
  })
);

export default ImageBlock;
