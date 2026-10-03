import { act, renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
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
    // These contexts have no row seeds, so the shared detached docs stay empty
    // (`useChartData.shared-rows.test.tsx` covers the seeded path).
    useBackgroundRowDocLoader: jest.fn(() => ({
      cachedRowDocs: mockNoCachedRowDocs,
      getCachedRowDocs: () => mockNoCachedRowDocs,
      subscribeToCachedRowDocChanges: () => () => undefined,
    })),
  };
});

const mockNoCachedRowDocs = {};

// English defaults unless a test sets a translation. `t` keeps its identity, as it does per language.
const mockTranslations: Record<string, string> = {};

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) =>
    mockTranslations[key] ?? options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});

import { useDatabaseContext, useDatabaseFields, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { DatabaseHistoryRowStore } from '@/application/database-yjs/history-row-store';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
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

import { computeNumberChartData, sortByFieldOrder, touchesChartedRowData } from './chartCompute';
import { ensureRowsWithConcurrency, ROW_LOAD_CONCURRENCY } from './rowLoadPool';
import { useChartData, UseChartDataReturn } from './useChartData';

/** The Number chart's value: its single item, or null while there is none. */
function numberValue(result: { current: UseChartDataReturn }): number | null {
  return result.current.chartData.length > 0 ? result.current.chartData[0].value : null;
}

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
      extended: DEFAULT_CHART_EXTENDED_SETTINGS,
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

describe('useChartData category labels', () => {
  const databaseId = 'labels-database';
  // Only `Date` is faked, so the relative buckets see a fixed today.
  const REAL_TIMERS = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
  ] as const;
  const now = new Date(2026, 2, 15, 12);
  const daysFromNow = (days: number) => String(dayjs(now).add(days, 'day').unix());

  afterEach(() => {
    Object.keys(mockTranslations).forEach((key) => delete mockTranslations[key]);
    jest.useRealTimers();
  });

  function renderChart(fieldType: FieldType, cells: Record<string, string | undefined>, dateCondition: DateGroupCondition) {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'Due', fieldType);
    const rowIds = Object.keys(cells);
    const rowMetas = Object.fromEntries(
      rowIds.map((rowId) => {
        const value = cells[rowId];

        return [rowId, createRowDoc(rowId, databaseId, value === undefined ? {} : { Due: createCell(fieldType, value) })];
      })
    );

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rowIds.map((id) => ({ id })));
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

    return renderHook(() =>
      useChartData({
        settings: {
          chartType: ChartType.Bar,
          xFieldId: 'Due',
          showEmptyValues: true,
          aggregationType: ChartAggregationType.Count,
          cumulative: false,
          dateCondition,
          extended: DEFAULT_CHART_EXTENDED_SETTINGS,
        },
      })
    );
  }

  it('orders relative date buckets like desktop, with the empty category last', async () => {
    jest.useFakeTimers({ now, doNotFake: [...REAL_TIMERS] });
    const { result } = renderChart(
      FieldType.DateTime,
      {
        later: daysFromNow(45),
        yesterday: daysFromNow(-1),
        nextMonth: daysFromNow(20),
        none: undefined,
        lastMonth: daysFromNow(-20),
        today: daysFromNow(0),
        lastWeek: daysFromNow(-3),
        nextWeek: daysFromNow(5),
        tomorrow: daysFromNow(1),
        lastWeekToo: daysFromNow(-6),
      },
      DateGroupCondition.Relative
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData.map(({ label, value }) => [label, value])).toEqual([
      ['Last 30 days', 1],
      ['Last 7 days', 2],
      ['Yesterday', 1],
      ['Today', 1],
      ['Tomorrow', 1],
      ['Next 7 days', 1],
      ['Next 30 days', 1],
      ['Apr 2026', 1],
      ['No Due', 1],
    ]);
  });

  it('labels day and week buckets like desktop, in the current language', async () => {
    Object.assign(mockTranslations, {
      'board.dateCondition.weekOf': 'Semaine du {} au {}',
      'chart.noFieldValue': 'Sans {}',
    });
    const cells = { a: String(dayjs(new Date(2026, 2, 11)).unix()), b: undefined };
    const day = renderChart(FieldType.DateTime, cells, DateGroupCondition.Day);

    await waitFor(() => expect(day.result.current.isLoading).toBe(false));
    expect(day.result.current.chartData.map((item) => item.label)).toEqual(['March 11, 2026', 'Sans Due']);

    const week = renderChart(FieldType.DateTime, cells, DateGroupCondition.Week);

    await waitFor(() => expect(week.result.current.isLoading).toBe(false));
    expect(week.result.current.chartData.map((item) => item.label)).toEqual([
      'Semaine du Mar 09 au 15 2026',
      'Sans Due',
    ]);
  });

  it('translates the checkbox categories', async () => {
    Object.assign(mockTranslations, { 'chart.checked': 'Coché', 'chart.unchecked': 'Non coché' });
    const { result } = renderChart(FieldType.Checkbox, { a: 'Yes', b: 'No', c: 'Yes' }, DateGroupCondition.Month);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Coché', rowIds: ['a', 'c'], key: 'checked', checkboxState: 'checked' }),
      expect.objectContaining({ label: 'Non coché', rowIds: ['b'], key: 'unchecked', checkboxState: 'unchecked' }),
    ]);
  });

  it('keeps the group key and leaves colors to the renderer', async () => {
    const { result } = renderChart(FieldType.Checkbox, { a: 'Yes' }, DateGroupCondition.Month);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    result.current.chartData.forEach((item) => expect(item.color).toBeUndefined());
  });
});

describe('useChartData select categories', () => {
  it('carries the option id and color of each category, and the empty key', async () => {
    const databaseId = 'select-database';
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'Stage', FieldType.SingleSelect, [
      { id: 'lead', name: 'Lead', color: 'Blue' as unknown as number },
      { id: 'won', name: 'Won', color: 'Green' as unknown as number },
    ]);
    const rowMetas = {
      r1: createRowDoc('r1', databaseId, { Stage: createCell(FieldType.SingleSelect, 'won') }),
      r2: createRowDoc('r2', databaseId, { Stage: createCell(FieldType.SingleSelect, 'lead') }),
      r3: createRowDoc('r3', databaseId, {}),
    };

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

    const settings: ChartLayoutSettings = {
      chartType: ChartType.Bar,
      xFieldId: 'Stage',
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Count,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      extended: DEFAULT_CHART_EXTENDED_SETTINGS,
    };
    const { result, rerender } = renderHook((props: { settings: ChartLayoutSettings }) => useChartData(props), {
      initialProps: { settings },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Lead', key: 'lead', optionColor: 'Blue', rowIds: ['r2'] }),
      expect.objectContaining({ label: 'Won', key: 'won', optionColor: 'Green', rowIds: ['r1'] }),
      expect.objectContaining({ label: 'No Stage', key: '__empty__', isEmptyCategory: true, rowIds: ['r3'] }),
    ]);

    // A style change keeps the data: the chart re-colors without recomputing.
    const data = result.current.chartData;

    rerender({ settings: { ...settings, extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, colorTheme: 'blue' } } });
    expect(result.current.chartData).toBe(data);
  });
});

describe('useChartData load errors', () => {
  it('reports a load error when every row fails, and retries the failed rows', async () => {
    const databaseId = 'error-database';
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'done', FieldType.Checkbox);
    const docs = { r1: createRowDoc('r1', databaseId, { done: createCell(FieldType.Checkbox, 'Yes') }) };
    let failing = true;
    const ensureRow = jest.fn(() => (failing ? Promise.reject(new Error('offline')) : Promise.resolve()));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }]);
    (useRowMap as jest.Mock).mockReturnValue({});
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-1' });

    const settings: ChartLayoutSettings = {
      chartType: ChartType.Bar,
      xFieldId: 'done',
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Count,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      extended: DEFAULT_CHART_EXTENDED_SETTINGS,
    };
    const { result, rerender } = renderHook(() => useChartData({ settings }));

    try {
      await waitFor(() => expect(result.current.loadError).toBe(true));
      expect(result.current.isLoading).toBe(false);

      failing = false;
      (useRowMap as jest.Mock).mockReturnValue(docs);
      act(() => result.current.retry());
      rerender();

      await waitFor(() => expect(result.current.loadError).toBe(false));
      await waitFor(() =>
        expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })])
      );
      expect(ensureRow).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('useChartData row-load failures', () => {
  const databaseId = 'failure-database';
  const settings: ChartLayoutSettings = {
    chartType: ChartType.Bar,
    xFieldId: 'done',
    showEmptyValues: true,
    aggregationType: ChartAggregationType.Count,
    cumulative: false,
    dateCondition: DateGroupCondition.Month,
    extended: DEFAULT_CHART_EXTENDED_SETTINGS,
  };
  const checkedRow = (rowId: string) =>
    createRowDoc(rowId, databaseId, { done: createCell(FieldType.Checkbox, 'Yes') });
  const flush = (ms = 0) =>
    act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'done', FieldType.Checkbox);
    addField(fields, 'amount', FieldType.Number);
    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    jest.useRealTimers();
  });

  function mount(rowIds: string[], rowMap: Record<string, Y.Doc>, ensureRow: jest.Mock, initial = settings) {
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rowIds.map((id) => ({ id })));
    (useRowMap as jest.Mock).mockReturnValue(rowMap);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-1' });

    return renderHook((props: { settings: ChartLayoutSettings }) => useChartData(props), {
      initialProps: { settings: initial },
    });
  }

  it('counts a row whose load resolves without a doc as failed, and retries it by itself', async () => {
    const doc = checkedRow('r1');
    let available = false;
    // `Database.ensureRow` swallows a failed open and resolves without a doc.
    const ensureRow = jest.fn(async () => (available ? doc : undefined));
    const { result, rerender } = mount(['r1'], {}, ensureRow);

    await flush();
    expect(ensureRow).toHaveBeenCalledTimes(1);
    // Not counted as loaded: the chart has no row to show, so it says so.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBe(true);

    // The row is not marked loaded, so the backoff asks for it again.
    available = true;
    await flush(ROW_SYNC_RETRY_DELAYS_MS[0]);
    expect(ensureRow).toHaveBeenCalledTimes(2);
    expect(result.current.loadError).toBe(false);

    (useRowMap as jest.Mock).mockReturnValue({ r1: doc });
    rerender({ settings });
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);
  });

  it('stops retrying after the backoff schedule and keeps the error with its Retry', async () => {
    const ensureRow = jest.fn(async () => undefined);
    const { result } = mount(['r1'], {}, ensureRow);

    await flush();
    for (const delay of ROW_SYNC_RETRY_DELAYS_MS) await flush(delay);
    expect(ensureRow).toHaveBeenCalledTimes(1 + ROW_SYNC_RETRY_DELAYS_MS.length);

    await flush(60_000);
    expect(ensureRow).toHaveBeenCalledTimes(1 + ROW_SYNC_RETRY_DELAYS_MS.length);
    expect(result.current.loadError).toBe(true);
    // The rows left out are reported once, when the retries are spent.
    expect(consoleWarn).toHaveBeenCalledTimes(1);

    // Retry starts over, behind the loading state.
    act(() => result.current.retry());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadError).toBe(false);
    await flush();
    expect(ensureRow).toHaveBeenCalledTimes(2 + ROW_SYNC_RETRY_DELAYS_MS.length);
    expect(result.current.loadError).toBe(true);
  });

  it('does not blank a chart that has rows when a row added later fails to load', async () => {
    const r1 = checkedRow('r1');
    const ensureRow = jest.fn((rowId: string) =>
      rowId === 'r1' ? Promise.resolve(r1) : Promise.reject(new Error('offline'))
    );
    const { result, rerender } = mount(['r1'], { r1 }, ensureRow);

    await flush();
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);

    // A collaborator's row whose document cannot be opened.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender({ settings });
    await flush();

    expect(ensureRow).toHaveBeenCalledWith('r2');
    expect(result.current.loadError).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

    // The failed row is retried behind the chart, never behind the loading state.
    await flush(ROW_SYNC_RETRY_DELAYS_MS[0]);
    expect(ensureRow.mock.calls.filter(([rowId]) => rowId === 'r2')).toHaveLength(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBe(false);
  });

  describe('clears the error on every path that finishes without loading', () => {
    const failing = () => jest.fn(() => Promise.reject(new Error('offline')));

    async function mountFailed(ensureRow: jest.Mock = failing()) {
      const hook = mount(['bad'], {}, ensureRow);

      await flush();
      expect(hook.result.current.loadError).toBe(true);
      return hook;
    }

    it('a Number chart that only counts rows', async () => {
      const { result, rerender } = await mountFailed();

      rerender({ settings: { ...settings, chartType: ChartType.Number } });
      await flush();
      expect(result.current.loadError).toBe(false);
      expect(numberValue(result)).toBe(1);
    });

    it('a view that has no rows any more', async () => {
      const { result, rerender } = await mountFailed();

      (useRowOrdersSelector as jest.Mock).mockReturnValue([]);
      rerender({ settings });
      // The empty-view grace period.
      await flush(300);
      expect(result.current.loadError).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.chartData).toEqual([]);
    });

    it('a history snapshot', async () => {
      const ensureRow = failing();
      const { result, rerender } = await mountFailed(ensureRow);

      (useRowMap as jest.Mock).mockReturnValue({ bad: checkedRow('bad') });
      (useDatabaseContext as jest.Mock).mockReturnValue({
        ensureRow,
        activeViewId: 'view-1',
        dataSource: { type: 'history', id: 'snapshot' },
      });
      rerender({ settings });
      await flush();
      expect(result.current.loadError).toBe(false);
      expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);
    });

    it('rows that were loaded before', async () => {
      const r1 = checkedRow('r1');
      const ensureRow = jest.fn((rowId: string) =>
        rowId === 'r1' ? Promise.resolve(r1) : Promise.reject(new Error('offline'))
      );
      const { result, rerender } = mount(['r1'], { r1 }, ensureRow);

      await flush();
      // A filter that leaves only a row that cannot be opened…
      (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'bad' }]);
      rerender({ settings });
      await flush();
      expect(result.current.loadError).toBe(true);

      // …and back: nothing is left to load, and the error goes with it.
      (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }]);
      rerender({ settings });
      await flush();
      expect(result.current.loadError).toBe(false);
      expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);
    });
  });
});

describe('useChartData aggregation rule', () => {
  const databaseId = 'aggregation-database';

  function setup(aggregationType: number, chartType: ChartType, yFieldId: string | undefined = 'amount') {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'done', FieldType.Checkbox);
    addField(fields, 'amount', FieldType.Number);
    const rowMetas = {
      r1: createRowDoc('r1', databaseId, {
        done: createCell(FieldType.Checkbox, 'Yes'),
        amount: createCell(FieldType.Number, '40'),
      }),
      r2: createRowDoc('r2', databaseId, {
        done: createCell(FieldType.Checkbox, 'Yes'),
        amount: createCell(FieldType.Number, '60'),
      }),
    };
    const ensureRow = jest.fn().mockResolvedValue(undefined);

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });

    const settings: ChartLayoutSettings = {
      chartType,
      xFieldId: 'done',
      yFieldId,
      showEmptyValues: true,
      // Another client's value: `parseChartLayoutSettings` passes any stored int through.
      aggregationType: aggregationType as ChartAggregationType,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      extended: DEFAULT_CHART_EXTENDED_SETTINGS,
    };

    return { ensureRow, ...renderHook(() => useChartData({ settings })) };
  }

  // 7–16 are WP11's: formatted by R-FORMAT already, but not computed here yet.
  it.each([7, 9, 12, 13, 15, 16, 99, -1])('charts a row count for the unknown aggregation %p', async (stored) => {
    const { result } = setup(stored, ChartType.Bar);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Not the Y field's sum (100), and not formatted as a percentage, a date or days.
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 2 })]);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(result.current.yFormatField).toBeNull();
    expect(result.current.yFieldName).toBe('');
  });

  it('counts rows for an unknown aggregation on a Number chart, without hydrating them', async () => {
    const { result, ensureRow } = setup(9, ChartType.Number);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(numberValue(result)).toBe(2);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(ensureRow).not.toHaveBeenCalled();
  });

  it('counts rows for a value aggregation whose Y field is gone, like the Number chart does', async () => {
    const { result } = setup(ChartAggregationType.Sum, ChartType.Bar, 'deleted-field');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 2 })]);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
  });

  it('keeps computing the aggregations it knows', async () => {
    const { result } = setup(ChartAggregationType.Sum, ChartType.Bar);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 100 })]);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Sum);
  });
});

describe('ensureRowsWithConcurrency', () => {
  const never = () => false;

  it('reports a row that resolves without a doc as failed, and marks only loaded rows', async () => {
    const doc = new Y.Doc();
    const ensureRow = jest.fn(async (rowId: string) => (rowId === 'ok' ? doc : undefined));
    const onLoaded = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await ensureRowsWithConcurrency(['ok', 'missing', 'thrown'], (rowId) =>
        rowId === 'thrown' ? Promise.reject(new Error('offline')) : ensureRow(rowId)
      , { isCancelled: never, onLoaded });

      expect(result).toEqual({ loaded: 1, failedRowIds: ['missing', 'thrown'] });
      expect(onLoaded.mock.calls).toEqual([['ok']]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('counts a row the caller already holds as loaded', async () => {
    const result = await ensureRowsWithConcurrency(['held', 'missing'], async () => undefined, {
      isCancelled: never,
      hasRowDoc: (rowId) => rowId === 'held',
    });

    expect(result).toEqual({ loaded: 1, failedRowIds: ['missing'] });
  });

  it('never runs more than ROW_LOAD_CONCURRENCY loads at once and stops when cancelled', async () => {
    let running = 0;
    let peak = 0;
    let cancelled = false;
    const started: string[] = [];
    const rowIds = Array.from({ length: ROW_LOAD_CONCURRENCY * 3 }, (_, index) => `row-${index}`);
    const ensureRow = async (rowId: string) => {
      started.push(rowId);
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      if (started.length >= ROW_LOAD_CONCURRENCY * 2) cancelled = true;
      return new Y.Doc();
    };

    await ensureRowsWithConcurrency(rowIds, ensureRow, { isCancelled: () => cancelled });
    expect(peak).toBe(ROW_LOAD_CONCURRENCY);
    expect(started.length).toBeLessThan(rowIds.length);
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
    extended: DEFAULT_CHART_EXTENDED_SETTINGS,
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
    expect(numberValue(result)).toBe(3);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(result.current.yFormatField).toBeNull();
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
    expect(numberValue(result)).toBe(1);
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
    expect(numberValue(result)).toBe(12.5);
    expect(result.current.yFieldName).toBe(amountFieldId);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Sum);
    expect(result.current.yFormatField).toEqual({ type: 'number', numberFormat: 0 });
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

    await waitFor(() => expect(numberValue(result)).toBe(6));

    rerender({ settings: { ...average, yFieldId: 'deleted-field' } });

    await waitFor(() => expect(numberValue(result)).toBe(2));
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(result.current.yFormatField).toBeNull();
  });

  it('counts rows without hydrating them', async () => {
    const { ensureRow } = setup(baseSettings, ['r1', 'r2', 'r3'], {});

    // No row doc is open: the count only needs the row orders.
    (useRowMap as jest.Mock).mockReturnValue({});
    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(numberValue(result)).toBe(3);
    expect(result.current.chartData[0].rowIds).toEqual(['r1', 'r2', 'r3']);
    expect(ensureRow).not.toHaveBeenCalled();
  });

  it('hydrates rows once the value aggregates the Y field', async () => {
    const { ensureRow } = setup(baseSettings, ['r1', 'r2'], { r1: '4', r2: '6' });
    const { result, rerender } = renderHook(({ settings }) => useChartData({ settings }), {
      initialProps: { settings: baseSettings },
    });

    await waitFor(() => expect(numberValue(result)).toBe(2));
    expect(ensureRow).not.toHaveBeenCalled();

    rerender({ settings: { ...baseSettings, aggregationType: ChartAggregationType.Sum, yFieldId: amountFieldId } });

    await waitFor(() => expect(numberValue(result)).toBe(10));
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

    await waitFor(() => expect(numberValue(result)).toBe(10));
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
    await waitFor(() => expect(numberValue(result)).toBe(4));
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

    await waitFor(() => expect(numberValue(result)).toBe(15));

    act(() => {
      const row = rowMetas.r1.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get(amountFieldId).set(YjsDatabaseKey.data, '40');
    });

    await waitFor(() => expect(numberValue(result)).toBe(45));
  });

  it('recomputes when the summed cell is first filled in', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1', 'r2'], { r1: '10' });

    const { result } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(numberValue(result)).toBe(10));

    act(() => {
      const row = rowMetas.r2.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      const cell = new Y.Map() as YDatabaseCell;

      cell.set(YjsDatabaseKey.field_type, FieldType.Number);
      cell.set(YjsDatabaseKey.data, '7');
      row.get(YjsDatabaseKey.cells).set(amountFieldId, cell);
    });

    await waitFor(() => expect(numberValue(result)).toBe(17));
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

    await waitFor(() => expect(numberValue(result)).toBe(10));
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
    await waitFor(() => expect(numberValue(result)).toBe(12));
  });

  it('keeps the row observers while the row map is replaced with the same docs', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1', 'r2'], { r1: '10', r2: '5' });
    const root = rowMetas.r1.getMap(YjsEditorKey.data_section);
    const observeDeep = jest.spyOn(root, 'observeDeep');
    const unobserveDeep = jest.spyOn(root, 'unobserveDeep');

    const { result, rerender } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(numberValue(result)).toBe(15));
    await waitFor(() => expect(observeDeep).toHaveBeenCalledTimes(1));

    // Another row doc of the database arriving gives `Database` a new map
    // object; the charted docs are the same, so nothing re-subscribes.
    (useRowMap as jest.Mock).mockReturnValue({ ...rowMetas, r3: createRowDoc('r3', databaseId, {}) });
    rerender();

    expect(unobserveDeep).not.toHaveBeenCalled();
    expect(observeDeep).toHaveBeenCalledTimes(1);

    // A charted doc replaced by its canonical copy is re-observed.
    const canonical = createRowDoc('r1', databaseId, { [amountFieldId]: createCell(FieldType.Number, '20') });
    const canonicalRoot = canonical.getMap(YjsEditorKey.data_section);
    const observeCanonical = jest.spyOn(canonicalRoot, 'observeDeep');

    (useRowMap as jest.Mock).mockReturnValue({ ...rowMetas, r1: canonical });
    rerender();

    expect(unobserveDeep).toHaveBeenCalledTimes(1);
    expect(observeCanonical).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(numberValue(result)).toBe(25));
  });

  it('returns a single zero item when no rows match', async () => {
    setup(baseSettings, [], {});

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ value: 0, rowIds: [] })]);
    expect(numberValue(result)).toBe(0);
  });
});

describe('useChartData rows added after the first load', () => {
  const databaseId = 'added-rows-database';
  const doneFieldId = 'done';
  const settings: ChartLayoutSettings = {
    chartType: ChartType.Bar,
    xFieldId: doneFieldId,
    showEmptyValues: true,
    aggregationType: ChartAggregationType.Count,
    cumulative: false,
    dateCondition: DateGroupCondition.Month,
    extended: DEFAULT_CHART_EXTENDED_SETTINGS,
  };

  function setup() {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, doneFieldId, FieldType.Checkbox);
    const docs = {
      r1: createRowDoc('r1', databaseId, { [doneFieldId]: createCell(FieldType.Checkbox, 'Yes') }),
      r2: createRowDoc('r2', databaseId, { [doneFieldId]: createCell(FieldType.Checkbox, 'Yes') }),
    };
    let deliverR2: () => void = () => undefined;
    const r2Loaded = new Promise<void>((resolve) => {
      deliverR2 = resolve;
    });
    const ensureRow = jest.fn((rowId: string) => (rowId === 'r2' ? r2Loaded : Promise.resolve()));

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }]);
    (useRowMap as jest.Mock).mockReturnValue({ r1: docs.r1 });
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-1' });

    // The row map gains r2 once its load resolves, as `Database` does.
    const arrive = async () => {
      (useRowMap as jest.Mock).mockReturnValue(docs);
      await act(async () => {
        deliverR2();
        await r2Loaded;
      });
    };

    return { arrive, docs, ensureRow };
  }

  it('keeps the chart, not the spinner, while the new row loads and counts it once it arrives', async () => {
    const { arrive, ensureRow } = setup();
    const { result, rerender } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

    // A row created in a grid next to this chart on a dashboard.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender();

    expect(ensureRow).toHaveBeenCalledWith('r2');
    expect(result.current.isLoading).toBe(false);
    // Not an "Unchecked" / empty bucket for a row whose cells are unknown yet.
    expect(result.current.chartData).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

    await arrive();
    rerender();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Checked', value: 2, rowIds: ['r1', 'r2'] }),
    ]);
  });

  it('shows the spinner again while another view loads its rows', async () => {
    const { arrive, ensureRow } = setup();
    const { result, rerender } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Switching chart tabs keeps this hook mounted.
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-2' });
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender();

    expect(result.current.isLoading).toBe(true);

    await arrive();
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Checked', value: 2, rowIds: ['r1', 'r2'] }),
    ]);
  });

  it('shows the spinner while a bulk change loads its rows', async () => {
    const { docs } = setup();
    let deliverBulk: () => void = () => undefined;
    const bulkLoaded = new Promise<void>((resolve) => {
      deliverBulk = resolve;
    });
    const ensureRow = jest.fn((rowId: string) => (rowId === 'r1' ? Promise.resolve() : bulkLoaded));

    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-1' });
    const { result, rerender } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // An import, or a widened filter: more rows than one round of loads.
    const bulkIds = Array.from({ length: ROW_LOAD_CONCURRENCY + 1 }, (_, index) => `bulk-${index}`);

    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, ...bulkIds.map((id) => ({ id }))]);
    rerender();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.chartData).toEqual([]);

    const bulkDocs = Object.fromEntries(
      bulkIds.map((id) => [id, createRowDoc(id, databaseId, { [doneFieldId]: createCell(FieldType.Checkbox, 'Yes') })])
    );

    (useRowMap as jest.Mock).mockReturnValue({ r1: docs.r1, ...bulkDocs });
    await act(async () => {
      deliverBulk();
      await bulkLoaded;
    });
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Checked', value: ROW_LOAD_CONCURRENCY + 2 }),
    ]);
  });
});

describe('computeNumberChartData', () => {
  it('leaves a row out of the aggregate until its doc arrives', () => {
    const databaseId = 'number-pending-database';
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;
    const doneField = addField(fields, 'done', FieldType.Checkbox);
    const rowMetas = { r1: createRowDoc('r1', databaseId, { done: createCell(FieldType.Checkbox, 'Yes') }) };

    // A missing checkbox cell reads as 0, which would halve the average.
    expect(
      computeNumberChartData({
        aggregation: ChartAggregationType.Average,
        rowOrders: [{ id: 'r1' }, { id: 'r2' }],
        rowDocs: rowMetas,
        yField: doneField,
      })
    ).toEqual([expect.objectContaining({ value: 1, rowIds: ['r1'] })]);

    // A row count needs no doc.
    expect(
      computeNumberChartData({
        aggregation: ChartAggregationType.Count,
        rowOrders: [{ id: 'r1' }, { id: 'r2' }],
        rowDocs: rowMetas,
        yField: doneField,
      })
    ).toEqual([expect.objectContaining({ value: 2, rowIds: ['r1', 'r2'] })]);
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
    extended: DEFAULT_CHART_EXTENDED_SETTINGS,
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
