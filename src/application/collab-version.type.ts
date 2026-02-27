
export interface CollabVersionInfo {
  viewId: string;
  currentVersionId: string | null;
  history: CollabVersionRecord[]
}

export interface CollabVersionRecord {
  viewId?: string;
  versionId: string;
  parentId: string | null;
  name: string | null;
  createdAt: Date;
  /**
   * Tombstone timestamp from history API. Non-null means this version is deleted
   * and should not be previewed/restored in UI.
   */
  deletedAt: Date | null;
  editors: number[]
}

export interface EncodedCollab {
  stateVector: Uint8Array,
  docState: Uint8Array,
  version: string | null
}
