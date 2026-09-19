import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

jest.mock('@/application/database-yjs', () => {
  const actual = jest.requireActual('@/application/database-yjs');

  return {
    ...actual,
    useDatabaseContext: jest.fn(),
    useDatabaseFields: jest.fn(),
    useDatabaseView: jest.fn(() => undefined),
    useRowMap: jest.fn(),
    useRowOrdersSelector: jest.fn(),
  };
});

jest.mock('./useChartColors', () => ({
  useChartColors: () => ({
    emptyColor: '#empty',
    getColorForCategory: () => '#category',
  }),
}));

import { useDatabaseContext, useDatabaseFields, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YDatabaseCell,
  YDatabaseRow,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';

import { sortByFieldOrder, touchesChartedRowData, useChartData } from './useChartData';

function addField(
  fields: YDatabaseFields,
  id: string,
  type: FieldType,
  options?: Array<{ id: string; name: string; color: number }>
): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  fields.set(id, field);
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, type);

  if (options) {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    field.set(YjsDatabaseKey.type_option, typeOptions);
    typeOptions.set(String(type), typeOption);
    typeOption.set(YjsDatabaseKey.content, JSON.stringify({ options, disable_color: false }));
  }

  return field;
}

describe('useChartData desktop-model field conversion', () => {
  it('parses both chart axes with the current fields and reacts to schema-only changes', async () => {
    const databaseId = 'chart-database';
    const rowId = 'row-a';
    const xFieldId = 'x-field';
    const yFieldId = 'y-field';
    const databaseDoc = new Y.Doc();
    const fields = databaseDoc.getMap('fields') as YDatabaseFields;
    const xField = addField(fields, xFieldId, FieldType.MultiSelect, [{ id: 'opt-yes', name: 'Yes', color: 0 }]);
    const yField = addField(fields, yFieldId, FieldType.Number);
    const rowMetas = {
      [rowId]: createRowDoc(rowId, databaseId, {
        [xFieldId]: createCell(FieldType.RichText, 'Yes'),
        [yFieldId]: createCell(FieldType.RichText, 'true'),
      }),
    };
    const ensureRow = jest.fn().mockResolvedValue(undefined);
    const settings: ChartLayoutSettings = {
      chartType: ChartType.Bar,
      xFieldId,
      yFieldId,
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Sum,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
    };

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: rowId }]);
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });

    const { result } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Yes', value: 0, rowIds: [rowId] })]);

    act(() => {
      databaseDoc.transact(() => {
        xField.set(YjsDatabaseKey.type, FieldType.Checkbox);
        yField.set(YjsDatabaseKey.type, FieldType.Checkbox);
      });
    });

    await waitFor(() => {
      expect(result.current.chartData).toEqual([
        expect.objectContaining({ label: 'Checked', value: 1, rowIds: [rowId] }),
      ]);
    });
  });
});

describe('useChartData Number chart', () => {
  const databaseId = 'number-database';
  const amountFieldId = 'amount';

  function setup(settings: ChartLayoutSettings, rowIds: string[], amounts: Record<string, string>) {
    const databaseDoc = new Y.Doc();
    const fields = databaseDoc.getMap('fields') as YDatabaseFields;
    const amountField = addField(fields, amountFieldId, FieldType.Number);
    const rowMetas = Object.fromEntries(
      rowIds.map((rowId) => [
        rowId,
        createRowDoc(
          rowId,
          databaseId,
          amounts[rowId] !== undefined ? { [amountFieldId]: createCell(FieldType.Number, amounts[rowId]) } : {}
        ),
      ])
    );

    const ensureRow = jest.fn().mockResolvedValue(undefined);

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rowIds.map((id) => ({ id })));
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });

    return { amountField, ensureRow, rowMetas };
  }

  const baseSettings: ChartLayoutSettings = {
    chartType: ChartType.Number,
    xFieldId: '',
    showEmptyValues: true,
    aggregationType: ChartAggregationType.Count,
    cumulative: false,
    dateCondition: DateGroupCondition.Month,
    numberFormat: 'auto',
    titleText: '',
  };

  it('counts every filtered row without any groupable field', async () => {
    setup(baseSettings, ['r1', 'r2', 'r3'], {});

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasGroupableFields).toBe(false);
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0]).toEqual(expect.objectContaining({ value: 3, rowIds: ['r1', 'r2', 'r3'] }));
    expect(result.current.numberValue).toBe(3);
    expect(result.current.yAxisField).toBeNull();
  });

  it('shows the spinner, not an empty tile, while a new filter hydrates its rows', async () => {
    setup(baseSettings, ['r1', 'r2'], {});

    const { result, rerender } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The row selector reports nothing until every row can be evaluated.
    (useRowOrdersSelector as jest.Mock).mockReturnValue(undefined);
    rerender();
    expect(result.current.isLoading).toBe(true);

    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r2' }]);
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numberValue).toBe(1);
  });

  it('aggregates the Y field over all rows and ignores empty cells', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };

    setup(settings, ['r1', 'r2', 'r3'], { r1: '10', r2: '2.5' });

    const { result } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numberValue).toBe(12.5);
    expect(result.current.yFieldName).toBe(amountFieldId);
    expect(result.current.yNumberFormat).toBe(0);
    expect(result.current.chartData[0].rowIds).toEqual(['r1', 'r2', 'r3']);
  });

  it('computes the average and falls back to count when the Y field is missing', async () => {
    const average: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Average,
      yFieldId: amountFieldId,
    };

    setup(average, ['r1', 'r2'], { r1: '4', r2: '8' });

    const { result, rerender } = renderHook(({ settings }) => useChartData({ settings }), {
      initialProps: { settings: average },
    });

    await waitFor(() => expect(result.current.numberValue).toBe(6));

    rerender({ settings: { ...average, yFieldId: 'deleted-field' } });

    await waitFor(() => expect(result.current.numberValue).toBe(2));
    expect(result.current.yAxisField).toBeNull();
  });

  it('counts rows without hydrating them', async () => {
    const { ensureRow } = setup(baseSettings, ['r1', 'r2', 'r3'], {});

    // No row doc is open: the count only needs the row orders.
    (useRowMap as jest.Mock).mockReturnValue({});
    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numberValue).toBe(3);
    expect(result.current.chartData[0].rowIds).toEqual(['r1', 'r2', 'r3']);
    expect(ensureRow).not.toHaveBeenCalled();
  });

  it('hydrates rows once the value aggregates the Y field', async () => {
    const { ensureRow } = setup(baseSettings, ['r1', 'r2'], { r1: '4', r2: '6' });
    const { result, rerender } = renderHook(({ settings }) => useChartData({ settings }), {
      initialProps: { settings: baseSettings },
    });

    await waitFor(() => expect(result.current.numberValue).toBe(2));
    expect(ensureRow).not.toHaveBeenCalled();

    rerender({ settings: { ...baseSettings, aggregationType: ChartAggregationType.Sum, yFieldId: amountFieldId } });

    await waitFor(() => expect(result.current.numberValue).toBe(10));
    expect(ensureRow.mock.calls.map(([rowId]) => rowId).sort()).toEqual(['r1', 'r2']);
  });

  it('keeps the item identity across title, format, x-axis and equal row-order changes', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };

    setup(settings, ['r1', 'r2'], { r1: '4', r2: '6' });
    const { result, rerender } = renderHook(({ settings: current }) => useChartData({ settings: current }), {
      initialProps: { settings },
    });

    await waitFor(() => expect(result.current.numberValue).toBe(10));
    const data = result.current.chartData;

    rerender({ settings: { ...settings, titleText: 'Revenue', numberFormat: 'compact' } });
    expect(result.current.chartData).toBe(data);

    rerender({ settings: { ...settings, xFieldId: 'other-field', dateCondition: DateGroupCondition.Year } });
    expect(result.current.chartData).toBe(data);

    // Yjs hands out a fresh row-order array with the same rows.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender({ settings });
    expect(result.current.chartData).toBe(data);

    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }]);
    rerender({ settings });
    await waitFor(() => expect(result.current.numberValue).toBe(4));
    expect(result.current.chartData).not.toBe(data);
  });

  it('recomputes when a summed cell is edited in place', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1', 'r2'], { r1: '10', r2: '5' });

    const { result } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.numberValue).toBe(15));

    act(() => {
      const row = rowMetas.r1.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get(amountFieldId).set(YjsDatabaseKey.data, '40');
    });

    await waitFor(() => expect(result.current.numberValue).toBe(45));
  });

  it('recomputes when the summed cell is first filled in', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1', 'r2'], { r1: '10' });

    const { result } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.numberValue).toBe(10));

    act(() => {
      const row = rowMetas.r2.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      const cell = new Y.Map() as YDatabaseCell;

      cell.set(YjsDatabaseKey.field_type, FieldType.Number);
      cell.set(YjsDatabaseKey.data, '7');
      row.get(YjsDatabaseKey.cells).set(amountFieldId, cell);
    });

    await waitFor(() => expect(result.current.numberValue).toBe(17));
  });

  it('does not recompute for edits the chart does not read', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1'], { r1: '10' });
    const nextFrame = () => act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    let renders = 0;

    const { result } = renderHook(() => {
      renders += 1;
      return useChartData({ settings });
    });

    await waitFor(() => expect(result.current.numberValue).toBe(10));
    await nextFrame();
    const settled = renders;
    const row = rowMetas.r1.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    act(() => {
      const notes = new Y.Map() as YDatabaseCell;

      row.get(YjsDatabaseKey.cells).set('notes', notes);
      notes.set(YjsDatabaseKey.data, 'unrelated');
      row.set(YjsDatabaseKey.last_modified, '99');
    });
    await nextFrame();
    expect(renders).toBe(settled);

    act(() => {
      row.get(YjsDatabaseKey.cells).get(amountFieldId).set(YjsDatabaseKey.data, '12');
    });
    await waitFor(() => expect(result.current.numberValue).toBe(12));
  });

  it('returns a single zero item when no rows match', async () => {
    setup(baseSettings, [], {});

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ value: 0, rowIds: [] })]);
    expect(result.current.numberValue).toBe(0);
  });
});

describe('touchesChartedRowData', () => {
  const event = (path: string[], keys: string[] = []) => ({
    path,
    changes: { keys: new Map(keys.map((key) => [key, {}])) },
  });
  const row = YjsEditorKey.database_row;
  const cells = YjsDatabaseKey.cells;
  const watched = { fieldIds: new Set(['amount']), rowTimes: false };

  it('reacts to the row or its cells map being replaced', () => {
    expect(touchesChartedRowData(event([], [row]), watched)).toBe(true);
    expect(touchesChartedRowData(event([], ['meta']), watched)).toBe(false);
    expect(touchesChartedRowData(event([row], [cells]), watched)).toBe(true);
  });

  it('reacts to watched cells only', () => {
    expect(touchesChartedRowData(event([row, cells], ['amount']), watched)).toBe(true);
    expect(touchesChartedRowData(event([row, cells], ['notes']), watched)).toBe(false);
    expect(touchesChartedRowData(event([row, cells, 'amount'], [YjsDatabaseKey.data]), watched)).toBe(true);
    expect(touchesChartedRowData(event([row, cells, 'notes', YjsDatabaseKey.data]), watched)).toBe(false);
    expect(touchesChartedRowData(event(['meta', cells, 'amount']), watched)).toBe(false);
  });

  it('reacts to row timestamps only when grouping by them', () => {
    expect(touchesChartedRowData(event([row], [YjsDatabaseKey.last_modified]), watched)).toBe(false);
    expect(touchesChartedRowData(event([row], [YjsDatabaseKey.height]), watched)).toBe(false);
    expect(touchesChartedRowData(event([row], [YjsDatabaseKey.last_modified]), { ...watched, rowTimes: true })).toBe(
      true
    );
    expect(touchesChartedRowData(event([row], [YjsDatabaseKey.created_at]), { ...watched, rowTimes: true })).toBe(true);
  });
});

describe('sortByFieldOrder', () => {
  const orders = (ids: string[]) => ({ toArray: () => ids.map((id) => ({ id })) });

  it('ranks groupable fields by the view property order', () => {
    const fields = [{ id: 'due' }, { id: 'urgent' }, { id: 'status' }];

    expect(sortByFieldOrder(fields, orders(['name', 'status', 'estimate', 'due', 'urgent'])).map((f) => f.id)).toEqual([
      'status',
      'due',
      'urgent',
    ]);
  });

  it('keeps unlisted fields after listed ones in their original order', () => {
    const fields = [{ id: 'b' }, { id: 'x' }, { id: 'a' }, { id: 'y' }];

    expect(sortByFieldOrder(fields, orders(['a', 'b'])).map((f) => f.id)).toEqual(['a', 'b', 'x', 'y']);
    expect(sortByFieldOrder(fields, undefined)).toBe(fields);
  });
});
