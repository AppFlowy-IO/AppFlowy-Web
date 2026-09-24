import { createEditor, Editor, Transforms } from 'slate';
import { withHistory } from 'slate-history';

import {
  editorSource,
  ejectCaretFromToken,
  findPropReferences,
  FORMULA_PROP,
  FormulaPropElement,
  moveCaret,
  offsetToPoint,
  pointToOffset,
  replaceSourceRange,
  resetSource,
  selectedSource,
  selectionOffsets,
  sourceToNodes,
  withFormulaTokens,
} from '../formula-slate';
import { normalizePastedFormula } from '../formula-paste';

function makeEditor(source = '') {
  const editor = withFormulaTokens(withHistory(createEditor()));

  editor.children = sourceToNodes(source);
  Editor.normalize(editor, { force: true });
  Transforms.select(editor, offsetToPoint(editor, source.length));
  return editor;
}

function tokens(editor: Editor): FormulaPropElement[] {
  return Array.from(
    Editor.nodes(editor, { at: [], match: (node) => (node as { type?: string }).type === FORMULA_PROP })
  ).map(([node]) => node as unknown as FormulaPropElement);
}

function type(editor: Editor, text: string) {
  for (const ch of text) Editor.insertText(editor, ch);
}

describe('findPropReferences', () => {
  it('finds complete prop() calls with their decoded argument', () => {
    expect(findPropReferences('prop("Price") * 2 + prop( \'A "b"\' )')).toEqual([
      { start: 0, end: 13, ref: 'Price' },
      { start: 20, end: 35, ref: 'A "b"' },
    ]);
  });

  it('ignores incomplete calls, references in strings and comments, and other databases', () => {
    expect(findPropReferences('prop("Pri')).toEqual([]);
    expect(findPropReferences('"prop(\\"A\\")"')).toEqual([]);
    expect(findPropReferences('/* prop("A") */ 1')).toEqual([]);
    expect(findPropReferences('current.prop("Status")')).toEqual([]);
    expect(findPropReferences('myprop("A")')).toEqual([]);
  });
});

describe('formula slate document', () => {
  it('round-trips multi-line source with tokens', () => {
    const source = 'if(prop("Done"),\n  prop("Price") * 2,\n  0)';
    const editor = makeEditor(source);

    expect(editorSource(editor)).toBe(source);
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Done', 'Price']);
  });

  it('turns a prop() call into a token when its closing parenthesis is typed', () => {
    const editor = makeEditor('');

    type(editor, 'prop("Price"');
    expect(tokens(editor)).toHaveLength(0);
    type(editor, ')');
    expect(tokens(editor).map((token) => token.source)).toEqual(['prop("Price")']);
    type(editor, ' * 2');
    expect(editorSource(editor)).toBe('prop("Price") * 2');
    expect(selectionOffsets(editor)).toEqual({ start: 17, end: 17 });
  });

  it('deletes a token as one unit with Backspace', () => {
    const editor = makeEditor('1 + prop("Price")');

    Editor.deleteBackward(editor, { unit: 'character' });
    expect(editorSource(editor)).toBe('1 + ');
    expect(tokens(editor)).toHaveLength(0);
  });

  it('maps offsets around tokens and snaps offsets inside a token to its end', () => {
    const editor = makeEditor('a\nprop("B") + c');

    expect(pointToOffset(editor, offsetToPoint(editor, 2))).toBe(2);
    expect(pointToOffset(editor, offsetToPoint(editor, 5))).toBe(11);
    expect(pointToOffset(editor, offsetToPoint(editor, 11))).toBe(11);
    expect(pointToOffset(editor, offsetToPoint(editor, 15))).toBe(15);
  });

  it('replaces a source range, tokenizing inserted references and placing the caret', () => {
    const editor = makeEditor('upper(ri)');

    replaceSourceRange(editor, 6, 8, 'prop("Price")', 13);
    expect(editorSource(editor)).toBe('upper(prop("Price"))');
    expect(tokens(editor)).toHaveLength(1);
    expect(selectionOffsets(editor)).toEqual({ start: 19, end: 19 });
  });

  it('pastes multi-line source as lines and tokens', () => {
    const editor = makeEditor('x + ');
    const data = { getData: () => 'prop("A") +\n prop("B")' } as unknown as DataTransfer;

    editor.insertData(data);
    expect(editorSource(editor)).toBe('x + prop("A") +\n prop("B")');
    expect(tokens(editor)).toHaveLength(2);
  });

  it('pastes after a token when the caret sits inside it', () => {
    // Chrome can give a paste a target range inside a token's spacer.
    const editor = makeEditor('prop("A")');

    Transforms.select(editor, { path: [0, 1, 0], offset: 0 });
    editor.insertData({ getData: () => ' + 1' } as unknown as DataTransfer);
    expect(editorSource(editor)).toBe('prop("A") + 1');
    expect(tokens(editor)).toHaveLength(1);
  });

  it('replaces a whole token when a pasted-over selection starts inside it', () => {
    const editor = makeEditor('prop("A") + 1');

    Transforms.select(editor, { anchor: { path: [0, 1, 0], offset: 0 }, focus: offsetToPoint(editor, 13) });
    editor.insertData({ getData: () => '2' } as unknown as DataTransfer);
    expect(editorSource(editor)).toBe('2');
    expect(tokens(editor)).toHaveLength(0);
  });

  it('runs pasted text through the paste rewrite', () => {
    const editor = withFormulaTokens(withHistory(createEditor()), (text) => text.replace('Price', 'prop("Price")'));

    editor.children = sourceToNodes('');
    Editor.normalize(editor, { force: true });
    Transforms.select(editor, offsetToPoint(editor, 0));
    editor.insertData({ getData: () => 'Price * 2' } as unknown as DataTransfer);
    expect(editorSource(editor)).toBe('prop("Price") * 2');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Price']);
  });

  it.each([
    'pi() * prop("Amount") ^ 2',
    'if(prop("Price") > 10 and not empty(prop("Notes")),\n  round(pi() * prop("Price") ^ 2, 2),\n  prop("Price") % 3) + prop("Name").length()',
    'prop("Name") + " Price " + "prop(\\"Price\\")" /* Price */ + current.prop("Price")',
    'lets(Price, 2, Price * prop("Price"))',
  ])('copies all and pastes back to the same formula: %s', (source) => {
    const names = ['Amount', 'Price', 'Notes', 'Name'];
    const copyFrom = makeEditor(source);
    let copied = '';

    Transforms.select(copyFrom, []);
    copyFrom.setFragmentData({ setData: (_: string, text: string) => (copied = text) } as unknown as DataTransfer);
    expect(copied).toBe(source);

    const pasteInto = withFormulaTokens(withHistory(createEditor()), (text) => normalizePastedFormula(text, names));

    pasteInto.children = sourceToNodes('');
    Editor.normalize(pasteInto, { force: true });
    Transforms.select(pasteInto, offsetToPoint(pasteInto, 0));
    pasteInto.insertData({ getData: () => copied } as unknown as DataTransfer);
    expect(editorSource(pasteInto)).toBe(source);
    expect(tokens(pasteInto).map((token) => token.ref)).toEqual(tokens(copyFrom).map((token) => token.ref));
  });

  it('copies tokens out as prop() calls', () => {
    const editor = makeEditor('1 + prop("Price") * 2');
    let copied = '';

    Transforms.select(editor, { anchor: offsetToPoint(editor, 4), focus: offsetToPoint(editor, 21) });
    editor.setFragmentData({ setData: (_: string, text: string) => (copied = text) } as unknown as DataTransfer);
    expect(copied).toBe('prop("Price") * 2');
    expect(selectedSource(editor)).toBe('prop("Price") * 2');
  });

  it('resets to new source and undoes edits', () => {
    const editor = makeEditor('1');

    resetSource(editor, 'prop("A")\n2', 3);
    expect(editorSource(editor)).toBe('prop("A")\n2');
    expect(tokens(editor)).toHaveLength(1);
    type(editor, 'x');
    editor.undo();
    expect(editorSource(editor)).toBe('prop("A")\n2');
  });

  it('moves the caret over a whole token with the arrow keys', () => {
    const editor = makeEditor('upper(prop("Name"))');

    expect(moveCaret(editor, true)).toBe(true);
    expect(selectionOffsets(editor)).toEqual({ start: 18, end: 18 });
    moveCaret(editor, true);
    expect(selectionOffsets(editor)).toEqual({ start: 6, end: 6 });
    moveCaret(editor, false);
    expect(selectionOffsets(editor)).toEqual({ start: 18, end: 18 });
    Transforms.select(editor, offsetToPoint(editor, 0));
    expect(moveCaret(editor, true)).toBe(false);
  });

  it('moves a caret inside a token to after it', () => {
    const editor = makeEditor('prop("A") + 1');

    Transforms.select(editor, { path: [0, 1, 0], offset: 0 });
    ejectCaretFromToken(editor);
    expect(selectionOffsets(editor)).toEqual({ start: 9, end: 9 });
    expect(editor.selection?.anchor.path).toEqual([0, 2]);
  });

  it('extends the selection over a whole token with Shift+Arrow', () => {
    const editor = makeEditor('1 + prop("Price") + 2');

    for (let i = 0; i < 4; i += 1) moveCaret(editor, true, true);
    expect(selectedSource(editor)).toBe(' + 2');
    moveCaret(editor, true, true);
    expect(selectedSource(editor)).toBe('prop("Price") + 2');
    Editor.deleteFragment(editor);
    expect(editorSource(editor)).toBe('1 + ');
  });
});

describe('formula copy and paste', () => {
  const NAMES = ['Amount', 'Price', 'Notes', 'Name', 'Say "hi"', '状态'];

  function pasteEditor(source = '', caret = source.length) {
    const editor = withFormulaTokens(withHistory(createEditor()), (text) => normalizePastedFormula(text, NAMES));

    editor.children = sourceToNodes(source);
    Editor.normalize(editor, { force: true });
    Transforms.select(editor, offsetToPoint(editor, caret));
    return editor;
  }

  function paste(editor: Editor, text: string) {
    editor.insertData({ getData: () => text } as unknown as DataTransfer);
  }

  function copyAll(editor: Editor): string {
    let copied = '';

    Transforms.select(editor, []);
    editor.setFragmentData({ setData: (_: string, text: string) => (copied = text) } as unknown as DataTransfer);
    return copied;
  }

  it.each([
    ['a lone reference', 'prop("Price")'],
    ['two adjacent references', 'prop("Price")prop("Amount")'],
    ['a reference whose name has quotes', 'prop("Say \\"hi\\"") + 1'],
    ['a reference in single quotes', "prop('Price') * 2"],
    ['a reference with padding', 'prop( "Price" ) * 2'],
    ['a non-Latin name', 'prop("状态") == "Done"'],
    ['a missing property', 'prop("Nope") + prop("Price")'],
    ['a reference into another database', 'prop("Name").prop("Price")'],
    ['a comment and a string that look like references', '/* prop("Price") */ "prop(\\"Price\\")" + prop("Price")'],
    ['blank lines and trailing newline', 'prop("Price")\n\n  * 2\n'],
    [
      'deep nesting',
      'if(empty(prop("Notes")), round(abs(prop("Price") - prop("Amount")) ^ 2, 1), max([prop("Price"), 0]))',
    ],
    ['a map with a variable', 'map([1, 2], current * prop("Price"))'],
  ])('round-trips %s', (_, source) => {
    const from = pasteEditor(source);
    const copied = copyAll(from);

    expect(copied).toBe(source);
    const to = pasteEditor();

    paste(to, copied);
    expect(editorSource(to)).toBe(source);
    expect(tokens(to).map((token) => token.source)).toEqual(tokens(from).map((token) => token.source));
  });

  it('pastes the copy of part of a formula into the middle of another', () => {
    const from = pasteEditor('1 + prop("Price") * 2');

    Transforms.select(from, { anchor: offsetToPoint(from, 4), focus: offsetToPoint(from, 17) });
    let copied = '';

    from.setFragmentData({ setData: (_: string, text: string) => (copied = text) } as unknown as DataTransfer);
    const to = pasteEditor('max(, 3)', 4);

    paste(to, copied);
    expect(editorSource(to)).toBe('max(prop("Price"), 3)');
    expect(tokens(to)).toHaveLength(1);
    expect(selectionOffsets(to)).toEqual({ start: 17, end: 17 });
  });

  it('turns Windows line endings into lines', () => {
    const editor = pasteEditor();

    paste(editor, 'prop("Price") +\r\n prop("Amount")\r2');
    expect(editorSource(editor)).toBe('prop("Price") +\n prop("Amount")\n2');
    expect(editor.children).toHaveLength(3);
    expect(tokens(editor)).toHaveLength(2);
  });

  it('replaces a selection that covers tokens', () => {
    const editor = pasteEditor('prop("Price") + prop("Amount")');

    Transforms.select(editor, []);
    paste(editor, 'Notes');
    expect(editorSource(editor)).toBe('prop("Notes")');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Notes']);
  });

  it('deletes the selection on an empty paste', () => {
    const editor = pasteEditor('1 + prop("Price")');

    Transforms.select(editor, []);
    editor.insertData({ types: ['text/plain'], getData: () => '' } as unknown as DataTransfer);
    expect(editorSource(editor)).toBe('');
  });

  it('ignores a paste with no plain text', () => {
    const editor = pasteEditor('1');

    editor.insertData({ types: ['text/html'], getData: () => '' } as unknown as DataTransfer);
    expect(editorSource(editor)).toBe('1');
  });

  it('pastes between two tokens', () => {
    const editor = pasteEditor('prop("Price")prop("Amount")', 13);

    paste(editor, ' * ');
    expect(editorSource(editor)).toBe('prop("Price") * prop("Amount")');
    expect(tokens(editor)).toHaveLength(2);
  });

  it('pastes bare names and curly quotes as tokens at the caret', () => {
    const editor = pasteEditor('round(, 2)', 6);

    paste(editor, 'Price * prop(“Amount”)');
    expect(editorSource(editor)).toBe('round(prop("Price") * prop("Amount"), 2)');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Price', 'Amount']);
    expect(selectionOffsets(editor)).toEqual({ start: 36, end: 36 });
  });

  it('undoes a paste in one step', () => {
    const editor = pasteEditor('1 + ');

    paste(editor, 'Price *\nAmount');
    expect(editorSource(editor)).toBe('1 + prop("Price") *\nprop("Amount")');
    editor.undo();
    expect(editorSource(editor)).toBe('1 + ');
    expect(tokens(editor)).toHaveLength(0);
    editor.redo();
    expect(editorSource(editor)).toBe('1 + prop("Price") *\nprop("Amount")');
    expect(tokens(editor)).toHaveLength(2);
  });

  it('copies and pastes back the same formula twice over', () => {
    const source = 'pi() * prop("Amount") ^ 2';
    const editor = pasteEditor(source);
    const first = copyAll(editor);

    Editor.deleteFragment(editor);
    paste(editor, first);
    const second = copyAll(editor);

    Editor.deleteFragment(editor);
    paste(editor, second);
    expect(second).toBe(source);
    expect(editorSource(editor)).toBe(source);
    expect(tokens(editor)).toHaveLength(1);
  });
});
