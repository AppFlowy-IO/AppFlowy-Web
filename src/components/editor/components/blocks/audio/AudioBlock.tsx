import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { AudioBlockData, AudioUrlType, BlockType } from '@/application/types';
import { ReactComponent as AudioIcon } from '@/assets/icons/audio.svg';
import { ReactComponent as ReloadIcon } from '@/assets/icons/regenerate.svg';
import { notify } from '@/components/_shared/notify';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import FileToolbar from '@/components/editor/components/blocks/file/FileToolbar';
import { AudioBlockNode, EditorElementProps, FileNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { constructFileUrl } from '@/components/editor/utils/file-url';
import { FileHandler } from '@/utils/file';

export const AudioBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AudioBlockNode>>(({ node, children, ...attributes }, ref) => {
    const { t } = useTranslation();
    const { blockId, data } = node;
    const { uploadFile, workspaceId, viewId } = useEditorContext();
    const editor = useSlateStatic() as YjsEditor;
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const { openPopover } = usePopoverContext();
    const emptyRef = useRef<HTMLDivElement>(null);
    const fileHandlerRef = useRef(new FileHandler());
    const [localUrl, setLocalUrl] = useState<string | undefined>();
    const [needRetry, setNeedRetry] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showToolbar, setShowToolbar] = useState(false);

    const { url: dataUrl, name, retry_local_url, duration_in_second } = data || {};
    const remoteUrl = useMemo(
      () => (dataUrl ? constructFileUrl(dataUrl, workspaceId, viewId) : ''),
      [dataUrl, workspaceId, viewId]
    );
    const sourceUrl = remoteUrl || localUrl || '';
    const hasContent = Boolean(sourceUrl);

    useEffect(() => {
      if (readOnly) return;
      void (async () => {
        if (!retry_local_url || dataUrl) {
          setLocalUrl(undefined);
          setNeedRetry(false);
          return;
        }

        const fileData = await fileHandlerRef.current.getStoredFile(retry_local_url);

        setLocalUrl(fileData?.url);
        setNeedRetry(!!fileData);
      })();
    }, [dataUrl, readOnly, retry_local_url]);

    const openUploadPopover = useCallback(() => {
      if (emptyRef.current && !readOnly) {
        openPopover(blockId, BlockType.AudioBlock, emptyRef.current);
      }
    }, [blockId, openPopover, readOnly]);

    const uploadFileRemote = useCallback(
      async (file: File) => {
        try {
          return await uploadFile?.(file);
        } catch {
          return undefined;
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
            notify.error(t('web.fileBlock.uploadFailed'));
            return;
          }

          const url = await uploadFileRemote(file);

          if (!url) {
            notify.error(t('web.fileBlock.uploadFailed'));
            return;
          }

          await fileHandlerRef.current.cleanup(retry_local_url);
          CustomEditor.setBlockData(editor, blockId, {
            url,
            name,
            uploaded_at: Date.now(),
            url_type: AudioUrlType.Cloud,
            retry_local_url: '',
            pending_upload_id: '',
          } as AudioBlockData);
        } finally {
          setLoading(false);
        }
      },
      [blockId, editor, name, retry_local_url, t, uploadFileRemote]
    );

    const handleLoadedMetadata = useCallback(
      (event: React.SyntheticEvent<HTMLAudioElement>) => {
        if (readOnly) return;

        const seconds = Math.round(event.currentTarget.duration);

        if (!Number.isFinite(seconds) || seconds <= 0 || seconds === duration_in_second) return;

        CustomEditor.setBlockData(editor, blockId, {
          duration_in_second: seconds,
        } as AudioBlockData);
      },
      [blockId, duration_in_second, editor, readOnly]
    );

    const className = [
      'w-full',
      !readOnly || hasContent ? 'cursor-pointer' : 'text-text-secondary',
      attributes.className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        {...attributes}
        contentEditable={readOnly ? false : undefined}
        className={className}
        onClick={() => {
          if (!hasContent) {
            openUploadPopover();
          }
        }}
        onMouseEnter={() => {
          if (hasContent) setShowToolbar(true);
        }}
        onMouseLeave={() => setShowToolbar(false)}
      >
        <div contentEditable={false} className={'embed-block flex-col p-4'}>
          <div className={'flex w-full items-center gap-3'}>
            <AudioIcon className={'h-6 w-6 flex-none'} />
            <div ref={emptyRef} className={'min-w-0 flex-1 text-base font-medium'}>
              {hasContent ? (
                <div className={'truncate'}>
                  {name?.trim() || t('document.selectionMenu.audio', { defaultValue: 'Audio' })}
                </div>
              ) : (
                <div className={'text-text-secondary'}>
                  {t('document.plugins.audio.addAudio', { defaultValue: 'Upload or embed audio' })}
                </div>
              )}
              {needRetry && (
                <div className={'text-sm font-normal text-function-error'}>{t('web.fileBlock.uploadFailed')}</div>
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
          </div>

          {hasContent && (
            <audio
              controls
              preload='metadata'
              src={sourceUrl}
              className={'w-full min-w-0'}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onLoadedMetadata={handleLoadedMetadata}
            />
          )}

          {showToolbar && remoteUrl && (
            <FileToolbar
              node={
                {
                  ...node,
                  data: {
                    ...data,
                    url: remoteUrl,
                  },
                } as unknown as FileNode
              }
            />
          )}
        </div>
        <div ref={ref} className={'pointer-events-none absolute h-full w-full text-transparent caret-transparent'}>
          {children}
        </div>
      </div>
    );
  })
);

AudioBlock.displayName = 'AudioBlock';

export default AudioBlock;
