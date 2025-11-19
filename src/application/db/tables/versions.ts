import { Table } from 'dexie';

export type VersionsTable = {
  collab_versions: Table<{
    viewId: string;
    versionId: string;
    parentId: string|null;
    name: string|null;
    createdAt: Date;
    uids: string[];
    snapshot: Uint8Array|null;
  }>;
};

export const versionSchema = {
  collab_versions: 'version',
};