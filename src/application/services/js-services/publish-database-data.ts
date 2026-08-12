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
import { YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { Log } from '@/utils/log';

interface RowOrderEntry {
  id?: string;
  is_deleted?: boolean;
}

const PUBLISH_ROW_LOAD_CONCURRENCY = 8;

/**
 * Publishing must not expose rows that only remain in the live collab as
 * restoreable tombstones. Clone the database document so those entries can be
 * removed without mutating the open database or its undo history.
 */
function createDatabasePublishSnapshot(dbDoc: Y.Doc): { doc: Y.Doc; rowIds: string[] } {
  const publishDoc = new Y.Doc({ guid: dbDoc.guid });

  Y.applyUpdate(publishDoc, Y.encodeStateAsUpdate(dbDoc));

  const sharedRoot = publishDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const rowIdSet = new Set<string>();
  const views = database?.get(YjsDatabaseKey.views);

  publishDoc.transact(() => {
    views?.forEach((view) => {
      const rowOrders = view.get(YjsDatabaseKey.row_orders);

      if (!rowOrders) return;

      for (let index = rowOrders.length - 1; index >= 0; index -= 1) {
        const row = rowOrders.get(index) as RowOrderEntry | undefined;

        if (row?.is_deleted) {
          rowOrders.delete(index);
        }
      }
    });
  }, 'filterTombstonedRowsForPublish');

  views?.forEach((view) => {
    const rowOrders = view.get(YjsDatabaseKey.row_orders);

    for (let index = 0; index < (rowOrders?.length ?? 0); index += 1) {
      const row = rowOrders?.get(index) as RowOrderEntry | undefined;

      if (row?.id) {
        rowIdSet.add(row.id);
      }
    }
  });

  return { doc: publishDoc, rowIds: Array.from(rowIdSet) };
}

/**
 * Gather all database collab data needed for publishing.
 *
 * @returns Uint8Array containing JSON-serialized PublishDatabaseData
 */
export async function gatherDatabasePublishData(
  viewId: string,
  visibleViewIds?: string[],
  databaseIdHint?: string | null
): Promise<Uint8Array> {
  // 1. Open the database doc from cache. New database views use the canonical
  //    databaseId cache key; fall back to the legacy viewId cache for users who
  //    have not reopened/migrated this database yet.
  let dbDoc = await openCollabDB(databaseIdHint || viewId);
  let dbSharedRoot = dbDoc.getMap(YjsEditorKey.data_section);
  let db = dbSharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

  if (!db && databaseIdHint && databaseIdHint !== viewId) {
    dbDoc = await openCollabDB(viewId);
    dbSharedRoot = dbDoc.getMap(YjsEditorKey.data_section);
    db = dbSharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
  }

  if (!db) {
    throw new Error(`Database not found in doc for view ${viewId}`);
  }

  const actualDatabaseId = databaseIdHint || db.get(YjsDatabaseKey.id) || dbDoc.guid || viewId;

  // 2. Build an isolated publish snapshot. Tombstoned row orders are removed
  //    from both the encoded database collab and the row-collab work list.
  const { doc: publishDbDoc, rowIds } = createDatabasePublishSnapshot(dbDoc);

  Log.debug('[gatherDatabasePublishData]', {
    viewId,
    databaseId: actualDatabaseId,
    rowCount: rowIds.length,
  });

  // 3. Encode database collab
  const databaseCollab = Array.from(Y.encodeStateAsUpdate(publishDbDoc));

  publishDbDoc.destroy();

  // 4. Encode each row collab. Row documents are independent, so load them in
  // bounded parallel batches rather than adding one IndexedDB round trip per
  // row to the critical path.
  const databaseRowCollabs: Record<string, number[]> = {};

  for (let start = 0; start < rowIds.length; start += PUBLISH_ROW_LOAD_CONCURRENCY) {
    const rowBatch = rowIds.slice(start, start + PUBLISH_ROW_LOAD_CONCURRENCY);
    const encodedRows = await Promise.all(
      rowBatch.map(async (rowId): Promise<[string, number[]] | null> => {
        try {
          const rowKey = getRowKey(actualDatabaseId, rowId);
          const rowDoc = await createRow(rowKey);

          // Verify the row doc has data
          const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);

          if (!rowRoot.has(YjsEditorKey.database_row)) {
            Log.debug('[gatherDatabasePublishData] skipping empty row', { rowId });
            return null;
          }

          return [rowId, Array.from(Y.encodeStateAsUpdate(rowDoc))];
        } catch (e) {
          Log.debug('[gatherDatabasePublishData] failed to load row', { rowId, error: e });
          return null;
        }
      })
    );

    for (const encodedRow of encodedRows) {
      if (encodedRow) {
        databaseRowCollabs[encodedRow[0]] = encodedRow[1];
      }
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
