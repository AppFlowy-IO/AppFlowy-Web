import { Element, Node, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { deleteBlock, getBlock, getBlockIndex, getChildrenArray, getParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { SimpleTableNode } from '@/components/editor/editor.type';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';

import { isSimpleTableCellNode, isSimpleTableRowNode } from './simple-table.utils';

export function simpleTableTextRows(node: SimpleTableNode): string[][] {
  return node.children.filter(isSimpleTableRowNode).map((row) =>
    row.children.filter(isSimpleTableCellNode).map((cell) =>
      cell.children.filter((child) => Element.isElement(child) && child.type !== YjsEditorKey.text)
        .map((child) => Node.string(child)).join('\n')
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

export function replaceSimpleTable(editor: YjsEditor, blockId: string, content: Element[]) {
  if (editor.readOnly || !YjsEditor.connected(editor)) throw new Error('The table is no longer editable');
  Transforms.deselect(editor);
  editor.flushLocalChanges();
  const root = editor.sharedRoot;
  const doc = root.doc;
  const block = getBlock(blockId, root);

  if (!doc || !block || block.get(YjsEditorKey.block_type) !== BlockType.SimpleTableBlock) {
    throw new Error('The table is no longer available');
  }

  const parentId = block.get(YjsEditorKey.block_parent);
  const index = getBlockIndex(blockId, root);
  const fragment = convertSlateFragmentTo(content);
  let insertedBlockIds: string[] = [];

  if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
  try {
    doc.transact(() => {
      insertedBlockIds = slateContentInsertToYData(parentId, index, fragment, doc);
      deleteBlock(root, blockId);
    }, CollabOrigin.LocalManual);
  } finally {
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
  }

  return insertedBlockIds;
}

export function deleteSimpleTable(editor: YjsEditor, blockId: string) {
  const parent = getParent(blockId, editor.sharedRoot);

  if (!parent) return;
  const siblings = getChildrenArray(parent.get(YjsEditorKey.block_children), editor.sharedRoot);
  const content: Element[] = siblings.length === 1 ? [{
    type: BlockType.Paragraph,
    data: {},
    children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
  } as Element] : [];

  // The generic delete command focuses the structural text of a remaining table.
  replaceSimpleTable(editor, blockId, content);
}
