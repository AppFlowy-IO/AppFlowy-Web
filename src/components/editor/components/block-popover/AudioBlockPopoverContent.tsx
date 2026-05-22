import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { AudioBlockData, AudioUrlType, BlockType } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useEditorContext } from '@/components/editor/EditorContext';
import { FileHandler } from '@/utils/file';
import { createPendingUploadId } from '@/utils/pending-upload';
import { processUrl } from '@/utils/url';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.alac', '.aiff', '.m4a'];
const AUDIO_EXTENSION_REGEX = /\.(mp3|wav|ogg|flac|aac|wma|alac|aiff|m4a)($|\?)/i;

function getAudioName(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const name = url.pathname.split('/').filter(Boolean).pop();

    return name || rawUrl;
  } catch {
    return rawUrl;
  }
}

function isAudioUrl(rawUrl: string) {
  const url = processUrl(rawUrl) || rawUrl;

  return AUDIO_EXTENSION_REGEX.test(url);
}

function AudioBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { uploadFile } = useEditorContext();
  const { t } = useTranslation();
  const [tabValue, setTabValue] = React.useState('upload');
  const [uploading, setUploading] = React.useState(false);
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch {
      return null;
    }
  }, [blockId, editor]);

  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const handleInsertEmbedLink = useCallback(
    (rawUrl: string) => {
      const url = processUrl(rawUrl) || rawUrl;

      CustomEditor.setBlockData(editor, blockId, {
        url,
        name: getAudioName(url),
        uploaded_at: Date.now(),
        url_type: AudioUrlType.Network,
      } as AudioBlockData);
      onClose();
    },
    [blockId, editor, onClose]
  );

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

  const createPendingAudioData = useCallback(async (file: File): Promise<AudioBlockData> => {
    const data: AudioBlockData = {
      url: undefined,
      name: file.name,
      uploaded_at: Date.now(),
      url_type: AudioUrlType.Cloud,
      pending_upload_id: createPendingUploadId(),
    };

    try {
      const fileHandler = new FileHandler();
      const res = await fileHandler.handleFileUpload(file);

      URL.revokeObjectURL(res.url);
      data.retry_local_url = res.id;
    } catch {
      data.retry_local_url = '';
    }

    return data;
  }, []);

  const cleanupLocalFile = useCallback(async (retryLocalUrl?: string) => {
    if (!retryLocalUrl) return;

    const fileHandler = new FileHandler();

    await fileHandler.cleanup(retryLocalUrl).catch(() => undefined);
  }, []);

  const uploadIntoAudioBlock = useCallback(
    async (targetBlockId: string, file: File, pendingData: AudioBlockData) => {
      const url = await uploadFileRemote(file);

      if (!url) return;

      await cleanupLocalFile(pendingData.retry_local_url);

      let currentData: AudioBlockData | undefined;

      try {
        const entry = findSlateEntryByBlockId(editor, targetBlockId);

        currentData = entry ? (entry[0] as { data?: AudioBlockData }).data ?? undefined : undefined;
      } catch {
        return;
      }

      if (!currentData) return;
      if (currentData.url) return;
      if (!pendingData.pending_upload_id || currentData.pending_upload_id !== pendingData.pending_upload_id) return;

      CustomEditor.setBlockData(editor, targetBlockId, {
        url,
        name: file.name,
        uploaded_at: Date.now(),
        url_type: AudioUrlType.Cloud,
        retry_local_url: '',
        pending_upload_id: '',
      } as AudioBlockData);
    },
    [cleanupLocalFile, editor, uploadFileRemote]
  );

  const handleChangeUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      setUploading(true);
      try {
        const [primaryData, ...otherDatas] = await Promise.all(files.map((file) => createPendingAudioData(file)));
        const [file, ...otherFiles] = files;

        CustomEditor.setBlockData(editor, blockId, primaryData);

        const pendingUploads: Promise<void>[] = [uploadIntoAudioBlock(blockId, file, primaryData)];
        const reversedPairs = otherFiles.map((f, i) => [f, otherDatas[i]] as const).reverse();

        for (const [f, data] of reversedPairs) {
          const newId = CustomEditor.addBelowBlock(editor, blockId, BlockType.AudioBlock, data);

          if (newId) {
            pendingUploads.push(uploadIntoAudioBlock(newId, f, data));
          }
        }

        onClose();
        await Promise.all(pendingUploads);
      } finally {
        setUploading(false);
      }
    },
    [blockId, createPendingAudioData, editor, onClose, uploadIntoAudioBlock]
  );

  const defaultLink = useMemo(() => {
    return (entry?.[0]?.data as AudioBlockData | undefined)?.url;
  }, [entry]);
  const selectedIndex = tabValue === 'upload' ? 0 : 1;

  return (
    <div className={'flex flex-col gap-2 p-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] w-[560px] max-w-[964px] border-b border-border-primary px-2'}
      >
        <ViewTab iconPosition='start' color='inherit' label={t('button.upload')} value='upload' />
        <ViewTab iconPosition='start' color='inherit' label={t('document.plugins.file.networkTab')} value='embed' />
      </ViewTabs>
      <div className={'appflowy-scroller max-h-[400px] overflow-y-auto p-2'}>
        <TabPanel className={'flex h-full w-full flex-col'} index={0} value={selectedIndex}>
          <FileDropzone
            accept={AUDIO_EXTENSIONS.join(',')}
            multiple={true}
            placeholder={
              <span>
                {t('document.plugins.audio.uploadHint', {
                  defaultValue: 'Click to upload or drag and drop audio files',
                })}
                <span className={'text-text-action'}> {t('document.plugins.file.fileUploadHintSuffix')}</span>
              </span>
            }
            onChange={handleChangeUploadFiles}
            loading={uploading}
          />
        </TabPanel>
        <TabPanel className={'flex h-full w-full flex-col'} index={1} value={selectedIndex}>
          <EmbedLink
            onDone={handleInsertEmbedLink}
            defaultLink={defaultLink}
            placeholder={t('document.plugins.audio.embedPlaceholder', { defaultValue: 'Paste an audio link' })}
            validator={isAudioUrl}
          />
        </TabPanel>
      </div>
    </div>
  );
}

export default AudioBlockPopoverContent;
