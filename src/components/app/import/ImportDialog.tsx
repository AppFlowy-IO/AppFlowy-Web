import { CircularProgress, Dialog, IconButton } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ViewLayout } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import {
  useAppOperations,
  useCurrentWorkspaceId,
  useOpenPageModal,
  useToView,
} from '@/components/app/app.hooks';
import {
  ImportAbortError,
  importCsvAsDatabase,
  populateDocumentWithMarkdown,
  stripFileExtension,
} from '@/components/app/import/import-service';

const MARKDOWN_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';
const CSV_ACCEPT = '.csv,text/csv';

type ImportFormat = 'markdown' | 'csv';

interface ImportDialogProps {
  open: boolean;
  parentViewId: string;
  prevViewId?: string;
  onOpenChange: (open: boolean) => void;
}

export default function ImportDialog({ open, parentViewId, prevViewId, onOpenChange }: ImportDialogProps) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspaceId();
  const { addPage } = useAppOperations();
  const openPageModal = useOpenPageModal();
  const toView = useToView();
  const [active, setActive] = useState<ImportFormat | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight import on unmount so polling doesn't keep running
  // after the dialog is torn down.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const close = useCallback(() => {
    setActive(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleClose = useCallback(() => {
    if (active) return;
    onOpenChange(false);
  }, [active, onOpenChange]);

  const handleMarkdown = useCallback(
    async (file: File) => {
      if (!workspaceId || !addPage) return;
      setActive('markdown');
      try {
        const created = await addPage(parentViewId, {
          layout: ViewLayout.Document,
          name: stripFileExtension(file.name),
          prev_view_id: prevViewId,
        });

        await populateDocumentWithMarkdown(workspaceId, created.view_id, file);
        toast.success(t('importPanel.success'));
        close();
        void openPageModal?.(created.view_id);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e?.message ?? t('importPanel.failed'));
      } finally {
        setActive(null);
      }
    },
    [workspaceId, addPage, parentViewId, prevViewId, openPageModal, close, t],
  );

  const handleCsv = useCallback(
    async (file: File) => {
      if (!workspaceId) return;
      const controller = new AbortController();

      abortRef.current?.abort();
      abortRef.current = controller;
      setActive('csv');
      try {
        const result = await importCsvAsDatabase({
          workspaceId,
          parentViewId,
          file,
          signal: controller.signal,
        });

        toast.success(t('importPanel.success'));
        close();
        void toView(result.viewId);
        // eslint-disable-next-line
      } catch (e: any) {
        if (e instanceof ImportAbortError) return;
        toast.error(e?.message ?? t('importPanel.failed'));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setActive(null);
      }
    },
    [workspaceId, parentViewId, toView, close, t],
  );

  const onMarkdownPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleMarkdown(file);
    },
    [handleMarkdown],
  );

  const onCsvPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleCsv(file);
    },
    [handleCsv],
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      keepMounted={false}
      PaperProps={{
        'data-testid': 'import-dialog',
        className: 'w-[480px] max-w-[90vw] rounded-500',
      }}
    >
      <div className='relative flex flex-col gap-4 p-5'>
        <div className='flex w-full items-center justify-between text-base font-medium'>
          <span className='flex-1 truncate font-medium'>{t('importPanel.title')}</span>
          <IconButton
            size='small'
            color='inherit'
            className='-right-1.5 h-6 w-6'
            onClick={handleClose}
            disabled={!!active}
          >
            <CloseIcon />
          </IconButton>
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <button
            type='button'
            disabled={!!active}
            onClick={() => markdownInputRef.current?.click()}
            className='flex items-center gap-3 rounded-300 bg-fill-content px-4 py-3 text-left text-text-primary hover:bg-fill-content-hover disabled:opacity-60'
            data-testid='import-markdown'
          >
            <TextIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.textAndMarkdown')}</span>
            {active === 'markdown' && <CircularProgress size={14} className='ml-auto' />}
          </button>

          <button
            type='button'
            disabled={!!active}
            onClick={() => csvInputRef.current?.click()}
            className='flex items-center gap-3 rounded-300 bg-fill-content px-4 py-3 text-left text-text-primary hover:bg-fill-content-hover disabled:opacity-60'
            data-testid='import-csv'
          >
            <DatabaseIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.csv')}</span>
            {active === 'csv' && <CircularProgress size={14} className='ml-auto' />}
          </button>
        </div>

        <input
          ref={markdownInputRef}
          type='file'
          accept={MARKDOWN_ACCEPT}
          className='hidden'
          data-testid='import-markdown-input'
          onChange={onMarkdownPicked}
        />
        <input
          ref={csvInputRef}
          type='file'
          accept={CSV_ACCEPT}
          className='hidden'
          data-testid='import-csv-input'
          onChange={onCsvPicked}
        />
      </div>
    </Dialog>
  );
}
