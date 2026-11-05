import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, FieldURLType, FileBlockData } from '@/application/types';
import { ReactComponent as FileIcon } from '@/assets/icons/file_block_doc.svg';
import { ReactComponent as UploadedFileIcon } from '@/assets/icons/file_block_uploaded_doc.svg';
import { ReactComponent as LinkedFileIcon } from '@/assets/icons/file_block_uploaded_doc_by_link.svg';
import { ReactComponent as ReloadIcon } from '@/assets/icons/regenerate.svg';
import { notify } from '@/components/_shared/notify';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import FileToolbar from '@/components/editor/components/blocks/file/FileToolbar';
import { EditorElementProps, FileNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { constructFileUrl } from '@/components/editor/utils/file-url';
import { FileHandler } from '@/utils/file';
import { openUrl } from '@/utils/url';

export const FileBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<FileNode>>(({ node, children, ...attributes }, ref) => {
    const { blockId, data } = node;
    const { uploadFile, workspaceId, viewId } = useEditorContext();
    const editor = useSlateStatic() as YjsEditor;
    const [needRetry, setNeedRetry] = useState(false);
    const fileHandler = useMemo(() => new FileHandler(), []);
    const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const { url: dataUrl, name, retry_local_url } = useMemo(() => data || {}, [data]);
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const emptyRef = useRef<HTMLDivElement>(null);

    const url = useMemo(() => constructFileUrl(dataUrl, workspaceId, viewId), [dataUrl, workspaceId, viewId]);

    const Icon = url ? (data.url_type === FieldURLType.Upload ? UploadedFileIcon : LinkedFileIcon) : FileIcon;

    const className = useMemo(() => {
      const classList = ['file-block group relative w-full'];

      if (url) {
        classList.push('cursor-pointer');
      } else {
        classList.push('text-text-secondary');
      }

      if (attributes.className) {
        classList.push(attributes.className);
      }

      if (!readOnly) {
        classList.push('cursor-pointer');
      }

      return classList.join(' ');
    }, [attributes.className, readOnly, url]);

    const { t } = useTranslation();
    const { openPopover } = usePopoverContext();

    const handleClick = useCallback(async () => {
      try {
        if (!url && !needRetry) {
          if (emptyRef.current && !readOnly) {
            openPopover(blockId, BlockType.FileBlock, emptyRef.current);
          }

          return;
        }

        const link = url || localUrl;

        if (link) {
          void openUrl(link, '_blank');
        }
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    }, [url, needRetry, localUrl, readOnly, openPopover, blockId]);

    useEffect(() => {
      if (readOnly) return;
      void (async () => {
        if (retry_local_url) {
          const fileData = await fileHandler.getStoredFile(retry_local_url);

          setLocalUrl(fileData?.url);
          setNeedRetry(!!fileData);
        } else {
          setNeedRetry(false);
        }
      })();
    }, [readOnly, retry_local_url, fileHandler]);

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
            name,
            uploaded_at: Date.now(),
            url_type: FieldURLType.Upload,
            retry_local_url: '',
            pending_upload_id: '',
          } as FileBlockData);
        } catch (e) {
          // do nothing
        } finally {
          setLoading(false);
        }
      },
      [blockId, editor, fileHandler, name, retry_local_url, uploadFileRemote]
    );

    return (
      <div {...attributes} contentEditable={readOnly ? false : undefined} className={className} onClick={handleClick}>
        <div contentEditable={false} data-file-row className={`embed-block items-center p-4`}>
          <Icon className={'h-5 w-5 shrink-0 text-text-tertiary'} />

          <div
            ref={emptyRef}
            className={'file-block-label min-w-0 flex-1 overflow-hidden text-left text-sm font-medium leading-5'}
          >
            {url || needRetry ? (
              <div className={'flex flex-col gap-2'}>
                <div className={'w-full truncate'}>{name?.trim() || t('document.title.placeholder')}</div>
                {needRetry && <div className={'font-normal text-function-error'}>{t('web.fileBlock.uploadFailed')}</div>}
              </div>
            ) : (
              <div className={'truncate font-normal text-text-tertiary'}>{t('web.fileBlock.empty')}</div>
            )}
          </div>

          {needRetry &&
            (loading ? (
              <CircularProgress size={16} />
            ) : (
              <Tooltip placement={'top'} title={t('web.fileBlock.retry')}>
                <IconButton onClick={handleRetry} size={'small'} color={'error'}>
                  <ReloadIcon />
                </IconButton>
              </Tooltip>
            ))}
          {url && (
            <FileToolbar
              node={{
                ...node,
                data: {
                  ...data,
                  url,
                },
              }}
            />
          )}
        </div>
        <div ref={ref} className={`absolute h-full w-full text-transparent caret-transparent`}>
          {children}
        </div>
      </div>
    );
  })
);

export default FileBlock;
