import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, ImageBlockData, ImageType } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { ALLOWED_IMAGE_EXTENSIONS, Unsplash } from '@/components/_shared/image-upload';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useEditorContext } from '@/components/editor/EditorContext';
import { FileHandler } from '@/utils/file';
import { createPendingUploadId } from '@/utils/pending-upload';

function ImageBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const { uploadFile } = useEditorContext();
  const editor = useSlateStatic() as YjsEditor;

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

  const handleUpdateLink = useCallback(
    (url: string, type?: ImageType) => {
      CustomEditor.setBlockData(editor, blockId, {
        url,
        image_type: type || ImageType.External,
      } as ImageBlockData);
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
      url: remoteUrl || '',
      image_type: ImageType.External,
      pending_upload_id: createPendingUploadId(),
    } as ImageBlockData;

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
        data.image_type = undefined;
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

  const uploadIntoImageBlock = useCallback(
    async (targetBlockId: string, file: File, pendingData: ImageBlockData) => {
      const url = await uploadFileRemote(file);

      if (!url) {
        return;
      }

      await cleanupLocalFile(pendingData.retry_local_url);

      // Popover closes before the upload settles, so the user may have
      // deleted/edited/replaced the block. Skip the write if the placeholder
      // we created is no longer there.
      let currentData: ImageBlockData | undefined;

      try {
        const entry = findSlateEntryByBlockId(editor, targetBlockId);

        currentData = entry ? (entry[0] as { data?: ImageBlockData }).data ?? undefined : undefined;
      } catch {
        return;
      }

      if (!currentData) return;
      if (currentData.url) return;
      if (!pendingData.pending_upload_id || currentData.pending_upload_id !== pendingData.pending_upload_id) return;

      CustomEditor.setBlockData(editor, targetBlockId, {
        url,
        image_type: ImageType.External,
        retry_local_url: '',
        pending_upload_id: '',
      } as ImageBlockData);
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

        let belowBlockId: string | undefined = blockId;
        const pendingUploads: Promise<void>[] = [uploadIntoImageBlock(blockId, file, primaryData)];

        for (let i = 0; i < otherFiles.length; i++) {
          const f = otherFiles[i];
          const d = otherDatas[i];
          const newId: string | undefined = belowBlockId
            ? CustomEditor.addBelowBlock(editor, belowBlockId, BlockType.ImageBlock, d)
            : undefined;

          if (newId) {
            belowBlockId = newId;
            pendingUploads.push(uploadIntoImageBlock(newId, f, d));
          }
        }

        if (!belowBlockId) return;

        belowBlockId = CustomEditor.addBelowBlock(editor, belowBlockId, BlockType.Paragraph, {});

        const entry = belowBlockId ? findSlateEntryByBlockId(editor, belowBlockId) : null;

        if (!entry) return;

        const [node, path] = entry;

        onClose();

        if (path) {
          editor.select(editor.start(path));
        }

        setTimeout(() => {
          if (!node) return;
          const el = ReactEditor.toDOMNode(editor, node);

          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);

        await Promise.all(pendingUploads);
      } finally {
        setUploading(false);
      }
    },
    [blockId, editor, getData, onClose, uploadIntoImageBlock]
  );

  const tabOptions = useMemo(() => {
    return [
      {
        key: 'upload',
        label: t('button.upload'),
        panel: (
          <FileDropzone
            multiple={true}
            onChange={handleChangeUploadFiles}
            accept={ALLOWED_IMAGE_EXTENSIONS.join(',')}
            loading={uploading}
          />
        ),
      },
      {
        key: 'embed',
        label: t('document.plugins.file.networkTab'),
        panel: (
          <EmbedLink
            onDone={handleUpdateLink}
            defaultLink={(entry?.[0].data as ImageBlockData).url}
            placeholder={t('document.imageBlock.embedLink.placeholder')}
          />
        ),
      },
      {
        key: 'unsplash',
        label: t('pageStyle.unsplash'),
        panel: <Unsplash onDone={handleUpdateLink} />,
      },
    ];
  }, [entry, handleChangeUploadFiles, handleUpdateLink, t, uploading]);

  const selectedIndex = tabOptions.findIndex((tab) => tab.key === tabValue);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;

    if (!el) return;

    const handleResize = () => {
      const top = el.getBoundingClientRect().top;
      const height = window.innerHeight - top - 30;

      el.style.maxHeight = `${height}px`;
    };

    if (tabValue === 'unsplash') {
      handleResize();
    }
  }, [tabValue]);

  return (
    <div className={'flex flex-col p-2'}>
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
      <div ref={ref} className={'appflowy-scroller max-h-[400px] overflow-y-auto p-2'}>
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

export default ImageBlockPopoverContent;
