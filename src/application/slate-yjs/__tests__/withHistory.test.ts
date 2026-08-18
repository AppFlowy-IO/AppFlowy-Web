import { expect } from '@jest/globals';
import { createEditor, Editor, Transforms } from 'slate';

import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
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

describe('withYHistory selection restoration', () => {
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
});
