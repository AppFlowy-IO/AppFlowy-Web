import { Editor, Element } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { deltaInsertToSlateNode } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { getBlock, getText, isCalloutContainer } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey } from '@/application/types';

/** Keep native title edits visible when an empty title was omitted from the web view. */
export function syncCalloutTitle(editor: YjsEditor, blockId: string): boolean {
  const block = getBlock(blockId, editor.sharedRoot);

  if (!block || block.get(YjsEditorKey.block_type) !== BlockType.CalloutBlock) return false;
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry) return false;
  const [node, path] = entry;
  const first = node.children[0];
  const title = Element.isElement(first) && first.type === YjsEditorKey.text ? first : undefined;
  const hidden = isCalloutContainer(editor.sharedRoot, block);
  const textId = block.get(YjsEditorKey.block_external_id);
  const text = getText(textId, editor.sharedRoot);

  if ((hidden && !title) || (!hidden && title?.textId === textId) || (!hidden && !text)) return false;

  Editor.withoutNormalizing(editor, () => {
    if (title) editor.apply({ type: 'remove_node', path: [...path, 0], node: title });
    if (!hidden && text) {
      const children = text.toDelta().flatMap(deltaInsertToSlateNode);

      editor.apply({
        type: 'insert_node',
        path: [...path, 0],
        node: { type: YjsEditorKey.text, textId, children: children.length ? children : [{ text: '' }] },
      });
    }
  });
  return true;
}
