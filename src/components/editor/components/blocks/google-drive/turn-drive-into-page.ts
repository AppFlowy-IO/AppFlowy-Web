import cloneDeep from 'lodash-es/cloneDeep';
import isEqual from 'lodash-es/isEqual';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, SubpageNodeData, ViewLayout } from '@/application/types';
import { GoogleDriveBlockNode } from '@/components/editor/editor.type';
import { EditorContextState } from '@/components/editor/EditorContext';

import { driveName } from './drive-data';

const creating = new WeakSet<YjsEditor>();

/** Create the child with its content before replacing the source with a page link. */
export async function turnDriveIntoPage(editor: YjsEditor, context: EditorContextState, blockId: string) {
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (
    !context.addPage ||
    creating.has(editor) ||
    editor.readOnly ||
    !YjsEditor.connected(editor) ||
    !entry ||
    entry[0].type !== BlockType.GoogleDriveBlock ||
    editor.isElementReadOnly(entry[0])
  )
    return;

  creating.add(editor);
  try {
    editor.flushLocalChanges();
    const source = cloneDeep(entry[0]) as GoogleDriveBlockNode;

    const { view_id } = await context.addPage(context.viewId, {
      layout: ViewLayout.Document,
      name: driveName(source.data).slice(0, 128),
      page_data: {
        type: BlockType.Page,
        children: [
          {
            type: BlockType.GoogleDriveBlock,
            data: {
              ...source.data,
            },
            children: [],
          },
        ],
      },
    });
    const current = findSlateEntryByBlockId(editor, blockId);

    // A request can outlive the editor, or a collaborator can edit its source.
    // Never remove content that wasn't included in the created page.
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
    const data: SubpageNodeData = { view_id };
    const inserted = CustomEditor.turnToBlock(editor, blockId, BlockType.SubpageBlock, data);

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
