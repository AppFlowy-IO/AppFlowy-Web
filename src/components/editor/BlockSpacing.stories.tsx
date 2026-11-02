import { BlockType, View, ViewLayout, YjsEditorKey } from '@/application/types';
import AppTheme from '@/components/main/AppTheme';
import { TooltipProvider } from '@/components/ui/tooltip';

import { withContexts } from '../../../.storybook/decorators';

import StaticEditor from './StaticEditor';

import type { Meta, StoryObj } from '@storybook/react';
import type { Descendant } from 'slate';

function block(type: BlockType, id: string, data = {}, children: Descendant[] = []): Descendant {
  return {
    type,
    blockId: id,
    data,
    children: [{ type: YjsEditorKey.text, textId: `${id}-text`, children: [{ text: id }] }, ...children],
  } as Descendant;
}

// Sources: Desktop editor_configuration.dart, editor_style.dart, and each
// block's build() implementation. Container nodes do not have a text child.
function container(type: BlockType, id: string, children: Descendant[], data = {}): Descendant {
  return { type, blockId: id, data, children } as Descendant;
}

function allBlocksValue(): Descendant[] {
  const ordinary = [
    BlockType.Paragraph,
    BlockType.BulletedListBlock,
    BlockType.NumberedListBlock,
    BlockType.TodoListBlock,
    BlockType.QuoteBlock,
    BlockType.CalloutBlock,
    BlockType.DividerBlock,
    BlockType.CodeBlock,
    BlockType.ImageBlock,
    BlockType.VideoBlock,
    BlockType.AudioBlock,
    BlockType.FileBlock,
    BlockType.GoogleDriveBlock,
    BlockType.GalleryBlock,
    BlockType.PDFBlock,
    BlockType.EquationBlock,
    BlockType.OutlineBlock,
    BlockType.LinkPreview,
    BlockType.SubpageBlock,
    BlockType.LinkedPageBlock,
  ].map((type) =>
    block(
      type,
      `all-${type}`,
      type === BlockType.SubpageBlock || type === BlockType.LinkedPageBlock
        ? { view_id: 'spacing-child-page' }
        : type === BlockType.CalloutBlock
        ? { icon: '💡', icon_type: 'emoji', version: 1 }
        : {}
    )
  );
  const column = (id: string) =>
    container(BlockType.ColumnBlock, id, [block(BlockType.Paragraph, `${id}-text`)], { ratio: 0.5 });
  const table = container(BlockType.SimpleTableBlock, 'all-simple_table', [
    container(BlockType.SimpleTableRowBlock, 'all-simple-row', [
      container(BlockType.SimpleTableCellBlock, 'all-simple-cell', [
        block(BlockType.Paragraph, 'all-simple-first'),
        block(BlockType.Paragraph, 'all-simple-second'),
      ]),
      container(BlockType.SimpleTableCellBlock, 'all-heading-cell', [
        block(BlockType.HeadingBlock, 'all-cell-heading', { level: 2 }),
      ]),
      container(BlockType.SimpleTableCellBlock, 'all-quote-cell', [
        block(BlockType.QuoteBlock, 'all-cell-quote', {}, [block(BlockType.Paragraph, 'all-cell-quote-child')]),
      ]),
      container(BlockType.SimpleTableCellBlock, 'all-toggle-cell', [
        block(BlockType.ToggleListBlock, 'all-cell-toggle', { collapsed: true }),
      ]),
    ]),
  ]);
  const sections = [
    BlockType.AIMeetingSummaryBlock,
    BlockType.AIMeetingNotesBlock,
    BlockType.AIMeetingTranscriptionBlock,
  ].map((type) => container(type, `all-${type}`, [block(BlockType.Paragraph, `${type}-child`)]));
  const databases = [
    BlockType.GridBlock,
    BlockType.BoardBlock,
    BlockType.CalendarBlock,
    BlockType.ListBlock,
    BlockType.TimelineBlock,
    BlockType.DashboardBlock,
    BlockType.ChartBlock,
    BlockType.DatabaseGalleryBlock,
    BlockType.FeedBlock,
  ].map((type) => block(type, `all-db-${type}`, { is_database_duplicate_placeholder: true }));
  const imageUrl = new URL('/af_icons/interface_essential/paragraph.svg', window.location.origin).href;
  const cases = [
    ...ordinary,
    block(BlockType.ImageBlock, 'all-image-loaded', { url: imageUrl }),
    block(BlockType.GalleryBlock, 'all-gallery-loaded', { images: [{ url: imageUrl }] }),
    block(BlockType.EquationBlock, 'all-formula-loaded', { formula: 'x^2 + y^2' }),
    block(BlockType.LinkPreview, 'all-bookmark-loaded', { url: 'https://example.com' }),
    ...[1, 2, 3, 4, 5, 6].map((level) => block(BlockType.HeadingBlock, `all-heading-${level}`, { level })),
    block(BlockType.ToggleListBlock, 'all-toggle_list', { collapsed: false }, [
      block(BlockType.Paragraph, 'all-toggle-child'),
    ]),
    ...[1, 2, 3, 4, 5, 6].map((level) =>
      block(BlockType.ToggleListBlock, `all-toggle-heading-${level}`, { level, collapsed: false }, [
        block(BlockType.Paragraph, `all-toggle-heading-${level}-child`),
      ])
    ),
    container(BlockType.ColumnsBlock, 'all-simple_columns', [column('column-left'), column('column-right')]),
    table,
    container(
      BlockType.TableBlock,
      'all-table',
      [
        container(BlockType.TableCell, 'all-legacy-cell', [block(BlockType.Paragraph, 'all-legacy-text')], {
          rowPosition: 0,
          colPosition: 0,
          width: 160,
          height: 40,
        }),
      ],
      { rowsLen: 1, colsLen: 1, colsHeight: 160, rowDefaultHeight: 40 }
    ),
    ...sections,
    container(
      BlockType.AIMeetingBlock,
      'all-ai_meeting',
      [
        container(BlockType.AIMeetingSummaryBlock, 'meeting-summary', [
          block(BlockType.Paragraph, 'meeting-summary-text'),
        ]),
      ],
      { title: 'Meeting' }
    ),
    container(BlockType.AIMeetingSpeakerBlock, 'all-ai_meeting_speaker', [block(BlockType.Paragraph, 'speaker-child')], {
      speaker_id: 'A',
      timestamp: 0,
    }),
    block(BlockType.QuoteBlock, 'all-nested-quote', {}, [
      block(BlockType.Paragraph, 'quote-child', {}, [block(BlockType.Paragraph, 'quote-grandchild')]),
    ]),
    ...databases,
  ];

  return cases.flatMap((node) => {
    const id = (node as { blockId: string }).blockId;

    return [block(BlockType.Paragraph, `${id}-before`), node, block(BlockType.Paragraph, `${id}-after`)];
  });
}

function nestedBackgroundsValue(): Descendant[] {
  return [BlockType.TodoListBlock, BlockType.ToggleListBlock].flatMap((type) => {
    const id = type === BlockType.TodoListBlock ? 'todo-background' : 'toggle-background';
    const data = type === BlockType.ToggleListBlock ? { collapsed: false } : { checked: false };

    return [
      block(type, id, { ...data, bgColor: 'bg-color-1' }, [
        block(type, `${id}-first`, data),
        block(type, `${id}-last`, { ...data, bgColor: 'bg-color-2' }),
      ]),
      block(BlockType.Paragraph, `${id}-after`),
      block(type, `${id}-nested`, { ...data, bgColor: 'bg-color-1' }, [
        block(type, `${id}-middle`, { ...data, bgColor: 'bg-color-2' }, [
          block(type, `${id}-deepest`, { ...data, bgColor: 'bg-color-3' }),
        ]),
      ]),
      block(type, `${id}-leaf`, { ...data, bgColor: 'bg-color-1' }),
    ];
  });
}

function SpacingPreview({
  allBlocks = false,
  nestedBackgrounds = false,
}: {
  allBlocks?: boolean;
  nestedBackgrounds?: boolean;
}) {
  const value = nestedBackgrounds
    ? nestedBackgroundsValue()
    : allBlocks
    ? allBlocksValue()
    : [
        block(BlockType.Paragraph, 'paragraph-one'),
        block(BlockType.Paragraph, 'paragraph-two'),
        block(BlockType.CalloutBlock, 'adjacent-callout', {
          icon: '💡',
          icon_type: 'emoji',
          version: 1,
          bgColor: 'block-bg-color-20',
        }),
        block(BlockType.Paragraph, 'paragraph-after-callout'),
        block(BlockType.Paragraph, 'colored-paragraph', { bgColor: 'bg-color-1' }),
        block(BlockType.HeadingBlock, 'colored-heading', { level: 2, bgColor: 'bg-color-1' }),
        block(BlockType.CodeBlock, 'code', { language: 'plain_text' }),
        block(BlockType.LinkPreview, 'bookmark', { url: 'https://example.com', title: 'Bookmark' }),
        ...[1, 2, 3, 4, 5, 6].map((level) => block(BlockType.HeadingBlock, `heading-${level}`, { level })),
        block(BlockType.ToggleListBlock, 'toggle', { collapsed: false }, [block(BlockType.Paragraph, 'toggle-child')]),
        block(BlockType.ToggleListBlock, 'toggle-heading', { collapsed: false, level: 1 }, [
          block(BlockType.Paragraph, 'toggle-heading-child'),
        ]),
        block(BlockType.BulletedListBlock, 'bullet', {}, [block(BlockType.Paragraph, 'bullet-child')]),
        block(BlockType.DividerBlock, 'divider'),
        block(BlockType.Paragraph, 'after-divider'),
        {
          type: BlockType.SimpleTableBlock,
          blockId: 'table',
          data: {},
          children: [
            {
              type: BlockType.SimpleTableRowBlock,
              blockId: 'row',
              data: {},
              children: [
                {
                  type: BlockType.SimpleTableCellBlock,
                  blockId: 'cell',
                  data: {},
                  children: [block(BlockType.Paragraph, 'cell-first'), block(BlockType.Paragraph, 'cell-second')],
                },
              ],
            },
          ],
        } as Descendant,
      ];

  return (
    <AppTheme>
      <TooltipProvider>
        <div id='body' style={{ padding: 40, fontSize: 16 }}>
          <StaticEditor
            value={value}
            workspaceId='publish'
            viewId='spacing-preview'
            loadViewMeta={async (viewId) =>
              ({
                view_id: viewId,
                name: 'Child page',
                layout: ViewLayout.Document,
                icon: null,
              } as View)
            }
          />
        </div>
      </TooltipProvider>
    </AppTheme>
  );
}

const meta = {
  title: 'Editor/Block Spacing',
  component: SpacingPreview,
  decorators: [withContexts],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SpacingPreview>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};

export const AllBlocks: Story = { args: { allBlocks: true } };

export const NestedBackgrounds: Story = { args: { nestedBackgrounds: true } };
