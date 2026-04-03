/**
 * Gathers database collab data from local YDocs for client-side publishing.
 *
 * This mirrors the desktop's `gather_publish_encode_collab` — the web collects
 * the database collab, row collabs (with cell values), and row sub-documents
 * from the locally synced Yjs documents and packages them as a
 * `PublishDatabaseData` JSON blob ready for the binary publish endpoint.
 */
import * as Y from 'yjs';

import { openCollabDB } from '@/application/db';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { createRow } from '@/application/services/js-services/cache';
import {
  YDatabase,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

/**
 * Gather all database collab data needed for publishing.
 *
 * @returns Uint8Array containing JSON-serialized PublishDatabaseData
 */
export async function gatherDatabasePublishData(
  viewId: string,
  visibleViewIds?: string[]
): Promise<Uint8Array> {
  // 1. Open the database doc from cache (opened when user navigated to the view).
  //    The doc is cached under the viewId key in the provider cache.
  //    Its guid may have been changed to databaseId by resolveCollabObjectId,
  //    but the data is in the doc opened via viewId.
  const dbDoc = await openCollabDB(viewId);
  const dbSharedRoot = dbDoc.getMap(YjsEditorKey.data_section);
  const db = dbSharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

  if (!db) {
    throw new Error(`Database not found in doc for view ${viewId}`);
  }

  const actualDatabaseId = db.get(YjsDatabaseKey.id) || dbDoc.guid || viewId;

  // 2. Collect all unique row IDs from all views
  const rowIdSet = new Set<string>();
  const views = db.get(YjsDatabaseKey.views);

  if (views) {
    views.forEach((_value: unknown, key: string) => {
      const view = views.get(key) as YDatabaseView | undefined;

      if (!view) return;
      const rowOrders = view.get(YjsDatabaseKey.row_orders);

      if (!rowOrders) return;
      for (let i = 0; i < rowOrders.length; i++) {
        const row = rowOrders.get(i) as { id?: string } | undefined;

        if (row?.id) {
          rowIdSet.add(row.id);
        }
      }
    });
  }

  const rowIds = Array.from(rowIdSet);

  Log.debug('[gatherDatabasePublishData]', {
    viewId,
    databaseId: actualDatabaseId,
    rowCount: rowIds.length,
  });

  // 3. Encode database collab
  const databaseCollab = Array.from(Y.encodeStateAsUpdate(dbDoc));

  // 4. Encode each row collab
  const databaseRowCollabs: Record<string, number[]> = {};

  for (const rowId of rowIds) {
    try {
      const rowKey = getRowKey(actualDatabaseId, rowId);
      const rowDoc = await createRow(rowKey);

      // Verify the row doc has data
      const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);

      if (!rowRoot.has(YjsEditorKey.database_row)) {
        Log.debug('[gatherDatabasePublishData] skipping empty row', { rowId });
        continue;
      }

      databaseRowCollabs[rowId] = Array.from(Y.encodeStateAsUpdate(rowDoc));
    } catch (e) {
      Log.debug('[gatherDatabasePublishData] failed to load row', { rowId, error: e });
    }
  }

  // 5. Encode row documents (sub-documents inside database rows)
  // Row documents are separate collab documents for the content editor inside a row detail page.
  // For now, we include an empty map — the primary field text is stored in row cells, not row documents.
  const databaseRowDocumentCollabs: Record<string, number[]> = {};

  // 6. Build PublishDatabaseData JSON
  const publishData = {
    database_collab: databaseCollab,
    database_row_collabs: databaseRowCollabs,
    database_row_document_collabs: databaseRowDocumentCollabs,
    visible_database_view_ids: visibleViewIds || [viewId],
    database_relations: { [actualDatabaseId]: viewId },
  };

  Log.debug('[gatherDatabasePublishData] gathered', {
    dbCollabBytes: databaseCollab.length,
    rowCollabCount: Object.keys(databaseRowCollabs).length,
    rowDocCount: Object.keys(databaseRowDocumentCollabs).length,
  });

  return new TextEncoder().encode(JSON.stringify(publishData));
}
