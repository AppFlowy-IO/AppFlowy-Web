import { stringify as stringifyUuid, v4 as uuid } from 'uuid';
import * as Y from 'yjs';

import { DatabaseHistoryRowStore } from '@/application/database-yjs/history-row-store';
import { getDatabaseHistoryRows, previewDatabaseVersion } from '@/application/services/domains/database-history';
import { YDoc } from '@/application/types';

export interface DatabaseHistoryPreviewSession {
  root: YDoc;
  rows: Record<string, YDoc>;
  destroy: () => void;
}

export async function loadDatabaseHistoryPreview({
  workspaceId,
  databaseId,
  version,
  rowCount,
  signal,
}: {
  workspaceId: string;
  databaseId: string;
  version: string;
  rowCount: number;
  signal: AbortSignal;
}): Promise<DatabaseHistoryPreviewSession> {
  const sessionId = uuid();
  const root: YDoc = new Y.Doc({ guid: `history:${workspaceId}:${databaseId}:${version}:${sessionId}` });
  const rowStore = new DatabaseHistoryRowStore(root.guid);
  const rows = rowStore.rows;
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    root.destroy();
    rowStore.destroy();
  };

  const assertActive = () => {
    if (signal.aborted) throw new DOMException('Preview cancelled', 'AbortError');
  };

  try {
    const rootBytes = await previewDatabaseVersion(workspaceId, databaseId, version, signal);

    assertActive();
    Y.applyUpdate(root, rootBytes);
    let cursor: string | undefined;
    const visitedCursors = new Set<string>();

    do {
      const page = await getDatabaseHistoryRows(workspaceId, databaseId, version, { cursor, signal });

      assertActive();
      let validatedRows = 0;

      for (const row of page.updates) {
        if (!row.rowId || row.rowId.byteLength !== 16 || !row.docState?.docState?.byteLength) {
          throw new Error('This database version contains an unavailable row.');
        }

        const id = stringifyUuid(row.rowId);

        const encoder = row.docState.encoderVersion ?? 1;

        rowStore.add(id, row.docState.docState, encoder);
        // Yield between decode batches so changing versions cancels promptly.
        if (++validatedRows % 64 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          assertActive();
        }
      }

      cursor = page.page?.hasMore && page.page.nextCursor?.byteLength
        ? new TextDecoder('utf-8', { fatal: true }).decode(page.page.nextCursor)
        : undefined;
      if (page.page?.hasMore && (!cursor || visitedCursors.has(cursor))) {
        throw new Error('Database history pagination did not advance.');
      }

      if (cursor) visitedCursors.add(cursor);
    } while (cursor);

    if (rowStore.rowCount !== rowCount) {
      throw new Error('This database version is incomplete. Refresh history and try again.');
    }

    return { root, rows, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}
