import { Descendant, Element, Node, Text } from 'slate';

import { isDatabaseBlockType } from '@/application/database-block';
import { CustomEditor } from '@/application/slate-yjs/command';
import type { CalloutBlockData, DatabaseNodeData, ViewCover } from '@/application/types';
import { getViewIds } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { DEFAULT_COLUMN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';
import { letterize, romanize } from '@/components/editor/utils/list';

import { fingerprint } from './source';
import { PageSnapshot, SourceBlock, SourceProperty } from './types';

/** Copies the document and embedded view references without mutating or expanding them. */
export function snapshotFromSlate(
  pageId: string,
  title: string,
  content: Element | undefined,
  isRow = false,
  properties?: SourceProperty[],
  cover?: ViewCover
): PageSnapshot {
  function convert(node: Descendant, path: string): SourceBlock | undefined {
    if (Text.isText(node) || node.type === 'text') return;
    const block = node as Element & {
      blockId?: string;
      data?: DatabaseNodeData &
        CalloutBlockData & {
          level?: number;
          depth?: number;
          checked?: boolean;
          url?: string;
          enable_header_row?: boolean;
          enable_header_column?: boolean;
          column_widths?: Record<string, number>;
          column_colors?: Record<string, string>;
          row_colors?: Record<string, string>;
          column_aligns?: Record<string, string>;
          row_aligns?: Record<string, string>;
          bgColor?: string;
          font_color?: string;
          align?: string;
          number?: number;
          collapsed?: boolean;
          formula?: string;
          language?: string;
          title?: string;
        };
    };
    const directText = block.children.filter(
      (child) => Text.isText(child) || (Element.isElement(child) && child.type === 'text')
    );
    const children = block.children
      .map((child, index) => convert(child, `${path}-${index}`))
      .filter((child): child is SourceBlock => !!child);
    const rowSettings = (settings: Record<string, string> | undefined) =>
      settings
        ? Object.fromEntries(children.flatMap((row, index) => (settings[index] ? [[row.id, settings[index]]] : [])))
        : undefined;
    const richText = directText.flatMap((child) =>
      Array.from(Node.texts(child)).map(([leaf]) => {
        const marks: Record<string, string | boolean> = {};

        for (const name of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const) {
          if (leaf[name]) marks[name] = true;
        }

        for (const name of [
          'font_color',
          'bg_color',
          'af_text_color',
          'af_background_color',
          'href',
          'font_family',
          'formula',
        ] as const) {
          const value = leaf[name];

          if (typeof value === 'string') marks[name] = value;
        }

        return { text: leaf.text, ...marks, ...(leaf.mention && { mention: structuredClone(leaf.mention) }) };
      })
    );

    return {
      id: block.blockId || `snapshot-${path}`,
      type: block.type || 'unsupported',
      text:
        block.type === 'math_equation'
          ? block.data?.formula ?? ''
          : directText.map((child) => Node.string(child)).join(''),
      level: block.data?.level,
      checked: block.data?.checked,
      url: block.data?.url,
      ...(block.type === 'math_equation' && { formula: block.data?.formula ?? '' }),
      ...(['heading', 'toggle_list'].includes(block.type ?? '') &&
        block.data?.level && {
          headingText: CustomEditor.getBlockTextContent(block, 2).trim(),
        }),
      ...(block.type === 'outline' && { outline: { depth: block.data?.depth, color: block.data?.bgColor } }),
      ...(block.type === 'ai_meeting' && { meeting: { title: block.data?.title } }),
      ...(block.type === 'code' && { language: block.data?.language }),
      ...(['sub_page', 'linked_page'].includes(block.type ?? '') && { pageId: block.data?.view_id }),
      ...(block.type === 'toggle_list' && { collapsed: block.data?.collapsed }),
      ...(block.type === 'numbered_list' && { listMarker: String(block.data?.number ?? 1) }),
      ...(block.type === 'callout' && {
        callout: {
          icon: block.data?.icon,
          icon_type: block.data?.icon_type,
          version: block.data?.version,
          bgColor: block.data?.bgColor,
          textColor: block.data?.textColor,
        },
      }),
      ...(isDatabaseBlockType(block.type) && {
        database: {
          viewIds: [...getViewIds(block.data ?? {})],
          databaseId: block.data?.database_id,
          parentId: block.data?.parent_id ?? pageId,
        },
      }),
      ...(richText.some((run) => Object.keys(run).length > 1) && { richText }),
      ...((block.data?.bgColor || block.data?.font_color || block.data?.align) && {
        style: { backgroundColor: block.data.bgColor, color: block.data.font_color, align: block.data.align },
      }),
      ...((block.type === 'simple_table' || block.type === 'table') && {
        table: {
          headerRow: block.data?.enable_header_row === true,
          headerColumn: block.data?.enable_header_column === true,
          columnWidths: Array.from(
            { length: Math.max(0, ...children.map((row) => row.children.length)) },
            (_, index) => block.data?.column_widths?.[index] || DEFAULT_COLUMN_WIDTH
          ),
          columnColors: block.data?.column_colors ? { ...block.data.column_colors } : undefined,
          columnAligns: block.data?.column_aligns ? { ...block.data.column_aligns } : undefined,
          rowColors: rowSettings(block.data?.row_colors),
          rowAligns: rowSettings(block.data?.row_aligns),
        },
      }),
      children,
    };
  }

  const blocks = (content?.children ?? [])
    .map((node, index) => convert(node, String(index)))
    .filter((block): block is SourceBlock => !!block);

  // Freeze the editor's sibling numbering before pagination separates the list.
  function listMarkers(siblings: SourceBlock[], depth = 0, bulletDepth = 0) {
    let number: number | undefined;

    siblings.forEach((block) => {
      if (block.type === 'numbered_list') {
        number = number === undefined ? Number(block.listMarker ?? 1) : number + 1;
        block.listMarker = `${depth % 3 === 1 ? letterize(number) : depth % 3 === 2 ? romanize(number) : number}.`;
      } else number = undefined;
      if (block.type === 'bulleted_list') block.listMarker = ['disc', 'circle', 'square'][bulletDepth % 3];
      listMarkers(
        block.children,
        depth + (block.type === 'numbered_list' ? 1 : 0),
        bulletDepth + (block.type === 'bulleted_list' ? 1 : 0)
      );
    });
  }

  listMarkers(blocks);

  return {
    pageId,
    title,
    kind: isRow ? 'row' : 'document',
    ...(cover && { cover: structuredClone(cover) }),
    revision: fingerprint({ title, blocks, properties, cover }),
    blocks,
    properties: structuredClone(properties ?? []),
    warnings: isRow
      ? !properties
        ? ['Row properties are unavailable here. Open the full row page to include its visible properties.']
        : [
            'Only visible row properties are included. Related records are not expanded; unsupported computed, people, and media values remain unknown.',
          ]
      : [],
  };
}
