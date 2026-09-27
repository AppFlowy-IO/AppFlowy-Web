import { fireEvent, render, screen } from '@testing-library/react';
import { Editor, Node, Text } from 'slate';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
  setFormulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FieldType } from '@/application/database-yjs/database.type';
import { FieldSpec } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { editorSource, selectionOffsets } from '@/components/database/components/property/formula/formula-slate';
import { FormulaEditorPanel } from '@/components/database/components/property/formula/FormulaEditorPanel';

import {
  clickDone,
  doneDisabled,
  formulaEditorFixture,
  FormulaEditorFixture,
  preview,
  redo,
  tokenRefs,
  typeAtCaret,
  undo,
} from './formula-editor-fixture';

/**
 * Undo and redo in the formula editor while a collaborator renames, deletes or
 * reuses the names of the properties the formula reads. History restores the
 * property an edit referenced (by id), named as it is now; a deleted property
 * stays a missing reference even when another property takes its name.
 */

// Pass-through spy on the Slate editor the input builds, to read its selection
// and history. Behaviour is unchanged.
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

function openEditor(f: FormulaEditorFixture, fieldId: string) {
  mockEditors.length = 0;
  return render(
    <FormulaEditorPanel fieldId={fieldId} rowId={'row'} onClose={jest.fn()} onAutocompleteOpenChange={jest.fn()} />,
    { wrapper: f.wrapper }
  );
}

/** Both selection points exist and their offsets fit their text nodes. */
function expectValidSelection() {
  const { selection } = editor();

  expect(selection).not.toBeNull();
  for (const point of selection ? [selection.anchor, selection.focus] : []) {
    expect(Node.has(editor(), point.path)).toBe(true);
    const node = Node.get(editor(), point.path);

    expect(Text.isText(node) && point.offset >= 0 && point.offset <= node.text.length).toBe(true);
  }
}

/** The draft the panel holds (and saves) is what the editor shows. */
function expectDraftFollowsEditor() {
  expect(formulaSource()).toBe(editorSource(editor()));
}

const KEY_CODES: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39 };

async function press(key: string, init: Record<string, unknown> = {}) {
  fireEvent.keyDown(formulaInput(), { key, keyCode: KEY_CODES[key], which: KEY_CODES[key], ...init });
  await flushFormulaEditor();
}

describe('undo that changes only which property a token reads', () => {
  const specs: FieldSpec[] = [
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'prop("price-first") * 2' } },
    // Two properties named Price: both draw the same "Price" chip.
    { id: 'price-first', name: 'Price', type: FieldType.Number },
    { id: 'price-second', name: 'Price', type: FieldType.Number },
    { id: 'other', name: 'Other', type: FieldType.Number },
  ];
  const cells = {
    'price-first': { type: FieldType.Number, data: '2' },
    'price-second': { type: FieldType.Number, data: '42' },
    other: { type: FieldType.Number, data: '5' },
  };

  /** Selects the leading token: caret before " * 2", then Shift+Left over the token. */
  async function selectLeadingToken() {
    const tokenLength = editorSource(editor()).length - ' * 2'.length;

    fireEvent.keyDown(formulaInput(), { key: 'a', ctrlKey: true });
    await press('ArrowRight');
    // One step left per character of " * 2".
    for (const _char of ' * 2') await press('ArrowLeft');
    await press('ArrowLeft', { shiftKey: true });
    expect(selectionOffsets(editor())).toEqual({ start: 0, end: tokenLength });
  }

  it('saves the reference an undo or redo restores behind an identical chip', async () => {
    const f = formulaEditorFixture(specs, cells);

    openEditor(f, 'formula');
    await flushFormulaEditor();
    await selectLeadingToken();
    fireEvent.click(screen.getByTestId('formula-catalogue-property-price-second'));
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("price-second") * 2');
    expect(preview()).toBe('84');

    await undo();
    expectDraftFollowsEditor();
    expect(formulaSource()).toBe('prop("Price") * 2');
    expect(preview()).toBe('4');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price-first") * 2');

    await redo();
    expectDraftFollowsEditor();
    expect(formulaSource()).toBe('prop("price-second") * 2');
    clickDone();
    expect(f.saved('formula')).toBe('prop("price-second") * 2');
  });

  it('saves the reference an undo or redo restores after pasting over a selected token', async () => {
    const f = formulaEditorFixture(specs, cells);

    openEditor(f, 'formula');
    await flushFormulaEditor();
    await selectLeadingToken();
    await typeAtCaret('prop("Other")');
    expect(tokenRefs()).toEqual(['Other']);

    await undo();
    expectDraftFollowsEditor();
    expect(tokenRefs()).toEqual(['Price']);
    clickDone();
    expect(f.saved('formula')).toBe('prop("price-first") * 2');

    await redo();
    expectDraftFollowsEditor();
    expect(tokenRefs()).toEqual(['Other']);
    clickDone();
    expect(f.saved('formula')).toBe('prop("other") * 2');
  });
});

describe('undo and redo after a collaborator renames a referenced property', () => {
  const renameFixture = (priceName: string, saved: string) =>
    formulaEditorFixture(
      [
        { id: 'price', name: priceName, type: FieldType.Number },
        { id: 'double', name: 'Double', type: FieldType.Formula, typeOption: { expression: saved } },
      ],
      { price: { type: FieldType.Number, data: '4' } }
    );

  it.each([
    ['long to short', 'Price with a long name', 'A'],
    ['short to long', 'A', 'A property with a much longer name'],
  ])('%s: keeps the history, with a valid selection, under the new name', async (_label, before, after) => {
    const f = renameFixture(before, 'prop("price") * 2');

    openEditor(f, 'double');
    await flushFormulaEditor();
    expect(formulaSource()).toBe(`prop("${before}") * 2`);
    await typeAtCaret(' + 1');
    await typeAtCaret(' + 10');
    expect(formulaSource()).toBe(`prop("${before}") * 2 + 1 + 10`);

    f.rename('price', after);
    await flushFormulaEditor();
    expect(formulaSource()).toBe(`prop("${after}") * 2 + 1 + 10`);
    expectValidSelection();

    await undo();
    expectValidSelection();
    expect(formulaSource()).toBe(`prop("${after}") * 2`);
    expect(tokenRefs()).toEqual([after]);
    await redo();
    expectValidSelection();
    expect(formulaSource()).toBe(`prop("${after}") * 2 + 1 + 10`);

    // Tab inserts at the caret, then typing continues after it.
    fireEvent.keyDown(formulaInput(), { key: 'Tab', keyCode: 9, which: 9 });
    await flushFormulaEditor();
    expectValidSelection();
    await typeAtCaret(' + 3');
    expectValidSelection();
    expect(formulaSource()).toBe(`prop("${after}") * 2 + 1 + 10   + 3`);
    clickDone();
    expect(f.saved('double')).toBe('prop("price") * 2 + 1 + 10   + 3');
  });

  it('undo restores a removed reference under its new name when the rename left the draft unchanged', async () => {
    const f = renameFixture('Price', 'prop("price") * 2');

    openEditor(f, 'double');
    await flushFormulaEditor();
    // The draft stops referencing Price, so the rename does not change its text.
    await setFormulaSource('2');
    f.rename('price', 'A');
    await flushFormulaEditor();
    expect(formulaSource()).toBe('2');

    await undo();
    expectValidSelection();
    expect(formulaSource()).toBe('prop("A") * 2');
    expect(tokenRefs()).toEqual(['A']);
    expect(document.querySelector('[data-testid="formula-token"][data-missing="true"]')).toBeNull();
    expect(doneDisabled()).toBe(false);
    clickDone();
    expect(f.saved('double')).toBe('prop("price") * 2');
  });

  it('redo restores an undone reference under its new name when the rename left the draft unchanged', async () => {
    const f = renameFixture('Price', '1');

    openEditor(f, 'double');
    await flushFormulaEditor();
    await setFormulaSource('prop("Price") * 3');
    await undo();
    expect(formulaSource()).toBe('1');
    f.rename('price', 'A');
    await flushFormulaEditor();
    expect(formulaSource()).toBe('1');

    await redo();
    expectValidSelection();
    expect(formulaSource()).toBe('prop("A") * 3');
    expect(tokenRefs()).toEqual(['A']);
    expect(doneDisabled()).toBe(false);
    clickDone();
    expect(f.saved('double')).toBe('prop("price") * 3');
  });
});

describe('undo and redo after a rename gives the old name to another property', () => {
  const namesakeFixture = () =>
    formulaEditorFixture(
      [
        { id: 'price', name: 'Price', type: FieldType.Number },
        { id: 'other', name: 'Other', type: FieldType.Number },
        { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: 'prop("price") * 2' } },
        { id: 'answer', name: 'Answer', type: FieldType.Formula, typeOption: { expression: '42' } },
      ],
      { price: { type: FieldType.Number, data: '2' }, other: { type: FieldType.Number, data: '99' } }
    );

  /** Price is renamed to Cost, then Other takes the name Price, as separate updates or as one. */
  const renames: Array<[string, (f: FormulaEditorFixture) => void]> = [
    [
      'separate updates',
      (f) => {
        f.rename('price', 'Cost');
        f.rename('other', 'Price');
      },
    ],
    [
      'one update',
      (f) =>
        f.transact(() => {
          f.edit.rename('price', 'Cost');
          f.edit.rename('other', 'Price');
        }),
    ],
  ];

  it.each(renames)('undo keeps the undone reference on the renamed property (%s)', async (_label, rename) => {
    const f = namesakeFixture();

    openEditor(f, 'total');
    await flushFormulaEditor();
    expect(preview()).toBe('4');
    await setFormulaSource('1');
    rename(f);
    await flushFormulaEditor();
    expect(formulaSource()).toBe('1');

    await undo();
    expect(formulaSource()).toBe('prop("Cost") * 2');
    expect(preview()).toBe('4');
    clickDone();
    expect(f.saved('total')).toBe('prop("price") * 2');
  });

  it.each(renames)('redo keeps the redone reference on the renamed property (%s)', async (_label, rename) => {
    const f = namesakeFixture();

    openEditor(f, 'answer');
    await flushFormulaEditor();
    await setFormulaSource('prop("Price") * 2');
    expect(preview()).toBe('4');
    await undo();
    expect(formulaSource()).toBe('42');
    rename(f);
    await flushFormulaEditor();
    expect(formulaSource()).toBe('42');

    await redo();
    expect(formulaSource()).toBe('prop("Cost") * 2');
    expect(preview()).toBe('4');
    clickDone();
    expect(f.saved('answer')).toBe('prop("price") * 2');
  });

  it('follows the rename in a draft that references the property and keeps its IDs', async () => {
    const f = namesakeFixture();

    openEditor(f, 'total');
    await flushFormulaEditor();
    await setFormulaSource('prop("Price") * 3');
    renames[0][1](f);
    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("Cost") * 3');

    await undo();
    expect(formulaSource()).toBe('prop("Cost") * 2');
    clickDone();
    expect(f.saved('total')).toBe('prop("price") * 2');
  });
});

describe('undo and redo after a referenced property is deleted and another takes its name', () => {
  const SAVED = 'prop("price") * prop("quantity")';
  const deletionFixture = () =>
    formulaEditorFixture(
      [
        { id: 'price', name: 'Price', type: FieldType.Number },
        { id: 'quantity', name: 'Quantity', type: FieldType.Number },
        { id: 'other', name: 'Other', type: FieldType.Number },
        { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: SAVED } },
      ],
      {
        price: { type: FieldType.Number, data: '2' },
        quantity: { type: FieldType.Number, data: '3' },
        other: { type: FieldType.Number, data: '99' },
        'new-price': { type: FieldType.Number, data: '77' },
      }
    );

  /** The ways a collaborator's edits can reach the open editor. */
  const scenarios: Array<[string, (f: FormulaEditorFixture) => void]> = [
    [
      'delete and rename another to Price in one update',
      (f) =>
        f.transact(() => {
          f.edit.remove('price');
          f.edit.rename('other', 'Price');
        }),
    ],
    [
      'delete, then rename another to Price',
      (f) => {
        f.remove('price');
        f.rename('other', 'Price');
      },
    ],
    [
      'delete and create a new Price in one update',
      (f) =>
        f.transact(() => {
          f.edit.remove('price');
          f.edit.add('new-price', 'Price');
        }),
    ],
    [
      'delete, create a new property, then rename it to Price',
      (f) => {
        f.remove('price');
        f.add('new-price', 'Number');
        f.rename('new-price', 'Price');
      },
    ],
  ];

  /** The deleted property shows by its id, as missing, not bound to the new namesake. */
  function expectMissingReference(source = 'prop("price") * prop("Quantity")') {
    expect(formulaSource()).toBe(source);
    const token = screen.getAllByTestId('formula-token').find((element) => element.getAttribute('data-ref') === 'price');

    expect(token?.getAttribute('data-missing')).toBe('true');
    expect(screen.getByTestId('formula-editor-error').textContent).toContain(
      'A property used by this formula is missing.'
    );
    // No preview from the namesake (99 * 3 or 77 * 3).
    expect(preview()).toBe('');
    expect(doneDisabled()).toBe(true);
  }

  it.each(scenarios)('%s: the open draft keeps reporting the deleted reference, also after reopening', async (_label, run) => {
    const f = deletionFixture();
    const view = openEditor(f, 'total');

    await flushFormulaEditor();
    expect(formulaSource()).toBe('prop("Price") * prop("Quantity")');
    expect(preview()).toBe('6');
    run(f);
    await flushFormulaEditor();
    expectMissingReference();
    clickDone();
    expect(f.saved('total')).toBe(SAVED);

    view.unmount();
    openEditor(f, 'total');
    await flushFormulaEditor();
    expectMissingReference();
    expect(f.saved('total')).toBe(SAVED);
  });

  it.each(scenarios)('%s: an edited draft keeps the deleted id, before and after undo', async (_label, run) => {
    const f = deletionFixture();

    openEditor(f, 'total');
    await flushFormulaEditor();
    await setFormulaSource('prop("Price") * prop("Quantity") + 1');
    expect(preview()).toBe('7');
    run(f);
    await flushFormulaEditor();
    expectMissingReference('prop("price") * prop("Quantity") + 1');

    await undo();
    expectMissingReference();
    clickDone();
    expect(f.saved('total')).toBe(SAVED);
  });

  it.each(scenarios)(
    '%s: undoing back to a draft that read the deleted property does not bind the namesake',
    async (_label, run) => {
      const f = deletionFixture();

      openEditor(f, 'total');
      await flushFormulaEditor();
      // The draft stops referencing Price, so the deletion does not change its text.
      await setFormulaSource('prop("Quantity")');
      expect(preview()).toBe('3');
      run(f);
      await flushFormulaEditor();
      expect(formulaSource()).toBe('prop("Quantity")');

      await undo();
      expectMissingReference();
      clickDone();
      expect(f.saved('total')).toBe(SAVED);
    }
  );
});
