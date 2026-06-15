import {
  BlockType,
  CoverType,
  DatabaseViewLayout,
  ViewIconType,
  ViewLayout,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import type {
  PublishedDatabaseSnapshotPayload,
  PublishedDocumentSnapshotPayload,
} from '@/application/publish-snapshot/types';

export const publishedDocumentPayload: PublishedDocumentSnapshotPayload = {
  schemaVersion: 1,
  kind: 'document',
  namespace: 'published-namespace',
  publishName: 'published-document',
  view: {
    viewId: 'published-document-view-id',
    name: 'Published document',
    icon: {
      ty: ViewIconType.Icon,
      value: 'document',
    },
    extra: JSON.stringify({
      cover: {
        type: CoverType.NormalColor,
        value: '#F3E8D0',
        offset: 0,
      },
    }),
    layout: ViewLayout.Document,
    databaseRelations: {
      'related-database-id': 'related-database-view-id',
    },
  },
  document: {
    children: [
      {
        type: BlockType.Paragraph,
        blockId: 'published-document-block-id',
        data: {},
        children: [
          {
            type: YjsEditorKey.text,
            textId: 'published-document-text-id',
            children: [{ text: 'Published document body' }],
          },
        ],
      },
    ],
  },
};

const databaseId = 'published-database-id';
const databaseViewId = 'published-database-view-id';
const rowId = 'published-row-id';

export const publishedRowDocumentId = 'published-row-document-id';
const fieldId = 'published-name-field-id';

export const publishedDatabasePayload: PublishedDatabaseSnapshotPayload = {
  schemaVersion: 1,
  kind: 'database',
  namespace: 'published-namespace',
  publishName: 'published-database',
  view: {
    viewId: databaseViewId,
    name: 'Published database',
    icon: {
      ty: ViewIconType.Icon,
      value: 'database',
    },
    extra: JSON.stringify({
      cover: {
        type: CoverType.NormalColor,
        value: '#DDEBFF',
        offset: 0,
      },
    }),
    layout: ViewLayout.Grid,
  },
  database: {
    databaseId,
    activeViewId: databaseViewId,
    visibleViewIds: [databaseViewId],
    fields: [
      {
        fieldId,
        name: 'Name',
        fieldType: 0,
        isPrimary: true,
        width: 180,
      },
    ],
    views: [
      {
        viewId: databaseViewId,
        name: 'Grid',
        layout: DatabaseViewLayout.Grid,
        fieldIds: [fieldId],
        rowIds: [rowId],
      },
    ],
    rows: [
      {
        rowId,
        cells: {
          [fieldId]: 'First published row',
        },
      },
    ],
    raw: {
      database: {
        [YjsDatabaseKey.id]: databaseId,
        [YjsDatabaseKey.fields]: {
          [fieldId]: {
            [YjsDatabaseKey.id]: fieldId,
            [YjsDatabaseKey.name]: 'Name',
            [YjsDatabaseKey.type]: 0,
            [YjsDatabaseKey.is_primary]: true,
            [YjsDatabaseKey.type_option]: {},
          },
        },
        [YjsDatabaseKey.views]: {
          [databaseViewId]: {
            [YjsDatabaseKey.database_id]: databaseId,
            [YjsDatabaseKey.name]: 'Grid',
            [YjsDatabaseKey.layout]: DatabaseViewLayout.Grid,
            [YjsDatabaseKey.created_at]: '1',
            [YjsDatabaseKey.modified_at]: '1',
            [YjsDatabaseKey.is_inline]: false,
            [YjsDatabaseKey.embedded]: false,
            [YjsDatabaseKey.field_orders]: [{ id: fieldId }],
            [YjsDatabaseKey.row_orders]: [{ id: rowId, height: 36 }],
            [YjsDatabaseKey.field_settings]: {
              [fieldId]: {
                [YjsDatabaseKey.width]: '180',
                [YjsDatabaseKey.visibility]: '0',
                [YjsDatabaseKey.wrap]: true,
              },
            },
            [YjsDatabaseKey.filters]: [],
            [YjsDatabaseKey.groups]: [],
            [YjsDatabaseKey.sorts]: [],
            [YjsDatabaseKey.calculations]: [],
            [YjsDatabaseKey.layout_settings]: {},
          },
        },
        [YjsDatabaseKey.metas]: {},
      },
      rows: {
        [rowId]: {
          [YjsEditorKey.database_row]: {
            [YjsDatabaseKey.id]: rowId,
            [YjsDatabaseKey.database_id]: databaseId,
            [YjsDatabaseKey.visibility]: true,
            [YjsDatabaseKey.height]: 36,
            [YjsDatabaseKey.created_at]: '1',
            [YjsDatabaseKey.last_modified]: '1',
            [YjsDatabaseKey.cells]: {
              [fieldId]: {
                [YjsDatabaseKey.field_type]: 0,
                [YjsDatabaseKey.data]: 'First published row',
                [YjsDatabaseKey.created_at]: '1',
                [YjsDatabaseKey.last_modified]: '1',
              },
            },
          },
          [YjsEditorKey.meta]: {},
        },
      },
      row_documents: {
        [publishedRowDocumentId]: {
          data: {
            page_id: 'published-row-document-page-id',
            blocks: {
              'published-row-document-page-id': {
                id: 'published-row-document-page-id',
                ty: BlockType.Page,
                parent: '',
                children: 'published-row-document-page-id',
                external_id: 'published-row-document-page-id',
                external_type: YjsEditorKey.text,
                data: {},
              },
              'published-row-document-block-id': {
                id: 'published-row-document-block-id',
                ty: BlockType.Paragraph,
                parent: 'published-row-document-page-id',
                children: 'published-row-document-block-id',
                external_id: 'published-row-document-text-id',
                external_type: YjsEditorKey.text,
                data: {},
              },
            },
            meta: {
              children_map: {
                'published-row-document-page-id': ['published-row-document-block-id'],
                'published-row-document-block-id': [],
              },
              text_map: {
                'published-row-document-text-id': JSON.stringify([{ insert: 'Published row document body' }]),
              },
            },
          },
        },
      },
    },
  },
};
