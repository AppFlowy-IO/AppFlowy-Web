import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FieldType } from '@/application/database-yjs/database.type';
import { FormulaFieldSchema } from '@/application/database-yjs/fields/formula';

import { offsetToPoint, selectionOffsets } from '../formula-slate';
import { FormulaSourceInput } from '../FormulaSourceInput';

/**
 * Dragging a selection in the formula input moves formula source: a drag
 * grabbed by one of the selection's tokens carries the whole selection, a drop
 * inside the input moves it there, and other apps only ever get the source.
 */

// Pass-through spy on the Slate editor the input builds, to set its selection.
const mockEditors: Editor[] = [];

jest.mock('slate-history', () => {
  const actual = jest.requireActual('slate-history');

  return {
    ...actual,
    withHistory: (editor: Editor) => {
      const result = actual.withHistory(editor);

      mockEditors.push(result);
      return result;
    },
  };
});

const editor = () => mockEditors[mockEditors.length - 1];

/** jsdom has no DataTransfer. */
class FakeDataTransfer {
  private store = new Map<string, string>();
  dropEffect = 'none';
  effectAllowed = 'all';
  files = [];
  items = [];

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

  clearData(type?: string) {
    if (type) this.store.delete(type);
    else this.store.clear();
  }
}

const SCHEMA = [
  { id: 'a', name: 'A', type: FieldType.Number, field: {} },
  { id: 'b', name: 'B', type: FieldType.Number, field: {} },
] as unknown as FormulaFieldSchema[];

function Host({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);

  return (
    <FormulaSourceInput
      value={value}
      onChange={setValue}
      onCaretChange={() => undefined}
      onKeyDown={() => undefined}
      schema={SCHEMA}
    />
  );
}

async function open(initial: string) {
  mockEditors.length = 0;
  render(<Host initial={initial} />);
  await flushFormulaEditor();
}

async function select(start: number, end: number) {
  act(() => {
    Transforms.select(editor(), { anchor: offsetToPoint(editor(), start), focus: offsetToPoint(editor(), end) });
  });
  await flushFormulaEditor();
  expect(selectionOffsets(editor())).toEqual({ start, end });
}

const tokenRefs = () => screen.queryAllByTestId('formula-token').map((token) => token.getAttribute('data-ref'));

/** The name inside a token's chip, where a pointer grabs it. */
const chipName = (index: number) => screen.getAllByTestId('formula-token')[index].querySelector('.truncate') as Element;

/** The highlighted piece of source reading `text`, where a pointer grabs plain source. */
const sourceText = (text: string) =>
  Array.from(formulaInput().querySelectorAll('[data-slate-string]')).find((el) => el.textContent === text) as Element;

async function dragStart(target: Element, data: FakeDataTransfer) {
  fireEvent.dragStart(target, { dataTransfer: data });
  await flushFormulaEditor();
}

/** Drops `data` with the pointer over source offset `offset`. */
async function dropAt(offset: number, data: FakeDataTransfer) {
  const [node, domOffset] = ReactEditor.toDOMPoint(editor(), offsetToPoint(editor(), offset));
  const range = document.createRange();

  range.setStart(node, domOffset);
  range.collapse(true);
  (document as unknown as { caretRangeFromPoint: () => Range }).caretRangeFromPoint = () => range;
  const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

  Object.defineProperty(event, 'dataTransfer', { value: data });
  act(() => {
    (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.dispatchEvent(event);
  });
  await flushFormulaEditor();
}

async function undo() {
  fireEvent.keyDown(formulaInput(), { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ctrlKey: true });
  await flushFormulaEditor();
}

describe('dragging a selection by one of its tokens', () => {
  it('carries the whole selection and moves it where it is dropped', async () => {
    await open('prop("A") * prop("B") > 0');
    await select(0, 21);
    // The browser fills a selection drag with the selection's text before dragstart.
    const data = new FakeDataTransfer({ 'text/plain': 'A * B' });

    await dragStart(chipName(1), data);
    expect(data.getData('text/plain')).toBe('prop("A") * prop("B")');

    await dropAt(25, data);
    expect(formulaSource()).toBe(' > 0prop("A") * prop("B")');
    expect(tokenRefs()).toEqual(['A', 'B']);

    // One undo puts the selection back where it was.
    await undo();
    expect(formulaSource()).toBe('prop("A") * prop("B") > 0');
    expect(tokenRefs()).toEqual(['A', 'B']);
  });

  it('keeps the token after the grabbed one', async () => {
    await open('prop("A")prop("B") + 1');
    await select(0, 18);
    const data = new FakeDataTransfer({ 'text/plain': 'AB' });

    await dragStart(chipName(0), data);
    expect(data.getData('text/plain')).toBe('prop("A")prop("B")');

    await dropAt(22, data);
    expect(formulaSource()).toBe(' + 1prop("A")prop("B")');
    expect(tokenRefs()).toEqual(['A', 'B']);
  });

  it('keeps the text after a single selected token grabbed by its chip', async () => {
    await open('1 + prop("A") * 2');
    await select(4, 13);
    const data = new FakeDataTransfer({ 'text/plain': 'A' });

    await dragStart(chipName(0), data);
    expect(data.getData('text/plain')).toBe('prop("A")');

    await dropAt(0, data);
    expect(formulaSource()).toBe('prop("A")1 +  * 2');
    expect(tokenRefs()).toEqual(['A']);
  });

  it('moves just the token when it is grabbed outside the selection', async () => {
    await open('1 + prop("A") * 2');
    await select(0, 0);
    const data = new FakeDataTransfer();

    await dragStart(chipName(0), data);
    expect(data.getData('text/plain')).toBe('prop("A")');

    await dropAt(17, data);
    expect(formulaSource()).toBe('1 +  * 2prop("A")');
    expect(tokenRefs()).toEqual(['A']);
  });

  it('leaves the formula alone when a token drag ends outside the input', async () => {
    await open('prop("A") * 2 + 1');
    await select(0, 13);
    const data = new FakeDataTransfer();

    await dragStart(chipName(0), data);
    fireEvent.dragEnd(chipName(0), { dataTransfer: data });
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("A") * 2 + 1');

    // A later drop from another app, even of the same text, inserts it and moves nothing.
    await dropAt(17, new FakeDataTransfer({ 'text/plain': 'prop("A") * 2' }));
    expect(formulaSource()).toBe('prop("A") * 2 + 1prop("A") * 2');
    expect(tokenRefs()).toEqual(['A', 'A']);
  });
});

describe('the data a drag out of the input carries', () => {
  // A selection drag starts with the browser's HTML of the selection: the
  // chips' names, not their prop() calls.
  function browserFilledData() {
    return new FakeDataTransfer({
      'text/plain': window.getSelection()?.toString() ?? '',
      'text/html': formulaInput().innerHTML,
    });
  }

  it.each([
    ['plain source', () => sourceText('*')],
    ['a token', () => chipName(0)],
  ])('is only the formula source when grabbed by %s', async (_, target) => {
    await open('prop("A") * 2');
    await select(0, 13);
    const data = browserFilledData();

    expect(data.types).toContain('text/html');
    await dragStart(target(), data);
    expect(data.types).toEqual(['text/plain']);
    expect(data.getData('text/plain')).toBe('prop("A") * 2');
  });
});
