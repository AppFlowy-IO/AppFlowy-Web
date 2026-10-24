import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import type { Row } from '@/application/database-yjs/selector';
import { YDatabaseCell, YDatabaseFields, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useBoardGroupCalculations } from '@/components/database/board/useBoardGroupCalculations';

let mockFields: YDatabaseFields | undefined;

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual<typeof import('@/application/database-yjs')>('@/application/database-yjs'),
  useDatabaseFields: () => mockFields,
}));

jest.mock('@/application/database-yjs/hooks/useDatabaseFieldsVersion', () => ({
  useDatabaseFieldsVersion: () => 0,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

function createFields(specs: { id: string; type: FieldType }[]): YDatabaseFields {
  const fields = new Y.Doc().getMap('fields') as unknown as YDatabaseFields;

  specs.forEach(({ id, type }) => {
    const field = new Y.Map();

    fields.set(id, field as never);
    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.name, id);
    field.set(YjsDatabaseKey.type, type);
  });
  return fields;
}

const rowOf = (doc: YDoc) =>
  doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as unknown as YDatabaseRow;
const cellOf = (doc: YDoc, fieldId: string) => rowOf(doc).get(YjsDatabaseKey.cells).get(fieldId);

/** Two rows in one column: amounts 10 and 20, a note each. */
function createBoard() {
  const r1 = createRowDoc(
    'r1',
    'db',
    { amount: createCell(FieldType.Number, '10'), note: createCell(FieldType.RichText, 'a') },
    '100',
    '100'
  );
  const r2 = createRowDoc(
    'r2',
    'db',
    { amount: createCell(FieldType.Number, '20'), note: createCell(FieldType.RichText, 'b') },
    '200',
    '200'
  );
  const rows: Row[] = [
    { id: 'r1', height: 36 },
    { id: 'r2', height: 36 },
  ];

  return { groupResult: new Map([['col', rows]]), groupingRows: { r1, r2 } };
}

describe('useBoardGroupCalculations', () => {
  beforeEach(() => {
    mockFields = createFields([
      { id: 'amount', type: FieldType.Number },
      { id: 'note', type: FieldType.RichText },
      { id: 'edited', type: FieldType.LastEditedTime },
    ]);
  });

  it('recomputes when the calculated field changes in a row, and only then', () => {
    const board = createBoard();
    const { result } = renderHook(() =>
      useBoardGroupCalculations({ ...board, calculation: { type: CalculationType.Sum, fieldId: 'amount' } })
    );
    const initial = result.current;

    expect(initial?.get('col')?.text).toContain('30');

    // Another field's cell, and the `last_modified` an edit bumps: the same map.
    act(() => {
      cellOf(board.groupingRows.r1, 'note').set(YjsDatabaseKey.data, 'changed');
      rowOf(board.groupingRows.r1).set(YjsDatabaseKey.last_modified, '300');
    });
    expect(result.current).toBe(initial);

    act(() => {
      cellOf(board.groupingRows.r1, 'amount').set(YjsDatabaseKey.data, '20');
    });
    expect(result.current).not.toBe(initial);
    expect(result.current?.get('col')?.text).toContain('40');
  });

  it('recomputes when the calculated field gets its first cell in a row', () => {
    const board = createBoard();
    const r3 = createRowDoc('r3', 'db', { note: createCell(FieldType.RichText, 'c') });

    board.groupResult.get('col')?.push({ id: 'r3', height: 36 });
    const groupingRows = { ...board.groupingRows, r3 };
    const { result } = renderHook(() =>
      useBoardGroupCalculations({
        groupResult: board.groupResult,
        groupingRows,
        calculation: { type: CalculationType.Sum, fieldId: 'amount' },
      })
    );
    const initial = result.current;

    act(() => {
      const cell = new Y.Map() as YDatabaseCell;

      rowOf(r3).get(YjsDatabaseKey.cells).set('amount', cell);
      cell.set(YjsDatabaseKey.field_type, FieldType.Number);
      cell.set(YjsDatabaseKey.data, '5');
    });
    expect(result.current).not.toBe(initial);
    expect(result.current?.get('col')?.text).toContain('35');
  });

  it("follows the row's timestamps for a time field's calculation", () => {
    const board = createBoard();
    const { result } = renderHook(() =>
      useBoardGroupCalculations({ ...board, calculation: { type: CalculationType.DateLatest, fieldId: 'edited' } })
    );
    const initial = result.current;

    expect(initial?.get('col')?.text).not.toBe('');
    act(() => {
      rowOf(board.groupingRows.r1).set(YjsDatabaseKey.last_modified, '900');
    });
    expect(result.current).not.toBe(initial);
  });

  it('shows card counts (null) without a calculation', () => {
    const board = createBoard();
    const { result } = renderHook(() => useBoardGroupCalculations({ ...board, calculation: undefined }));

    expect(result.current).toBeNull();
  });
});
