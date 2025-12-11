
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
  snapshot: Uint8Array | null;
  editors: number[]
}

export interface EncodedCollab {
  stateVector: Uint8Array,
  docState: Uint8Array,
  version: string | null
}