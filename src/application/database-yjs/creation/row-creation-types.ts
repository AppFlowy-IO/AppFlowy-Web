import type { YDoc } from '@/application/types';

export type CreationRowPosition = { kind: 'start' | 'end' } | { kind: 'before' | 'after'; row_id: string };

export interface DefaultRowRequest {
  schema_version: 'v1';
  request_id: string;
  row_id: string;
  database_restore_id: string;
  source_view_id: string;
  cells: Record<string, Record<string, unknown>>;
  height: number;
  visibility: boolean;
  presentation: {
    icon_url?: string | null;
    cover?: { data: string; upload_type: number; cover_type: number; offset: number } | null;
  };
  position: CreationRowPosition;
}

export interface CreatedRowReceipt {
  request_id: string;
  outcome: 'applied' | 'already_applied';
  result: {
    row_id: string;
    database_id: string;
    database_restore_id: string;
    database_version: string | null;
    database_update_v1: string;
    update_batch_id: string;
  };
  activation?: { row_encoded_collab_v1: string };
}

/** The prepared document is private: no IndexedDB, provider, or row-order registration. */
export interface PreparedRowIntent {
  rowId: string;
  rowDoc: YDoc;
  position: CreationRowPosition;
}
