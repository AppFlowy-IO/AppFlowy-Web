import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';

import {
  flushFormulaEditor,
  formulaInput,
  formulaSource,
  setFormulaSource,
} from '@/application/database-yjs/__tests__/formula-editor-input';
import { FormulaCell as FormulaCellType } from '@/application/database-yjs/cell.type';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { parseFormulaTypeOption } from '@/application/database-yjs/fields/formula/parse';
import {
  YDatabase,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { FormulaCell } from '@/components/database/components/cell/formula';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';

import type { ReactNode } from 'react';

const SAVED = 'prop("price") * 2';

function fixture() {
  const fields = createFields([
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'double', name: 'Double', type: FieldType.Formula, typeOption: { expression: SAVED } },
  ]).clone() as YDatabaseFields;
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;

  view.set(YjsDatabaseKey.id, 'view');
  view.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: 'row', height: 44 }]));
  views.set('view', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  view.set(YjsDatabaseKey.field_orders, Y.Array.from(Array.from(fields.keys(), (id) => ({ id }))));
  const { doc: rowDoc } = createRow('row', { price: { type: FieldType.Number, data: '4' } });
  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    readOnly: false,
    workspaceId: 'workspace',
    rowMap: { row: rowDoc },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { fields, wrapper, savedFormula: () => parseFormulaTypeOption(fields.get('double')).formula };
}

const cell: FormulaCellType = {
  createdAt: 0,
  lastModified: 0,
  fieldType: FieldType.Formula,
  data: '8',
  resultType: 'number',
  rawNumeric: 8,
};

/** A host cell like the grid's: positioned, and it owns the editing state. */
function HostCell({ onEditingChange }: { onEditingChange: (editing: boolean) => void }) {
  const [editing, setEditing] = useState(false);

  return (
    <div data-testid={'host-cell'} style={{ position: 'relative' }} onClick={() => setEditing(true)}>
      <FormulaCell
        cell={cell}
        rowId={'row'}
        fieldId={'double'}
        wrap={false}
        editing={editing}
        setEditing={(next) => {
          onEditingChange(next);
          setEditing(next);
        }}
      />
    </div>
  );
}

async function openFromCell() {
  const f = fixture();
  const onEditingChange = jest.fn();

  render(<HostCell onEditingChange={onEditingChange} />, { wrapper: f.wrapper });
  fireEvent.click(screen.getByTestId('formula-cell-row-double'));
  const editor = await screen.findByTestId('formula-editor-dialog');

  await flushFormulaEditor();
  // Radix starts listening for outside pointer events a tick after opening.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { ...f, editor, onEditingChange };
}

const editorClosed = () => waitFor(() => expect(screen.queryByTestId('formula-editor-dialog')).toBeNull());

describe('formula editor opened from a cell', () => {
  it('is a popover anchored to the cell, not a dialog', async () => {
    const { editor } = await openFromCell();

    expect(editor.getAttribute('data-slot')).toBe('popover-content');
    expect(editor.getAttribute('data-side')).toBe('bottom');
    expect(editor.getAttribute('data-align')).toBe('start');
    expect(editor.getAttribute('role')).toBe('dialog');
    expect(editor.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading').id);
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    // The anchor fills the host cell, so the popover is placed from the cell's box.
    expect(screen.getByTestId('host-cell').contains(screen.getByTestId('formula-editor-anchor'))).toBe(true);
    expect(screen.getByTestId('formula-editor-anchor').className).toContain('absolute inset-0');
    // Same editor as the dialog: title, Cancel, Done, close, input and preview for this row.
    expect(screen.getByRole('heading').textContent).toContain('Double');
    expect(screen.getByTestId('formula-editor-cancel')).not.toBeNull();
    expect(screen.getByTestId('formula-editor-done')).not.toBeNull();
    expect(screen.getByTestId('formula-editor-close')).not.toBeNull();
    expect(formulaSource()).toBe('prop("Price") * 2');
    expect(screen.getByTestId('formula-preview-value').textContent).toBe('8');
    expect(document.activeElement).toBe(formulaInput());
  });

  it.each([
    ['the Cancel button', () => fireEvent.click(screen.getByTestId('formula-editor-cancel'))],
    ['the close button', () => fireEvent.click(screen.getByTestId('formula-editor-close'))],
    ['Escape', () => fireEvent.keyDown(formulaInput(), { key: 'Escape' })],
    ['a click outside', () => fireEvent.pointerDown(document.body)],
  ])('closes without saving on %s', async (_method, close) => {
    const { onEditingChange, savedFormula } = await openFromCell();

    await setFormulaSource('prop("Price") * 100');
    expect(formulaSource()).toBe('prop("Price") * 100');
    close();
    await editorClosed();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(savedFormula()).toBe(SAVED);
  });

  it('lets the first Escape close only the autocomplete', async () => {
    const { onEditingChange, savedFormula } = await openFromCell();

    await setFormulaSource('Pri');
    expect(screen.queryByTestId('formula-autocomplete')).not.toBeNull();
    fireEvent.keyDown(formulaInput(), { key: 'Escape' });
    await flushFormulaEditor();
    expect(screen.queryByTestId('formula-autocomplete')).toBeNull();
    expect(screen.queryByTestId('formula-editor-dialog')).not.toBeNull();
    expect(onEditingChange).not.toHaveBeenCalledWith(false);

    fireEvent.keyDown(formulaInput(), { key: 'Escape' });
    await editorClosed();
    expect(savedFormula()).toBe(SAVED);
  });

  it('closes on an Escape pressed outside the formula input, even while suggestions show', async () => {
    const { onEditingChange, savedFormula } = await openFromCell();

    await setFormulaSource('Pri');
    expect(screen.queryByTestId('formula-autocomplete')).not.toBeNull();
    fireEvent.keyDown(screen.getByTestId('formula-catalogue-search'), { key: 'Escape' });
    await editorClosed();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(savedFormula()).toBe(SAVED);
  });

  it('hides the suggestions once focus leaves the formula input', async () => {
    const { onEditingChange, savedFormula } = await openFromCell();

    await setFormulaSource('Pri');
    expect(screen.queryByTestId('formula-autocomplete')).not.toBeNull();
    const search = screen.getByTestId('formula-catalogue-search');

    act(() => search.focus());
    expect(document.activeElement).toBe(search);
    expect(screen.queryByTestId('formula-autocomplete')).toBeNull();
    expect(screen.queryByTestId('formula-editor-dialog')).not.toBeNull();

    // With no suggestions left, the first Escape closes the editor.
    fireEvent.keyDown(search, { key: 'Escape' });
    await editorClosed();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(savedFormula()).toBe(SAVED);
  });

  it('is modal: the page behind it takes no pointer events until it closes', async () => {
    await openFromCell();

    // A click on another cell only closes the editor; it cannot open that cell's editor.
    expect(document.body.style.pointerEvents).toBe('none');
    expect(screen.getByTestId('host-cell').closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('formula-editor-cancel'));
    await editorClosed();
    expect(document.body.style.pointerEvents).toBe('');
    expect(screen.getByTestId('host-cell').closest('[aria-hidden="true"]')).toBeNull();
  });

  it.each([
    ['the Done button', () => fireEvent.click(screen.getByTestId('formula-editor-done'))],
    ['Cmd+Enter', () => fireEvent.keyDown(formulaInput(), { key: 'Enter', metaKey: true })],
    ['Ctrl+Enter', () => fireEvent.keyDown(formulaInput(), { key: 'Enter', ctrlKey: true })],
  ])('saves and closes with %s', async (_method, save) => {
    const { onEditingChange, savedFormula } = await openFromCell();

    await setFormulaSource('prop("Price") * 3');
    save();
    await editorClosed();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(savedFormula()).toBe('prop("price") * 3');
  });

  it('keeps clicks and keys inside the editor from reaching the cell', async () => {
    const f = fixture();
    const onHostClick = jest.fn();
    const onHostKeyDown = jest.fn();

    render(
      <div onClick={onHostClick} onKeyDown={onHostKeyDown}>
        <FormulaCell cell={cell} rowId={'row'} fieldId={'double'} wrap={false} editing setEditing={jest.fn()} />
      </div>,
      { wrapper: f.wrapper }
    );
    await screen.findByTestId('formula-editor-dialog');
    await flushFormulaEditor();
    fireEvent.click(screen.getByTestId('formula-catalogue-search'));
    fireEvent.keyDown(formulaInput(), { key: 'x' });
    expect(onHostClick).not.toHaveBeenCalled();
    expect(onHostKeyDown).not.toHaveBeenCalled();
  });
});

describe('formula editor opened from the property menu', () => {
  it('stays a centered dialog with the same editor', async () => {
    const f = fixture();

    render(<PropertyMenu fieldId={'double'} open onOpenChange={jest.fn()} />, { wrapper: f.wrapper });
    fireEvent.click(await screen.findByTestId('formula-edit-formula'));
    const editor = await screen.findByTestId('formula-editor-dialog');

    await flushFormulaEditor();
    expect(editor.getAttribute('data-slot')).toBe('dialog-content');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(editor.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { name: /Double/ }).id);
    expect(formulaSource()).toBe('prop("Price") * 2');
    await setFormulaSource('prop("Price") * 100');
    fireEvent.click(screen.getByTestId('formula-editor-close'));
    await editorClosed();
    expect(f.savedFormula()).toBe(SAVED);
  });
});
