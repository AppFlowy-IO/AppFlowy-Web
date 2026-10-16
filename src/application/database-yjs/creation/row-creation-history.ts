import * as Y from 'yjs';

import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { isDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const documentLifetimes = new WeakMap<YDoc, { destroyed: boolean }>();

/** Undo only this new Row's membership, never another writer's structs from its server update. */
export function recordCommittedRowCreation(databaseDoc: YDoc, rowId: string, group?: object) {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database.get(YjsDatabaseKey.views);
  let lifetime = documentLifetimes.get(databaseDoc);

  if (!lifetime) {
    lifetime = { destroyed: false };
    const captured = lifetime;

    databaseDoc.once('destroy', () => {
      captured.destroyed = true;
    });
    documentLifetimes.set(databaseDoc, lifetime);
  }

  const capturedLifetime = lifetime;
  const version = databaseDoc.version;
  const restoreId = databaseDoc.databaseRestoreId;
  const insertions = Y.createDeleteSet();

  views.forEach((view) => {
    const orders = view.get(YjsDatabaseKey.row_orders);
    const rows = orders.toArray();
    const index = rows.findIndex((row) => row.id === rowId);

    if (index < 0 || rows[index].is_deleted) return;
    // Relative positions expose the exact clock even when several orders share
    // one Yjs Item. Capture only this slot, never the rest of the server update.
    const item = Y.createRelativePositionFromTypeIndex(orders, index).item;

    if (!item) return;
    const ranges = insertions.clients.get(item.client) ?? [];

    ranges.push({ clock: item.clock, len: 1 });
    insertions.clients.set(item.client, ranges);
  });
  if (!insertions.clients.size) return;
  insertions.clients.forEach((ranges) => ranges.sort((a, b) => a.clock - b.clock));

  getOrCreateDatabaseHistoryManager(databaseDoc).recordCommittedInsertions(
    insertions,
    () =>
      !capturedLifetime.destroyed &&
      !isDatabaseHistoryDocumentImmutable(databaseDoc) &&
      databaseDoc.version === version &&
      databaseDoc.databaseRestoreId === restoreId,
    group
  );
}
