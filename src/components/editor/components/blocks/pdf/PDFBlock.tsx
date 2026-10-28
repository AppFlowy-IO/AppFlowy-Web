import { forwardRef, lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { ERROR_CODE } from '@/application/constants';
import { readErrorIdentity } from '@/application/errors/error-message';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, PDFBlockData } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import moreIcon from '@/assets/icons/pdf/figma/6ce7044d646d972a9d3da547c0fb4cc2f68661cf.svg';
import pdfIcon from '@/assets/icons/pdf/figma/bad4f9029c2ddb7dec6b79b6f194f5ae0889c385.svg';
import { notify } from '@/components/_shared/notify';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, PDFNode } from '@/components/editor/editor.type';
import { useBlockSelected, useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { FileHandler } from '@/utils/file';
import { resolveFileUrl } from '@/utils/file-storage-url';

import { clearPDFUploadError, usePDFUploadError } from './pdf-block-state';
import { isLocalPDF, pdfFileName } from './pdf-data';
import { retryPDFUpload, uploadPDFFiles } from './pdf-upload';
import { PDF_ACTION_EVENT, PDFBlockMenu } from './PDFBlockMenu';
import { PDFUploadLimitDialog } from './PDFUploadLimitDialog';
import './pdf.scss';

const PDFViewer = lazy(() => import('./PDFViewer'));
const PDFAssistant = lazy(() => import('./PDFAssistant'));

export const PDFBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<PDFNode>>(({ node, children, ...attributes }, ref) => {
    const editor = useSlateStatic() as YjsEditor;
    const aiEnabled = useAIEnabled();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node);
    const selected = useBlockSelected(node.blockId);
    const { uploadFile, workspaceId, viewId } = useEditorContext();
    const { openPopover, open: popoverOpen, blockId: popoverBlockId } = usePopoverContext();
    const uploadOpen = popoverOpen && popoverBlockId === node.blockId;
    const { t } = useTranslation();
    const anchor = useRef<HTMLDivElement>(null);
    const [local, setLocal] = useState<{ id: string; url: string }>();
    const [retrying, setRetrying] = useState(false);
    const retryInProgress = useRef(false);
    const uploadError = usePDFUploadError(editor, node.blockId);
    const [emptyAssistantOpen, setEmptyAssistantOpen] = useState(false);
    const [uploadLimitOpen, setUploadLimitOpen] = useState(false);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [nearby, setNearby] = useState(false);
    const { url, retry_local_url, pending_upload_id } = node.data;
    const source =
      (url ? resolveFileUrl(url, workspaceId, viewId) : '') || (local?.id === retry_local_url ? local?.url : undefined);
    const localUnavailable = !!url && isLocalPDF(node.data);
    const uploadFailed = (!!retry_local_url || node.data.upload_error) && !pending_upload_id && !url;

    useEffect(() => {
      let cancelled = false;
      let objectUrl: string | undefined;

      if (retry_local_url && !url) {
        void new FileHandler()
          .getStoredFile(retry_local_url)
          .then((file) => {
            objectUrl = file?.url;
            if (cancelled) {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              return;
            }

            setLocal(objectUrl ? { id: retry_local_url, url: objectUrl } : undefined);
          })
          .catch(() => {
            if (!cancelled) setLocal(undefined);
          });
      }

      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [retry_local_url, url]);

    useEffect(() => {
      const element = anchor.current;

      if (!element) return;
      if (typeof IntersectionObserver === 'undefined') {
        setNearby(true);
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          // Start near the viewport. Keep a loaded document alive while scrolling.
          if (entry.isIntersecting) {
            setNearby(true);
            observer.disconnect();
          }
        },
        { rootMargin: '400px' }
      );

      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const onChange = useCallback(
      (data: Partial<PDFBlockData>) => {
        const current = findSlateEntryByBlockId(editor, node.blockId)?.[0];

        if (!readOnly && !editor.readOnly && current?.type === BlockType.PDFBlock && !editor.isElementReadOnly(current))
          CustomEditor.setBlockData(editor, node.blockId, data);
      },
      [editor, node.blockId, readOnly]
    );
    const handleUploadError = useCallback((error: unknown) => {
      const identity = readErrorIdentity(error);

      if (
        identity.sourceDomain === 'appflowy.server' &&
        identity.code === ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED &&
        getWorkspacePlanPolicy().usesHostedBilling
      )
        setUploadLimitOpen(true);
    }, []);

    useEffect(() => {
      if (!uploadError) return;
      handleUploadError(uploadError.error);
      clearPDFUploadError(editor, node.blockId, uploadError);
    }, [editor, node.blockId, uploadError, handleUploadError]);

    useEffect(() => {
      const live = findSlateEntryByBlockId(editor, node.blockId)?.[0];
      const element = live && ReactEditor.toDOMNode(editor, live);
      const aiListener = (event: Event) => {
        if ((event as CustomEvent).detail === 'ask' && !url) setEmptyAssistantOpen(true);
      };

      element?.addEventListener(PDF_ACTION_EVENT, aiListener);
      return () => {
        element?.removeEventListener(PDF_ACTION_EVENT, aiListener);
      };
    }, [editor, node.blockId, url]);

    const openUpload = () => {
      if (!readOnly && anchor.current) openPopover(node.blockId, BlockType.PDFBlock, anchor.current);
    };

    const retryUpload = async () => {
      if (!retry_local_url || !uploadFile || retryInProgress.current || readOnly) return;
      retryInProgress.current = true;
      setRetrying(true);
      try {
        await retryPDFUpload({ editor, blockId: node.blockId, uploadFile });
      } catch (error) {
        handleUploadError(error);
        notify.error(t('button.uploadFailed'));
      } finally {
        retryInProgress.current = false;
        setRetrying(false);
      }
    };

    return (
      <div {...attributes} className={`relative w-full ${attributes.className || ''}`}>
        <div
          ref={anchor}
          contentEditable={false}
          className='pdf-block w-full'
          data-selected={!!selected}
          data-upload-open={uploadOpen}
          onDragOver={(event) => {
            if (!readOnly && event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onDrop={(event) => {
            if (readOnly || !event.dataTransfer.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            const files = Array.from(event.dataTransfer.files);

            void uploadPDFFiles({ editor, blockId: node.blockId, files, uploadFile, onError: handleUploadError }).catch(
              () => notify.error(t('button.uploadFailed'))
            );
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {localUnavailable ? (
            <div role='status' className='pdf-selection-surface relative flex flex-col gap-3 rounded-lg bg-fill-content p-4 text-text-secondary'>
              <p>{t('document.plugins.pdf.localUnavailable')}</p>
              {!readOnly && (
                <Button variant='outline' onClick={openUpload}>
                  {t('document.plugins.pdf.replace')}
                </Button>
              )}
            </div>
          ) : source ? (
            <Suspense
              fallback={
                <div className='pdf-selection-surface relative h-[400px] rounded-xl' role='status'>
                  {t('document.plugins.pdf.loading')}
                </div>
              }
            >
              {nearby ? (
                <PDFViewer key={source} node={node} source={source} readOnly={readOnly} onChange={onChange} />
              ) : (
                <div className='pdf-selection-surface relative h-[400px] rounded-xl' />
              )}
            </Suspense>
          ) : (
            <div
              className='pdf-empty pdf-selection-surface relative flex h-11 w-full items-center gap-2 rounded-lg bg-[var(--block-bg-color-20)] py-2 pl-3 pr-2 text-sm leading-5 text-text-tertiary hover:bg-[var(--block-bg-hover-color-20)]'
              data-testid='pdf-empty'
            >
              <button
                type='button'
                className='flex h-7 min-w-0 flex-1 items-center gap-2 text-left font-normal disabled:cursor-default'
                disabled={readOnly}
                onClick={openUpload}
              >
                <img src={pdfIcon} alt='' />
                <span className='truncate'>
                  {pending_upload_id ? pdfFileName(node.data) : t('document.plugins.pdf.placeholder')}
                </span>
              </button>
              {!readOnly && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 rounded p-1'
                  aria-label={t('button.more')}
                  onClick={(event) => setMenu(event.currentTarget)}
                >
                  <img src={moreIcon} alt='' />
                </Button>
              )}
            </div>
          )}
          {emptyAssistantOpen && aiEnabled && !source && !readOnly && (
            <Suspense fallback={null}>
              <PDFAssistant node={node} mode='ask' text='' onClose={() => setEmptyAssistantOpen(false)} />
            </Suspense>
          )}
          {menu && <PDFBlockMenu node={node} anchorEl={menu} onClose={() => setMenu(null)} />}
          {(pending_upload_id || retrying) && (
            <div role='status' className='mt-2 text-sm text-text-secondary'>
              {t('fileDropzone.uploading')}
            </div>
          )}
          {uploadFailed && (
            <div role='alert' className='mt-2 flex items-center gap-2 text-sm text-text-error'>
              {t('button.uploadFailed')}
              {!readOnly && (
                <Button
                  variant='ghost'
                  disabled={retrying}
                  onClick={() => (retry_local_url ? void retryUpload() : openUpload())}
                >
                  {t('button.retry')}
                </Button>
              )}
            </div>
          )}
        </div>
        <PDFUploadLimitDialog open={uploadLimitOpen && !readOnly} onClose={() => setUploadLimitOpen(false)} />
        <div
          ref={ref}
          className='pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden text-transparent caret-transparent'
        >
          {children}
        </div>
      </div>
    );
  })
);
PDFBlock.displayName = 'PDFBlock';
