/** Immutable database history metadata. Cursor timestamps retain server precision. */
export interface DatabaseHistoryVersion {
  version: string;
  parent: string | null;
  name: string | null;
  created_at: string;
  changed_at: string;
  created_by: number | null;
  is_deleted: boolean;
  row_count: number;
  document_count: number;
  size_bytes: number;
}

export interface DatabaseHistoryCursor {
  before_changed_at: string;
  before_version: string;
}

export interface DatabaseRestoreResult {
  version: string;
  pre_restore_version: string | null;
  restored_rows: number;
  restored_documents: number;
  tombstoned_rows: number;
}

export interface DatabaseRestoreJob {
  job_id: string;
  workspace_id: string;
  database_id: string;
  target_version: string;
  state: string;
  staged_bytes: number;
  staged_rows: number;
  result: DatabaseRestoreResult | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}
