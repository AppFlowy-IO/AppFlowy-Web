import { Table } from 'dexie';

/** Content-free evidence shared with tabs that missed a live acknowledgement. */
export interface SyncReceiptRecord {
  syncId: string;
  userId: string;
  workspaceId: string;
  objectId: string;
  version?: string | null;
  receiptKey: string;
  /** Zero until an exact server SAVED receipt has been received. */
  savedAt: number;
}

export type SyncReceiptTable = { sync_receipts: Table<SyncReceiptRecord, string> };

export const syncReceiptSchema = {
  sync_receipts: 'syncId, [userId+workspaceId+receiptKey], [userId+workspaceId+objectId], savedAt',
};
