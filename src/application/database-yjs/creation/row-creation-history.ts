import * as Y from 'yjs';

import { DatabaseNoHistoryOrigin, getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
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
  const placements = new Map<string, { previous?: string; next?: string; height: number }>();

  views.forEach((view, id) => {
    const rows = view.get(YjsDatabaseKey.row_orders).toArray();
    const index = rows.findIndex((row) => row.id === rowId);

    if (index >= 0)
      placements.set(id, { previous: rows[index - 1]?.id, next: rows[index + 1]?.id, height: rows[index].height });
  });
  if (!placements.size) return;
  const origin = new DatabaseNoHistoryOrigin({ type: 'row.creation.history', rowId, policy: 'skip' });

  getOrCreateDatabaseHistoryManager(databaseDoc).recordCommittedAction(
    {
      isCurrent: () =>
        !capturedLifetime.destroyed &&
        !isDatabaseHistoryDocumentImmutable(databaseDoc) &&
        databaseDoc.version === version &&
        databaseDoc.databaseRestoreId === restoreId,
      replay: (type) => {
        let changed = false;

        databaseDoc.transact(() => {
          placements.forEach((placement, id) => {
            const orders = views.get(id)?.get(YjsDatabaseKey.row_orders);

            if (!(orders instanceof Y.Array)) return;
            const rows = orders.toArray();
            const index = rows.findIndex((row) => row.id === rowId);

            if (type === 'undo' && index >= 0) {
              orders.delete(index, 1);
              changed = true;
            } else if (type === 'redo' && index < 0) {
              const next = rows.findIndex((row) => row.id === placement.next);
              const previous = rows.findIndex((row) => row.id === placement.previous);

              orders.insert(next >= 0 ? next : previous >= 0 ? previous + 1 : rows.length, [
                { id: rowId, height: placement.height },
              ]);
              changed = true;
            }
          });
        }, origin);
        return changed;
      },
    },
    group
  );
}
