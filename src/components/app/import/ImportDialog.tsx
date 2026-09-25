import { CircularProgress, Dialog, IconButton } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DocumentFileImportFormat, ViewLayout } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ConfluenceIcon } from '@/assets/icons/confluence.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as DocIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as HtmlIcon } from '@/assets/icons/inline_code.svg';
import { ReactComponent as NotionIcon } from '@/assets/icons/notion.svg';
import { ReactComponent as PdfIcon } from '@/assets/icons/pdf.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import { useAppOperations, useCurrentWorkspaceId, useOpenPageModal, useToView } from '@/components/app/app.hooks';
import {
  ImportAbortError,
  ImportFileBatchItem,
  importConfluenceZipToView,
  importCsvFilesAsDatabases,
  importDocumentFiles,
  importNotionZipToView,
  populateDocumentWithMarkdown,
  stripFileExtension,
} from '@/components/app/import/import-service';
import { isStorageLimitError } from '@/utils/errors';

const MARKDOWN_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';
const CSV_ACCEPT = '.csv,text/csv';
const ZIP_ACCEPT = '.zip,application/zip,application/x-zip,application/x-zip-compressed';
const HTML_ACCEPT = '.html,.htm,text/html';
const DOCX_ACCEPT = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_ACCEPT = '.pdf,application/pdf';

// Enough failed names to be actionable in a toast without turning it into a wall of text.
const MAX_REPORTED_FAILURES = 3;
// Warnings per file are already aggregated by the server; two messages keep the toast readable.
const MAX_REPORTED_WARNINGS = 2;

// File names and server messages are raw user/server data, and i18next escapes interpolated
// values by default — without this a file called `Q1&Q2.csv` shows up as `Q1&amp;Q2.csv`.
// Toasts render plain text, so there is nothing to escape for.
const RAW_INTERPOLATION = { interpolation: { escapeValue: false } };

type ZipImportFormat = 'notion' | 'confluence';
type ImportFormat = 'markdown' | 'csv' | ZipImportFormat | DocumentFileImportFormat;

/** Formats imported one file at a time through a server task, sharing the batch UI. */
type BatchImportFormat = 'csv' | DocumentFileImportFormat;

interface BatchProgress {
  current: number;
  total: number;
}

interface ImportDialogProps {
  open: boolean;
  parentViewId: string;
  prevViewId?: string;
  onOpenChange: (open: boolean) => void;
}

const DOCUMENT_TILES: {
  format: DocumentFileImportFormat;
  labelKey: 'importPanel.html' | 'importPanel.word' | 'importPanel.pdf';
  accept: string;
}[] = [
  { format: 'html', labelKey: 'importPanel.html', accept: HTML_ACCEPT },
  { format: 'docx', labelKey: 'importPanel.word', accept: DOCX_ACCEPT },
  { format: 'pdf', labelKey: 'importPanel.pdf', accept: PDF_ACCEPT },
];

function DocumentTileIcon({ format }: { format: DocumentFileImportFormat }) {
  const className = 'h-5 w-5 shrink-0 text-icon-primary';

  if (format === 'pdf') return <PdfIcon className={className} />;
  if (format === 'docx') return <DocIcon className={className} />;
  return <HtmlIcon className={className} />;
}

export default function ImportDialog({ open, parentViewId, prevViewId, onOpenChange }: ImportDialogProps) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspaceId();
  const { addPage } = useAppOperations();
  const openPageModal = useOpenPageModal();
  const toView = useToView();
  const [active, setActive] = useState<ImportFormat | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const notionInputRef = useRef<HTMLInputElement>(null);
  const confluenceInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const documentInputRefs: Record<DocumentFileImportFormat, React.RefObject<HTMLInputElement>> = {
    html: htmlInputRef,
    docx: docxInputRef,
    pdf: pdfInputRef,
  };

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
    setBatchProgress(null);
    onOpenChange(false);
  }, [onOpenChange]);

  // Backdrop click / Escape: never interrupts an import. Cancelling a batch has to be
  // deliberate, otherwise a stray click throws away a long-running import.
  const handleDismiss = useCallback(() => {
    if (active) return;
    onOpenChange(false);
  }, [active, onOpenChange]);

  // A file batch and a ZIP upload can both run for minutes, so the close button doubles as
  // a cancel for them and keeps whatever already imported. Markdown blocks the button instead:
  // it is two round trips, and its page already exists by the time the upload starts.
  const cancellable = active !== null && active !== 'markdown';
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

  /**
   * Report a finished batch: success/partial toasts, failed file names, converter warnings,
   * and whether the dialog should close and navigate to the first page.
   */
  const reportBatch = useCallback(
    (items: ImportFileBatchItem[], aborted: boolean, total: number): string | null => {
      const importedViewIds: string[] = [];
      const failed: ImportFileBatchItem[] = [];
      let storageLimitReached = false;

      for (const item of items) {
        if (item.viewId) importedViewIds.push(item.viewId);
        else if (isStorageLimitError(item)) storageLimitReached = true;
        else failed.push(item);
      }

      // Cancelling — or a batch-fatal server error such as the pending-task cap — leaves the
      // remaining files unattempted, so `total` is not a denominator we can honestly report.
      // Only claim "x of y" when every selected file actually got a turn.
      const attemptedAll = !aborted && items.length === total;

      if (importedViewIds.length > 0) {
        if (attemptedAll && importedViewIds.length < total) {
          toast.success(t('importPanel.partialSuccess', { success: importedViewIds.length, count: total }));
        } else {
          toast.success(
            importedViewIds.length === 1
              ? t('importPanel.success')
              : t('importPanel.successCount', { count: importedViewIds.length })
          );
        }
      }

      // Files that were attempted and broke are reported even when the batch was cancelled
      // afterwards: cancelling hides the files never started, not the ones that already failed.
      // Keep a storage denial visible even when earlier files had unrelated conversion failures.
      if (storageLimitReached) {
        toast.error(
          getWorkspacePlanPolicy().usesHostedBilling
            ? t('importPanel.storageLimitExceeded')
            : t('importPanel.storageLimitAdministrator', {
                defaultValue: 'This workspace does not have enough storage for this import. Contact your workspace administrator.',
              })
        );
      }

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
            ? t('importPanel.failedFilesOverflow', { names, count: extra, ...RAW_INTERPOLATION })
            : t('importPanel.failedFiles', { names, ...RAW_INTERPOLATION })
        );
      }

      // Converter warnings are per file and already aggregated server-side; surface them so the
      // user knows what to check in the imported page (e.g. images that were dropped).
      for (const item of items) {
        if (!item.viewId || !item.warnings || item.warnings.length === 0) continue;
        const summary = item.warnings
          .slice(0, MAX_REPORTED_WARNINGS)
          .map((warning) => warning.message)
          .join('; ');

        toast.warning(t('importPanel.importedWithWarnings', { name: item.fileName, summary, ...RAW_INTERPOLATION }));
      }

      // Files left unattempted mean there is still work here — keep the dialog open so the
      // user can retry them instead of navigating away from a half-finished batch.
      if (storageLimitReached || !attemptedAll || importedViewIds.length === 0) return null;

      return importedViewIds[0];
    },
    [t]
  );

  const runBatch = useCallback(
    async (
      format: BatchImportFormat,
      files: File[],
      run: (
        signal: AbortSignal,
        onFileStart: (index: number, total: number) => void
      ) => Promise<{ items: ImportFileBatchItem[]; aborted: boolean }>
    ) => {
      if (!workspaceId || files.length === 0) return;
      const controller = new AbortController();

      abortRef.current?.abort();
      abortRef.current = controller;
      setActive(format);
      setBatchProgress({ current: 1, total: files.length });
      try {
        const { items, aborted } = await run(controller.signal, (index, total) =>
          setBatchProgress({ current: index + 1, total })
        );
        const firstViewId = reportBatch(items, aborted || controller.signal.aborted, files.length);

        if (!firstViewId) return;

        close();
        void toView(firstViewId);
        // eslint-disable-next-line
      } catch (e: any) {
        if (e instanceof ImportAbortError) return;
        toast.error(e?.message ?? t('importPanel.failed'));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setActive(null);
        setBatchProgress(null);
      }
    },
    [workspaceId, reportBatch, close, toView, t]
  );

  const handleCsv = useCallback(
    (files: File[]) => {
      if (!workspaceId) return;
      void runBatch('csv', files, (signal, onFileStart) =>
        importCsvFilesAsDatabases({ workspaceId, parentViewId, files, signal, onFileStart })
      );
    },
    [workspaceId, parentViewId, runBatch]
  );

  const handleDocumentFiles = useCallback(
    (files: File[], format: DocumentFileImportFormat) => {
      if (!workspaceId) return;
      void runBatch(format, files, (signal, onFileStart) =>
        importDocumentFiles({ workspaceId, parentViewId, files, format, signal, onFileStart })
      );
    },
    [workspaceId, parentViewId, runBatch]
  );

  const handleZip = useCallback(
    async (file: File, source: ZipImportFormat) => {
      if (!workspaceId) return;
      const controller = new AbortController();

      abortRef.current?.abort();
      abortRef.current = controller;
      setActive(source);
      try {
        const importZip = source === 'confluence' ? importConfluenceZipToView : importNotionZipToView;

        await importZip({
          workspaceId,
          parentViewId,
          file,
          signal: controller.signal,
        });

        toast.success(
          t(source === 'confluence' ? 'importPanel.confluenceImportStarted' : 'importPanel.notionImportStarted')
        );
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
      if (files.length > 0) handleCsv(files);
    },
    [handleCsv]
  );

  const onDocumentFilesPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>, format: DocumentFileImportFormat) => {
      const files = Array.from(event.target.files ?? []);

      event.target.value = '';
      if (files.length > 0) handleDocumentFiles(files, format);
    },
    [handleDocumentFiles]
  );

  const onNotionPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleZip(file, 'notion');
    },
    [handleZip]
  );

  const onConfluencePicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleZip(file, 'confluence');
    },
    [handleZip]
  );

  const batchCounter = (format: BatchImportFormat) =>
    active === format ? (
      <span className='ml-auto flex items-center gap-2'>
        {batchProgress && batchProgress.total > 1 ? (
          <span className='text-xs text-text-secondary' data-testid={`import-${format}-progress`}>
            {t('importPanel.importingCount', { current: batchProgress.current, total: batchProgress.total })}
          </span>
        ) : null}
        <CircularProgress size={14} />
      </span>
    ) : null;

  const tileClassName =
    'flex items-center gap-3 rounded-300 bg-fill-content px-4 py-3 text-left text-text-primary hover:bg-fill-content-hover disabled:opacity-60';

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
            className={tileClassName}
            data-testid='import-markdown'
          >
            <TextIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.textAndMarkdown')}</span>
            {active === 'markdown' ? <CircularProgress size={14} className='ml-auto' /> : null}
          </button>

          <button
            type='button'
            disabled={!!active}
            onClick={() => csvInputRef.current?.click()}
            className={tileClassName}
            data-testid='import-csv'
          >
            <DatabaseIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.csv')}</span>
            {batchCounter('csv')}
          </button>

          {DOCUMENT_TILES.map(({ format, labelKey }) => (
            <button
              key={format}
              type='button'
              disabled={!!active}
              onClick={() => documentInputRefs[format].current?.click()}
              className={tileClassName}
              data-testid={`import-${format}`}
            >
              <DocumentTileIcon format={format} />
              <span className='text-sm'>{t(labelKey)}</span>
              {batchCounter(format)}
            </button>
          ))}

          <button
            type='button'
            disabled={!!active}
            onClick={() => notionInputRef.current?.click()}
            className={tileClassName}
            data-testid='import-notion'
          >
            <NotionIcon className='h-5 w-5 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.notionZip')}</span>
            {active === 'notion' ? <CircularProgress size={14} className='ml-auto' /> : null}
          </button>

          <button
            type='button'
            disabled={!!active}
            onClick={() => confluenceInputRef.current?.click()}
            className={tileClassName}
            data-testid='import-confluence'
          >
            <ConfluenceIcon className='h-5 w-5 shrink-0 text-icon-primary' />
            <span className='text-sm'>{t('importPanel.confluenceZip')}</span>
            {active === 'confluence' ? <CircularProgress size={14} className='ml-auto' /> : null}
          </button>
        </div>

        {/* The visible counter sits inside a disabled button, which assistive tech skips, so the
            batch reports its progress from a live region that stays in the accessibility tree. */}
        <span aria-live='polite' className='sr-only' data-testid='import-csv-progress-announcement'>
          {active &&
          active !== 'markdown' &&
          active !== 'notion' &&
          active !== 'confluence' &&
          batchProgress &&
          batchProgress.total > 1
            ? t('importPanel.importingProgress', { current: batchProgress.current, total: batchProgress.total })
            : ''}
        </span>

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
        {DOCUMENT_TILES.map(({ format, accept }) => (
          <input
            key={format}
            ref={documentInputRefs[format]}
            type='file'
            accept={accept}
            multiple
            className='hidden'
            data-testid={`import-${format}-input`}
            onChange={(event) => onDocumentFilesPicked(event, format)}
          />
        ))}
        <input
          ref={notionInputRef}
          type='file'
          accept={ZIP_ACCEPT}
          className='hidden'
          data-testid='import-notion-input'
          onChange={onNotionPicked}
        />
        <input
          ref={confluenceInputRef}
          type='file'
          accept={ZIP_ACCEPT}
          className='hidden'
          data-testid='import-confluence-input'
          onChange={onConfluencePicked}
        />
      </div>
    </Dialog>
  );
}
