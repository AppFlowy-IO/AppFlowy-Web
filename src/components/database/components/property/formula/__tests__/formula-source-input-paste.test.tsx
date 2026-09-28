import { fireEvent, render } from '@testing-library/react';
import { createRef, RefObject, useState } from 'react';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FieldType } from '@/application/database-yjs/database.type';
import { FormulaFieldSchema } from '@/application/database-yjs/fields/formula';

import { FormulaSourceInput, FormulaSourceInputHandle } from '../FormulaSourceInput';

/**
 * Pasting into the formula input reads the pasted text where it lands: inside
 * a string or comment it stays as it is, and a variable the formula around it
 * binds is not a property.
 */

function schemaOf(names: string[]): FormulaFieldSchema[] {
  return names.map((name, index) => ({
    id: `field-${index}`,
    name,
    type: FieldType.Number,
    field: {},
  })) as unknown as FormulaFieldSchema[];
}

function Host({
  initial,
  schema,
  handle,
}: {
  initial: string;
  schema: FormulaFieldSchema[];
  handle: RefObject<FormulaSourceInputHandle>;
}) {
  const [value, setValue] = useState(initial);

  return (
    <FormulaSourceInput
      ref={handle}
      value={value}
      onChange={setValue}
      onCaretChange={() => undefined}
      onKeyDown={() => undefined}
      schema={schema}
    />
  );
}

const tokenRefs = () =>
  Array.from(formulaInput().querySelectorAll('[data-testid="formula-token"]')).map((el) => el.getAttribute('data-ref'));

function pasteText(text: string) {
  fireEvent.paste(formulaInput(), {
    clipboardData: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
}

/** Opens the input on `initial`, puts the caret at `caret` and pastes `text` there. */
async function pasteAt(initial: string, caret: number, text: string, names: string[]) {
  const handle = createRef<FormulaSourceInputHandle>();

  render(<Host initial={initial} schema={schemaOf(names)} handle={handle} />);
  await flushFormulaEditor();
  handle.current?.replaceRange(caret, caret, '', 0);
  await flushFormulaEditor();
  expect(handle.current?.selection()).toEqual({ start: caret, end: caret });
  pasteText(text);
  await flushFormulaEditor();
  return formulaSource();
}

describe('pasting into the formula input', () => {
  it('rewrites a bare name pasted in code', async () => {
    expect(await pasteAt('1 + ', 4, 'Due Date', ['Due Date'])).toBe('1 + prop("Due Date")');
    expect(tokenRefs()).toEqual(['Due Date']);
  });

  it.each([
    ['after typing prop("', 'prop("', 6, 'Due Date', ['Due Date'], 'prop("Due Date'],
    [
      'between the quotes of a string',
      'if(prop("Status") == "", 1, 0)',
      22,
      'Done',
      ['Status', 'Done'],
      'if(prop("Status") == "Done", 1, 0)',
    ],
    ['inside an open comment', '1 /* ', 5, 'Impact', ['Impact'], '1 /* Impact'],
    ['of a curly prop() call inside an open string', '"say ', 5, 'prop(“x”)', ['x'], '"say prop(“x”)'],
    ['on the second line of a string', '"a\n', 3, 'Impact', ['Impact'], '"a\nImpact'],
  ])('leaves a paste %s as it is', async (_, initial, caret, text, names, expected) => {
    expect(await pasteAt(initial, caret, text, names)).toBe(expected);
  });

  it.each([
    ['after a backslash that escapes the pasted quote', 'concat("a\\', 10, '" + Price', 'concat("a\\" + Price'],
    ['after a "/" the pasted "*" makes a comment', '1 /', 3, '* Price */', '1 /* Price */'],
    ['onto the end of a word', 'x', 1, 'Price', 'xPrice'],
    ['after a dot', 'current.', 8, 'Price', 'current.Price'],
  ])('reads a paste %s with the characters before it', async (_, initial, caret, text, expected) => {
    expect(await pasteAt(initial, caret, text, ['Price'])).toBe(expected);
    expect(tokenRefs()).toEqual([]);
  });

  it('reads what follows as code once the paste closes the string', async () => {
    expect(await pasteAt('concat("', 8, 'USD", Price)', ['Price'])).toBe('concat("USD", prop("Price"))');
    expect(tokenRefs()).toEqual(['Price']);
  });

  it.each([
    ['the let() around the paste', 'let(Impact, 2, )', 15, 'Impact * 2', 'let(Impact, 2, Impact * 2)'],
    ['the lets() around the paste', 'lets(x, 1, Impact, 2, )', 22, 'x + Impact', 'lets(x, 1, Impact, 2, x + Impact)'],
    ['a let() the paste completes', 'let(', 4, 'Impact, 2, Impact * 2)', 'let(Impact, 2, Impact * 2)'],
  ])('keeps a variable bound by %s bare', async (_, initial, caret, text, expected) => {
    expect(await pasteAt(initial, caret, text, ['Impact'])).toBe(expected);
    expect(tokenRefs()).toEqual([]);
  });

  it('keeps the explicit call when pasting a copy back over the formula', async () => {
    const handle = createRef<FormulaSourceInputHandle>();

    render(<Host initial={'prop("Price") * 2'} schema={schemaOf(['Price', 'prop("Price")'])} handle={handle} />);
    await flushFormulaEditor();
    expect(tokenRefs()).toEqual(['Price']);
    let copied = '';

    fireEvent.keyDown(formulaInput(), { key: 'a', ctrlKey: true });
    fireEvent.copy(formulaInput(), {
      clipboardData: {
        types: [],
        setData: (type: string, text: string) => {
          if (type === 'text/plain') copied = text;
        },
        getData: () => '',
      },
    });
    expect(copied).toBe('prop("Price") * 2');
    fireEvent.keyDown(formulaInput(), { key: 'a', ctrlKey: true });
    pasteText(copied);
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("Price") * 2');
    expect(tokenRefs()).toEqual(['Price']);
  });
});
