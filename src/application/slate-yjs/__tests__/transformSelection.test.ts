import { expect } from '@jest/globals';
import { createEditor, Editor, Range } from 'slate';

import { ensureValidSelection, isValidSelection } from '@/application/slate-yjs/utils/transformSelection';

describe('ensureValidSelection', () => {
  it('clamps a stale selection offset to the current text length', () => {
    const editor = createEditor();

    editor.children = [
      {
        type: 'paragraph',
        children: [{ text: 'Hi' }],
      },
    ] as Editor['children'];
    editor.selection = {
      anchor: { path: [0, 0], offset: 47 },
      focus: { path: [0, 0], offset: 47 },
    };

    expect(isValidSelection(editor, editor.selection)).toBe(false);

    ensureValidSelection(editor);

    expect(editor.selection).not.toBeNull();
    expect(Range.isCollapsed(editor.selection!)).toBe(true);
    expect(isValidSelection(editor, editor.selection!)).toBe(true);
    expect(editor.selection!.anchor.offset).toBe(2);
    expect(editor.selection!.focus.offset).toBe(2);
  });
});
