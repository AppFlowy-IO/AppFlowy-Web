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
import { DatabaseHistoryRowStore } from '@/application/database-yjs/history-row-store';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YjsDatabaseKey,
  YMapFieldTypeOption,
} from '@/application/types';


import { useChartData } from './useChartData';

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


it('aggregates all historical rows through the bounded snapshot accessor without live hydration', async () => {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  addField(fields, 'category', FieldType.Checkbox);
  addField(fields, 'amount', FieldType.Number);
  const store = new DatabaseHistoryRowStore('history:chart');
  const rows = Array.from({ length: 400 }, (_, i) => ({ id: String(i) }));

  rows.forEach(({ id }, i) => {
    const row = createRowDoc(id, 'chart', {
      category: createCell(FieldType.Checkbox, i % 2 ? 'Yes' : 'No'),
      amount: createCell(FieldType.Number, String(i)),
    });

    store.add(id, Y.encodeStateAsUpdate(row), 1);
    row.destroy();
  });
  const ensureRow = jest.fn();

  (useDatabaseFields as jest.Mock).mockReturnValue(fields);
  (useRowOrdersSelector as jest.Mock).mockReturnValue(rows);
  (useRowMap as jest.Mock).mockReturnValue(store.rows);
  (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, dataSource: { type: 'history', id: 'chart' } });
  const { result, unmount } = renderHook(() => useChartData({ settings: {
    chartType: ChartType.Bar, xFieldId: 'category', yFieldId: 'amount', showEmptyValues: true,
    aggregationType: ChartAggregationType.Sum, cumulative: false, dateCondition: DateGroupCondition.Month,
  } }));

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.chartData).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Checked', value: 40000 }),
    expect.objectContaining({ label: 'Unchecked', value: 39800 }),
  ]));
  expect(ensureRow).not.toHaveBeenCalled();
  expect(store.cachedDocumentCount).toBeLessThanOrEqual(128);
  unmount();
  store.destroy();
  doc.destroy();
});
