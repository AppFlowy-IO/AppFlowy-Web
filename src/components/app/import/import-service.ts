import * as Y from 'yjs';

import { getCollab, updateCollab } from '@/application/services/js-services/http/collab-api';
import {
  cancelDatabaseCsvImportTask,
  createDatabaseCsvImportTask,
  getDatabaseCsvImportStatus,
  uploadDatabaseCsvImportFile,
} from '@/application/services/js-services/http/import-api';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import {
  deleteBlock,
  getBlock,
  getChildrenArray,
  getPageId,
} from '@/application/slate-yjs/utils/yjs';
import {
  DatabaseCsvImportLayout,
  DatabaseCsvImportMode,
  Types,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { parsedBlockToSlateElement } from '@/components/app/import/markdown-to-blocks';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { calculateMd5 } from '@/utils/md5';

const CSV_POLL_INTERVAL_MS = 1500;
const CSV_POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
export async function populateDocumentWithMarkdown(
  workspaceId: string,
  viewId: string,
  file: File,
): Promise<void> {
  // Fetch the file text and the (empty) page collab in parallel — they're independent
  // and the markdown parse is much cheaper than either round trip.
  const [text, collab] = await Promise.all([
    file.text(),
    getCollab(workspaceId, viewId, Types.Document),
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

export class ImportAbortError extends Error {
  constructor() {
    super('CSV import aborted');
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
    await uploadDatabaseCsvImportFile(task.presigned_url, file, onProgress);

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
    throw err;
  }
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
