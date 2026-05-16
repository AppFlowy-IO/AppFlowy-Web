import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, FieldURLType, PDFBlockData } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useEditorContext } from '@/components/editor/EditorContext';
import { FileHandler } from '@/utils/file';

import EmbedLink from 'src/components/_shared/image-upload/EmbedLink';

export function getFileName(rawUrl: string) {
  try {
    const urlObj = new URL(rawUrl);
    const name = urlObj.pathname.split('/').filter(Boolean).pop();

    return name || rawUrl;
  } catch {
    return rawUrl;
  }
}

function PDFBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
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
      } as PDFBlockData);
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
      } catch (e: unknown) {
        return;
      }
    },
    [uploadFile]
  );

  const createPendingFileData = useCallback(
    async (file: File): Promise<PDFBlockData> => {
      const data: PDFBlockData = {
        url: undefined,
        name: file.name,
        uploaded_at: Date.now(),
        url_type: FieldURLType.Upload,
      };

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

      return data;
    },
    []
  );

  const cleanupLocalFile = useCallback(async (retryLocalUrl?: string) => {
    if (!retryLocalUrl) return;

    const fileHandler = new FileHandler();

    await fileHandler.cleanup(retryLocalUrl).catch(() => undefined);
  }, []);

  const uploadIntoPdfBlock = useCallback(
    async (targetBlockId: string, file: File, pendingData: PDFBlockData) => {
      const url = await uploadFileRemote(file);

      if (!url) {
        return;
      }

      await cleanupLocalFile(pendingData.retry_local_url);

      // Popover closes before the upload settles, so the user may have
      // deleted/edited/replaced the block. Skip the write if the placeholder
      // we created is no longer there.
      let currentData: PDFBlockData | undefined;

      try {
        const entry = findSlateEntryByBlockId(editor, targetBlockId);

        currentData = entry ? ((entry[0] as { data?: PDFBlockData }).data ?? undefined) : undefined;
      } catch {
        return;
      }

      if (!currentData) return;
      if (currentData.url) return;
      if ((currentData.retry_local_url ?? '') !== (pendingData.retry_local_url ?? '')) return;

      CustomEditor.setBlockData(editor, targetBlockId, {
        url,
        name: file.name,
        uploaded_at: Date.now(),
        url_type: FieldURLType.Upload,
        retry_local_url: '',
      } as PDFBlockData);
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
        const [primaryData, ...otherDatas] = await Promise.all(
          files.map((f) => createPendingFileData(f))
        );
        const [file, ...otherFiles] = files;

        CustomEditor.setBlockData(editor, blockId, primaryData);

        const pendingUploads: Promise<void>[] = [uploadIntoPdfBlock(blockId, file, primaryData)];

        // Each new block is inserted directly below `blockId`, so iterating
        // in reverse preserves the user's original file order in the doc.
        const reversedPairs = otherFiles
          .map((f, i) => [f, otherDatas[i]] as const)
          .reverse();

        for (const [f, d] of reversedPairs) {
          const newId = CustomEditor.addBelowBlock(editor, blockId, BlockType.PDFBlock, d);

          if (newId) {
            pendingUploads.push(uploadIntoPdfBlock(newId, f, d));
          }
        }

        onClose();
        await Promise.all(pendingUploads);
      } finally {
        setUploading(false);
      }
    },
    [blockId, createPendingFileData, editor, onClose, uploadIntoPdfBlock]
  );

  const defaultLink = useMemo(() => {
    return (entry?.[0]?.data as PDFBlockData | undefined)?.url;
  }, [entry]);

  const uploadLabel = t('button.upload');
  const embedLabel = t('document.plugins.file.networkTab');
  const selectedIndex = tabValue === 'upload' ? 0 : 1;

  return (
    <div className={'flex flex-col gap-2 p-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] w-[560px] max-w-[964px] border-b border-border-primary px-2'}
      >
        <ViewTab iconPosition='start' color='inherit' label={uploadLabel} value='upload' />
        <ViewTab iconPosition='start' color='inherit' label={embedLabel} value='embed' />
      </ViewTabs>
      <div className={'appflowy-scroller max-h-[400px] overflow-y-auto p-2'}>
        <TabPanel className={'flex h-full w-full flex-col'} index={0} value={selectedIndex}>
          <FileDropzone
            accept="application/pdf,.pdf"
            multiple={true}
            placeholder={
              <span>
                Click to upload or drag and drop PDF files
                <span className={'text-text-action'}> {t('document.plugins.photoGallery.browserLayout')}</span>
              </span>
            }
            onChange={handleChangeUploadFiles}
            loading={uploading}
          />
        </TabPanel>
        <TabPanel className={'flex h-full w-full flex-col'} index={1} value={selectedIndex}>
          <EmbedLink onDone={handleInsertEmbedLink} defaultLink={defaultLink} placeholder={'Embed a PDF link'} />
        </TabPanel>
      </div>
    </div>
  );
}

export default PDFBlockPopoverContent;
