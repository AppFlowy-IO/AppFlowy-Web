import { Table } from 'dexie';

export interface SyncOutboxRecord {
  id?: number;
  userId: string;
  workspaceId: string;
  /** API origin that owns these bytes; absent only on legacy records. */
  serverUrl?: string;
  objectId: string;
  collabType: number;
  version?: string | null;
  /** Restore identity captured with these bytes; never upgraded while draining. */
  databaseRestoreId?: string;
  payload: Uint8Array;
  createdAt: number;
  // Yjs state vector (lib0 v1) of the doc state before this local edit, so the
  // server can detect missing updates. Optional: older rows written before this
  // field existed drain without it (legacy server path). Not indexed, so no
  // schema version bump is needed. We intentionally don't store an after vector —
  // the server derives the post-update state itself and never trusts a client one.
  beforeStateVector?: Uint8Array;
  /**
   * Server-directed manifest snapshots supersede older pending manifest
   * snapshots for the same object. Local edit records intentionally leave this
   * unset so they are never removed by manifest coalescing.
   */
  source?: 'manifest';
  /** Retained after a permission denial; a transport restart is not a new grant. */
  permissionBlocked?: boolean;
}

export type SyncOutboxTable = {
  sync_outbox: Table<SyncOutboxRecord, number>;
  sync_permission_blocks: Table<SyncPermissionBlock, [string, string, string, string]>;
};

export interface SyncPermissionBlock {
  serverUrl: string;
  userId: string;
  workspaceId: string;
  objectId: string;
  revision: string;
}

export const syncPermissionBlockSchema = {
  sync_permission_blocks: '[serverUrl+userId+workspaceId+objectId], [serverUrl+userId+workspaceId]',
};

// Records are scoped by [userId + workspaceId] so a tab crash cannot leave
// rows from user A that later drain over user B's WebSocket in the same
// workspace. Sign-out preserves recoverable edits; drain authorization also
// checks the owning API origin before transmitting any retained row.
export const syncOutboxSchema = {
  sync_outbox: '++id, [userId+workspaceId], [userId+workspaceId+objectId], [userId+workspaceId+objectId+id]',
};
