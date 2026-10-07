import { Editor, Element, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TEXT_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { deleteBlock, getBlock, getBlockIndex, getChildrenArray, getPageId, getParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { SimpleTableNode } from '@/components/editor/editor.type';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';

import { isSimpleTableCellNode, isSimpleTableRowNode } from './simple-table.utils';

export function simpleTableTextRows(node: SimpleTableNode): string[][] {
  return node.children.filter(isSimpleTableRowNode).map((row) =>
    row.children.filter(isSimpleTableCellNode).map((cell) =>
      cell.children.filter((child) => Element.isElement(child) && child.type !== YjsEditorKey.text)
        .map((child) => CustomEditor.getBlockTextContent(child)).join('\n')
    )
  );
}

export function simpleTableCsv(node: SimpleTableNode): string {
  const rows = simpleTableTextRows(node);
  const count = rows[0]?.length ?? 0;
  const headers = Array.from({ length: count }, (_, index) => `Column ${index + 1}`);
  const values = node.data.enable_header_row ? rows : [headers, ...rows];

  return values.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function runTableTransaction<T>(editor: YjsEditor, operation: () => T): T {
  if (editor.readOnly || !YjsEditor.connected(editor)) throw new Error('The table is no longer editable');
  Transforms.deselect(editor);
  editor.flushLocalChanges();
  const root = editor.sharedRoot;
  const doc = root.doc;

  if (!doc) throw new Error('The table is no longer available');
  let result!: T;

  if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
  try {
    doc.transact(() => {
      result = operation();
    }, CollabOrigin.LocalManual);
  } finally {
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
  }

  return result;
}

export function replaceSimpleTable(editor: YjsEditor, blockId: string, content: Element[]) {
  return runTableTransaction(editor, () => {
    const root = editor.sharedRoot;
    const block = getBlock(blockId, root);

    if (!block || block.get(YjsEditorKey.block_type) !== BlockType.SimpleTableBlock) {
      throw new Error('The table is no longer available');
    }

    const insertedBlockIds = slateContentInsertToYData(
      block.get(YjsEditorKey.block_parent), getBlockIndex(blockId, root), convertSlateFragmentTo(content), root.doc!
    );

    deleteBlock(root, blockId);
    return insertedBlockIds;
  });
}

function focusAfterDeletion(editor: YjsEditor, blockId?: string) {
  const preferred = blockId && findSlateEntryByBlockId(editor, blockId);
  // Table and cell structural text is not rendered. Focus a real text block,
  // including a paragraph inside a surviving table, rather than its sentinel.
  const match = (node: unknown) => Element.isElement(node) &&
    node.type !== BlockType.SimpleTableCellBlock && TEXT_BLOCK_TYPES.includes(node.type as BlockType);
  const [nearby] = Editor.nodes(editor, { at: preferred ? preferred[1] : [], match });
  const [first] = nearby ? [] : Editor.nodes(editor, { at: [], match });

  Transforms.select(editor, editor.start(nearby?.[1] ?? first?.[1] ?? [0]));
  ReactEditor.focus(editor);
}

/** Delete a selection containing tables as one history entry, including its other blocks. */
export function deleteBlocksWithSimpleTable(editor: YjsEditor, blockIds: string[]) {
  if (blockIds.length === 0) return;
  let focusBlockId: string | undefined;

  runTableTransaction(editor, () => {
    const root = editor.sharedRoot;
    const insertParagraph = (parentId: string) => slateContentInsertToYData(parentId, 0, convertSlateFragmentTo([{
      type: BlockType.Paragraph, data: {},
      children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
    } as Element]), root.doc!)[0];

    for (const blockId of blockIds) {
      const block = getBlock(blockId, root);
      const parent = block && getParent(blockId, root);

      if (!block || !parent) continue;
      const siblings = getChildrenArray(parent.get(YjsEditorKey.block_children), root);
      const index = getBlockIndex(blockId, root);

      focusBlockId = index > 0 ? siblings.get(index - 1)
        : index + 1 < siblings.length ? siblings.get(index + 1) : undefined;
      if (block.get(YjsEditorKey.block_type) === BlockType.SimpleTableBlock && siblings.length === 1) {
        focusBlockId = insertParagraph(parent.get(YjsEditorKey.block_id));
      }

      deleteBlock(root, blockId);
    }

    const pageId = getPageId(root);
    const page = getBlock(pageId, root);

    if (page && getChildrenArray(page.get(YjsEditorKey.block_children), root).length === 0) {
      focusBlockId = insertParagraph(pageId);
    }
  });

  focusAfterDeletion(editor, focusBlockId);
}

export function deleteSimpleTable(editor: YjsEditor, blockId: string) {
  deleteBlocksWithSimpleTable(editor, [blockId]);
}
