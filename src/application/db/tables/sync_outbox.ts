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
  // Yjs state vector (lib0 v1) of the doc state before this local edit, so the
  // server can detect missing updates. Optional: older rows written before this
  // field existed drain without it (legacy server path). Not indexed, so no
  // schema version bump is needed. We intentionally don't store an after vector —
  // the server derives the post-update state itself and never trusts a client one.
  beforeStateVector?: Uint8Array;
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
