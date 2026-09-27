/**
 * @jest-environment-options {"userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"}
 */
// Safari: the browser whose kill ring takes the selection's text (the chips'
// names) before Slate can cancel the kill. It must support `beforeinput`,
// which slate-react detects on load, so this import comes first.
import './before-input-support';

import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Editor, Transforms } from 'slate';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FieldType } from '@/application/database-yjs/database.type';
import { FormulaFieldSchema } from '@/application/database-yjs/fields/formula';

import { offsetToPoint } from '../formula-slate';
import { FormulaSourceInput } from '../FormulaSourceInput';

/**
 * macOS kill and yank (Ctrl+K, then Ctrl+Y) in the formula input. The kill
 * ring holds the selection's text as drawn, the tokens' names rather than
 * their prop() calls, so a yank reads it the way a paste is read.
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

const SCHEMA = [
  { id: 'a', name: 'A', type: FieldType.Number, field: {} },
  { id: 'price', name: 'Price', type: FieldType.Number, field: {} },
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
}

async function beforeInput(inputType: string, data: string | null = null) {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data });

  act(() => {
    formulaInput().dispatchEvent(event);
  });
  await flushFormulaEditor();
}

/** Ctrl+K on the selection, keeping what the kill ring takes: the selection's text as drawn. */
async function kill() {
  const killRing = window.getSelection()?.toString() ?? '';

  await beforeInput('deleteContent');
  return killRing;
}

const tokenRefs = () => screen.queryAllByTestId('formula-token').map((token) => token.getAttribute('data-ref'));

describe('killing and yanking back part of a formula', () => {
  it.each([
    // WebKit yanks as `insertText`; the input events spec names it `insertFromYank`.
    ['insertText', 'prop("A") * 2', 0, 13, ['A']],
    ['insertFromYank', 'prop("A") * 2', 0, 13, ['A']],
    ['insertText', '1 + prop("Price") * 2', 4, 21, ['Price']],
  ])('with %s restores the tokens in %s', async (inputType, formula, start, end, refs) => {
    await open(formula);
    await select(start, end);
    const killRing = await kill();

    expect(killRing).not.toContain('prop(');
    expect(formulaSource()).toBe(formula.slice(0, start) + formula.slice(end));

    await beforeInput(inputType, killRing);
    expect(formulaSource()).toBe(formula);
    expect(tokenRefs()).toEqual(refs);
  });

  it('inserts other typed text as it is', async () => {
    await open('1 + ');
    await select(4, 4);
    await beforeInput('insertText', 'Price');
    expect(formulaSource()).toBe('1 + Price');
    expect(tokenRefs()).toEqual([]);
  });
});
