import * as Y from 'yjs';

import { getCollab, updateCollab } from '@/application/services/js-services/http/collab-api';
import {
  cancelDatabaseCsvImportTask,
  cancelImportTask,
  createDatabaseCsvImportTask,
  createNotionImportTask,
  getDatabaseCsvImportStatus,
  uploadImportFile,
  uploadImportFileMultipart,
  uploadDatabaseCsvImportFile,
} from '@/application/services/js-services/http/import-api';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { deleteBlock, getBlock, getChildrenArray, getPageId } from '@/application/slate-yjs/utils/yjs';
import { DatabaseCsvImportLayout, DatabaseCsvImportMode, Types, YjsEditorKey, YSharedRoot } from '@/application/types';
import { parsedBlockToSlateElement } from '@/components/app/import/markdown-to-blocks';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
// Import failures arrive either as `Error`s or as `{ code, message }` rejections from the
// HTTP layer; `getErrorMessage` normalises both.
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';
import { calculateMd5 } from '@/utils/md5';

const CSV_POLL_INTERVAL_MS = 1500;
const CSV_POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
  // Fetch the file text and the (empty) page collab in parallel — they're independent
  // and the markdown parse is much cheaper than either round trip.
  const [text, collab] = await Promise.all([file.text(), getCollab(workspaceId, viewId, Types.Document)]);
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

export interface ImportNotionInput {
  workspaceId: string;
  parentViewId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportNotionResult {
  taskId: string;
}

export class ImportAbortError extends Error {
  constructor() {
    super('Import aborted');
    this.name = 'ImportAbortError';
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

export interface ImportCsvBatchItem {
  fileName: string;
  /** Set when the file imported successfully. */
  viewId?: string;
  /**
   * Set when the file failed; the batch continued with the remaining files. Empty when the
   * failure carried no message — wording is the caller's job, so it stays translatable.
   */
  error?: string;
}

export interface ImportCsvBatchResult {
  /**
   * One entry per file that was attempted, in selection order. Shorter than the input when the
   * batch stopped early — either cancelled, or halted by a failure that would repeat for every
   * remaining file. Callers should treat `items.length`, not the input length, as the denominator.
   */
  items: ImportCsvBatchItem[];
  /** True when `signal` fired mid-batch, so `items` covers only the files attempted so far. */
  aborted: boolean;
}

/**
 * Import several CSV files as sibling Grid pages under the same parent.
 *
 * Files are imported one at a time on purpose: the server caps how many import tasks a user
 * may have pending (`MAXIMUM_IMPORT_PENDING_TASK`, 3 by default), so fanning out in parallel
 * makes every file past the cap fail with `TooManyImportTask`.
 *
 * One bad file does not sink the batch — its error is recorded and the remaining files still
 * import. The exception is `TooManyImportTask`, which is about the account rather than the file:
 * retrying it per file would burn a round trip each and then blame every file for a queue the
 * user only has to wait out, so the batch stops and reports the server's message once.
 *
 * Aborting via `signal` likewise stops the batch and returns what finished, rather than throwing,
 * so the caller can still report the pages that were created.
 */
export async function importCsvFilesAsDatabases(input: ImportCsvBatchInput): Promise<ImportCsvBatchResult> {
  const { workspaceId, parentViewId, files, onFileStart, signal } = input;
  const items: ImportCsvBatchItem[] = [];

  for (let index = 0; index < files.length; index++) {
    if (signal?.aborted) return { items, aborted: true };

    const file = files[index];

    onFileStart?.(index, files.length);

    try {
      const { viewId } = await importCsvAsDatabase({ workspaceId, parentViewId, file, signal });

      items.push({ fileName: file.name, viewId });
    } catch (err) {
      if (err instanceof ImportAbortError) return { items, aborted: true };

      items.push({ fileName: file.name, error: getErrorMessage(err, '') });

      // Batch-fatal: the pending-task cap belongs to the user, not to this file.
      if (isAPIErrorCode(err, TOO_MANY_IMPORT_TASK_CODE)) return { items, aborted: false };
    }
  }

  return { items, aborted: false };
}

/**
 * Upload a Notion export zip into an existing workspace under the selected view.
 * The server processes the imported workspace asynchronously after upload.
 */
export async function importNotionZipToView(input: ImportNotionInput): Promise<ImportNotionResult> {
  const { workspaceId, parentViewId, file, onProgress, signal } = input;

  throwIfAborted(signal);
  const md5_base64 = await calculateMd5(file);

  throwIfAborted(signal);
  const task = await createNotionImportTask(workspaceId, parentViewId, {
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
