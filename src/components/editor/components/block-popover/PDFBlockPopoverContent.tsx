import { SyntheticEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, LinkPreviewBlockData, PDFBlockData } from '@/application/types';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { notify } from '@/components/_shared/notify';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { reportPDFUploadError } from '@/components/editor/components/blocks/pdf/pdf-block-state';
import { parsePDFLink } from '@/components/editor/components/blocks/pdf/pdf-data';
import { uploadPDFFiles } from '@/components/editor/components/blocks/pdf/pdf-upload';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

  const [tabValue, setTabValue] = useState('upload');
  const uploadInProgress = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState((entry?.[0]?.data as PDFBlockData | undefined)?.url || '');

  const handleTabChange = useCallback((_event: SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
  }, []);

  const handleInsertEmbedLink = useCallback(
    (url: string) => {
      const current = findSlateEntryByBlockId(editor, blockId)?.[0];

      if (current?.type !== BlockType.PDFBlock || editor.readOnly || editor.isElementReadOnly(current)) return;
      const link = parsePDFLink(url);

      if (!link) {
        notify.error(t('document.plugins.pdf.invalidUrlToast'));
        return;
      }

      if (!link.isPDF) {
        CustomEditor.turnToBlock(editor, blockId, BlockType.LinkPreview, { url: link.url } as LinkPreviewBlockData);
        notify.warning(t('document.plugins.pdf.unableToEmbed'));
        onClose();
        return;
      }

      CustomEditor.setBlockData(editor, blockId, {
        url: link.url,
        name: link.name,
        uploaded_at: Date.now(),
        url_type: 'network',
        retry_local_url: '',
        pending_upload_id: '',
        needPassword: false,
        upload_error: false,
      } as PDFBlockData);
      onClose();
    },
    [blockId, editor, onClose, t]
  );

  const handleChangeUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || uploadInProgress.current) return;
      uploadInProgress.current = true;
      setUploading(true);
      try {
        await uploadPDFFiles({
          editor,
          blockId,
          files,
          uploadFile,
          onStarted: onClose,
          onError: (error) => {
            const live = findSlateEntryByBlockId(editor, blockId)?.[0];

            if (live?.type === BlockType.PDFBlock) reportPDFUploadError(editor, blockId, error);
          },
        });
      } catch {
        notify.error(t('button.uploadFailed'));
      } finally {
        uploadInProgress.current = false;
        setUploading(false);
      }
    },
    [editor, blockId, uploadFile, onClose, t]
  );

  const selectedIndex = tabValue === 'upload' ? 0 : 1;

  return (
    <div className='flex w-[400px] max-w-[calc(100vw-32px)] flex-col bg-surface-layer-04' data-testid='pdf-uploader'>
      <ViewTabs
        value={tabValue}
        onChange={handleTabChange}
        className='w-full border-b border-border-primary'
        sx={{
          height: 47,
          minHeight: 47,
          paddingTop: '12px',
          paddingLeft: '12px',
          '& .MuiTabs-scroller': { paddingBottom: 0 },
          '& .MuiTab-root': {
            height: 34,
            minHeight: 34,
            padding: '4px 10px 10px',
            margin: 0,
            fontWeight: 500,
            lineHeight: '20px',
            textTransform: 'none',
            color: 'var(--text-tertiary)',
          },
          '& .MuiTab-root.Mui-selected': { color: 'var(--text-primary)' },
        }}
      >
        <ViewTab color='inherit' label={t('button.upload')} value='upload' />
        <ViewTab color='inherit' label={t('document.plugins.pdf.embedTab')} value='embed' />
      </ViewTabs>
      <TabPanel index={0} value={selectedIndex}>
        <div className='pdf-upload-dropzone px-5 pb-4 pt-5'>
          <FileDropzone
            accept='application/pdf,.pdf'
            multiple
            onChange={handleChangeUploadFiles}
            loading={uploading}
            buttonClassName='!h-[min(264px,calc(100dvh-115px))] !min-h-16 !border-2 !border-dashed !outline-none !px-8'
            placeholder={
              <span>
                {t('document.plugins.pdf.uploadHint')}{' '}
                <span className='text-text-action'>{t('document.plugins.pdf.uploadAction')}</span>
              </span>
            }
          />
        </div>
      </TabPanel>
      <TabPanel index={1} value={selectedIndex}>
        <form
          className='flex flex-col gap-4 p-5'
          onSubmit={(event) => {
            event.preventDefault();
            handleInsertEmbedLink(link);
          }}
        >
          <Input
            size='md'
            className='h-10 rounded-[10px]'
            autoFocus
            placeholder={t('document.plugins.pdf.embedPlaceholder')}
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <Button className='h-8 w-full rounded-md font-medium' type='submit' disabled={!parsePDFLink(link)}>
            {t('document.plugins.pdf.embedAction')}
          </Button>
          <p className='text-sm leading-5 text-text-tertiary'>{t('document.plugins.pdf.worksWithLinksOfPDF')}</p>
        </form>
      </TabPanel>
    </div>
  );
}

export default PDFBlockPopoverContent;
