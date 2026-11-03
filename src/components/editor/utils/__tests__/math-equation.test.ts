jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));

import { createEditor, Editor, Element, Node } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory, YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { withPlugins } from '@/components/editor/plugins';

import { getSelectedEquationTexts, insertInlineEquation, OPEN_MATH_EQUATION_EVENT, toggleInlineEquation } from '../math-equation';

function block(text = '', type = BlockType.Paragraph, marks = {}): Element {
  return { type, data: {}, children: [{ type: YjsEditorKey.text, children: [{ text, ...marks }] }] } as Element;
}

describe('Flutter math character and selection shortcuts with Yjs', () => {
  const editors: YjsEditor[] = [];

  beforeEach(() => jest.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined));
  afterEach(() => {
    editors.splice(0).forEach((editor) => {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    });
    jest.restoreAllMocks();
  });
  function setup(text = '', type = BlockType.Paragraph, marks = {}) {
    const doc = withTestingYDoc('math-page');

    slateContentInsertToYData('math-page', 0, [block(text, type, marks)], doc);
    const editor = withPlugins(
      withReact(withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })))
    ) as YjsEditor & YHistoryEditor;

    editor.connect();
    editor.select(editor.end([0, 0]));
    editors.push(editor);
    return editor;
  }
  const formulas = (editor: YjsEditor) =>
    Array.from(Node.texts(editor))
      .filter(([n]) => n.formula !== undefined)
      .map(([n]) => n.formula);
  const type = (editor: YjsEditor, text: string) => {
    for (const character of text) editor.insertText(character);
  };
  const persisted = (editor: YjsEditor) => {
    editor.flushLocalChanges();
    expect(yDocToSlateContent(editor.sharedRoot.doc!)?.children).toEqual(editor.children);
  };

  it('inserts multiple inline formulas and continues typing on the same line', () => {
    const editor = setup();

    type(editor, '$E = MC ^ 2$ hello $a^2+b^2$ world');
    expect(formulas(editor)).toEqual(['E = MC ^ 2', 'a^2+b^2']);
    expect(editor.children).toHaveLength(1);
    expect(Node.string(editor)).toBe('$ hello $ world');
    persisted(editor);
  });

  it('ports Flutter whole-string IME input, including the adjacent-equation guard', () => {
    const editor = setup();

    editor.insertText('$E = MC ^ 2$');
    editor.insertText(' $E = MC ^ 2$test');
    editor.insertText(' $E = MC ^ 2$');
    expect(formulas(editor)).toHaveLength(3);
    editor.insertText('$E = MC ^ 2$');
    expect(formulas(editor)).toHaveLength(3);
    persisted(editor);
  });

  it('ports Flutter whole-string display input with preceding and following text', () => {
    const editor = setup();

    editor.insertText('before text$$E = MC ^ 2$$after');
    expect(editor.children[1]).toMatchObject({ type: BlockType.EquationBlock, data: { formula: 'E = MC ^ 2' } });
    expect(Node.string(editor.children[0])).toBe('before text');
    expect(Node.string(editor.children[2])).toBe('after');
    persisted(editor);
  });

  it.each([String.raw`\$x$`, '$   $', '$x\ny$', '$$$x$$'])(
    'does not convert escaped, empty, multiline or triple delimiters: %s',
    (text) => {
      const editor = setup('before ');

      type(editor, text);
      expect(formulas(editor)).toEqual([]);
      expect((editor.children[0] as Element).type).toBe(BlockType.Paragraph);
      persisted(editor);
    }
  );

  it.each([
    { type: BlockType.CodeBlock, marks: {} },
    { type: BlockType.Paragraph, marks: { code: true } },
  ])('keeps dollars literal inside code (%s)', ({ type: blockType, marks }) => {
    const editor = setup('existing', blockType, marks);

    editor.select({ path: [0, 0, 0], offset: 3 });
    type(editor, '$x$');
    expect(formulas(editor)).toEqual([]);
  });

  it.each([
    { type: BlockType.CodeBlock, marks: {} },
    { type: BlockType.Paragraph, marks: { code: true } },
  ])('keeps whole-string math and Unicode literal inside code (%s)', ({ type: blockType, marks }) => {
    const editor = setup('existing', blockType, marks);
    const text = ' $😀$ and $$x^2$$';

    editor.insertText(text);
    expect(formulas(editor)).toEqual([]);
    expect(editor.children).toHaveLength(1);
    expect(Node.string(editor)).toBe(`existing${text}`);
    persisted(editor);
  });

  it('opens an empty block editor with $$', () => {
    const editor = setup('$');
    const open = jest.fn();

    window.addEventListener(OPEN_MATH_EQUATION_EVENT, open);
    editor.insertText('$');
    window.removeEventListener(OPEN_MATH_EQUATION_EVENT, open);
    expect(editor.children[0]).toMatchObject({ type: BlockType.EquationBlock, data: { formula: '' } });
    expect(open).toHaveBeenCalledTimes(1);
    persisted(editor);
  });

  it('splits a block formula out of surrounding text', () => {
    const editor = setup('before $$x^2$ after');

    editor.select({ path: [0, 0, 0], offset: 'before $$x^2$'.length });
    editor.insertText('$');
    expect(editor.children.map((n) => (n as Element).type)).toEqual([
      BlockType.Paragraph,
      BlockType.EquationBlock,
      BlockType.Paragraph,
    ]);
    expect(Node.string(editor.children[0])).toBe('before ');
    expect(editor.children[1]).toMatchObject({ data: { formula: 'x^2' } });
    expect(Node.string(editor.children[2])).toBe(' after');
    type(editor, 'continued');
    expect(Node.string(editor.children[2])).toContain('continued');
    persisted(editor);
  });

  it('converts selected text, edits it, and removes equation formatting', () => {
    const editor = setup('E = MC ^ 2');

    editor.select([0, 0]);
    expect(toggleInlineEquation(editor)).toBe(true);
    expect(formulas(editor)).toEqual(['E = MC ^ 2']);
    editor.select([0, 0]);
    editor.addMark('formula', 'E = MC ^ 3');
    expect(toggleInlineEquation(editor)).toBe(true);
    expect(formulas(editor)).toEqual([]);
    expect(Node.string(editor)).toBe('E = MC ^ 3');
    persisted(editor);
  });

  it('removes inline math selected from the start of the following text leaf', () => {
    const editor = setup('Before ');

    insertInlineEquation(editor, 'x^2');
    type(editor, ' after');
    editor.select({ anchor: { path: [0, 0, 2], offset: 0 }, focus: { path: [0, 0, 1], offset: 0 } });
    expect(getSelectedEquationTexts(editor)).toEqual([{ text: '$', formula: 'x^2' }]);
    expect(toggleInlineEquation(editor)).toBe(true);
    expect(Node.string(editor)).toBe('Before x^2 after');
    expect(formulas(editor)).toEqual([]);
    persisted(editor);
  });

  it('does not convert a selection containing a mention', () => {
    const editor = setup('text', BlockType.Paragraph, { mention: { type: 'page', page_id: 'page' } });

    editor.select([0, 0]);
    expect(toggleInlineEquation(editor)).toBe(false);
    expect(formulas(editor)).toEqual([]);
  });

  it('inserts an inline slash formula at a tracked range and leaves following text unformatted', () => {
    const editor = setup('before after');

    editor.select({ path: [0, 0, 0], offset: 7 });
    const ref = EditorRangeRef(editor);

    editor.deselect();
    insertInlineEquation(editor, 'x^2 + y^2', ref.unref());
    type(editor, ' following ');
    expect(formulas(editor)).toEqual(['x^2 + y^2']);
    expect(Node.string(editor)).toBe('before $ following after');
    persisted(editor);
  });

  it('duplicates and deletes equation blocks without losing persisted formula data', () => {
    const editor = setup('$');

    editor.insertText('$');
    const id = (editor.children[0] as Element).blockId as string;

    CustomEditor.setBlockData(editor, id, { formula: 'E=mc^2' });
    editor.flushLocalChanges();
    const copy = CustomEditor.duplicateBlock(editor, id, id);

    expect(editor.children[1]).toMatchObject({ type: BlockType.EquationBlock, data: { formula: 'E=mc^2' } });
    CustomEditor.deleteBlock(editor, copy!);
    expect(editor.children).toHaveLength(1);
    persisted(editor);
  });

  it('copies a selected display equation as both rich content and TeX', () => {
    const editor = setup('$');

    editor.insertText('$');
    const id = (editor.children[0] as Element).blockId!;

    CustomEditor.setBlockData(editor, id, { formula: 'E=mc^2' });
    editor.select(editor.start([0]));
    const values = new Map<string, string>();

    editor.setFragmentData({
      getData: (key: string) => values.get(key) || '',
      setData: (key: string, value: string) => values.set(key, value),
    } as DataTransfer);
    expect(values.get('text/plain')).toBe('$$\nE=mc^2\n$$');
    expect(JSON.parse(decodeURIComponent(window.atob(values.get('application/x-appflowy-fragment')!)))[0]).toMatchObject(
      { type: BlockType.EquationBlock, data: { formula: 'E=mc^2' } }
    );
  });
});

// A range ref tracks insertions even while the popover owns browser focus.
function EditorRangeRef(editor: YjsEditor) {
  return Editor.rangeRef(editor, editor.selection!);
}
