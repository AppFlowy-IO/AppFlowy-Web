import { Table } from 'dexie';

export interface CollabSnapshotRecord {
  objectId: string;
  update: Uint8Array;
  stateVector: Uint8Array;
  version?: string | null;
  compactionId?: string;
  updatedAt: number;
  byteLength: number;
}

export interface CollabUpdateRecord {
  id?: number;
  objectId: string;
  update: Uint8Array;
  createdAt: number;
  byteLength: number;
}

export interface CollabCustomRecord {
  objectId: string;
  key: string;
  value: unknown;
}

export type CollabStorageTable = {
  collab_snapshots: Table<CollabSnapshotRecord, string>;
  collab_updates: Table<CollabUpdateRecord, number>;
  collab_custom: Table<CollabCustomRecord, [string, string]>;
};

export const collabStorageSchema = {
  collab_snapshots: 'objectId, updatedAt',
  collab_updates: '++id, objectId, [objectId+id]',
  collab_custom: '[objectId+key], objectId',
};
