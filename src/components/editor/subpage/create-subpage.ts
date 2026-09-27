import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, SubpageNodeData, ViewLayout } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

const creating = new WeakSet<YjsEditor>();

export async function createSubpage(editor: YjsEditor, context: EditorContextState) {
  if (editor.readOnly || !editor.selection || !context.addPage || creating.has(editor)) return;
  const blockId = getBlockEntry(editor)?.[0].blockId;

  if (!blockId) return;
  creating.add(editor);
  try {
    const { view_id } = await context.addPage(context.viewId, { layout: ViewLayout.Document });
    const entry = findSlateEntryByBlockId(editor, blockId);

    // The request can outlive the document or its insertion point. Clean up the
    // newly created child rather than inserting into a different selection.
    if (editor.readOnly || !YjsEditor.connected(editor) || !entry) {
      await context.deletePage?.(view_id);
      return;
    }

    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    const data: SubpageNodeData = { view_id };
    const inserted = CustomEditor.getBlockTextContent(entry[0], 2)
      ? CustomEditor.addBelowBlock(editor, blockId, BlockType.SubpageBlock, data)
      : CustomEditor.turnToBlock(editor, blockId, BlockType.SubpageBlock, data);

    if (!inserted) {
      await context.deletePage?.(view_id);
      return;
    }

    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    const insertedEntry = findSlateEntryByBlockId(editor, inserted);

    if (insertedEntry) editor.select(editor.start(insertedEntry[1]));
    context.openPageModal?.(view_id);
  } finally {
    creating.delete(editor);
  }
}
