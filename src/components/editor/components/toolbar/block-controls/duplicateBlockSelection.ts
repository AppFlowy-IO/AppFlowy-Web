import { Editor, Element, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { getBlock, getBlockIndex } from '@/application/slate-yjs/utils/yjs';
import { BlockData, CollabOrigin, YjsEditorKey } from '@/application/types';
import { stripInlineCommentIds } from '@/components/editor/clipboard/inline-comment-metadata';
import { EditorContextState } from '@/components/editor/EditorContext';
import { containsSubpage, prepareSubpageFragment } from '@/components/editor/subpage/subpage-operations';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';

// Resolving a placeholder completes its insertion; it is not another user edit.
const duplicateResolutionOrigin = {};

export function finalizeDuplicatedBlockData(editor: YjsEditor, blockId: string, data: BlockData): boolean {
  if (editor.readOnly || !YjsEditor.connected(editor)) return false;
  editor.flushLocalChanges();
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry) return false;
  Editor.withoutNormalizing(editor, () => {
    Transforms.setNodes(editor, { data }, { at: entry[1] });
    editor.flushLocalChanges(duplicateResolutionOrigin);
  });
  return true;
}

/** Prepare asynchronous page copies before opening the menu action's history batch. */
export async function duplicateBlockSelection(
  editor: YjsEditor,
  blockIds: string[],
  context: EditorContextState,
  getData?: (source: Element) => BlockData | undefined
): Promise<{ source: Element; blockId: string }[]> {
  if (editor.readOnly || context.readOnly || !YjsEditor.connected(editor)) return [];
  editor.flushLocalChanges();
  const selected = blockIds.flatMap((blockId) => {
    const entry = findSlateEntryByBlockId(editor, blockId);

    return entry ? [{ source: entry[0], blockId }] : [];
  });

  if (selected.length === 0) return [];
  const prepared = await prepareSubpageFragment(
    selected.map(({ source }) => source),
    context
  );
  let inserted = false;

  try {
    if (editor.readOnly || !YjsEditor.connected(editor)) return [];
    editor.flushLocalChanges();
    if (selected.some(({ blockId }) => !getBlock(blockId, editor.sharedRoot))) return [];
    const fragments = prepared.fragment.map((node, index) =>
      containsSubpage([selected[index].source]) ? convertSlateFragmentTo(stripInlineCommentIds([node])) : undefined
    );
    const data = selected.map(({ source }) => getData?.(source));
    const duplicated: { source: Element; blockId: string }[] = [];
    let afterId = selected[selected.length - 1].blockId;

    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    try {
      editor.sharedRoot.doc!.transact(() => {
        selected.forEach(({ source, blockId }, index) => {
          const fragment = fragments[index];
          let ids: string[];

          if (fragment) {
            const after = getBlock(afterId, editor.sharedRoot);

            ids = slateContentInsertToYData(
              after.get(YjsEditorKey.block_parent),
              getBlockIndex(afterId, editor.sharedRoot) + 1,
              fragment,
              editor.sharedRoot.doc!
            );
          } else {
            const id = CustomEditor.duplicateBlock(editor, blockId, afterId, { data: data[index] });

            ids = id ? [id] : [];
          }

          ids.forEach((id) => duplicated.push({ source, blockId: id }));
          afterId = ids[ids.length - 1] ?? afterId;
        });
      }, CollabOrigin.LocalManual);
      inserted = true;
    } finally {
      if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    }

    return duplicated;
  } finally {
    if (!inserted) await prepared.rollback();
  }
}
