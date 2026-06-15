import type { Descendant } from 'slate';

import { DatabaseViewLayout, FieldId, RowId, ViewId, ViewInfo, ViewLayout, ViewMetaIcon } from '@/application/types';

export type PublishedSnapshotKind = 'document' | 'database';

export interface PublishedView {
  viewId: ViewId;
  name: string;
  icon: ViewMetaIcon | null;
  extra: string | null;
  layout: ViewLayout;
  childViews: ViewInfo[];
  ancestorViews: ViewInfo[];
  visibleViewIds: ViewId[];
  databaseRelations: Record<string, ViewId>;
}

export interface PublishedViewPayload {
  viewId: ViewId;
  name: string;
  icon: ViewMetaIcon | null;
  extra: string | null;
  layout: ViewLayout;
  childViews?: ViewInfo[];
  ancestorViews?: ViewInfo[];
  visibleViewIds?: ViewId[];
  databaseRelations?: Record<string, ViewId>;
}

export interface PublishedSnapshotBase {
  schemaVersion: 1;
  kind: PublishedSnapshotKind;
  namespace: string;
  publishName: string;
  view: PublishedView;
}

export interface PublishedSnapshotPayloadBase {
  schemaVersion: 1;
  kind: PublishedSnapshotKind;
  namespace: string;
  publishName: string;
  view: PublishedViewPayload;
}

export type PublishedJsonValue =
  | string
  | number
  | boolean
  | null
  | PublishedJsonObject
  | PublishedJsonValue[];

export interface PublishedJsonObject {
  [key: string]: PublishedJsonValue;
}

export interface PublishedDocumentBlock {
  id: string;
  ty: string;
  parent?: string;
  children: string;
  external_id?: string | null;
  external_type?: string | null;
  data?: PublishedJsonObject | null;
}

export interface PublishedDocumentRaw {
  data: {
    page_id: string;
    blocks: Record<string, PublishedDocumentBlock>;
    meta: {
      children_map?: Record<string, string[]>;
      text_map?: Record<string, string> | null;
    };
  };
}

export interface PublishedDocumentSnapshot extends PublishedSnapshotBase {
  kind: 'document';
  document: {
    children: Descendant[];
    raw?: PublishedDocumentRaw;
  };
}

// Server-facing payloads may omit collections that the UI expects to be present.
// Normalize them before passing data into publish renderers.
export interface PublishedDocumentSnapshotPayload extends PublishedSnapshotPayloadBase {
  kind: 'document';
  document?: {
    children?: Descendant[];
    raw?: PublishedDocumentRaw;
  };
}

export interface PublishedDatabaseField {
  fieldId: FieldId;
  name: string;
  fieldType: number;
  isPrimary: boolean;
  width?: number;
}

export interface PublishedDatabaseRow {
  rowId: RowId;
  cells: Record<FieldId, unknown>;
}

export interface PublishedDatabaseView {
  viewId: ViewId;
  name: string;
  layout: DatabaseViewLayout;
  fieldIds: FieldId[];
  rowIds: RowId[];
}

export interface PublishedDatabaseSnapshot extends PublishedSnapshotBase {
  kind: 'database';
  database: {
    databaseId: string;
    activeViewId: ViewId;
    visibleViewIds: ViewId[];
    fields: PublishedDatabaseField[];
    views: PublishedDatabaseView[];
    rows: PublishedDatabaseRow[];
    raw: {
      database: PublishedJsonObject;
      rows: Record<RowId, PublishedJsonObject>;
      row_documents: Record<string, PublishedDocumentRaw>;
    };
  };
}

// Server-facing payloads may omit collections that the UI expects to be present.
// Normalize them before passing data into publish renderers.
export interface PublishedDatabaseSnapshotPayload extends PublishedSnapshotPayloadBase {
  kind: 'database';
  database: {
    databaseId: string;
    activeViewId: ViewId;
    visibleViewIds?: ViewId[];
    fields?: PublishedDatabaseField[];
    views?: PublishedDatabaseView[];
    rows?: PublishedDatabaseRow[];
    raw?: {
      database?: PublishedJsonObject;
      rows?: Record<RowId, PublishedJsonObject>;
      row_documents?: Record<string, PublishedDocumentRaw>;
    };
  };
}

export type PublishedPageSnapshot = PublishedDocumentSnapshot | PublishedDatabaseSnapshot;
export type PublishedPageSnapshotPayload = PublishedDocumentSnapshotPayload | PublishedDatabaseSnapshotPayload;

export interface PublishSnapshotDataSource {
  getPage(namespace: string, publishName: string): Promise<PublishedPageSnapshot>;
}
