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
    viewId: '6e91148b-e42a-56b1-b9a0-58fbaa31552d',
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

type FixtureLeaf = { text: string } & Record<string, unknown>;
type FixtureBlock = {
  type: string;
  blockId: string;
  data: Record<string, unknown>;
  children: Array<FixtureBlock | { type: string; textId: string; children: FixtureLeaf[] }>;
};

let fixtureBlockCounter = 0;

// Builds a Slate block element in the shape the snapshot endpoint returns:
// a text element first (when the block has text), then nested child blocks.
function block(
  type: string,
  leaves: FixtureLeaf[] | null,
  data: Record<string, unknown> = {},
  children: FixtureBlock[] = []
): FixtureBlock {
  fixtureBlockCounter += 1;
  const id = `rich-block-${fixtureBlockCounter}`;

  return {
    type,
    blockId: id,
    data,
    children: [
      ...(leaves ? [{ type: YjsEditorKey.text, textId: `${id}-text`, children: leaves }] : []),
      ...children,
    ],
  };
}

const text = (value: string, marks: Record<string, unknown> = {}): FixtureLeaf => ({ text: value, ...marks });

export const richDocumentChildViewId = 'rich-document-child-view-id';

/**
 * A document snapshot exercising every block family the server-side
 * serializer handles: headings, grouped and nested lists, todo, toggle, quote,
 * callout, code, equation, divider, media, tables, columns, sub-pages, inline
 * marks, links and mentions.
 */
export const publishedRichDocumentPayload: PublishedDocumentSnapshotPayload = {
  schemaVersion: 1,
  kind: 'document',
  namespace: 'published-namespace',
  publishName: 'rich-document',
  view: {
    viewId: 'rich-document-view-id',
    name: 'Rich document',
    icon: null,
    extra: null,
    layout: ViewLayout.Document,
    childViews: [
      {
        view_id: richDocumentChildViewId,
        name: 'Child page',
        icon: null,
        extra: null,
        layout: ViewLayout.Document,
        created_at: '0',
        created_by: '0',
        last_edited_time: '0',
        last_edited_by: '0',
        child_views: null,
      },
    ],
  },
  document: {
    children: [
      block(BlockType.HeadingBlock, [text('Introduction')], { level: 1 }),
      block(BlockType.Paragraph, [
        text('Plain, '),
        text('bold', { bold: true }),
        text(', '),
        text('bold italic', { bold: true, italic: true }),
        text(', '),
        text('code', { code: true }),
        text(', '),
        text('struck', { strikethrough: true }),
        text(', '),
        text('underlined', { underline: true }),
        text(' and '),
        text('a link', { href: 'https://appflowy.com' }),
        text('.'),
      ]),
      block(BlockType.BulletedListBlock, [text('First bullet')], {}, [
        block(BlockType.BulletedListBlock, [text('Nested bullet')]),
      ]),
      block(BlockType.BulletedListBlock, [text('Second bullet')]),
      block(BlockType.NumberedListBlock, [text('Step one')], { number: 3 }),
      block(BlockType.NumberedListBlock, [text('Step two')]),
      block(BlockType.TodoListBlock, [text('Done task')], { checked: true }),
      block(BlockType.TodoListBlock, [text('Open task')], { checked: false }),
      block(BlockType.ToggleListBlock, [text('Toggle title')], { collapsed: true }, [
        block(BlockType.Paragraph, [text('Hidden detail')]),
      ]),
      block(BlockType.QuoteBlock, [text('A quotation')]),
      block(BlockType.CalloutBlock, [text('Callout body')], { icon: '💡' }),
      block(BlockType.CodeBlock, [text('const a = 1 < 2;')], { language: 'typescript' }),
      block(BlockType.EquationBlock, null, { formula: 'E = mc^2' }),
      block(BlockType.DividerBlock, null),
      block(BlockType.ImageBlock, null, { url: 'https://example.com/image.png' }),
      block(BlockType.FileBlock, null, { url: 'https://example.com/report.pdf', name: 'Report' }),
      block(BlockType.SimpleTableBlock, null, {}, [
        block(BlockType.SimpleTableRowBlock, null, {}, [
          block(BlockType.SimpleTableCellBlock, null, {}, [block(BlockType.Paragraph, [text('Cell A1')])]),
          block(BlockType.SimpleTableCellBlock, null, {}, [block(BlockType.Paragraph, [text('Cell B1')])]),
        ]),
      ]),
      block(BlockType.ColumnsBlock, null, {}, [
        block(BlockType.ColumnBlock, null, {}, [block(BlockType.Paragraph, [text('Left column')])]),
        block(BlockType.ColumnBlock, null, {}, [block(BlockType.Paragraph, [text('Right column')])]),
      ]),
      block(BlockType.SubpageBlock, null, { view_id: richDocumentChildViewId }),
      block(BlockType.Paragraph, [
        text('See '),
        text('$', { mention: { type: 'page', page_id: richDocumentChildViewId } }),
        text(' on '),
        text('$', { mention: { type: 'date', date: '2026-09-30T10:00:00.000Z' } }),
        text(' with '),
        text('$', { mention: { type: 'person', person_id: 'p1', person_name: 'Ada' } }),
        text('.'),
      ]),
    ],
  },
};
