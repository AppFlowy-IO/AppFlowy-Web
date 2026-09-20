import { act, renderHook } from '@testing-library/react';
import { type ReactNode, useLayoutEffect } from 'react';
import * as Y from 'yjs';

import { FormulaCell } from '@/application/database-yjs/cell.type';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
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

  return { row, rowId, wrapper };
}

describe('formula row subscriptions', () => {
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
});
