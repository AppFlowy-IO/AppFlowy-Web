import { Table } from 'dexie';

export interface SyncOutboxRecord {
  id?: number;
  userId: string;
  workspaceId: string;
  objectId: string;
  collabType: number;
  version?: string | null;
  payload: Uint8Array;
  createdAt: number;
  // Yjs state vectors (lib0 v1) captured at the time this local update was
  // produced, so the server can detect missing updates. `before` is the doc
  // state before the edit, `after` the state after it. Optional: older rows
  // written before this field existed drain without them (legacy server path).
  // Not indexed, so no schema version bump is needed.
  beforeStateVector?: Uint8Array;
  afterStateVector?: Uint8Array;
}

export type SyncOutboxTable = {
  sync_outbox: Table<SyncOutboxRecord, number>;
};

// Records are scoped by [userId + workspaceId] so a tab crash cannot leave
// rows from user A that later drain over user B's WebSocket in the same
// workspace. Purge-on-logout covers the graceful case; userId scoping is the
// backstop for tab crashes / orphaned rows.
export const syncOutboxSchema = {
  sync_outbox: '++id, [userId+workspaceId], [userId+workspaceId+objectId], [userId+workspaceId+objectId+id]',
};
