import { createEditor } from 'slate';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { withYHistory, YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { CollabOrigin } from '@/application/types';

describe('withYHistory', () => {
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
