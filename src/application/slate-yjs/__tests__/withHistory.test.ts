import { expect } from '@jest/globals';
import { createEditor, Editor, Transforms } from 'slate';

import { withYHistory, YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { HistoryStackItem, RelativeRange } from '@/application/slate-yjs/types';
import { relativeRangeToSlateRange } from '@/application/slate-yjs/utils/positions';
import { CollabOrigin } from '@/application/types';

import { insertBlock, withTestingYDoc } from './withTestingYjsEditor';

jest.mock('nanoid');
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

const flushEditorChange = async () => {
  await Promise.resolve();
};

describe('withYHistory', () => {
  it('restores the selections around a merged typing burst on undo and redo', async () => {
    const doc = withTestingYDoc('page-id');
    const blockId = 'paragraph-id';

    insertBlock({
      doc,
      blockObject: {
        id: blockId,
        ty: 'paragraph',
        relation_id: blockId,
        text_id: blockId,
        data: '{}',
      },
    }).applyDelta([]);

    const editor = withYHistory(
      withYjs(createEditor(), doc, {
        localOrigin: CollabOrigin.Local,
        readOnly: false,
      })
    );
    const textPath = [0, 0, 0];

    editor.connect();

    try {
      Transforms.select(editor, { path: textPath, offset: 0 });
      await flushEditorChange();

      Transforms.insertText(editor, 'a');
      await flushEditorChange();
      Transforms.insertText(editor, 'b');
      await flushEditorChange();

      expect(Editor.string(editor, [0])).toBe('ab');
      expect(editor.undoManager.undoStack).toHaveLength(1);
      expect(editor.selection?.anchor).toEqual({ path: textPath, offset: 2 });

      const stackItem = editor.undoManager.undoStack[0] as HistoryStackItem;
      const selectionBefore = relativeRangeToSlateRange(
        editor.sharedRoot,
        stackItem.meta.get('selectionBefore') as RelativeRange
      );
      const selectionAfter = relativeRangeToSlateRange(
        editor.sharedRoot,
        stackItem.meta.get('selection') as RelativeRange
      );

      expect(selectionBefore?.anchor).toEqual({ path: textPath, offset: 0 });
      expect(selectionAfter?.anchor).toEqual({ path: textPath, offset: 2 });

      editor.undo();

      expect(Editor.string(editor, [0])).toBe('');
      expect(editor.selection?.anchor).toEqual({ path: textPath, offset: 0 });

      editor.redo();

      expect(Editor.string(editor, [0])).toBe('ab');
      expect(editor.selection?.anchor).toEqual({ path: textPath, offset: 2 });
    } finally {
      editor.disconnect();
    }
  });

  it('keeps history installed while current read-only access gates undo and redo', () => {
    const editor = withYHistory(
      withYjs(createEditor(), withTestingYDoc('page-id'), {
        localOrigin: CollabOrigin.Local,
        readOnly: true,
      })
    );

    expect(YHistoryEditor.isYHistoryEditor(editor)).toBe(true);
    editor.undoManager.undoStack.push({} as never);
    editor.undoManager.redoStack.push({} as never);
    expect(YHistoryEditor.canUndo(editor)).toBe(false);
    expect(YHistoryEditor.canRedo(editor)).toBe(false);

    editor.connect();
    const undo = jest.spyOn(editor.undoManager, 'undo').mockImplementation(() => undefined);
    const redo = jest.spyOn(editor.undoManager, 'redo').mockImplementation(() => undefined);

    editor.undo();
    editor.redo();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();

    editor.readOnly = false;
    expect(YHistoryEditor.canUndo(editor)).toBe(true);
    expect(YHistoryEditor.canRedo(editor)).toBe(true);
    editor.undo();
    editor.redo();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);

    editor.disconnect();
  });
});
