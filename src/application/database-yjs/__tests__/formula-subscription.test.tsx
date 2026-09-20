import { act, renderHook } from '@testing-library/react';
import { type ReactNode, useLayoutEffect } from 'react';
import * as Y from 'yjs';

import { FormulaCell } from '@/application/database-yjs/cell.type';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import * as formulaEvaluator from '@/application/database-yjs/fields/formula/evaluator';
import * as formulaSchema from '@/application/database-yjs/fields/formula/schema';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { useCellSelector } from '@/application/database-yjs/selector';
import { YDatabase, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function fixture(expression: string) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([
    { id: 'input', name: 'Input', type: FieldType.Number },
    { id: 'edited', name: 'Edited', type: FieldType.LastEditedTime },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression } },
  ]).clone() as YDatabaseFields;
  const rowId = 'row';
  const { doc: rowDoc, row } = createRow(rowId, { input: { type: FieldType.Number, data: '2' } }, { lastModified: '2' });

  database.set(YjsDatabaseKey.fields, fields);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    readOnly: false,
    workspaceId: 'workspace',
    rowMap: { [rowId]: rowDoc },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { row, rowId, fields, context, wrapper };
}

describe('formula row subscriptions', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])('skips formula schema reads for ordinary cells (has formulas: %s)', (hasFormulas) => {
    const f = fixture('prop("input")');

    if (!hasFormulas) f.fields.delete('formula');
    const readSchema = jest.spyOn(formulaSchema, 'readFormulaSchemaForVersion');
    const { result, rerender } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'input' }), {
      wrapper: f.wrapper,
    });

    expect(result.current?.fieldType).toBe(FieldType.Number);
    act(() => {
      f.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '5');
    });
    rerender();
    expect(readSchema).not.toHaveBeenCalled();
  });

  it('starts and stops formula schema reads when a field changes type', () => {
    const f = fixture('prop("input") * 2');
    const field = f.fields.get('formula');

    field.set(YjsDatabaseKey.type, FieldType.Number);
    const readSchema = jest.spyOn(formulaSchema, 'readFormulaSchemaForVersion');
    const { result } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), {
      wrapper: f.wrapper,
    });

    expect(readSchema).not.toHaveBeenCalled();
    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.Formula);
    });
    expect((result.current as FormulaCell)?.rawNumeric).toBe(4);
    expect(readSchema).toHaveBeenCalled();
    readSchema.mockClear();
    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.Number);
    });
    act(() => {
      f.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '5');
    });
    expect(readSchema).not.toHaveBeenCalled();
  });

  it('follows a replacement cells map and releases its observer on unmount', () => {
    const f = fixture('prop("input")');
    const subscribe = jest.spyOn(f.row, 'observeDeep');
    const unsubscribe = jest.spyOn(f.row, 'unobserveDeep');
    const { result, unmount } = renderHook(
      () => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined,
      { wrapper: f.wrapper }
    );

    expect(result.current?.rawNumeric).toBe(2);
    const replacement = f.row.get(YjsDatabaseKey.cells).clone();

    act(() => {
      f.row.doc!.transact(() => {
        f.row.set(YjsDatabaseKey.cells, replacement);
        replacement.get('input').set(YjsDatabaseKey.data, '9');
      });
    });
    expect(result.current?.rawNumeric).toBe(9);
    act(() => {
      replacement.get('input').set(YjsDatabaseKey.data, '11');
    });
    expect(result.current?.rawNumeric).toBe(11);

    unmount();
    expect(subscribe).toHaveBeenCalled();
    subscribe.mock.calls.forEach(([listener]) => expect(unsubscribe).toHaveBeenCalledWith(listener));
  });

  it.each(['cell', 'row metadata'] as const)('rechecks a %s changed between render and subscription', (input) => {
    const f = fixture(input === 'cell' ? 'prop("input")' : 'timestamp(prop("edited")) / 1000');

    // Keep the shared store active: its first-subscription refresh must not
    // accidentally hide a missed row notification in the new formula cell.
    const schemaStore = renderHook(() => useDatabaseFieldsVersion(), { wrapper: f.wrapper });
    const schemaVersion = schemaStore.result.current;
    const setInput = (value: string) => {
      if (input === 'cell') {
        f.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, value);
      } else {
        f.row.set(YjsDatabaseKey.last_modified, value);
      }
    };

    const rendered: Array<number | undefined> = [];
    const { result } = renderHook(
      () => {
        const cell = useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined;

        rendered.push(cell?.rawNumeric);
        // Layout effects run after the value was rendered, before the passive
        // effect in useFormulaCellValue attaches its row and cell observers.
        useLayoutEffect(() => setInput('9'), []);
        return cell;
      },
      { wrapper: f.wrapper }
    );

    expect(rendered[0]).toBe(2);
    expect(schemaStore.result.current).toBe(schemaVersion);
    expect(result.current?.rawNumeric).toBe(9);

    act(() => setInput('11'));
    expect(result.current?.rawNumeric).toBe(11);
  });

  it('uses current row inputs on the first render after reopening', () => {
    const f = fixture('prop("input") * 2');
    const opened = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined, {
      wrapper: f.wrapper,
    });

    expect(opened.result.current?.rawNumeric).toBe(4);
    opened.unmount();
    f.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '7');

    const rendered: Array<number | undefined> = [];
    const reopened = renderHook(
      () => {
        const cell = useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined;

        rendered.push(cell?.rawNumeric);
        return cell;
      },
      { wrapper: f.wrapper }
    );

    expect(rendered[0]).toBe(14);
    expect(rendered.every((value) => value === 14)).toBe(true);
    expect(reopened.result.current?.rawNumeric).toBe(14);
  });

  it('refreshes transitive schema changes before the first reopened render', () => {
    const f = fixture('prop("helper")');
    const helper = createFields([
      {
        id: 'helper',
        name: 'Helper',
        type: FieldType.Formula,
        typeOption: { expression: 'prop("input") * 2' },
      },
    ])
      .get('helper')
      .clone();

    f.fields.set('helper', helper);
    const opened = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined, {
      wrapper: f.wrapper,
    });

    expect(opened.result.current?.rawNumeric).toBe(4);
    opened.unmount();
    helper.get(YjsDatabaseKey.type_option).get(String(FieldType.Formula)).set('expression', 'prop("input") * 5');

    const rendered: Array<number | undefined> = [];
    const reopened = renderHook(
      () => {
        const cell = useCellSelector({ rowId: f.rowId, fieldId: 'formula' }) as FormulaCell | undefined;

        rendered.push(cell?.rawNumeric);
        return cell;
      },
      { wrapper: f.wrapper }
    );

    expect(rendered[0]).toBe(10);
    expect(rendered.every((value) => value === 10)).toBe(true);
    expect(reopened.result.current?.rawNumeric).toBe(10);
  });

  it('isolates rapid database switches and does no work for the closed view', () => {
    const first = fixture('prop("input") * 2');
    const second = fixture('prop("input") * 10');

    second.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '7');
    // Both databases deliberately have the same field, row, and view IDs.
    let context = first.context;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
    );
    const rendered: Array<number | undefined> = [];
    const evaluation = jest.spyOn(formulaEvaluator, 'evaluateFormula');
    const opened = renderHook(
      () => {
        const cell = useCellSelector({ rowId: 'row', fieldId: 'formula' }) as FormulaCell | undefined;

        rendered.push(cell?.rawNumeric);
        return cell;
      },
      { wrapper }
    );

    expect(opened.result.current?.rawNumeric).toBe(4);
    rendered.length = 0;
    context = second.context;
    opened.rerender();
    expect(rendered.every((value) => value === 70)).toBe(true);

    evaluation.mockClear();
    act(() => {
      first.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '5');
      first.fields
        .get('formula')
        .get(YjsDatabaseKey.type_option)
        .get(String(FieldType.Formula))
        .set('expression', 'prop("input") * 3');
    });
    expect(evaluation).not.toHaveBeenCalled();
    expect(opened.result.current?.rawNumeric).toBe(70);

    rendered.length = 0;
    context = first.context;
    opened.rerender();
    expect(rendered[0]).toBe(15);
    expect(rendered.every((value) => value === 15)).toBe(true);

    opened.unmount();
    evaluation.mockClear();
    first.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '8');
    second.row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, '9');
    expect(evaluation).not.toHaveBeenCalled();
  });
});
