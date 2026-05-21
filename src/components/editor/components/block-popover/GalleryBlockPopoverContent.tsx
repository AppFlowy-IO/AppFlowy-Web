import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { GalleryBlockData, GalleryLayout, ImageType } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { ALLOWED_IMAGE_EXTENSIONS, Unsplash } from '@/components/_shared/image-upload';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useEditorContext } from '@/components/editor/EditorContext';

function GalleryBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
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
  const data = entry?.[0]?.data as GalleryBlockData | undefined;

  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const appendImages = useCallback(
    (images: GalleryBlockData['images']) => {
      if (!images.length) return;

      CustomEditor.setBlockData(editor, blockId, {
        images: [...(data?.images ?? []), ...images],
        layout: data?.layout ?? GalleryLayout.Carousel,
      } as GalleryBlockData);
      onClose();
    },
    [blockId, data?.images, data?.layout, editor, onClose]
  );

  const handleChangeUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      setUploading(true);
      try {
        const uploadedImages = (
          await Promise.all(
            files.map(async (file) => {
              try {
                const url = await uploadFile?.(file);

                return url
                  ? {
                      url,
                      type: ImageType.External,
                    }
                  : null;
              } catch {
                return null;
              }
            })
          )
        ).filter(Boolean) as GalleryBlockData['images'];

        appendImages(uploadedImages);
      } finally {
        setUploading(false);
      }
    },
    [appendImages, uploadFile]
  );

  const handleInsertEmbedLink = useCallback(
    (url: string, type?: ImageType) => {
      appendImages([
        {
          url,
          type: type ?? ImageType.External,
        },
      ]);
    },
    [appendImages]
  );

  const selectedIndex = tabValue === 'upload' ? 0 : tabValue === 'embed' ? 1 : 2;

  return (
    <div className={'flex flex-col p-2'}>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className={'min-h-[38px] w-[560px] max-w-[964px] border-b border-border-primary px-2'}
      >
        <ViewTab iconPosition='start' color='inherit' label={t('button.upload')} value='upload' />
        <ViewTab iconPosition='start' color='inherit' label={t('document.plugins.file.networkTab')} value='embed' />
        <ViewTab iconPosition='start' color='inherit' label={t('pageStyle.unsplash')} value='unsplash' />
      </ViewTabs>
      <div className={'appflowy-scroller max-h-[400px] overflow-y-auto p-2'}>
        <TabPanel className={'flex h-full w-full flex-col'} index={0} value={selectedIndex}>
          <FileDropzone
            multiple={true}
            onChange={handleChangeUploadFiles}
            accept={ALLOWED_IMAGE_EXTENSIONS.join(',')}
            loading={uploading}
          />
        </TabPanel>
        <TabPanel className={'flex h-full w-full flex-col'} index={1} value={selectedIndex}>
          <EmbedLink onDone={handleInsertEmbedLink} placeholder={t('document.imageBlock.embedLink.placeholder')} />
        </TabPanel>
        <TabPanel className={'flex h-full w-full flex-col'} index={2} value={selectedIndex}>
          <Unsplash onDone={handleInsertEmbedLink} />
        </TabPanel>
      </div>
    </div>
  );
}

export default GalleryBlockPopoverContent;
