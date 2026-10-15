import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import type { DatabaseRowTemplate } from '@/application/database-yjs/template/types';
import type { ViewIcon } from '@/application/types';

import type { CreationRowPosition } from './row-creation-types';
import type * as Y from 'yjs';

export type TemplateJson = null | boolean | number | string | TemplateJson[] | { [key: string]: TemplateJson };
export type TemplateRecord = { [key: string]: TemplateJson };
export interface TemplateDatabaseView extends TemplateRecord {
  id: string;
  database_id: string;
  name: string;
  layout: number;
  row_orders: Array<{ id: string; height: number; is_deleted?: boolean }>;
  field_orders: Array<{ id: string }>;
}
export interface TemplateDatabaseArchive {
  database_id: string;
  views: TemplateDatabaseView[];
  fields: TemplateRecord[];
  rows: TemplateRecord[];
  row_metas?: Record<string, TemplateRecord>;
  form_field_settings?: Record<string, TemplateRecord>;
  calculations?: Record<string, TemplateRecord[]>;
  row_templates_meta?: TemplateRecord;
}
export interface CompoundFolderView {
  view_id: string;
  parent_view_id: string;
  name: string;
  icon?: ViewIcon | null;
  content:
    | { kind: 'document' }
    | { kind: 'row_document'; database_id: string; source_view_id: string; row_id: string }
    | { kind: 'database_container'; database_id: string; primary_view_id: string; is_embedded: boolean }
    | {
        kind: 'database_view';
        database_id: string;
        layout: number;
        is_embedded: boolean;
        responses_view_id?: string | null;
      };
}
export interface AtomicLinkedDatabaseView {
  view: TemplateDatabaseView;
  form_field_settings: TemplateRecord;
  calculations: TemplateRecord[];
  responses_view_id?: string | null;
}
export interface CompoundDatabaseExtension {
  database_id: string;
  database_restore_id: string;
  source_view_id: string;
  views: AtomicLinkedDatabaseView[];
  dependency_fields: TemplateRecord[];
}
export interface ClaimCompoundCreationRequest {
  request_id: string;
  target: {
    kind: 'row';
    row_id: string;
    database_id: string;
    database_restore_id: string;
    source_view_id: string;
    position: CreationRowPosition;
    position_view_ids: string[];
  };
  objects: Array<{
    object_id: string;
    kind: 'document' | 'database' | 'database_row';
    byte_length: number;
    sha256: number[];
  }>;
  views: CompoundFolderView[];
  database_extensions: CompoundDatabaseExtension[];
}
export interface CreateDatabaseRowRequest {
  request_id: string;
  database_restore_id: string;
  source_view_id: string;
  row: { row_id: string; collab: string; document?: string };
  position: CreationRowPosition;
  position_view_ids: string[];
  document_name?: string;
}
export interface TemplateRowGraphInput {
  owner: AtomicCreationOwner;
  databaseId: string;
  restoreId: string;
  sourceViewId: string;
  requestId: string;
  rowId: string;
  position: CreationRowPosition;
  positionViewIds: string[];
  rowDoc: Y.Doc;
  template: DatabaseRowTemplate;
  documentState: Uint8Array;
  signal: AbortSignal;
  deadline: number;
  assertCurrent: () => void;
}
export type PreparedTemplateRowGraph =
  | { kind: 'seeded'; request: CreateDatabaseRowRequest }
  | { kind: 'compound'; manifest: ClaimCompoundCreationRequest; seeds: Map<string, string> };
