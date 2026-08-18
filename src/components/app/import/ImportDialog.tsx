import { CircularProgress, Dialog, IconButton } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ViewLayout } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as NotionIcon } from '@/assets/icons/notion.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import { useAppOperations, useCurrentWorkspaceId, useOpenPageModal, useToView } from '@/components/app/app.hooks';
import {
  ImportAbortError,
  ImportCsvBatchItem,
  importCsvFilesAsDatabases,
  importNotionZipToView,
  populateDocumentWithMarkdown,
  stripFileExtension,
} from '@/components/app/import/import-service';

const MARKDOWN_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';
const CSV_ACCEPT = '.csv,text/csv';
const NOTION_ACCEPT = '.zip,application/zip,application/x-zip,application/x-zip-compressed';

// Enough failed names to be actionable in a toast without turning it into a wall of text.
const MAX_REPORTED_FAILURES = 3;

// File names and server messages are raw user/server data, and i18next escapes interpolated
// values by default — without this a file called `Q1&Q2.csv` shows up as `Q1&amp;Q2.csv`.
// Toasts render plain text, so there is nothing to escape for.
const RAW_INTERPOLATION = { interpolation: { escapeValue: false } };

type ImportFormat = 'markdown' | 'csv' | 'notion';

interface CsvProgress {
  current: number;
  total: number;
}

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
  const [csvProgress, setCsvProgress] = useState<CsvProgress | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const notionInputRef = useRef<HTMLInputElement>(null);
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
    setCsvProgress(null);
    onOpenChange(false);
  }, [onOpenChange]);

  // Backdrop click / Escape: never interrupts an import. Cancelling a batch has to be
  // deliberate, otherwise a stray click throws away a long-running import.
  const handleDismiss = useCallback(() => {
    if (active) return;
    onOpenChange(false);
  }, [active, onOpenChange]);

  // Only a CSV batch is cancellable: it can run for minutes, so the close button aborts it and
  // keeps the files already imported. Markdown / Notion are single-shot and block the button.
  const cancellable = active === 'csv';
  const closeDisabled = active !== null && !cancellable;

  // The button doubles as the cancel control during a batch, so it has to say so.
  const closeLabel = cancellable ? t('importPanel.cancelImport') : t('button.close');

  const handleCloseClick = useCallback(() => {
    if (closeDisabled) return;
    if (cancellable) abortRef.current?.abort();
    onOpenChange(false);
  }, [cancellable, closeDisabled, onOpenChange]);

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
    [workspaceId, addPage, parentViewId, prevViewId, openPageModal, close, t]
  );

  const handleCsv = useCallback(
    async (files: File[]) => {
      if (!workspaceId || files.length === 0) return;
      const controller = new AbortController();

      abortRef.current?.abort();
      abortRef.current = controller;
      setActive('csv');
      setCsvProgress({ current: 1, total: files.length });
      try {
        const { items, aborted } = await importCsvFilesAsDatabases({
          workspaceId,
          parentViewId,
          files,
          signal: controller.signal,
          onFileStart: (index, total) => setCsvProgress({ current: index + 1, total }),
        });

        const importedViewIds: string[] = [];
        const failed: ImportCsvBatchItem[] = [];

        for (const item of items) {
          if (item.viewId) importedViewIds.push(item.viewId);
          else failed.push(item);
        }

        if (aborted) {
          // Cancelling leaves the remaining files unattempted, so `files.length` is not a
          // meaningful denominator — report only what actually landed.
          if (importedViewIds.length > 0) {
            toast.success(
              importedViewIds.length === 1
                ? t('importPanel.success')
                : t('importPanel.successCount', { total: importedViewIds.length })
            );
          }
        } else if (importedViewIds.length === files.length) {
          toast.success(
            files.length === 1 ? t('importPanel.success') : t('importPanel.successCount', { total: files.length })
          );
        } else if (importedViewIds.length > 0) {
          toast.success(t('importPanel.partialSuccess', { success: importedViewIds.length, total: files.length }));
        }

        // Files that were attempted and broke are reported even when the batch was cancelled
        // afterwards: cancelling hides the files never started, not the ones that already failed.
        if (failed.length === 1) {
          toast.error(
            t('importPanel.failedFile', {
              name: failed[0].fileName,
              reason: failed[0].error || t('importPanel.failed'),
              ...RAW_INTERPOLATION,
            })
          );
        } else if (failed.length > 1) {
          const shown = failed.slice(0, MAX_REPORTED_FAILURES).map((item) => item.fileName);
          const names = shown.join(', ');
          const extra = failed.length - shown.length;

          toast.error(
            extra > 0
              ? t('importPanel.failedFilesOverflow', { names, extra, ...RAW_INTERPOLATION })
              : t('importPanel.failedFiles', { names, ...RAW_INTERPOLATION })
          );
        }

        if (aborted || importedViewIds.length === 0) return;

        close();
        void toView(importedViewIds[0]);
        // eslint-disable-next-line
      } catch (e: any) {
        if (e instanceof ImportAbortError) return;
        toast.error(e?.message ?? t('importPanel.failed'));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setActive(null);
        setCsvProgress(null);
      }
    },
    [workspaceId, parentViewId, toView, close, t]
  );

  const handleNotion = useCallback(
    async (file: File) => {
      if (!workspaceId) return;
      const controller = new AbortController();

      abortRef.current?.abort();
      abortRef.current = controller;
      setActive('notion');
      try {
        await importNotionZipToView({
          workspaceId,
          parentViewId,
          file,
          signal: controller.signal,
        });

        toast.success(t('importPanel.notionImportStarted'));
        close();
        // eslint-disable-next-line
      } catch (e: any) {
        if (e instanceof ImportAbortError) return;
        toast.error(e?.message ?? t('importPanel.failed'));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setActive(null);
      }
    },
    [workspaceId, parentViewId, close, t]
  );

  const onMarkdownPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleMarkdown(file);
    },
    [handleMarkdown]
  );

  const onCsvPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);

      event.target.value = '';
      if (files.length > 0) void handleCsv(files);
    },
    [handleCsv]
  );

  const onNotionPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleNotion(file);
    },
    [handleNotion]
  );

  return (
    <Dialog
      open={open}
      onClose={handleDismiss}
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
            data-testid='import-dialog-close'
            title={closeLabel}
            aria-label={closeLabel}
            onClick={handleCloseClick}
            disabled={closeDisabled}
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
            {active === 'csv' && (
              <span className='ml-auto flex items-center gap-2'>
                {csvProgress && csvProgress.total > 1 && (
                  <span className='text-xs text-text-secondary' data-testid='import-csv-progress'>
                    {t('importPanel.importingCount', { current: csvProgress.current, total: csvProgress.total })}
                  </span>
                )}
                <CircularProgress size={14} />
              </span>
            )}
          </button>

          <button
            type='button'
            disabled={!!active}
            onClick={() => notionInputRef.current?.click()}
            className='flex items-center gap-3 rounded-300 bg-fill-content px-4 py-3 text-left text-text-primary hover:bg-fill-content-hover disabled:opacity-60'
            data-testid='import-notion'
          >
            <NotionIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.notionZip')}</span>
            {active === 'notion' && <CircularProgress size={14} className='ml-auto' />}
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
          multiple
          className='hidden'
          data-testid='import-csv-input'
          onChange={onCsvPicked}
        />
        <input
          ref={notionInputRef}
          type='file'
          accept={NOTION_ACCEPT}
          className='hidden'
          data-testid='import-notion-input'
          onChange={onNotionPicked}
        />
      </div>
    </Dialog>
  );
}
