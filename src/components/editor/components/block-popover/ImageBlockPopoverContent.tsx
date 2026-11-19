import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ImageType } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { ALLOWED_IMAGE_EXTENSIONS, Unsplash } from '@/components/_shared/image-upload';
import { notify } from '@/components/_shared/notify';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { imageURL } from '@/components/editor/components/blocks/image/image-data';
import { uploadImageBlocks, writableImage } from '@/components/editor/components/blocks/image/image-upload';
import { reportImageUploadError } from '@/components/editor/components/blocks/image/image-upload-state';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ImageBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { uploadFile } = useEditorContext();
  const { t } = useTranslation();
  const [tab, setTab] = useState('upload');
  const [busy, setBusy] = useState(false);
  const uploading = useRef(false);
  const [link, setLink] = useState(() => {
    const data = writableImage(editor, blockId)?.data;

    return data?.source === 'network' ? data.url || '' : '';
  });
  const embed = (value: string, source: 'network' | 'unsplash' = 'network') => {
    const url = imageURL(value);

    if (!url || !writableImage(editor, blockId)) return;
    CustomEditor.setBlockData(editor, blockId, {
      url,
      source,
      name: '',
      image_type: ImageType.External,
      retry_local_url: '',
      pending_upload_id: '',
      upload_error: false,
      upload_error_code: null,
    });
    onClose();
  };

  const upload = async (files: File[]) => {
    if (!files.length || uploading.current) return;
    if (
      files.some(
        (file) =>
          !file.type.startsWith('image/') &&
          !ALLOWED_IMAGE_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
      )
    ) {
      notify.error(t('document.plugins.file.noImages'));
      return;
    }

    uploading.current = true;
    setBusy(true);
    try {
      await uploadImageBlocks({
        editor,
        blockId,
        files,
        uploadFile,
        onStarted: onClose,
        onError: (error) => reportImageUploadError(editor, blockId, error),
      });
    } catch {
      notify.error(t('button.uploadFailed'));
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  };

  const tabs = ['upload', 'embed', 'unsplash'];

  return (
    <div
      className='image-uploader w-[400px] max-w-[calc(100vw-32px)] bg-surface-layer-04'
      data-testid='image-uploader'
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);

        if (files.length) {
          event.preventDefault();
          void upload(files);
        } else if (tab === 'upload') {
          const url = imageURL(event.clipboardData.getData('text/plain'));

          if (url) {
            event.preventDefault();
            embed(url);
          }
        }
      }}
    >
      <ViewTabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        className='border-b border-border-primary'
        sx={{
          height: 48,
          minHeight: 48,
          paddingTop: '12px',
          paddingLeft: '12px',
          '& .MuiTabs-scroller': { paddingBottom: 0 },
          '& .MuiTab-root': {
            minHeight: 35,
            height: 35,
            padding: '4px 14px 10px',
            margin: 0,
            fontWeight: 500,
            lineHeight: '20px',
            textTransform: 'none',
            color: 'var(--text-tertiary)',
          },
          '& .MuiTab-root.Mui-selected': { color: 'var(--text-primary)' },
        }}
      >
        <ViewTab label={t('button.upload')} value='upload' />
        <ViewTab label={t('web.imageBlock.embedTab')} value='embed' />
        <ViewTab label={t('pageStyle.unsplash')} value='unsplash' />
      </ViewTabs>
      <TabPanel index={0} value={tabs.indexOf(tab)}>
        <div className='image-upload-dropzone p-5'>
          <FileDropzone
            multiple
            accept={ALLOWED_IMAGE_EXTENSIONS.join(',')}
            loading={busy}
            onChange={(files) => void upload(files)}
            buttonClassName='!h-[min(264px,calc(100dvh-120px))] !min-h-16 !border-2 !border-dashed !outline-none !px-8'
            placeholder={
              <span>
                {t('web.imageBlock.uploadHint')} <span className='text-text-action'>{t('grid.media.browse')}</span>
              </span>
            }
          />
        </div>
      </TabPanel>
      <TabPanel index={1} value={tabs.indexOf(tab)}>
        <form
          className='flex flex-col gap-4 p-5'
          onSubmit={(event) => {
            event.preventDefault();
            embed(link);
          }}
        >
          <Input
            autoFocus
            aria-label={t('document.imageBlock.embedLink.placeholder')}
            placeholder={t('document.imageBlock.embedLink.placeholder')}
            className='h-10 rounded-[10px]'
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <Button className='h-10 rounded-[10px]' type='submit' disabled={!imageURL(link)}>
            {t('document.plugins.pdf.embedAction')}
          </Button>
        </form>
      </TabPanel>
      <TabPanel index={2} value={tabs.indexOf(tab)}>
        <div className='max-h-[min(354px,calc(100dvh-100px))] overflow-auto p-5'>
          <Unsplash onDone={(url) => embed(url, 'unsplash')} onEscape={onClose} />
        </div>
      </TabPanel>
    </div>
  );
}
