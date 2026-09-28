import { createEditor, Descendant, Editor, Element, Transforms } from 'slate';
import { withHistory } from 'slate-history';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  FormulaFieldSchema,
  toDisplayExpression,
  toStorageExpression,
} from '@/application/database-yjs/fields/formula';

import {
  editorSource,
  ejectCaretFromToken,
  findPropReferences,
  FORMULA_CLIPBOARD_TYPE,
  FORMULA_PROP,
  FormulaPropElement,
  isFormulaProp,
  moveCaret,
  offsetToPoint,
  pointToOffset,
  rebindTokens,
  remapOffset,
  replaceSourceRange,
  resetSource,
  selectedSource,
  selectionOffsets,
  sourceToNodes,
  tokenRangeAt,
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

  describe('a single line holding many prop() calls', () => {
    const count = 40;
    const line = Array.from({ length: count }, (_, index) => `prop("P${index}")`).join(' + ');

    it('tokenizes every call when pasted', () => {
      const editor = makeEditor('');

      expect(() => editor.insertData({ getData: () => line } as unknown as DataTransfer)).not.toThrow();
      expect(editorSource(editor)).toBe(line);
      expect(tokens(editor).map((token) => token.ref)).toEqual(
        Array.from({ length: count }, (_, index) => `P${index}`)
      );
      expect(selectionOffsets(editor)).toEqual({ start: line.length, end: line.length });
    });

    it('tokenizes every call when inserted as text', () => {
      const editor = makeEditor('1 + ');

      expect(() => Editor.insertText(editor, line)).not.toThrow();
      expect(editorSource(editor)).toBe(`1 + ${line}`);
      expect(tokens(editor)).toHaveLength(count);
      expect(selectionOffsets(editor)).toEqual({ start: line.length + 4, end: line.length + 4 });
    });

    it('tokenizes adjacent calls with no text between them', () => {
      const editor = makeEditor('');
      const packed = line.replace(/ \+ /g, '');

      editor.insertData({ getData: () => packed } as unknown as DataTransfer);
      expect(editorSource(editor)).toBe(packed);
      expect(tokens(editor)).toHaveLength(count);
    });
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

  it.each([
    ['a call to a property named like the call', 'prop("Price") * 2', ['Price', 'prop("Price")']],
    ['a call whose name ends in "("', 'max([1, 2]) + 1', ['max(']],
    ['a multi-line string holding a name', 'if(prop("Done"), "Great\nDone!", "Keep going")', ['Done']],
    ['curly quotes inside a string', '"say prop(“Price”)" + prop("Price")', ['Price']],
    ['a number named like a property', 'prop("Year") == 2024', ['Year', '2024']],
  ])('round-trips %s with its own names', (_, source, names) => {
    const from = pasteEditor(source);
    const copied = copyAll(from);
    const to = withFormulaTokens(withHistory(createEditor()), (text) => normalizePastedFormula(text, names));

    to.children = sourceToNodes('');
    Editor.normalize(to, { force: true });
    Transforms.select(to, offsetToPoint(to, 0));
    paste(to, copied);
    expect(editorSource(to)).toBe(source);
    expect(tokens(to).map((token) => token.ref)).toEqual(tokens(from).map((token) => token.ref));
  });

  it('tells the paste rewrite the source around the selection it replaces', () => {
    const contexts: Array<{ before: string; after: string }> = [];
    const editor = withFormulaTokens(withHistory(createEditor()), (text, context) => {
      contexts.push(context);
      return text;
    });

    editor.children = sourceToNodes('1 + prop("A") + 2');
    Editor.normalize(editor, { force: true });
    Transforms.select(editor, offsetToPoint(editor, 2));
    paste(editor, 'x');
    // A selection that starts inside a token covers the whole token.
    Transforms.select(editor, { anchor: { path: [0, 1, 0], offset: 0 }, focus: offsetToPoint(editor, 16) });
    paste(editor, 'y');
    expect(contexts).toEqual([
      { before: '1 ', after: '+ prop("A") + 2' },
      { before: '1 x+ ', after: ' 2' },
    ]);
    expect(editorSource(editor)).toBe('1 x+ y 2');
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

describe('rebinding tokens', () => {
  // Stands in for a rename: references to Price now name Cost.
  const renamePrice = (source: string) => (source === 'prop("Price")' ? 'prop("Cost")' : source);

  it('rewrites tokens in place without moving the caret or recording an edit', () => {
    const editor = makeEditor('prop("Price") * 25 + 3');

    Transforms.select(editor, offsetToPoint(editor, 'prop("Price") * 25'.length));
    const selection = editor.selection;
    const undos = editor.history.undos.length;

    expect(rebindTokens(editor, renamePrice)).toBe(true);
    expect(editorSource(editor)).toBe('prop("Cost") * 25 + 3');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Cost']);
    expect(editor.selection).toEqual(selection);
    expect(selectionOffsets(editor)).toEqual({ start: 17, end: 17 });
    expect(editor.history.undos).toHaveLength(undos);
    expect(rebindTokens(editor, renamePrice)).toBe(false);
  });

  it('rewrites the tokens undo and redo restore, including tokens inside whole lines', async () => {
    const editor = makeEditor('1');

    editor.history = { undos: [], redos: [] };
    Transforms.insertNodes(editor, sourceToNodes('prop("Price") + 2'), { at: [1] });
    // Let Slate flush, so the next edit is its own undo step.
    await Promise.resolve();
    Transforms.removeNodes(editor, { at: [1, 1] });
    expect(editorSource(editor)).toBe('1\n + 2');
    expect(editor.history.undos).toHaveLength(2);

    expect(rebindTokens(editor, renamePrice)).toBe(false);
    editor.undo();
    expect(editorSource(editor)).toBe('1\nprop("Cost") + 2');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Cost']);
    editor.undo();
    expect(editorSource(editor)).toBe('1');
    editor.redo();
    expect(editorSource(editor)).toBe('1\nprop("Cost") + 2');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Cost']);
  });

  it('ignores a rewrite that is no longer one prop() call', () => {
    const editor = makeEditor('prop("Price") + 1');

    expect(rebindTokens(editor, () => 'prop("A") + prop("B")')).toBe(false);
    expect(editorSource(editor)).toBe('prop("Price") + 1');
  });
});

describe('remapOffset', () => {
  const before = 'prop("Price") * 25 + 3';
  const after = 'prop("Cost") * 25 + 3';

  it('keeps an offset in the text before or after a change', () => {
    expect(remapOffset(before, after, 3)).toBe(3);
    expect(remapOffset(before, after, 'prop("Price") * 25'.length)).toBe('prop("Cost") * 25'.length);
    expect(remapOffset(before, after, before.length)).toBe(after.length);
    expect(remapOffset(before, before, 9)).toBe(9);
  });

  it('moves an offset inside the change after its replacement', () => {
    expect(remapOffset(before, after, 'prop("Pr'.length)).toBe('prop("Cost'.length);
    expect(remapOffset('ab', 'aXYb', 2)).toBe(4);
    expect(remapOffset('abc', 'c', 1)).toBe(0);
  });
});

/** A DataTransfer: jsdom has none. */
class FakeDataTransfer {
  private store = new Map<string, string>();

  constructor(init: Record<string, string> = {}) {
    Object.entries(init).forEach(([type, value]) => this.store.set(type, value));
  }

  get types() {
    return Array.from(this.store.keys());
  }

  getData(type: string) {
    return this.store.get(type) ?? '';
  }

  setData(type: string, value: string) {
    this.store.set(type, value);
  }

  clearData() {
    this.store.clear();
  }

  asDataTransfer() {
    return this as unknown as DataTransfer;
  }
}

describe('formula clipboard data', () => {
  it('carries only the formula source, not what the browser put in a drag first', () => {
    const editor = makeEditor('1 + prop("Price") * 2');
    // A selection drag starts with the selection's text and HTML: the token's name.
    const data = new FakeDataTransfer({ 'text/plain': '1 + Price * 2', 'text/html': '1 + <span>Price</span> * 2' });

    Transforms.select(editor, []);
    editor.setFragmentData(data.asDataTransfer());
    expect(data.types).toEqual(['text/plain']);
    expect(data.getData('text/plain')).toBe('1 + prop("Price") * 2');
  });

  it('finds the source range of the token at a path', () => {
    const editor = makeEditor('1\n+ prop("Price") * 2');

    expect(tokenRangeAt(editor, [1, 1])).toEqual({ start: 4, end: 17 });
    expect(tokenRangeAt(editor, [1, 1, 0])).toEqual({ start: 4, end: 17 });
    expect(tokenRangeAt(editor, [1, 0])).toBeNull();
    expect(tokenRangeAt(editor, [5])).toBeNull();
  });
});

describe('typed-in text taken off the editor', () => {
  function editorWithNames(source: string) {
    const editor = withFormulaTokens(withHistory(createEditor()), (text) => normalizePastedFormula(text, ['Price']));

    editor.children = sourceToNodes(source);
    Editor.normalize(editor, { force: true });
    Transforms.select(editor, offsetToPoint(editor, source.length));
    return editor;
  }

  it('reads text holding the zero-width marks drawn beside tokens the way a paste is read', () => {
    // What a macOS kill ring holds for a selection with a token: its name and the marks.
    const editor = editorWithNames('1 + ');

    Editor.insertText(editor, 'Price\uFEFF * 2');
    expect(editorSource(editor)).toBe('1 + prop("Price") * 2');
    expect(tokens(editor).map((token) => token.ref)).toEqual(['Price']);
    editor.undo();
    expect(editorSource(editor)).toBe('1 + ');
  });

  it('inserts other text as it is', () => {
    const editor = editorWithNames('1 + ');

    Editor.insertText(editor, 'Price');
    expect(editorSource(editor)).toBe('1 + Price');
    expect(tokens(editor)).toHaveLength(0);
  });
});

describe('tokens copied with the properties they name', () => {
  const schemaOf = (entries: Array<[string, string]>) =>
    entries.map(([id, name]) => ({ id, name, type: FieldType.Number, field: {} })) as unknown as FormulaFieldSchema[];

  /** Editors sharing one database whose properties can change between a copy and a paste. */
  function database({ scope }: { scope?: string } = { scope: 'database' }) {
    let schema = schemaOf([
      ['price', 'Price'],
      ['other', 'Other'],
    ]);
    const clipboard = {
      scope: () => scope,
      bind: (source: string) => toStorageExpression(source, schema),
      unbind: (bound: string) => toDisplayExpression(bound, schema),
    };

    return {
      editor(source = '', caret = source.length) {
        const editor = withFormulaTokens(withHistory(createEditor()), undefined, clipboard);

        editor.children = sourceToNodes(source);
        Editor.normalize(editor, { force: true });
        Transforms.select(editor, offsetToPoint(editor, caret));
        return editor;
      },
      /** Price is renamed to Cost, and Other takes the name Price. */
      renamePrice() {
        schema = schemaOf([
          ['price', 'Cost'],
          ['other', 'Price'],
        ]);
      },
    };
  }

  function copy(editor: Editor, start: number, end: number) {
    const data = new FakeDataTransfer();

    Transforms.select(editor, { anchor: offsetToPoint(editor, start), focus: offsetToPoint(editor, end) });
    editor.setFragmentData(data.asDataTransfer());
    return data;
  }

  it('records each copied token by id, and pastes it as the property it named', () => {
    const db = database();
    const data = copy(db.editor('1 + prop("Price") * prop("Other")'), 4, 32);

    expect(data.getData('text/plain')).toBe('prop("Price") * prop("Other")');
    expect(JSON.parse(data.getData(FORMULA_CLIPBOARD_TYPE))).toEqual({
      scope: 'database',
      text: 'prop("Price") * prop("Other")',
      tokens: [
        [0, 13, 'prop("price")'],
        [16, 29, 'prop("other")'],
      ],
    });

    db.renamePrice();
    const to = db.editor('max(, 1)', 4);

    to.insertData(data.asDataTransfer());
    expect(editorSource(to)).toBe('max(prop("Cost") * prop("Price"), 1)');
  });

  it('reads the copy when the clipboard wrote its lines with "\\r\\n"', () => {
    const db = database();
    const data = copy(db.editor('prop("Price") +\n1'), 0, 17);

    db.renamePrice();
    const to = db.editor();

    to.insertData(
      new FakeDataTransfer({
        'text/plain': 'prop("Price") +\r\n1',
        [FORMULA_CLIPBOARD_TYPE]: data.getData(FORMULA_CLIPBOARD_TYPE),
      }).asDataTransfer()
    );
    expect(editorSource(to)).toBe('prop("Cost") +\n1');
  });

  it('records nothing without a scope to read the copy in', () => {
    const data = copy(database({}).editor('prop("Price")'), 0, 13);

    expect(data.types).toEqual(['text/plain']);
  });

  it.each<[string, (copied: { text: string; data: Record<string, unknown> }) => Record<string, string>]>([
    [
      'copied in another database',
      ({ text, data }) => ({ 'text/plain': text, [FORMULA_CLIPBOARD_TYPE]: JSON.stringify({ ...data, scope: 'x' }) }),
    ],
    [
      'another app changed the text',
      ({ data }) => ({ 'text/plain': 'prop("Price") * 3', [FORMULA_CLIPBOARD_TYPE]: JSON.stringify(data) }),
    ],
    ['the data is not JSON', ({ text }) => ({ 'text/plain': text, [FORMULA_CLIPBOARD_TYPE]: '{"scope"' })],
    ['the data is not an object', ({ text }) => ({ 'text/plain': text, [FORMULA_CLIPBOARD_TYPE]: '2' })],
    [
      'a recorded token is not a prop() call in the text',
      ({ text, data }) => ({
        'text/plain': text,
        [FORMULA_CLIPBOARD_TYPE]: JSON.stringify({ ...data, tokens: [[1, 13, 'prop("price")']] }),
      }),
    ],
    [
      'recorded tokens overlap',
      ({ text, data }) => ({
        'text/plain': text,
        [FORMULA_CLIPBOARD_TYPE]: JSON.stringify({
          ...data,
          tokens: [
            [0, 13, 'prop("price")'],
            [0, 13, 'prop("price")'],
          ],
        }),
      }),
    ],
  ])('pastes by name when %s', (_, clipboard) => {
    const db = database();
    const data = copy(db.editor('prop("Price") * 2'), 0, 17);
    const copied = {
      text: data.getData('text/plain'),
      data: JSON.parse(data.getData(FORMULA_CLIPBOARD_TYPE)) as Record<string, unknown>,
    };
    const pasted = clipboard(copied);

    db.renamePrice();
    const to = db.editor();

    to.insertData(new FakeDataTransfer(pasted).asDataTransfer());
    expect(editorSource(to)).toBe(pasted['text/plain']);
  });
});

describe('prop() text inside a string or comment that spans lines', () => {
  const refs = (editor: Editor) => tokens(editor).map((token) => token.ref);
  const nodeRefs = (nodes: Descendant[]) =>
    nodes.flatMap((line) => (line as Element).children).flatMap((node) => (isFormulaProp(node) ? [node.ref] : []));

  it('stays text on a later line of a string', () => {
    const source = '\'a\nprop("X")\' + 1';
    const editor = makeEditor(source);

    expect(nodeRefs(sourceToNodes(source))).toEqual([]);
    expect(refs(editor)).toEqual([]);
    expect(editorSource(editor)).toBe(source);
  });

  it('stays text in a block comment that comments out whole lines', () => {
    const source = '/*\nprop("Old") * 2\n*/\nprop("New") * 3';

    expect(nodeRefs(sourceToNodes(source))).toEqual(['New']);
    expect(refs(makeEditor(source))).toEqual(['New']);
  });

  it('stays text when typed on the next line of an open string, also once the string closes', () => {
    const editor = makeEditor('');

    type(editor, "'a");
    Editor.insertBreak(editor);
    type(editor, 'prop("X")');
    expect(refs(editor)).toEqual([]);
    type(editor, "'");
    expect(refs(editor)).toEqual([]);
    type(editor, ' + prop("Y")');
    expect(editorSource(editor)).toBe('\'a\nprop("X")\' + prop("Y")');
    expect(refs(editor)).toEqual(['Y']);
  });

  it('becomes a token on a later line once an earlier line closes the string it was in', () => {
    const editor = makeEditor('"a\nprop("X")');

    expect(refs(editor)).toEqual([]);
    Transforms.select(editor, offsetToPoint(editor, 2));
    type(editor, '"');
    expect(editorSource(editor)).toBe('"a"\nprop("X")');
    expect(refs(editor)).toEqual(['X']);
    expect(selectionOffsets(editor)).toEqual({ start: 3, end: 3 });
  });
});

describe('the draft rewrite reads the references the editor draws as tokens', () => {
  const schema = [
    { id: 'price', name: 'Price', type: FieldType.Number, field: {} },
  ] as unknown as FormulaFieldSchema[];

  // The host rewrites its whole draft on a rename while the editor rewrites
  // its tokens; both must find the same references or they disagree.
  it.each([
    ['a related row\'s property', 'prop("Tasks").map(current.prop("Price")) + prop("Price")'],
    ['a string spanning lines', '\'a\nprop("Price")\' + prop("Price")'],
    ['a comment spanning lines', '/*\nprop("Price")\n*/ prop("Price")'],
    ['an unclosed string', 'prop("Price") + "a\nprop("Price")'],
  ])('%s', (_label, source) => {
    const editor = makeEditor(source);

    rebindTokens(editor, (call) => toStorageExpression(call, schema));
    expect(editorSource(editor)).toBe(toStorageExpression(source, schema));
  });
});
