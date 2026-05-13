import { Table } from 'dexie';

export type LocalCollabRecoveryStatus =
  | 'discovered'
  | 'merged'
  | 'uploading'
  | 'synced'
  | 'legacy_deleted'
  | 'failed'
  | 'skipped';

export interface LocalCollabRecoveryRecord {
  workspaceId: string;
  objectId: string;
  collabType: number;
  databaseId: string;
  databaseIdAliases?: string[];
  legacyDbName: string;
  legacyCacheDeleted?: boolean;
  source: 'legacy';
  status: LocalCollabRecoveryStatus;
  attempts: number;
  discoveredAt: number;
  updatedAt: number;
  lastLocalAt: number;
  lastSyncedAt?: number;
  error?: string;
}

export type LocalCollabRecoveryTable = {
  local_collab_recovery: Table<LocalCollabRecoveryRecord, [string, string]>;
};

export const localCollabRecoverySchema = {
  local_collab_recovery:
    '[workspaceId+objectId], workspaceId, status, [workspaceId+status], legacyDbName, updatedAt',
};
