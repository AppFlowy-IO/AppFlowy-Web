import { YjsDatabaseKey } from '@/application/types';

export const DATABASE_ROW_TEMPLATES_KEY = YjsDatabaseKey.row_templates;
export const DATABASE_DEFAULT_ROW_TEMPLATE_KEY = YjsDatabaseKey.default_row_template;

export type TemplateCellValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: string }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date_time'; value: number }
  | { type: 'time'; value: number }
  | { type: 'url'; value: string }
  | { type: 'select'; value: string[] }
  | { type: 'person'; value: string[] }
  | { type: 'relation'; value: string[] }
  | { type: 'legacy'; value: string };

/**
 * The JSON cell shape written by Desktop's Rust
 * `TemplateCellValue` (`#[serde(flatten)]`).
 */
export type PersistedTemplateCellValue = TemplateCellValue & { field_id: string };

export interface TemplateEmbeddedDatabaseSnapshot {
  sourceViewId: string;
  sourceDatabaseId: string;
  layoutType: number;
  name: string;
  rawData: string;
  /**
   * `true` means the block remains linked to its source database. `false`
   * means the snapshot is owned by the template. `undefined` is the legacy
   * format whose ownership has to be inferred from the document/folder shape.
   */
  isLinked?: boolean;
}

/** The snake-case JSON shape of Desktop's `TemplateEmbeddedDatabase`. */
export interface PersistedTemplateEmbeddedDatabaseSnapshot {
  source_view_id: string;
  source_database_id: string;
  layout_type: number;
  name: string;
  raw_data: string;
  is_linked?: boolean;
}

/**
 * The persisted JSON contract shared with Desktop's
 * `DatabaseRowTemplateMeta` in the database collab `metas` map.
 *
 * `icon` and `cover` are optional Flutter model extensions. Desktop's Rust
 * serde reader ignores them, while Web keeps them for its hidden template-row
 * metadata. Every required Rust field is represented explicitly here.
 */
export interface PersistedDatabaseRowTemplate {
  template_id: string;
  name: string;
  doc_view_id: string;
  doc_data: number[];
  is_document_empty: boolean;
  embedded_databases: PersistedTemplateEmbeddedDatabaseSnapshot[];
  default_cells: PersistedTemplateCellValue[];
  created_at_ms: number;
  updated_at_ms: number;
  icon?: string;
  cover?: string;
}

/**
 * The camel-case application model for Desktop's `DatabaseRowTemplateMeta`.
 * The codec in this module's sibling file is the only place that translates
 * to the snake-case JSON stored in the database collab.
 */
export interface DatabaseRowTemplate {
  templateId: string;
  name: string;
  docViewId: string;
  documentData?: number[];
  isDocumentEmpty: boolean;
  embeddedDatabases: TemplateEmbeddedDatabaseSnapshot[];
  defaultCells: Record<string, TemplateCellValue>;
  icon?: string;
  cover?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DatabaseRowTemplateState {
  templates: DatabaseRowTemplate[];
  defaultTemplateId?: string;
}
