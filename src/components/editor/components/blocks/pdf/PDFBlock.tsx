import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, FieldURLType, PDFBlockData } from '@/application/types';
import { ReactComponent as PDFIcon } from '@/assets/icons/pdf.svg';
import { ReactComponent as ReloadIcon } from '@/assets/icons/regenerate.svg';
import { notify } from '@/components/_shared/notify';
import { useEditorContext } from '@/components/editor/EditorContext';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import FileToolbar from '@/components/editor/components/blocks/file/FileToolbar';
import { EditorElementProps, FileNode, PDFNode } from '@/components/editor/editor.type';
import { FileHandler } from '@/utils/file';
import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import React, { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

export const PDFBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<PDFNode>>(
    ({ node, children, ...attributes }, ref) => {
      const { blockId, data } = node;
      const { uploadFile } = useEditorContext();
      const editor = useSlateStatic() as YjsEditor;
      const [needRetry, setNeedRetry] = useState(false);
      const fileHandlerRef = useRef(new FileHandler());
      const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
      const [loading, setLoading] = useState(false);
      const { url, name, retry_local_url } = data || {};
      const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
      const emptyRef = useRef<HTMLDivElement>(null);
      const [showToolbar, setShowToolbar] = useState(false);

      const hasContent = url || needRetry;

      const className = [
        'w-full',
        url || !readOnly ? 'cursor-pointer' : 'text-text-secondary',
        attributes.className,
      ]
        .filter(Boolean)
        .join(' ');

      const { openPopover } = usePopoverContext();

      const openUploadPopover = useCallback(() => {
        if (emptyRef.current && !readOnly) {
          openPopover(blockId, BlockType.PDFBlock, emptyRef.current);
        }
      }, [blockId, openPopover, readOnly]);

      const openPDFInNewTab = useCallback(() => {
        const link = url || localUrl;

        if (link) {
          window.open(link, '_blank');
        }
      }, [url, localUrl]);

      const handleClick = useCallback(async () => {
        try {
          if (!url && !needRetry) {
            openUploadPopover();
            return;
          }

          openPDFInNewTab();
        } catch (e: unknown) {
          notify.error((e as Error).message);
        }
      }, [url, needRetry, openUploadPopover, openPDFInNewTab]);

      useEffect(() => {
        if (readOnly) return;
        void (async () => {
          if (retry_local_url) {
            const fileData = await fileHandlerRef.current.getStoredFile(retry_local_url);

            setLocalUrl(fileData?.url);
            setNeedRetry(!!fileData);
          } else {
            setNeedRetry(false);
          }
        })();
      }, [readOnly, retry_local_url]);

      const uploadFileRemote = useCallback(
        async (file: File) => {
          try {
            if (uploadFile) {
              return await uploadFile(file);
            }
          } catch (e: unknown) {
            return;
          }
        },
        [uploadFile]
      );

      const handleRetry = useCallback(
        async (e: React.MouseEvent) => {
          e.stopPropagation();
          if (!retry_local_url) return;

          setLoading(true);
          try {
            const fileData = await fileHandlerRef.current.getStoredFile(retry_local_url);
            const file = fileData?.file;

            if (!file) {
              notify.error('File not found. Please upload again.');
              return;
            }

            const url = await uploadFileRemote(file);

            if (!url) {
              notify.error('Upload failed. Please try again.');
              return;
            }

            await fileHandlerRef.current.cleanup(retry_local_url);
            CustomEditor.setBlockData(editor, blockId, {
              url,
              name,
              uploaded_at: Date.now(),
              url_type: FieldURLType.Upload,
              retry_local_url: '',
            } as PDFBlockData);
          } catch (e: unknown) {
            notify.error((e as Error).message || 'Failed to retry upload. Please try again.');
          } finally {
            setLoading(false);
          }
        },
        [blockId, editor, name, retry_local_url, uploadFileRemote]
      );

      return (
        <div
          {...attributes}
          contentEditable={readOnly ? false : undefined}
          className={className}
          onMouseEnter={() => {
            if (!url) return;
            setShowToolbar(true);
          }}
          onMouseLeave={() => setShowToolbar(false)}
          onClick={handleClick}
        >
          <div contentEditable={false} className={`embed-block flex flex-row items-center gap-4 p-4 ${hasContent ? 'text-text-primary' : ''}`}>
            <div className={'flex h-full items-start'}>
              <PDFIcon className={'h-6 w-6'} />
            </div>

            <div ref={emptyRef} className={'flex flex-1 flex-col gap-2 overflow-hidden text-base font-medium'}>
              {hasContent ? (
                <div className={'flex flex-col gap-2'}>
                  <div className={'w-full truncate'}>{name?.trim() || 'PDF Document'}</div>
                  {needRetry && <div className={'font-normal text-function-error'}>Upload failed</div>}
                </div>
              ) : (
                <div className={'text-text-secondary'}>Upload or embed a PDF</div>
              )}
            </div>

            {needRetry &&
              (loading ? (
                <CircularProgress size={16} />
              ) : (
                <Tooltip placement={'top'} title={'Retry upload'}>
                  <IconButton onClick={handleRetry} size={'small'} color={'error'}>
                    <ReloadIcon />
                  </IconButton>
                </Tooltip>
              ))}
            {showToolbar && url && (
              <FileToolbar
                node={
                  {
                    ...node,
                    data: {
                      ...data,
                      url,
                    },
                  } as unknown as FileNode
                }
              />
            )}
          </div>
          <div ref={ref} className={`absolute h-full w-full caret-transparent`}>
            {children}
          </div>
        </div>
      );
    }
  )
);

PDFBlock.displayName = 'PDFBlock';
