import { Element, Node, Range, Text } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { isEmbedBlockTypes, TEXT_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, YjsEditorKey } from '@/application/types';
import { stripInlineCommentIds } from '@/components/editor/clipboard/inline-comment-metadata';
import { markSubpageClipboard } from '@/components/editor/subpage/subpage-operations';

export const clipboardFormatKey = 'x-appflowy-fragment';

function setCopiedFragmentData(
  editor: ReactEditor,
  setFragmentData: ReactEditor['setFragmentData'],
  data: Pick<DataTransfer, 'getData' | 'setData'>,
  fragment: Node[]
) {
  const getFragment = editor.getFragment;

  // Slate reads this fragment for both the custom MIME data and its HTML attribute.
  editor.getFragment = () => fragment;
  try {
    setFragmentData(data as DataTransfer);
  } finally {
    editor.getFragment = getFragment;
  }
}

function unwrapUnselectedTextBlockAncestors(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => {
    if (!Element.isElement(node)) return [node];

    const children = unwrapUnselectedTextBlockAncestors(node.children);
    const hasOwnText = node.children.some(
      (child) => Text.isText(child) || (Element.isElement(child) && child.type === YjsEditorKey.text)
    );

    // Slate keeps ancestors of selected descendants, but removes their unselected
    // text wrappers. Unwrap those ancestors before paste can turn them into empty
    // headings/lists. A selected empty wrapper still counts as content. Table
    // cells intentionally have no text wrapper and must retain their structure.
    if (
      TEXT_BLOCK_TYPES.includes(node.type as BlockType) &&
      node.type !== BlockType.SimpleTableCellBlock &&
      !hasOwnText
    ) {
      return children;
    }

    return [{ ...node, children }];
  });
}

export const withCopy = (editor: ReactEditor) => {
  const { setFragmentData } = editor;

  editor.setFragmentData = (data: Pick<DataTransfer, 'getData' | 'setData'>, origin) => {
    const { selection } = editor;

    if (!selection) {
      return;
    }

    if (Range.isCollapsed(selection)) {
      const entry = getBlockEntry(editor as YjsEditor);

      if (!entry) return;

      const [node] = entry;

      if (node && isEmbedBlockTypes(node.type as BlockType)) {
        const fragment = markSubpageClipboard(stripInlineCommentIds(editor.getFragment()), origin === 'cut');
        const string = JSON.stringify(fragment);
        const encoded = window.btoa(encodeURIComponent(string));

        data.setData(`application/${clipboardFormatKey}`, encoded);
      }

      return;
    }

    const fragment = markSubpageClipboard(
      stripInlineCommentIds(unwrapUnselectedTextBlockAncestors(editor.getFragment())),
      origin === 'cut'
    );
    const tsvText = fragmentToTSV(fragment);

    setCopiedFragmentData(editor, setFragmentData, data, fragment);

    if (tsvText !== null) {
      // Override the plain text with tab-separated values
      data.setData('text/plain', tsvText);
    }
  };

  return editor;
};

/**
 * If a fragment contains table cell content, convert to TSV format.
 * Returns null if the fragment doesn't contain table cells.
 *
 * Handles these cases:
 * 1. Fragment is [SimpleTableCellBlock, SimpleTableCellBlock, ...] — cells from same row
 * 2. Fragment is [SimpleTableRowBlock, ...] — full rows
 * 3. Fragment contains text nodes from different cells
 */
function fragmentToTSV(fragment: Node[]): string | null {
  if (fragment.length === 0) return null;

  // Case 1: Fragment contains SimpleTableCellBlock nodes directly
  const allCells = fragment.every((n) => Element.isElement(n) && n.type === BlockType.SimpleTableCellBlock);

  if (allCells && fragment.length > 1) {
    const texts = fragment.map((n) => Node.string(n));

    return texts.join('\t');
  }

  // Case 2: Fragment contains SimpleTableRowBlock nodes
  const allRows = fragment.every((n) => Element.isElement(n) && n.type === BlockType.SimpleTableRowBlock);

  if (allRows) {
    const rows = fragment.map((rowNode) => {
      const cells = (rowNode as Element).children || [];

      return cells.map((cell) => Node.string(cell)).join('\t');
    });

    return rows.join('\n');
  }

  // Case 3: Fragment contains a mix — check if any are table-related
  const tableTypes: string[] = [
    BlockType.SimpleTableBlock,
    BlockType.SimpleTableRowBlock,
    BlockType.SimpleTableCellBlock,
  ];
  const hasTableContent = fragment.some((n) => Element.isElement(n) && tableTypes.includes(n.type as string));

  if (hasTableContent) {
    // Extract all text, treating table structure as TSV
    const rows: string[] = [];

    for (const node of fragment) {
      if (!Element.isElement(node)) continue;

      if (node.type === BlockType.SimpleTableBlock) {
        for (const row of node.children) {
          if (Element.isElement(row)) {
            rows.push(row.children.map((c: Node) => Node.string(c)).join('\t'));
          }
        }
      } else if (node.type === BlockType.SimpleTableRowBlock) {
        rows.push(node.children.map((c: Node) => Node.string(c)).join('\t'));
      } else if (node.type === BlockType.SimpleTableCellBlock) {
        rows.push(Node.string(node));
      } else {
        rows.push(Node.string(node));
      }
    }

    return rows.join('\n');
  }

  // Not table content
  return null;
}
