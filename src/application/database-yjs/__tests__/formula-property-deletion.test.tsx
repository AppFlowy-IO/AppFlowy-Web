import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { useDeletePropertyDispatch } from '@/application/database-yjs/dispatch';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { compileFormula } from '@/application/database-yjs/fields/formula/compile';
import { evaluateFormulaCell } from '@/application/database-yjs/fields/formula/evaluate';
import { parseFormulaTypeOption } from '@/application/database-yjs/fields/formula/parse';
import { readFormulaSchema } from '@/application/database-yjs/fields/formula/schema';
import { useDatabaseHistory } from '@/application/database-yjs/history';
import { useCellSelector } from '@/application/database-yjs/selector';
import {
  YDatabase,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { DeletePropertyConfirm } from '@/components/database/components/property/DeletePropertyConfirm';
import { FormulaEditorDialog } from '@/components/database/components/property/formula/FormulaEditorDialog';

import type { ReactNode } from 'react';

function fixture() {
  const fields = createFields([
    { id: 'price', name: 'Price', type: FieldType.Number },
    { id: 'other-price', name: 'Price', type: FieldType.Number },
    { id: 'quantity', name: 'Quantity', type: FieldType.Number },
    {
      id: 'total',
      name: 'Total',
      type: FieldType.Formula,
      typeOption: { expression: 'prop("price") * prop("quantity")' },
    },
    {
      id: 'summary',
      name: 'Summary',
      type: FieldType.Formula,
      typeOption: { expression: 'format(prop("total"))' },
    },
    { id: 'unrelated', name: 'Unrelated', type: FieldType.Formula, typeOption: { expression: '42' } },
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
  const { doc: rowDoc, row } = createRow('row', {
    price: { type: FieldType.Number, data: '2' },
    'other-price': { type: FieldType.Number, data: '99' },
    quantity: { type: FieldType.Number, data: '3' },
  });
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

  return { fields, row, view, databaseDoc, wrapper };
}

describe('deleting formula dependencies', () => {
  it.each(['price', 'total'])(
    'preserves references and refreshes cells through deleting, undoing and redoing %s',
    (fieldId) => {
      const f = fixture();
      const summarySource = parseFormulaTypeOption(f.fields.get('summary')).formula;
      const totalSource = parseFormulaTypeOption(f.fields.get('total')).formula;
      const { result } = renderHook(
        () => ({
          total: useCellSelector({ rowId: 'row', fieldId: 'total' }),
          summary: useCellSelector({ rowId: 'row', fieldId: 'summary' }),
          unrelated: useCellSelector({ rowId: 'row', fieldId: 'unrelated' }),
          deleteProperty: useDeletePropertyDispatch(),
          history: useDatabaseHistory(),
        }),
        { wrapper: f.wrapper }
      );

      expect(result.current.total).toMatchObject({ data: '6', rawNumeric: 6 });
      expect(result.current.summary?.data).toBe('6');
      act(() => result.current.deleteProperty(fieldId));
      expect(f.fields.has(fieldId)).toBe(false);
      expect(result.current.summary).toMatchObject({ data: '', missingPropertyRef: fieldId });
      expect(result.current.unrelated?.data).toBe('42');
      expect(parseFormulaTypeOption(f.fields.get('summary')).formula).toBe(summarySource);
      if (fieldId === 'price') {
        expect(result.current.total).toMatchObject({ data: '', missingPropertyRef: 'price' });
        expect(parseFormulaTypeOption(f.fields.get('total')).formula).toBe(totalSource);
      }

      act(() => result.current.history.undo());
      expect(f.fields.has(fieldId)).toBe(true);
      expect(
        f.view
          .get(YjsDatabaseKey.field_orders)
          .toArray()
          .map(({ id }) => id)
      ).toContain(fieldId);
      expect(result.current.total).toMatchObject({ data: '6', rawNumeric: 6 });
      expect(result.current.summary).toMatchObject({ data: '6', error: undefined, missingPropertyRef: undefined });
      expect(parseFormulaTypeOption(f.fields.get('total')).formula).toBe(totalSource);
      expect(f.row.get(YjsDatabaseKey.cells).get('price').get(YjsDatabaseKey.data)).toBe('2');

      act(() => result.current.history.redo());
      expect(f.fields.has(fieldId)).toBe(false);
      expect(result.current.summary).toMatchObject({ data: '', missingPropertyRef: fieldId });
    }
  );

  it('keeps the missing ID after syncing the deletion, even when another property has the same name', () => {
    const f = fixture();
    const { result } = renderHook(useDeletePropertyDispatch, { wrapper: f.wrapper });

    act(() => result.current('price'));
    const copy = new Y.Doc();

    Y.applyUpdate(copy, Y.encodeStateAsUpdate(f.databaseDoc));
    const database = copy.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const fields = database.get(YjsDatabaseKey.fields);
    const field = fields.get('total');

    expect(parseFormulaTypeOption(field).formula).toBe('prop("price") * prop("quantity")');
    expect(
      evaluateFormulaCell({ field, fieldId: 'total', schema: readFormulaSchema(fields), row: f.row, rowId: 'row' })
    ).toMatchObject({ text: '', missingPropertyRef: 'price' });
  });

  it('warns about direct and indirect formulas, allows cancel, and deletes only after confirmation', () => {
    const f = fixture();
    const onClose = jest.fn();

    const { rerender } = render(<DeletePropertyConfirm fieldId={'price'} open onClose={onClose} />, {
      wrapper: f.wrapper,
    });
    const warning = screen.getByTestId('formula-deletion-warning');

    expect(
      within(warning)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Total', 'Summary']);
    expect(f.fields.has('price')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(f.fields.has('price')).toBe(true);
    rerender(<DeletePropertyConfirm fieldId={'price'} open={false} onClose={onClose} />);
    expect(screen.queryByTestId('formula-deletion-warning')).toBeNull();
    rerender(<DeletePropertyConfirm fieldId={'price'} open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'button.delete', exact: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(f.fields.has('price')).toBe(false);
    expect(parseFormulaTypeOption(f.fields.get('total')).formula).toBe('prop("price") * prop("quantity")');
  });

  it('updates the warning when dependencies change while the confirmation is open', () => {
    const f = fixture();

    render(<DeletePropertyConfirm fieldId={'price'} open onClose={jest.fn()} />, { wrapper: f.wrapper });
    expect(screen.queryByTestId('formula-deletion-warning')).not.toBeNull();
    act(() => {
      f.fields.get('summary').set(YjsDatabaseKey.name, 'Renamed summary');
    });
    expect(within(screen.getByTestId('formula-deletion-warning')).getByText('Renamed summary')).not.toBeNull();
    act(() => {
      f.fields
        .get('total')
        .get(YjsDatabaseKey.type_option)
        .get(String(FieldType.Formula))
        .set(YjsDatabaseKey.expression, 'prop("other-price")');
    });
    expect(screen.queryByTestId('formula-deletion-warning')).toBeNull();
  });

  it('keeps the broken expression in the editor and saves an explicitly selected replacement', () => {
    const f = fixture();
    const deletion = renderHook(useDeletePropertyDispatch, { wrapper: f.wrapper });

    act(() => deletion.result.current('price'));
    const onOpenChange = jest.fn();

    render(<FormulaEditorDialog fieldId={'total'} rowId={'row'} open onOpenChange={onOpenChange} />, {
      wrapper: f.wrapper,
    });
    const input = screen.getByTestId<HTMLTextAreaElement>('formula-editor-input');

    expect(input.value).toBe('prop("price") * prop("Quantity")');
    expect(screen.getByTestId('formula-editor-error').textContent).toContain(
      'A property used by this formula is missing.'
    );
    expect(screen.getByTestId<HTMLButtonElement>('formula-editor-done').disabled).toBe(true);
    expect(parseFormulaTypeOption(f.fields.get('total')).formula).toBe('prop("price") * prop("quantity")');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('formula-catalogue-property-other-price'));
    expect(screen.getByTestId('formula-preview-value').textContent).toBe('99');
    fireEvent.click(screen.getByTestId('formula-editor-done'));
    expect(parseFormulaTypeOption(f.fields.get('total')).formula).toBe('prop("other-price")');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports a missing relation reached through a rollup as a missing-property error', () => {
    const fields = createFields([
      { id: 'relation', name: 'Related', type: FieldType.Relation },
      {
        id: 'rollup',
        name: 'Rollup',
        type: FieldType.Rollup,
        typeOption: { relation_field_id: 'relation', target_field_id: 'amount', calculation_type: CalculationType.Sum },
      },
      { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: 'prop("rollup") * 2' } },
    ]);

    expect(compileFormula('prop("total")', readFormulaSchema(fields)).error).toBeUndefined();
    fields.delete('relation');
    expect(compileFormula('prop("total")', readFormulaSchema(fields)).error?.missingPropertyRef).toBe('relation');
  });
});
