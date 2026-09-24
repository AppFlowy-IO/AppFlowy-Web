import * as Y from 'yjs';

import { getCollab, updateCollab } from '@/application/services/js-services/http/collab-api';
import {
  cancelDatabaseCsvImportTask,
  cancelImportTask,
  createConfluenceImportTask,
  createDatabaseCsvImportTask,
  createDocumentFileImportTask,
  createNotionImportTask,
  getDatabaseCsvImportStatus,
  getDocumentFileImportStatus,
  uploadDocumentFileImportFile,
  uploadImportFile,
  uploadImportFileMultipart,
  uploadDatabaseCsvImportFile,
} from '@/application/services/js-services/http/import-api';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { deleteBlock, getBlock, getChildrenArray, getPageId } from '@/application/slate-yjs/utils/yjs';
import {
  DatabaseCsvImportLayout,
  DatabaseCsvImportMode,
  DocumentFileImportFormat,
  ImportDiagnosticsWarning,
  Types,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { parsedBlockToSlateElement } from '@/components/app/import/markdown-to-blocks';
// Import failures arrive either as `Error`s or as `{ code, message }` rejections from the
// HTTP layer; `getErrorMessage` normalises both.
import { getAPIErrorCode, getErrorMessage, isAPIErrorCode, isStorageLimitError } from '@/utils/errors';
import { calculateMd5 } from '@/utils/md5';

const CSV_POLL_INTERVAL_MS = 1500;
const CSV_POLL_TIMEOUT_MS = 5 * 60 * 1000;
// A 50 MB Word document or a 20 MB PDF can take the worker a while to convert; poll a bit slower
// and wait longer than for CSV.
const DOCUMENT_POLL_INTERVAL_MS = 2000;
const DOCUMENT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Per-format upload caps, mirroring the server defaults (which mirror Notion's paid-plan limits).
 * Checked before uploading so an oversized pick fails instantly instead of after the upload.
 */
export const DOCUMENT_FILE_MAX_BYTES: Record<DocumentFileImportFormat, number> = {
  html: 50 * 1024 * 1024,
  docx: 50 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
};

export class DocumentFileTooLargeError extends Error {
  constructor(public readonly fileName: string, public readonly limitBytes: number) {
    super(`${fileName} exceeds the ${Math.round(limitBytes / 1024 / 1024)} MB limit`);
    this.name = 'DocumentFileTooLargeError';
  }
}

// AppFlowy Cloud's `ErrorCode::TooManyImportTask`. Unlike a bad delimiter or an oversized file,
// this describes the account rather than the file, so every remaining file in a batch would fail
// the same way — see `ensure_import_task_capacity` in the server's workspace/database API.
const TOO_MANY_IMPORT_TASK_CODE = 1046;

export function stripFileExtension(name: string): string {
  const dot = name.lastIndexOf('.');

  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Populate a freshly-created Document page with the contents of a Markdown / plain-text file.
 *
 * The server has no single-file MD endpoint, so we fetch the page's empty Y.Doc, mutate it
 * locally with `slateContentInsertToYData`, and PUT the encoded update back via `updateCollab`.
 * The page must already exist (created via PageService.add by the caller).
 */
export async function populateDocumentWithMarkdown(workspaceId: string, viewId: string, file: File): Promise<void> {
  // ZIP and CSV imports do not need the Markdown parser. Load it only for Markdown,
  // alongside the independent file and empty-page reads.
  const [text, collab, { parseMarkdown }] = await Promise.all([
    file.text(),
    getCollab(workspaceId, viewId, Types.Document),
    import('@/components/editor/parsers/markdown-parser'),
  ]);
  const blocks = parseMarkdown(text);

  if (blocks.length === 0) return;

  const docState = collab.data;
  const doc = new Y.Doc();

  Y.applyUpdate(doc, docState);

  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const pageId = getPageId(sharedRoot);
  const pageBlock = getBlock(pageId, sharedRoot);

  if (!pageBlock) {
    throw new Error('Imported document has no root page block');
  }

  const childrenArray = getChildrenArray(pageBlock.get(YjsEditorKey.block_children), sharedRoot);
  const existingChildIds = childrenArray ? childrenArray.toArray() : [];
  const slateNodes = blocks.map(parsedBlockToSlateElement);

  doc.transact(() => {
    existingChildIds.forEach((id) => deleteBlock(sharedRoot, id));
    slateContentInsertToYData(pageId, 0, slateNodes, doc);
  });

  const update = Y.encodeStateAsUpdate(doc);

  await updateCollab(workspaceId, viewId, Types.Document, update, { version_vector: 0 });
}

export interface ImportCsvInput {
  workspaceId: string;
  parentViewId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportCsvResult {
  viewId: string;
}

export interface ImportZipInput {
  workspaceId: string;
  parentViewId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportZipResult {
  taskId: string;
}

export type ImportNotionInput = ImportZipInput;
export type ImportNotionResult = ImportZipResult;

export class ImportAbortError extends Error {
  constructor() {
    super('Import aborted');
    this.name = 'ImportAbortError';
  }
}

/** Preserve the worker's error code just like a rejected HTTP request. */
class ImportTaskError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'ImportTaskError';
  }
}

/**
 * Import a CSV file as a new Grid (database) page. Server handles parsing.
 *
 *   1. createDatabaseCsvImportTask → { task_id, presigned_url }
 *   2. PUT csv to presigned_url
 *   3. poll getDatabaseCsvImportStatus until 'Completed' (returns view_id) or terminal failure
 *
 * If `signal` aborts, polling exits and the server task is cancelled best-effort.
 */
export async function importCsvAsDatabase(input: ImportCsvInput): Promise<ImportCsvResult> {
  const { workspaceId, parentViewId, file, onProgress, signal } = input;

  throwIfAborted(signal);
  const md5_base64 = await calculateMd5(file);

  throwIfAborted(signal);
  const baseName = stripFileExtension(file.name);

  const task = await createDatabaseCsvImportTask(workspaceId, {
    content_length: file.size,
    md5_base64,
    mode: DatabaseCsvImportMode.Create,
    parent_view_id: parentViewId,
    name: baseName,
    layout: DatabaseCsvImportLayout.Grid,
    csv: {
      has_header: true,
      delimiter: ',',
      quote: '"',
      escape: '\\',
      encoding: 'utf-8',
      trim: false,
    },
  });

  try {
    throwIfAborted(signal);
    await uploadDatabaseCsvImportFile(task.presigned_url, file, onProgress, signal);

    const start = Date.now();

    while (Date.now() - start < CSV_POLL_TIMEOUT_MS) {
      throwIfAborted(signal);
      const status = await getDatabaseCsvImportStatus(workspaceId, task.task_id);

      if (status.status === 'Completed' && status.view_id) {
        return { viewId: status.view_id };
      }

      if (status.status === 'Failed' || status.status === 'Expire' || status.status === 'Cancel') {
        throw new Error(status.error || `CSV import ${status.status.toLowerCase()}`);
      }

      await sleep(CSV_POLL_INTERVAL_MS, signal);
    }

    throw new Error('CSV import timed out');
  } catch (err) {
    // Server task is still running — cancel it whether we aborted, timed out, or hit a hard failure.
    void cancelDatabaseCsvImportTask(workspaceId, task.task_id).catch(noop);
    // An aborted upload surfaces as an axios `CanceledError`, not an `ImportAbortError`.
    // Normalise it so callers can tell "user cancelled" from "this file failed".
    throwIfAborted(signal);
    throw err;
  }
}

export interface ImportCsvBatchInput {
  workspaceId: string;
  parentViewId: string;
  files: File[];
  /** Called before each file starts, with its zero-based index in `files`. */
  onFileStart?: (index: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ImportFileBatchItem {
  fileName: string;
  /** Set when the file imported successfully. */
  viewId?: string;
  /**
   * Set when the file failed. Empty when the failure carried no message — wording is the
   * caller's job, so it stays translatable.
   */
  error?: string;
  /** Application error code, when the API or worker supplied one. */
  code?: number;
  /** Content the converter could not carry over, when the server reported any. */
  warnings?: ImportDiagnosticsWarning[];
}

export type ImportCsvBatchItem = ImportFileBatchItem;

export interface ImportFileBatchResult {
  /**
   * One entry per file that was attempted, in selection order. Shorter than the input when the
   * batch stopped early — either cancelled, or halted by a failure that would repeat for every
   * remaining file. Callers should treat `items.length`, not the input length, as the denominator.
   */
  items: ImportFileBatchItem[];
  /** True when `signal` fired mid-batch, so `items` covers only the files attempted so far. */
  aborted: boolean;
}

export type ImportCsvBatchResult = ImportFileBatchResult;

/**
 * Import several files one at a time, each into its own page under the same parent.
 *
 * Sequential on purpose: the server caps how many import tasks a user may have pending
 * (`MAXIMUM_IMPORT_PENDING_TASK`, 3 by default), so fanning out in parallel makes every file
 * past the cap fail with `TooManyImportTask`.
 *
 * One bad file does not sink the batch — its error is recorded and the remaining files still
 * import. Queue capacity and workspace storage failures stop the batch so the user can address
 * the limit before uploading more files.
 *
 * Aborting via `signal` likewise stops the batch and returns what finished, rather than throwing,
 * so the caller can still report the pages that were created.
 */
async function importFilesSequentially(
  files: File[],
  signal: AbortSignal | undefined,
  onFileStart: ((index: number, total: number) => void) | undefined,
  importOne: (file: File) => Promise<{ viewId: string; warnings?: ImportDiagnosticsWarning[] }>
): Promise<ImportFileBatchResult> {
  const items: ImportFileBatchItem[] = [];

  for (let index = 0; index < files.length; index++) {
    if (signal?.aborted) return { items, aborted: true };

    const file = files[index];

    onFileStart?.(index, files.length);

    try {
      const { viewId, warnings } = await importOne(file);

      items.push(
        warnings && warnings.length > 0 ? { fileName: file.name, viewId, warnings } : { fileName: file.name, viewId }
      );
    } catch (err) {
      if (err instanceof ImportAbortError) return { items, aborted: true };

      const code = getAPIErrorCode(err);

      items.push({ fileName: file.name, error: getErrorMessage(err, ''), ...(code === undefined ? {} : { code }) });

      if (isAPIErrorCode(err, TOO_MANY_IMPORT_TASK_CODE) || isStorageLimitError(err)) return { items, aborted: false };
    }
  }

  return { items, aborted: false };
}

/** Import several CSV files as sibling Grid pages under the same parent. */
export async function importCsvFilesAsDatabases(input: ImportCsvBatchInput): Promise<ImportCsvBatchResult> {
  const { workspaceId, parentViewId, files, onFileStart, signal } = input;

  return importFilesSequentially(files, signal, onFileStart, (file) =>
    importCsvAsDatabase({ workspaceId, parentViewId, file, signal })
  );
}

export interface ImportDocumentFileInput {
  workspaceId: string;
  parentViewId: string;
  file: File;
  format: DocumentFileImportFormat;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportDocumentFileResult {
  viewId: string;
  warnings: ImportDiagnosticsWarning[];
}

/**
 * Import one HTML / Word / PDF file as a new Document page. The server converts it.
 *
 *   1. createDocumentFileImportTask → { task_id, presigned_url }
 *   2. PUT the file to presigned_url with the format's content type
 *   3. poll getDocumentFileImportStatus until 'Completed' (returns view_id) or a terminal failure
 *
 * If `signal` aborts, polling exits and the server task is cancelled best-effort.
 */
export async function importDocumentFile(input: ImportDocumentFileInput): Promise<ImportDocumentFileResult> {
  const { workspaceId, parentViewId, file, format, onProgress, signal } = input;

  throwIfAborted(signal);
  const limit = DOCUMENT_FILE_MAX_BYTES[format];

  if (file.size > limit) throw new DocumentFileTooLargeError(file.name, limit);

  const md5_base64 = await calculateMd5(file);

  throwIfAborted(signal);
  const task = await createDocumentFileImportTask(workspaceId, {
    content_length: file.size,
    md5_base64,
    file_name: file.name,
    format,
    parent_view_id: parentViewId,
  });

  try {
    throwIfAborted(signal);
    await uploadDocumentFileImportFile(task.presigned_url, file, format, onProgress, signal);

    const start = Date.now();

    while (Date.now() - start < DOCUMENT_POLL_TIMEOUT_MS) {
      throwIfAborted(signal);
      const status = await getDocumentFileImportStatus(workspaceId, task.task_id);

      if (status.status === 'Completed' && status.view_id) {
        return { viewId: status.view_id, warnings: status.diagnostics?.warnings ?? [] };
      }

      if (status.status === 'Failed' || status.status === 'Expire' || status.status === 'Cancel') {
        throw new ImportTaskError(status.error || `${format} import ${status.status.toLowerCase()}`, status.error_code);
      }

      await sleep(DOCUMENT_POLL_INTERVAL_MS, signal);
    }

    throw new Error(`${format} import timed out`);
  } catch (err) {
    // The server task may still be pending or converting — cancel it whether we aborted, timed
    // out, or hit a hard failure.
    void cancelImportTask(task.task_id).catch(noop);
    throwIfAborted(signal);
    throw err;
  }
}

export interface ImportDocumentFilesBatchInput {
  workspaceId: string;
  parentViewId: string;
  files: File[];
  format: DocumentFileImportFormat;
  /** Called before each file starts, with its zero-based index in `files`. */
  onFileStart?: (index: number, total: number) => void;
  signal?: AbortSignal;
}

/** Import several HTML / Word / PDF files as sibling Document pages under the same parent. */
export async function importDocumentFiles(input: ImportDocumentFilesBatchInput): Promise<ImportFileBatchResult> {
  const { workspaceId, parentViewId, files, format, onFileStart, signal } = input;

  return importFilesSequentially(files, signal, onFileStart, (file) =>
    importDocumentFile({ workspaceId, parentViewId, file, format, signal })
  );
}

/**
 * Upload a Notion export zip into an existing workspace under the selected view.
 * The server processes the imported workspace asynchronously after upload.
 */
export async function importNotionZipToView(input: ImportNotionInput): Promise<ImportNotionResult> {
  return importZipToView(input, createNotionImportTask);
}

/** Upload a Confluence HTML or CSV space-export ZIP; the server detects its format. */
export async function importConfluenceZipToView(input: ImportZipInput): Promise<ImportZipResult> {
  return importZipToView(input, createConfluenceImportTask);
}

async function importZipToView(
  input: ImportZipInput,
  createTask: typeof createNotionImportTask
): Promise<ImportZipResult> {
  const { workspaceId, parentViewId, file, onProgress, signal } = input;

  throwIfAborted(signal);
  const md5_base64 = await calculateMd5(file);

  throwIfAborted(signal);
  const task = await createTask(workspaceId, parentViewId, {
    content_length: file.size,
    md5_base64,
  });

  try {
    throwIfAborted(signal);
    if (task.multipart) {
      await uploadImportFileMultipart(file, task.multipart, onProgress ?? noopProgress, signal);
    } else {
      await uploadImportFile(task.presignedUrl, file, onProgress ?? noopProgress, signal);
    }

    throwIfAborted(signal);
    return { taskId: task.taskId };
  } catch (err) {
    void cancelImportTask(task.taskId).catch(noop);
    // A zip upload is the longest thing this dialog does, so the signal has to reach it — and an
    // aborted upload surfaces as an axios `CanceledError`. Normalise it so the caller can tell
    // "user cancelled" from "the upload failed", exactly as the CSV path does.
    throwIfAborted(signal);
    throw err;
  }
}

function noopProgress(): void {
  /* swallow */
}

function noop(): void {
  /* swallow */
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImportAbortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ImportAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ImportAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
