import type { DatabaseViewLayout, ViewIcon } from '@/application/types';

/** These layouts are DatabaseLayout values, not the Folder ViewLayout values. */
export type CreationViewPosition = { kind: 'start' | 'end' } | { kind: 'index'; index: number } | { kind: 'after'; view_id: string };
export interface DefaultDatabaseOptions {
  database_id: string;
  view_id: string;
  name: string;
  layout: DatabaseViewLayout;
  embedded: boolean;
  responses_view_id: string | null;
  initial_row_ids: string[];
  timezone_id: string | null;
}
export interface DefaultDatabaseViewOptions extends Omit<DefaultDatabaseOptions, 'initial_row_ids'> {
  parent_view_id: string;
  source_view_id: string | null;
}
interface PagePresentation {
  schema_version: 'v1';
  request_id: string;
  parent_view_id: string;
  name: string;
  position?: CreationViewPosition;
  icon?: ViewIcon | null;
  extra?: Record<string, unknown> | null;
  is_favorite?: boolean;
}
export interface CreateDefaultDocumentPageRequest extends PagePresentation {
  view_id: string;
}
export interface CreateDefaultDatabasePageRequest extends PagePresentation {
  container_id: string;
  database: DefaultDatabaseOptions;
}
export interface CreateDefaultDatabaseViewRequest {
  schema_version: 'v1';
  request_id: string;
  database_restore_id: string;
  view: DefaultDatabaseViewOptions;
  position?: CreationViewPosition;
  icon?: ViewIcon | null;
  extra?: Record<string, unknown> | null;
}
export interface NativeBlockAction {
  action: 'Insert' | 'Update' | 'Delete' | 'Move' | 'InsertText' | 'ApplyTextDelta';
  payload: {
    block?: {
      id: string;
      ty: string;
      parent: string;
      children: string;
      external_id: string | null;
      external_type: string | null;
      data: Record<string, unknown>;
    } | null;
    prev_id?: string | null;
    parent_id?: string | null;
    delta?: string | null;
    text_id?: string | null;
    update_type: boolean;
  };
}
export interface PublishRowDocumentRequest {
  request_id: string;
  database_id: string;
  database_restore_id: string;
  row_id: string;
  source_view_id: string;
  name: string;
  contribution:
    | { kind: 'default_schema'; schema_version: 'v1' }
    | { kind: 'default_actions'; schema_version: 'v1'; actions: NativeBlockAction[] };
}
export interface AtomicPageResult {
  view_id: string;
  database_id: string | null;
}
export interface CreateDatabaseViewResult {
  view_id: string;
  view_ids: string[];
  database_id: string;
  database_restore_id: string;
  database_version: string | null;
  database_update_v1: string;
  update_batch_id: string;
}
export interface PublishRowDocumentResult {
  document_id: string;
  row_id: string;
  database_id: string;
  database_restore_id: string;
  row_version: string | null;
  document_version: string | null;
  update_batch_id: string;
}
export interface AtomicCreationRequests {
  document: CreateDefaultDocumentPageRequest;
  database: CreateDefaultDatabasePageRequest;
  'database-view': CreateDefaultDatabaseViewRequest;
  'row-document': PublishRowDocumentRequest;
}
export interface AtomicCreationResults {
  document: AtomicPageResult;
  database: AtomicPageResult;
  'database-view': CreateDatabaseViewResult;
  'row-document': PublishRowDocumentResult;
}
export type AtomicCreationKind = keyof AtomicCreationRequests;
export interface AtomicCreationReceipt<K extends AtomicCreationKind = AtomicCreationKind> {
  request_id: string;
  outcome: 'applied' | 'already_applied';
  result: AtomicCreationResults[K];
}
export interface AtomicCreationRecord<K extends AtomicCreationKind = AtomicCreationKind> {
  id: string;
  serverUrl: string;
  userId: string;
  workspaceId: string;
  kind: K;
  logicalTarget: string;
  requestId: string;
  /** Exact bytes sent on every attempt, including after a browser restart. */
  requestJson: string;
  state: 'pending' | 'committed';
  receiptJson?: string;
  /** Row-page edits accepted after sealing; separate from the immutable HTTP recipe. */
  rowDocumentStagingJson?: string;
  createdAt: number;
}
