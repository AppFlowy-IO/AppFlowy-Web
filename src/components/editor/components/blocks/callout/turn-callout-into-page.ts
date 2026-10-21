import cloneDeep from 'lodash-es/cloneDeep';
import isEqual from 'lodash-es/isEqual';
import { Element, Node } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateNodeToDeltaInsert } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { deleteBlock, executeOperations } from '@/application/slate-yjs/utils/yjs';
import { BlockType, SubpageNodeData, ViewLayout, YjsEditorKey } from '@/application/types';
import { stripInlineCommentIds } from '@/components/editor/clipboard/inline-comment-metadata';
import { EditorContextState } from '@/components/editor/EditorContext';
import { containsSubpage } from '@/components/editor/subpage/subpage-operations';

const creating = new WeakSet<YjsEditor>();

/** Serialize each block's own rich text separately from its nested body blocks. */
function pageBlock(node: Element): object {
  const text = node.children.find((child) => Element.isElement(child) && child.type === YjsEditorKey.text);

  return {
    type: node.type,
    data: {
      ...(typeof node.data === 'object' && node.data !== null ? node.data : {}),
      ...(text ? { delta: Array.from(Node.texts(text), ([leaf]) => slateNodeToDeltaInsert(leaf)) } : {}),
    },
    children: node.children
      .filter((child): child is Element => Element.isElement(child) && child.type !== YjsEditorKey.text)
      .map(pageBlock),
  };
}

/** Save the complete callout before replacing it with a page reference. */
export async function turnCalloutIntoPage(editor: YjsEditor, context: EditorContextState, blockId: string) {
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (
    !context.addPage ||
    creating.has(editor) ||
    editor.readOnly ||
    !YjsEditor.connected(editor) ||
    !entry ||
    entry[0].type !== BlockType.CalloutBlock ||
    editor.isElementReadOnly(entry[0])
  )
    return;

  // Owned pages need a folder move and coordinated undo, not just copied block
  // data. Removing them here would make the subpage lifecycle trash their pages.
  if (containsSubpage([entry[0]])) {
    throw new Error('Move nested pages out of this callout before turning it into a page.');
  }

  creating.add(editor);
  try {
    editor.flushLocalChanges();
    const source = cloneDeep(entry[0]);
    const { view_id } = await context.addPage(context.viewId, {
      layout: ViewLayout.Document,
      name: CustomEditor.getBlockTextContent(source.children[0]).slice(0, 128),
      page_data: { type: BlockType.Page, children: [pageBlock(stripInlineCommentIds([source])[0] as Element)] },
    });
    const current = findSlateEntryByBlockId(editor, blockId);

    // Do not replace content changed by the user or a collaborator while saving.
    if (
      editor.readOnly ||
      !YjsEditor.connected(editor) ||
      !current ||
      editor.isElementReadOnly(current[0]) ||
      !isEqual(current[0], source)
    ) {
      await context.deletePage?.(view_id);
      return;
    }

    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    let inserted: string | undefined;

    executeOperations(
      editor.sharedRoot,
      [
        () => {
          // Ordinary Turn into lifts a container's children into the parent. These
          // children were copied into the new page, so remove them in the same undo step.
          for (const child of source.children) {
            if (Element.isElement(child) && child.blockId) deleteBlock(editor.sharedRoot, child.blockId);
          }

          inserted = CustomEditor.turnToBlock<SubpageNodeData>(editor, blockId, BlockType.SubpageBlock, { view_id });
        },
      ],
      'turnCalloutIntoPage'
    );
    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    const insertedEntry = inserted && findSlateEntryByBlockId(editor, inserted);

    if (insertedEntry) editor.select(editor.start(insertedEntry[1]));
    context.openPageModal?.(view_id);
  } finally {
    creating.delete(editor);
  }
}
