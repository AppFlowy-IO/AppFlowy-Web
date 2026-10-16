import { Editor, Element } from 'slate';

import { isDatabaseBlockType } from '@/application/database-block';
import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { DatabaseNode } from '@/components/editor/editor.type';

/** Creation belongs to the live editor, not the menu that starts and then closes it. */
export function captureBlockCreationTarget(editor: YjsEditor, blockId: string) {
  const root = editor.sharedRoot;
  let currentBlockId = blockId;
  const assertCurrent = () => {
    if (
      editor.sharedRoot !== root ||
      !YjsEditor.connected(editor) ||
      editor.readOnly ||
      editor.firstBody ||
      !findSlateEntryByBlockId(editor, currentBlockId)
    ) {
      throw new Error('Database creation target is no longer editable');
    }
  };

  assertCurrent();
  return {
    assertCurrent,
    replace(replaceBlock: (targetBlockId: string) => string | undefined) {
      assertCurrent();
      const replacementId = replaceBlock(currentBlockId);

      if (!replacementId) throw new Error('The Database insertion block is unavailable');
      // Converting a paragraph to an embedded block intentionally replaces its
      // identity. Subsequent receipt checks must follow the resulting block.
      currentBlockId = replacementId;
      assertCurrent();
    },
  };
}

/** A live reference proves that an older committed receipt has already been activated. */
export function captureExistingDatabaseBlock(
  editor: YjsEditor,
  parentId: string,
  databaseId: string,
  viewId: string
): (() => void) | undefined {
  const matches = (node: DatabaseNode) =>
    node.data.parent_id === parentId &&
    node.data.database_id === databaseId &&
    (node.data.view_ids?.length ? node.data.view_ids : [node.data.view_id]).includes(viewId);

  for (const [node] of Editor.nodes<DatabaseNode>(editor, {
    at: [],
    match: (node) => Element.isElement(node) && isDatabaseBlockType(node.type as BlockType),
  })) {
    if (!matches(node) || !node.blockId) continue;
    const blockId = node.blockId;
    const target = captureBlockCreationTarget(editor, blockId);

    return () => {
      target.assertCurrent();
      const current = findSlateEntryByBlockId(editor, blockId)?.[0];

      if (!current || !isDatabaseBlockType(current.type as BlockType) || !matches(current as DatabaseNode)) {
        throw new Error('Previously activated Database block changed');
      }
    };
  }

  return undefined;
}
