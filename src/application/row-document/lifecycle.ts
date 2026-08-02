/**
 * Row-document (row page) lifecycle helpers.
 *
 * A database row opened as a page is backed by an orphaned folder view whose
 * id equals the row's document id and whose `extra` carries the source ids
 * (`{"row_document":{"source":{database_id,database_view_id,row_id}}}`).
 * Materializing that view is what makes the row page favoritable/trashable
 * through the regular page-view APIs.
 */

import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { PageService, ViewService } from '@/application/services/domains';
import { RowDocumentSourcePayload, View } from '@/application/types';
import { Log } from '@/utils/log';

/**
 * The row document id is deterministic: the hashed meta key derived from the
 * row id (same derivation the row meta map uses for RowMetaKey.DocumentId).
 */
export function rowDocumentIdFromRowId(rowId: string): string {
  return getMetaIdMap(rowId).get(RowMetaKey.DocumentId) ?? '';
}

/**
 * Returns the complete row-document source carried on a favorites/trash view
 * entry, or null when the view is not a (complete) row-document view.
 */
export function getRowDocumentSourceFromView(view?: View | null): RowDocumentSourcePayload | null {
  const source = view?.extra?.row_document?.source;

  if (!source?.database_id || !source.database_view_id || !source.row_id) {
    return null;
  }

  return {
    database_id: source.database_id,
    database_view_id: source.database_view_id,
    row_id: source.row_id,
  };
}

/**
 * Idempotently materializes the row-document folder view on the server.
 * The server repairs/merges an existing view, so re-registering is safe.
 * Returns false (and logs) on failure instead of throwing — callers decide
 * whether the follow-up action can still proceed.
 */
export async function ensureRowDocumentView(
  workspaceId: string,
  documentId: string,
  source: RowDocumentSourcePayload
): Promise<boolean> {
  try {
    await ViewService.createOrphaned(workspaceId, {
      document_id: documentId,
      row_document_source: source,
    });
    return true;
  } catch (e) {
    Log.warn('[row-document] ensureRowDocumentView failed', { workspaceId, documentId, source, error: e });
    return false;
  }
}

/**
 * Whether the row's document collab was ever materialized on the server.
 * Mirrors desktop's `existing_row_document_metadata_candidates`: a row whose
 * meta claims an empty document is still trashed (not hard-deleted) when a
 * row-document was materialized for it. Errors resolve to false so deletion
 * falls back to the hard-delete path.
 */
export async function rowDocumentExists(workspaceId: string, documentId: string): Promise<boolean> {
  if (!documentId) return false;

  try {
    return await ViewService.checkCollabExists(workspaceId, documentId);
  } catch (e) {
    Log.warn('[row-document] rowDocumentExists check failed', { workspaceId, documentId, error: e });
    return false;
  }
}

/**
 * Pushes the row's primary-cell title to the row-document view name so
 * favorites/trash entries show the row title. Failures are logged only.
 */
export async function syncRowDocumentViewName(workspaceId: string, documentId: string, name: string): Promise<void> {
  try {
    await PageService.updateName(workspaceId, documentId, name);
  } catch (e) {
    Log.warn('[row-document] syncRowDocumentViewName failed', { workspaceId, documentId, error: e });
  }
}
