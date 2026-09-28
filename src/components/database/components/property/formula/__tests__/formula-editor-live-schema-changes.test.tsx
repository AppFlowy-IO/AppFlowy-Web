/**
 * @jest-environment-options {"userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}
 */
// Chrome UA: slate-react commits IME text on compositionend only in Chrome
// (jsdom's default UA is treated as Safari, which never reaches that path).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor, Transforms } from 'slate';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
  setFormulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FieldType } from '@/application/database-yjs/database.type';
import { FieldSpec } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { offsetToPoint, selectionOffsets } from '@/components/database/components/property/formula/formula-slate';
import { FormulaEditorPanel } from '@/components/database/components/property/formula/FormulaEditorPanel';

import {
  clickDone,
  doneDisabled,
  formulaEditorFixture,
  FormulaEditorFixture,
  tokenRefs,
  typeAtCaret,
  undo,
} from './formula-editor-fixture';

/**
 * A collaborator's property changes reach the open formula editor without
 * disturbing what the user is doing: the caret, an IME composition and the
 * highlighted autocomplete suggestion stay where they were.
 */

// Pass-through spy on the Slate editor the input builds, to place its caret.
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

async function openEditor(f: FormulaEditorFixture) {
  mockEditors.length = 0;
  render(
    <FormulaEditorPanel fieldId={'formula'} rowId={'row'} onClose={jest.fn()} onAutocompleteOpenChange={jest.fn()} />,
    { wrapper: f.wrapper }
  );
  await flushFormulaEditor();
}

async function placeCaret(offset: number) {
  act(() => {
    Transforms.select(editor(), offsetToPoint(editor(), offset));
  });
  await flushFormulaEditor();
  expect(selectionOffsets(editor())).toEqual({ start: offset, end: offset });
}

const caretAt = (offset: number) => ({ start: offset, end: offset });

describe('a rename of a referenced property keeps the caret where the user is typing', () => {
  it('keeps typing between two keystrokes in place, so Done saves the formula typed', async () => {
    const f = formulaEditorFixture(
      [
        { id: 'price', name: 'Price', type: FieldType.Number },
        { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'prop("price") * 2 + 3' } },
      ],
      { price: { type: FieldType.Number, data: '4' } }
    );

    await openEditor(f);
    expect(formulaSource()).toBe('prop("Price") * 2 + 3');
    // Change the multiplier to 250: caret after "2", type "5" then "0".
    await placeCaret('prop("Price") * 2'.length);
    await typeAtCaret('5');
    expect(formulaSource()).toBe('prop("Price") * 25 + 3');

    f.rename('price', 'Cost');
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("Cost") * 25 + 3');
    expect(selectionOffsets(editor())).toEqual(caretAt('prop("Cost") * 25'.length));

    await typeAtCaret('0');
    expect(formulaSource()).toBe('prop("Cost") * 250 + 3');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price") * 250 + 3');
  });

  describe('during an IME composition', () => {
    const specs: FieldSpec[] = [
      { id: 'notes', name: 'Notes', type: FieldType.RichText },
      { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'concat(prop("notes"), "")' } },
    ];
    const cells = { notes: { type: FieldType.RichText, data: 'alpha' } };
    // The caret between the empty string's quotes.
    const insideQuotes = (name: string) => `concat(prop("${name}"), "`.length;

    async function compose(partial: string) {
      fireEvent.compositionStart(formulaInput(), { data: '' });
      fireEvent.compositionUpdate(formulaInput(), { data: partial });
      await flushFormulaEditor();
    }

    async function commit(text: string) {
      fireEvent.compositionEnd(formulaInput(), { data: text });
      await flushFormulaEditor();
      // slate-react clears its composing flag a microtask later.
      await flushFormulaEditor();
    }

    it('commits the composed text at the caret', async () => {
      const f = formulaEditorFixture(specs, cells);

      await openEditor(f);
      expect(formulaSource()).toBe('concat(prop("Notes"), "")');
      await placeCaret(insideQuotes('Notes'));
      await compose('ni');
      await commit('你好');
      expect(formulaSource()).toBe('concat(prop("Notes"), "你好")');
    });

    it('commits the composed text where it was composed when a collaborator renames the property meanwhile', async () => {
      const f = formulaEditorFixture(specs, cells);

      await openEditor(f);
      await placeCaret(insideQuotes('Notes'));
      await compose('ni');
      f.rename('notes', 'Memo');
      await flushFormulaEditor();
      expect(selectionOffsets(editor())).toEqual(caretAt(insideQuotes('Memo')));

      await commit('你好');
      expect(formulaSource()).toBe('concat(prop("Memo"), "你好")');
      expect(doneDisabled()).toBe(false);
      clickDone();
      expect(f.saved('formula')).toBe('concat(prop("notes"), "你好")');
    });
  });
});

describe('a token copied before a collaborator renames or deletes its property', () => {
  // The formula reads Price; Other is the property that takes Price's name.
  const specs: FieldSpec[] = [
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'other', name: 'Other', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'prop("price") * 2' } },
  ];

  type Clipboard = Map<string, string>;

  /** Copies the source range `[start, end)`, returning every type the copy wrote. */
  async function copy(start: number, end: number): Promise<Clipboard> {
    const clipboard: Clipboard = new Map();

    act(() => {
      Transforms.select(editor(), { anchor: offsetToPoint(editor(), start), focus: offsetToPoint(editor(), end) });
    });
    await flushFormulaEditor();
    fireEvent.copy(formulaInput(), {
      clipboardData: {
        types: [],
        setData: (type: string, text: string) => clipboard.set(type, text),
        getData: (type: string) => clipboard.get(type) ?? '',
      },
    });
    return clipboard;
  }

  async function paste(clipboard: Clipboard) {
    fireEvent.paste(formulaInput(), {
      clipboardData: { types: Array.from(clipboard.keys()), getData: (type: string) => clipboard.get(type) ?? '' },
    });
    await flushFormulaEditor();
  }

  /** Copies the Price token, lets `change` happen, then pastes it at the end after " + ". */
  async function copyPriceThen(f: FormulaEditorFixture, change: () => void) {
    await openEditor(f);
    expect(formulaSource()).toBe('prop("Price") * 2');
    const clipboard = await copy(0, 'prop("Price")'.length);

    expect(clipboard.get('text/plain')).toBe('prop("Price")');
    change();
    await flushFormulaEditor();
    await placeCaret(formulaSource()?.length ?? 0);
    await typeAtCaret(' + ');
    await paste(clipboard);
  }

  it('pastes the renamed property, not the one that took its name', async () => {
    const f = formulaEditorFixture(specs);

    await copyPriceThen(f, () =>
      f.transact(() => {
        f.edit.rename('price', 'Cost');
        f.edit.rename('other', 'Price');
      })
    );
    expect(formulaSource()).toBe('prop("Cost") * 2 + prop("Cost")');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price") * 2 + prop("price")');
  });

  it('pastes the deleted property, not the one that took its name', async () => {
    const f = formulaEditorFixture(specs);

    await copyPriceThen(f, () =>
      f.transact(() => {
        f.edit.remove('price');
        f.edit.rename('other', 'Price');
      })
    );
    // Both stay the missing reference the token showed; neither reads Other.
    expect(formulaSource()).toBe('prop("price") * 2 + prop("price")');
    expect(screen.getAllByTestId('formula-token').map((token) => token.getAttribute('data-missing'))).toEqual([
      'true',
      'true',
    ]);
  });

  it('pastes the property by name when nothing changed', async () => {
    const f = formulaEditorFixture(specs);

    await copyPriceThen(f, () => undefined);
    expect(formulaSource()).toBe('prop("Price") * 2 + prop("Price")');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price") * 2 + prop("price")');
  });
});

describe('the highlighted autocomplete suggestion while a collaborator changes properties', () => {
  const specs: FieldSpec[] = [
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'price2', name: 'Price 2', type: FieldType.Number },
    { id: 'price3', name: 'Price 3', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: '' } },
  ];
  const suggestions = () => screen.getAllByRole('option').map((option) => option.getAttribute('data-testid'));
  const highlighted = () =>
    screen
      .getAllByRole('option')
      .find((option) => option.getAttribute('aria-selected') === 'true')
      ?.getAttribute('data-testid');

  /** Types "Pri" and highlights the second suggestion, Price 2. */
  async function highlightPrice2(f: FormulaEditorFixture) {
    await openEditor(f);
    await setFormulaSource('Pri');
    expect(suggestions()).toEqual([
      'formula-suggestion-Price',
      'formula-suggestion-Price 2',
      'formula-suggestion-Price 3',
    ]);
    fireEvent.keyDown(formulaInput(), { key: 'ArrowDown' });
    await flushFormulaEditor();
    expect(highlighted()).toBe('formula-suggestion-Price 2');
  }

  async function accept() {
    fireEvent.keyDown(formulaInput(), { key: 'Enter' });
    await flushFormulaEditor();
  }

  it('accepts the highlighted property when nothing changes', async () => {
    const f = formulaEditorFixture(specs);

    await highlightPrice2(f);
    await accept();
    expect(formulaSource()).toBe('prop("Price 2")');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price2")');
  });

  it.each<[string, (f: FormulaEditorFixture) => void]>([
    ['renamed so it no longer matches', (f) => f.rename('price', 'Cost')],
    ['deleted', (f) => f.remove('price')],
  ])('keeps the highlight on its property when an earlier suggestion is %s', async (_label, change) => {
    const f = formulaEditorFixture(specs);

    await highlightPrice2(f);
    change(f);
    await flushFormulaEditor();
    expect(highlighted()).toBe('formula-suggestion-Price 2');

    await accept();
    expect(formulaSource()).toBe('prop("Price 2")');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price2")');
  });

  it('keeps the highlight on a property renamed to a name that still matches', async () => {
    const f = formulaEditorFixture(specs);

    await highlightPrice2(f);
    f.rename('price2', 'Price two');
    await flushFormulaEditor();
    expect(highlighted()).toBe('formula-suggestion-Price two');
    await accept();
    expect(formulaSource()).toBe('prop("Price two")');
  });

  it('highlights the first suggestion when the highlighted property stops matching', async () => {
    const f = formulaEditorFixture(specs);

    await highlightPrice2(f);
    f.rename('price2', 'Cost');
    await flushFormulaEditor();
    expect(suggestions()).toEqual(['formula-suggestion-Price', 'formula-suggestion-Price 3']);
    expect(highlighted()).toBe('formula-suggestion-Price');
  });

  it('starts from the first suggestion for a new word', async () => {
    const f = formulaEditorFixture(specs);

    await highlightPrice2(f);
    await typeAtCaret('c');
    expect(highlighted()).toBe('formula-suggestion-Price');
  });
});

describe('a token after a string or comment the user has not closed yet', () => {
  // The formula reads Price; Other is the property that takes Price's name.
  const specs: FieldSpec[] = [
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'other', name: 'Other', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'concat(prop("price"))' } },
  ];
  const renamePriceGivingItsName = (f: FormulaEditorFixture) =>
    f.transact(() => {
      f.edit.rename('price', 'Cost');
      f.edit.rename('other', 'Price');
    });
  const deletePriceGivingItsName = (f: FormulaEditorFixture) =>
    f.transact(() => {
      f.edit.remove('price');
      f.edit.rename('other', 'Price');
    });
  // What the user types before the token, then types to close it again.
  const literals: Array<[string, string, string]> = [
    ['string', '"USD', '", '],
    ['comment', '/* USD', ' */ '],
  ];

  /** Opens a literal right before the Price token, so the formula text now reads the token as part of it. */
  async function openLiteralBeforeToken(f: FormulaEditorFixture, opener: string) {
    await openEditor(f);
    expect(formulaSource()).toBe('concat(prop("Price"))');
    await placeCaret('concat('.length);
    await typeAtCaret(opener);
    expect(formulaSource()).toBe(`concat(${opener}prop("Price"))`);
    expect(tokenRefs()).toEqual(['Price']);
  }

  it.each(literals)(
    'keeps the token on the renamed property while a %s is open, so closing it saves that property',
    async (_label, opener, closer) => {
      const f = formulaEditorFixture(specs);

      await openLiteralBeforeToken(f, opener);
      renamePriceGivingItsName(f);
      await flushFormulaEditor();
      // The token and the draft both follow Price to its new name.
      expect(tokenRefs()).toEqual(['Cost']);
      expect(formulaSource()).toBe(`concat(${opener}prop("Cost"))`);
      expect(selectionOffsets(editor())).toEqual(caretAt(`concat(${opener}`.length));

      await typeAtCaret(closer);
      expect(formulaSource()).toBe(`concat(${opener}${closer}prop("Cost"))`);
      expect(tokenRefs()).toEqual(['Cost']);
      clickDone();
      expect(f.saved('formula')).toBe(`concat(${opener}${closer}prop("price"))`);
    }
  );

  it.each(literals)(
    'keeps the token on the deleted property while a %s is open, so closing it does not read the namesake',
    async (_label, opener, closer) => {
      const f = formulaEditorFixture(specs);

      await openLiteralBeforeToken(f, opener);
      deletePriceGivingItsName(f);
      await flushFormulaEditor();
      expect(tokenRefs()).toEqual(['price']);
      expect(formulaSource()).toBe(`concat(${opener}prop("price"))`);

      await typeAtCaret(closer);
      expect(formulaSource()).toBe(`concat(${opener}${closer}prop("price"))`);
      expect(screen.getByTestId('formula-token').getAttribute('data-missing')).toBe('true');
      expect(doneDisabled()).toBe(true);
      clickDone();
      expect(f.saved('formula')).toBe('concat(prop("price"))');
    }
  );

  it('keeps the undo history, which restores the token under the new name', async () => {
    const f = formulaEditorFixture(specs);

    await openLiteralBeforeToken(f, '"USD');
    renamePriceGivingItsName(f);
    await flushFormulaEditor();

    await undo();
    expect(formulaSource()).toBe('concat(prop("Cost"))');
    expect(tokenRefs()).toEqual(['Cost']);
    clickDone();
    expect(f.saved('formula')).toBe('concat(prop("price"))');
  });

  it('does not reopen suggestions the user dismissed', async () => {
    const f = formulaEditorFixture(specs);

    await openLiteralBeforeToken(f, '/* abs');
    expect(screen.getByTestId('formula-autocomplete')).toBeTruthy();
    fireEvent.keyDown(formulaInput(), { key: 'Escape' });
    await flushFormulaEditor();
    expect(screen.queryByTestId('formula-autocomplete')).toBeNull();

    renamePriceGivingItsName(f);
    await flushFormulaEditor();
    expect(formulaSource()).toBe('concat(/* absprop("Cost"))');
    expect(screen.queryByTestId('formula-autocomplete')).toBeNull();
  });
});

describe('a prop() call split over lines when a collaborator renames its property', () => {
  // Ids differ from names, so a stale name cannot pass for an id. Other takes
  // Price's name in the same update that renames Price.
  const specs = (expression: string): FieldSpec[] => [
    { id: 'fp', name: 'Price', type: FieldType.Number },
    { id: 'fo', name: 'Other', type: FieldType.Number },
    { id: 'fq', name: 'Qty', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression } },
  ];

  it('follows the renamed property when a token is renamed in the same update', async () => {
    const f = formulaEditorFixture(specs('prop(\n"fp") + prop("fq")'));

    await openEditor(f);
    expect(formulaSource()).toBe('prop(\n"Price") + prop("Qty")');
    // The split call is text; only the one-line call is a token.
    expect(tokenRefs()).toEqual(['Qty']);

    f.transact(() => {
      f.edit.rename('fp', 'Cost');
      f.edit.rename('fo', 'Price');
      f.edit.rename('fq', 'Q2');
    });
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop(\n"Cost") + prop("Q2")');
    expect(tokenRefs()).toEqual(['Q2']);
    clickDone();
    expect(f.saved('formula')).toBe('prop(\n"fp") + prop("fq")');
  });

  it('follows the renamed property while a token after an unclosed string is renamed too', async () => {
    const f = formulaEditorFixture(specs('prop(\n"fp") + concat(prop("fq"))'));

    await openEditor(f);
    expect(formulaSource()).toBe('prop(\n"Price") + concat(prop("Qty"))');
    await placeCaret('prop(\n"Price") + concat('.length);
    await typeAtCaret('"USD');
    expect(formulaSource()).toBe('prop(\n"Price") + concat("USDprop("Qty"))');

    // Other takes Qty's name as well, so the token after the string must not read it.
    f.transact(() => {
      f.edit.rename('fp', 'Cost');
      f.edit.rename('fq', 'Q2');
      f.edit.rename('fo', 'Qty');
    });
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop(\n"Cost") + concat("USDprop("Q2"))');
    expect(selectionOffsets(editor())).toEqual(caretAt('prop(\n"Cost") + concat("USD'.length));

    await typeAtCaret('", ');
    expect(formulaSource()).toBe('prop(\n"Cost") + concat("USD", prop("Q2"))');
    expect(tokenRefs()).toEqual(['Q2']);
    clickDone();
    expect(f.saved('formula')).toBe('prop(\n"fp") + concat("USD", prop("fq"))');
  });
});

describe('the docs for a property a collaborator renames or deletes', () => {
  const specs: FieldSpec[] = [
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'quantity', name: 'Quantity', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: '' } },
  ];
  const docsTitle = () => screen.getByTestId('formula-docs').firstElementChild?.textContent;
  const docsExamples = () =>
    Array.from(screen.getByTestId('formula-docs').querySelectorAll('[data-expression]'), (example) =>
      example.getAttribute('data-expression')
    );

  async function showQuantityDocs(f: FormulaEditorFixture) {
    await openEditor(f);
    fireEvent.mouseEnter(screen.getByTestId('formula-catalogue-property-quantity'));
    await flushFormulaEditor();
    expect(docsTitle()).toBe('Quantity');
    expect(docsExamples()).toEqual(['prop("Quantity")', 'prop("Quantity") * 2']);
  }

  it('shows the property under its new name', async () => {
    const f = formulaEditorFixture(specs);

    await showQuantityDocs(f);
    f.rename('quantity', 'Amount');
    await flushFormulaEditor();
    expect(docsTitle()).toBe('Amount');
    expect(docsExamples()).toEqual(['prop("Amount")', 'prop("Amount") * 2']);
  });

  it('stops documenting a deleted property', async () => {
    const f = formulaEditorFixture(specs);

    await showQuantityDocs(f);
    f.remove('quantity');
    await flushFormulaEditor();
    // Back to the first property in the catalogue.
    expect(docsTitle()).toBe('Price');
    expect(docsExamples()).toEqual(['prop("Price")', 'prop("Price") * 2']);
  });
});
