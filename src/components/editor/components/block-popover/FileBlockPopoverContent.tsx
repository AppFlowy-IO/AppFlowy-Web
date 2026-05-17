import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, FieldURLType, FileBlockData } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useEditorContext } from '@/components/editor/EditorContext';
import { FileHandler } from '@/utils/file';
import { createPendingUploadId } from '@/utils/pending-upload';

import EmbedLink from 'src/components/_shared/image-upload/EmbedLink';

export function getFileName(url: string) {
  const urlObj = new URL(url);
  const name = urlObj.pathname.split('/').pop();

  return name;
}

function FileBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { uploadFile } = useEditorContext();
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch (e) {
      return null;
    }
  }, [blockId, editor]);

  const { t } = useTranslation();

  const [tabValue, setTabValue] = React.useState('upload');
  const [uploading, setUploading] = React.useState(false);

  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const handleInsertEmbedLink = useCallback(
    (url: string) => {
      CustomEditor.setBlockData(editor, blockId, {
        url,
        name: getFileName(url),
        uploaded_at: Date.now(),
        url_type: FieldURLType.Link,
      } as FileBlockData);
      onClose();
    },
    [blockId, editor, onClose]
  );

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

  const getData = useCallback(async (file: File, remoteUrl?: string) => {
    const data = {
      url: remoteUrl,
      name: file.name,
      uploaded_at: Date.now(),
      url_type: FieldURLType.Upload,
      pending_upload_id: createPendingUploadId(),
    } as FileBlockData;

    if (!remoteUrl) {
      // Best-effort: a missing local snapshot must not block the remote upload
      // (IndexedDB may be unavailable in private mode or over quota).
      try {
        const fileHandler = new FileHandler();
        const res = await fileHandler.handleFileUpload(file);

        // The popover never renders the local preview itself — the block
        // creates its own object URL via `getStoredFile`. Revoke the one
        // created here so it doesn't leak until the tab unloads.
        URL.revokeObjectURL(res.url);
        data.retry_local_url = res.id;
      } catch {
        data.retry_local_url = '';
      }
    }

    return data;
  }, []);

  const cleanupLocalFile = useCallback(async (retryLocalUrl?: string) => {
    if (!retryLocalUrl) return;

    const fileHandler = new FileHandler();

    await fileHandler.cleanup(retryLocalUrl).catch(() => undefined);
  }, []);

  const uploadIntoFileBlock = useCallback(
    async (targetBlockId: string, file: File, pendingData: FileBlockData) => {
      const url = await uploadFileRemote(file);

      if (!url) {
        return;
      }

      await cleanupLocalFile(pendingData.retry_local_url);

      // Popover closes before the upload settles, so the user may have
      // deleted/edited/replaced the block. Skip the write if the placeholder
      // we created is no longer there (block gone, URL already set, or
      // pending_upload_id has changed because a different file was uploaded
      // onto the same block).
      let currentData: FileBlockData | undefined;

      try {
        const entry = findSlateEntryByBlockId(editor, targetBlockId);

        currentData = entry ? (entry[0] as { data?: FileBlockData }).data ?? undefined : undefined;
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
        url_type: FieldURLType.Upload,
        retry_local_url: '',
        pending_upload_id: '',
      } as FileBlockData);
    },
    [cleanupLocalFile, editor, uploadFileRemote]
  );

  const handleChangeUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      setUploading(true);
      try {
        // Run every local snapshot in parallel so the popover doesn't pay
        // N×IDB-latency before it can close.
        const [primaryData, ...otherDatas] = await Promise.all(files.map((f) => getData(f)));
        const [file, ...otherFiles] = files;

        CustomEditor.setBlockData(editor, blockId, primaryData);

        const pendingUploads: Promise<void>[] = [uploadIntoFileBlock(blockId, file, primaryData)];

        // Each new block is inserted directly below `blockId`, so iterating
        // in reverse preserves the user's original file order in the doc.
        const reversedPairs = otherFiles.map((f, i) => [f, otherDatas[i]] as const).reverse();

        for (const [f, d] of reversedPairs) {
          const newId = CustomEditor.addBelowBlock(editor, blockId, BlockType.FileBlock, d);

          if (newId) {
            pendingUploads.push(uploadIntoFileBlock(newId, f, d));
          }
        }

        onClose();
        await Promise.all(pendingUploads);
      } finally {
        setUploading(false);
      }
    },
    [blockId, editor, getData, onClose, uploadIntoFileBlock]
  );

  const tabOptions = useMemo(() => {
    return [
      {
        key: 'upload',
        label: t('button.upload'),
        panel: (
          <FileDropzone
            multiple={true}
            placeholder={
              <span>
                {t('document.plugins.file.fileUploadHint')}
                <span className={'text-text-action'}>{t('document.plugins.file.fileUploadHintSuffix')}</span>
              </span>
            }
            onChange={handleChangeUploadFiles}
            loading={uploading}
          />
        ),
      },
      {
        key: 'embed',
        label: t('document.plugins.file.networkTab'),
        panel: (
          <EmbedLink
            onDone={handleInsertEmbedLink}
            defaultLink={(entry?.[0].data as FileBlockData).url}
            placeholder={t('document.plugins.file.networkHint')}
          />
        ),
      },
    ];
  }, [entry, handleChangeUploadFiles, handleInsertEmbedLink, t, uploading]);

  const selectedIndex = tabOptions.findIndex((tab) => tab.key === tabValue);

  return (
    <div className={'flex flex-col gap-2 p-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] w-[560px] max-w-[964px] border-b border-border-primary px-2'}
      >
        {tabOptions.map((tab) => {
          const { key, label } = tab;

          return <ViewTab key={key} iconPosition='start' color='inherit' label={label} value={key} />;
        })}
      </ViewTabs>
      <div className={'appflowy-scroller max-h-[400px] overflow-y-auto p-2'}>
        {tabOptions.map((tab, index) => {
          const { key, panel } = tab;

          return (
            <TabPanel className={'flex h-full w-full flex-col'} key={key} index={index} value={selectedIndex}>
              {panel}
            </TabPanel>
          );
        })}
      </div>
    </div>
  );
}

export default FileBlockPopoverContent;
