import isEqual from 'lodash-es/isEqual';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, MathEquationBlockData, PDFBlockData, SubpageNodeData, ViewLayout } from '@/application/types';
import { pdfFileName } from '@/components/editor/components/blocks/pdf/pdf-data';
import { EditorContextState } from '@/components/editor/EditorContext';

const creating = new WeakSet<YjsEditor>();

export async function createSubpage(editor: YjsEditor, context: EditorContextState) {
  if (editor.readOnly || !editor.selection || !context.addPage || creating.has(editor)) return;
  const source = getBlockEntry(editor)?.[0];
  const blockId = source?.blockId;

  if (!blockId) return;
  const pdf = source.type === BlockType.PDFBlock ? { ...(source.data as PDFBlockData) } : undefined;

  if (pdf?.pending_upload_id) return;
  creating.add(editor);
  try {
    const equation =
      source.type === BlockType.EquationBlock ? (source.data as MathEquationBlockData).formula || '' : undefined;
    const { view_id } = await context.addPage(context.viewId, {
      layout: ViewLayout.Document,
      ...(pdf
        ? {
            name: pdfFileName(pdf).slice(0, 128),
            page_data: { type: BlockType.Page, children: [{ type: BlockType.PDFBlock, data: pdf, children: [] }] },
          }
        : {}),
      ...(equation !== undefined
        ? {
            name: equation.slice(0, 128),
            page_data: {
              type: 'page',
              children: [
                { type: BlockType.EquationBlock, data: { ...(source.data as MathEquationBlockData) }, children: [] },
              ],
            },
          }
        : {}),
    });
    const entry = findSlateEntryByBlockId(editor, blockId);

    // The request can outlive the document or its insertion point. Clean up the
    // newly created child rather than inserting into a different selection.
    if (
      editor.readOnly ||
      !YjsEditor.connected(editor) ||
      !entry ||
      (pdf !== undefined && (entry[0].type !== BlockType.PDFBlock || !isEqual(entry[0].data, pdf))) ||
      (equation !== undefined &&
        (entry[0].type !== BlockType.EquationBlock ||
          ((entry[0].data as MathEquationBlockData).formula || '') !== equation))
    ) {
      await context.deletePage?.(view_id);
      return;
    }

    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    const data: SubpageNodeData = { view_id };
    const inserted =
      pdf === undefined && equation === undefined && CustomEditor.getBlockTextContent(entry[0], 2)
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
