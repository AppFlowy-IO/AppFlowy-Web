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

// Workspace members for people axes (`buildIdentifierLabels`).
let mockMembers: Array<{ person_id: string; uid: string; name: string; email: string }> = [];

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockMembers, loading: false }),
}));

// English defaults unless a test sets a translation. `t` keeps its identity, as it does per language.
const mockTranslations: Record<string, string> = {};
// The app language (`useAppLocale` reads it; '' is the en-US fallback).
let mockLanguage = '';

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) =>
    mockTranslations[key] ?? options?.defaultValue ?? key;

  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});

import { useDatabaseContext, useDatabaseFields, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { CHART_ALL_SERIES_KEY, ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
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

import * as chartCompute from './chartCompute';
import { computeNumberChartData, sortByFieldOrder, touchesChartedRowData } from './chartCompute';
import { chartColorToFixture, toCategoryItems } from './chartSeries';
import { ensureRowsWithConcurrency, ROW_LOAD_CONCURRENCY } from './rowLoadPool';
import { useChartData, UseChartDataReturn } from './useChartData';

/** The Number chart's value: its single item, or null while there is none. */
function numberValue(result: { current: UseChartDataReturn }): number | null {
  return result.current.numberItem ? result.current.numberItem.value : null;
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Yes', value: 0, rowIds: [rowId] })]);

    act(() => {
      databaseDoc.transact(() => {
        xField.set(YjsDatabaseKey.type, FieldType.Checkbox);
        yField.set(YjsDatabaseKey.type, FieldType.Checkbox);
      });
    });

    await waitFor(() => {
      expect(toCategoryItems(result.current.seriesData)).toEqual([
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
    mockLanguage = '';
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
    expect(toCategoryItems(result.current.seriesData).map(({ label, value }) => [label, value])).toEqual([
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
    // R-GROUPKEY: `rel:` bucket keys, the plain month key for farther dates.
    expect(toCategoryItems(result.current.seriesData).map(({ key }) => key)).toEqual([
      'rel:last_30_days',
      'rel:last_7_days',
      'rel:yesterday',
      'rel:today',
      'rel:tomorrow',
      'rel:next_7_days',
      'rel:next_30_days',
      '2026-04',
      '__empty__',
    ]);
  });

  it('labels day and week buckets like desktop, in the current language', async () => {
    const cells = { a: String(dayjs(new Date(2026, 2, 11)).unix()), b: undefined };
    const englishWeek = renderChart(FieldType.DateTime, cells, DateGroupCondition.Week);

    await waitFor(() => expect(englishWeek.result.current.isLoading).toBe(false));
    expect(toCategoryItems(englishWeek.result.current.seriesData).map((item) => item.label)).toEqual([
      'Week of Mar 9 - Mar 15, 2026',
      'No Due',
    ]);

    Object.assign(mockTranslations, {
      'board.dateCondition.weekOf': 'Semaine du {} au {}',
      'chart.noFieldValue': 'Sans {}',
    });
    mockLanguage = 'fr-FR';
    const day = renderChart(FieldType.DateTime, cells, DateGroupCondition.Day);

    await waitFor(() => expect(day.result.current.isLoading).toBe(false));
    expect(toCategoryItems(day.result.current.seriesData).map((item) => item.label)).toEqual(['11 mars 2026', 'Sans Due']);

    const week = renderChart(FieldType.DateTime, cells, DateGroupCondition.Week);

    await waitFor(() => expect(week.result.current.isLoading).toBe(false));
    expect(toCategoryItems(week.result.current.seriesData).map((item) => item.label)).toEqual([
      'Semaine du 9 mars au 15 mars 2026',
      'Sans Due',
    ]);
  });

  it('relabels the dates when the language changes, without reordering them', async () => {
    const cells = {
      a: String(dayjs(new Date(2026, 1, 10)).unix()),
      b: String(dayjs(new Date(2026, 0, 20)).unix()),
      c: String(dayjs(new Date(2026, 1, 3)).unix()),
    };
    const chart = renderChart(FieldType.DateTime, cells, DateGroupCondition.Month);

    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(toCategoryItems(chart.result.current.seriesData).map(({ key, label }) => [key, label])).toEqual([
      ['2026-01', 'Jan 2026'],
      ['2026-02', 'Feb 2026'],
    ]);

    mockLanguage = 'ja-JP';
    chart.rerender();
    expect(toCategoryItems(chart.result.current.seriesData).map(({ key, label, rowIds }) => [key, label, rowIds])).toEqual([
      ['2026-01', '2026年1月', ['b']],
      ['2026-02', '2026年2月', ['a', 'c']],
    ]);
  });

  it('translates the checkbox categories', async () => {
    Object.assign(mockTranslations, { 'chart.checked': 'Coché', 'chart.unchecked': 'Non coché' });
    const { result } = renderChart(FieldType.Checkbox, { a: 'Yes', b: 'No', c: 'Yes' }, DateGroupCondition.Month);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData)).toEqual([
      expect.objectContaining({ label: 'Coché', rowIds: ['a', 'c'], key: 'checked' }),
      expect.objectContaining({ label: 'Non coché', rowIds: ['b'], key: 'unchecked' }),
    ]);
    // The checkbox state colours each category (the build carries it as the checkbox colours).
    expect(result.current.seriesData.categories.map((category) => chartColorToFixture(category.color))).toEqual([
      '#72BC8F',
      '#C7C6C4',
    ]);
  });

  it('reads every checked spelling the server and desktop write', async () => {
    Object.assign(mockTranslations, { 'chart.checked': 'Checked', 'chart.unchecked': 'Unchecked' });
    const { result } = renderChart(
      FieldType.Checkbox,
      { a: 'true', b: '1', c: 'YES', d: 'No', e: 'false', f: '0' },
      DateGroupCondition.Month
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData)).toEqual([
      expect.objectContaining({ key: 'checked', rowIds: ['a', 'b', 'c'] }),
      expect.objectContaining({ key: 'unchecked', rowIds: ['d', 'e', 'f'] }),
    ]);
  });

  it('keeps the group key and leaves painting the colors to the renderer', async () => {
    const { result } = renderChart(FieldType.Checkbox, { a: 'Yes' }, DateGroupCondition.Month);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The build resolves each colour to a hex and an opacity step; the theme paints it (WP12 §2.2).
    expect(result.current.seriesData.categories.map((category) => [category.key, chartColorToFixture(category.color)])).toEqual([
      ['checked', '#72BC8F'],
    ]);
    toCategoryItems(result.current.seriesData).forEach((item) => expect(item.color).toBeUndefined());
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([
      expect.objectContaining({ label: 'Lead', key: 'lead', rowIds: ['r2'] }),
      expect.objectContaining({ label: 'Won', key: 'won', rowIds: ['r1'] }),
      expect.objectContaining({ label: 'No Stage', key: '__empty__', isEmptyCategory: true, rowIds: ['r3'] }),
    ]);
    // Auto colours a select axis by its options; the empty category is always the empty fill.
    const colors = () => result.current.seriesData.categories.map((category) => chartColorToFixture(category.color));

    expect(colors()).toEqual(['#5E9FE8', '#72BC8F', 'empty']);

    // A style change that colours nothing keeps the build: the chart re-renders nothing.
    const data = result.current.seriesData;

    rerender({
      settings: { ...settings, extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, legendPosition: 'off', decimalPlaces: 2 } },
    });
    expect(result.current.seriesData).toBe(data);

    // A colour theme is a builder input (WP12): the categories take its ramp.
    rerender({ settings: { ...settings, extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, colorTheme: 'blue' } } });
    expect(colors()).toEqual(['#5E9FE8', '#5E9FE8/0.7', 'empty']);
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
        expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })])
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);

    // A collaborator's row whose document cannot be opened.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender({ settings });
    await flush();

    expect(ensureRow).toHaveBeenCalledWith('r2');
    expect(result.current.loadError).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

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
      expect(toCategoryItems(result.current.seriesData)).toEqual([]);
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
      expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);
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
      expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1 })]);
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

  // WP11 computes 0–16: a combination the Y type cannot compute (12, 13, 15 on a Number field) and any
  // unknown integer count rows (`effectiveChartAggregation`), and are formatted as counts.
  it.each([12, 13, 15, 99, -1])('charts a row count for the aggregation %p a Number field cannot compute', async (stored) => {
    const { result } = setup(stored, ChartType.Bar);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Not the Y field's sum (100), and not formatted as a percentage, a date or days.
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 2 })]);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(result.current.yFormatField).toBeNull();
    expect(result.current.yFieldName).toBe('');
  });

  it.each([
    [ChartAggregationType.CountNotEmpty, 2],
    [ChartAggregationType.PercentEmpty, 0],
    [ChartAggregationType.Range, 20],
  ])('computes the WP11 aggregation %p over a Number field', async (stored, value) => {
    const { result } = setup(stored, ChartType.Bar);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value })]);
    expect(result.current.effectiveAggregation).toBe(stored);
    expect(result.current.yFieldName).toBe('amount');
  });

  it('counts rows for an aggregation the Y field cannot compute on a Number chart, without hydrating them', async () => {
    const { result, ensureRow } = setup(ChartAggregationType.PercentChecked, ChartType.Number);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(numberValue(result)).toBe(2);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(ensureRow).not.toHaveBeenCalled();
  });

  it('counts rows for a value aggregation whose Y field is gone, like the Number chart does', async () => {
    const { result } = setup(ChartAggregationType.Sum, ChartType.Bar, 'deleted-field');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 2 })]);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
  });

  it('keeps computing the aggregations it knows', async () => {
    const { result } = setup(ChartAggregationType.Sum, ChartType.Bar);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 100 })]);
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

  it('counts every filtered row, whatever the X axis', async () => {
    setup(baseSettings, ['r1', 'r2', 'r3'], {});

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A Number property groups an X axis into ranges (WP11 §1.4); the Number chart ignores the X axis.
    expect(result.current.hasGroupableFields).toBe(true);
    expect(result.current.numberItem).not.toBeNull();
    expect(result.current.numberItem).toEqual(expect.objectContaining({ value: 3, rowIds: ['r1', 'r2', 'r3'] }));
    expect(numberValue(result)).toBe(3);
    expect(result.current.effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(result.current.yFormatField).toBeNull();
  });

  it('counts every filtered row in a database without a field a chart can group by', async () => {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'tasks', FieldType.Checklist);
    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    (useRowMap as jest.Mock).mockReturnValue({});
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasGroupableFields).toBe(false);
    expect(numberValue(result)).toBe(2);
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
    expect(result.current.numberItem?.rowIds).toEqual(['r1', 'r2', 'r3']);
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
    expect(result.current.numberItem?.rowIds).toEqual(['r1', 'r2', 'r3']);
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
    const data = result.current.numberItem;

    rerender({ settings: { ...settings, titleText: 'Revenue', numberFormat: 'compact' } });
    expect(result.current.numberItem).toBe(data);

    rerender({ settings: { ...settings, xFieldId: 'other-field', dateCondition: DateGroupCondition.Year } });
    expect(result.current.numberItem).toBe(data);

    // Yjs hands out a fresh row-order array with the same rows.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender({ settings });
    expect(result.current.numberItem).toBe(data);

    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }]);
    rerender({ settings });
    await waitFor(() => expect(numberValue(result)).toBe(4));
    expect(result.current.numberItem).not.toBe(data);
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

    // Not in the same render: new docs for the same rows are taken a few at a time.
    expect(unobserveDeep).not.toHaveBeenCalled();
    await waitFor(() => expect(unobserveDeep).toHaveBeenCalledTimes(1));
    expect(observeCanonical).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(numberValue(result)).toBe(25));
  });

  it('takes new docs for the same rows a few at a time, re-observing only the rows they belong to', async () => {
    const settings: ChartLayoutSettings = {
      ...baseSettings,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: amountFieldId,
    };
    const { rowMetas } = setup(settings, ['r1', 'r2', 'r3'], { r1: '10', r2: '5', r3: '1' });
    const unobserveR3 = jest.spyOn(rowMetas.r3.getMap(YjsEditorKey.data_section), 'unobserveDeep');
    const compute = jest.spyOn(chartCompute, 'computeNumberChartData');

    try {
      const { result, rerender } = renderHook(() => useChartData({ settings }));

      await waitFor(() => expect(numberValue(result)).toBe(16));
      const computed = compute.mock.calls.length;
      // The loader connects the live docs of r1, then of r2, a batch at a time; the seeds hold the same values.
      const liveR1 = createRowDoc('r1', databaseId, { [amountFieldId]: createCell(FieldType.Number, '10') });
      const liveR2 = createRowDoc('r2', databaseId, { [amountFieldId]: createCell(FieldType.Number, '5') });
      const observeR1 = jest.spyOn(liveR1.getMap(YjsEditorKey.data_section), 'observeDeep');
      const observeR2 = jest.spyOn(liveR2.getMap(YjsEditorKey.data_section), 'observeDeep');

      (useRowMap as jest.Mock).mockReturnValue({ ...rowMetas, r1: liveR1 });
      rerender();
      (useRowMap as jest.Mock).mockReturnValue({ ...rowMetas, r1: liveR1, r2: liveR2 });
      rerender();

      // Neither batch recomputed the value or moved an observer yet.
      expect(compute.mock.calls.length).toBe(computed);
      expect(observeR1).not.toHaveBeenCalled();
      expect(observeR2).not.toHaveBeenCalled();

      // One settle takes both docs; r3, whose doc did not change, keeps its observer.
      await waitFor(() => expect(observeR2).toHaveBeenCalledTimes(1));
      expect(observeR1).toHaveBeenCalledTimes(1);
      expect(compute.mock.calls.length).toBe(computed + 1);
      expect(unobserveR3).not.toHaveBeenCalled();

      // The chart reads the live docs now.
      const row = liveR1.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      act(() => {
        row.get(YjsDatabaseKey.cells).get(amountFieldId).set(YjsDatabaseKey.data, '20');
      });
      await waitFor(() => expect(numberValue(result)).toBe(26));
    } finally {
      compute.mockRestore();
    }
  });

  it('returns a single zero item when no rows match', async () => {
    setup(baseSettings, [], {});

    const { result } = renderHook(() => useChartData({ settings: baseSettings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numberItem).toEqual(expect.objectContaining({ value: 0, rowIds: [] }));
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

    // A row created in a grid next to this chart on a dashboard.
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }]);
    rerender();

    expect(ensureRow).toHaveBeenCalledWith('r2');
    expect(result.current.isLoading).toBe(false);
    // Not an "Unchecked" / empty bucket for a row whose cells are unknown yet.
    expect(toCategoryItems(result.current.seriesData)).toEqual([expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] })]);

    await arrive();
    rerender();

    expect(result.current.isLoading).toBe(false);
    expect(toCategoryItems(result.current.seriesData)).toEqual([
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([
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
    expect(toCategoryItems(result.current.seriesData)).toEqual([]);

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
    expect(toCategoryItems(result.current.seriesData)).toEqual([
      expect.objectContaining({ label: 'Checked', value: ROW_LOAD_CONCURRENCY + 2 }),
    ]);
  });

  it('is in the loading state in the very render a bulk change arrives: no pass over the partial rows', async () => {
    setup();
    const ensureRow = jest.fn((rowId: string) => (rowId === 'r1' ? Promise.resolve() : new Promise<void>(() => undefined)));
    const compute = jest.spyOn(chartCompute, 'computeChartFacts');

    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, activeViewId: 'view-1' });
    try {
      const { result, rerender } = renderHook(() => useChartData({ settings }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(toCategoryItems(result.current.seriesData)).toEqual([
        expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['r1'] }),
      ]);
      const computed = compute.mock.calls.length;
      const bulkIds = Array.from({ length: ROW_LOAD_CONCURRENCY + 1 }, (_, index) => `bulk-${index}`);

      (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, ...bulkIds.map((id) => ({ id }))]);
      rerender();

      expect(result.current.isLoading).toBe(true);
      expect(toCategoryItems(result.current.seriesData)).toEqual([]);
      expect(compute.mock.calls.length).toBe(computed);
    } finally {
      compute.mockRestore();
    }
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
  expect(toCategoryItems(result.current.seriesData)).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Checked', value: 40000 }),
    expect.objectContaining({ label: 'Unchecked', value: 39800 }),
  ]));
  expect(ensureRow).not.toHaveBeenCalled();
  expect(store.cachedDocumentCount).toBeLessThanOrEqual(128);
  unmount();
  store.destroy();
  doc.destroy();
});

describe('useChartData WP11 configuration', () => {
  const databaseId = 'config-database';
  const STATUS = [
    { id: 'o-todo', name: 'Todo', color: 0 },
    { id: 'o-doing', name: 'Doing', color: 1 },
    { id: 'o-done', name: 'Done', color: 2 },
  ];

  interface ChartRow {
    id: string;
    cells: Record<string, ReturnType<typeof createCell>>;
    createdBy?: string;
  }

  function setup(
    defineFields: (fields: YDatabaseFields) => void,
    rows: ChartRow[],
    overrides: Partial<ChartLayoutSettings> & { extended?: Partial<ChartLayoutSettings['extended']> }
  ) {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    defineFields(fields);
    const rowMetas = Object.fromEntries(
      rows.map((row) => {
        const doc = createRowDoc(row.id, databaseId, row.cells);

        if (row.createdBy) {
          (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow).set(
            YjsDatabaseKey.created_by,
            row.createdBy
          );
        }

        return [row.id, doc];
      })
    );

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rows.map((row) => ({ id: row.id })));
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

    const settings: ChartLayoutSettings = {
      chartType: ChartType.Bar,
      xFieldId: 'status',
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Count,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      ...overrides,
      extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...overrides.extended },
    };

    return renderHook(() => useChartData({ settings }));
  }

  const select = (id: string) => createCell(FieldType.SingleSelect, id);
  const statusRows: ChartRow[] = [
    { id: 'r1', cells: { status: select('o-doing'), estimate: createCell(FieldType.Number, '3') } },
    { id: 'r2', cells: { status: select('o-todo'), estimate: createCell(FieldType.Number, '5') } },
    { id: 'r3', cells: { status: select('o-done'), estimate: createCell(FieldType.Number, '8') } },
  ];
  const statusFields = (fields: YDatabaseFields) => {
    addField(fields, 'status', FieldType.SingleSelect, STATUS);
    addField(fields, 'estimate', FieldType.Number);
  };

  const labels = (result: { current: UseChartDataReturn }) => toCategoryItems(result.current.seriesData).map((item) => item.label);

  afterEach(() => {
    mockMembers = [];
  });

  it('orders select categories by the option order, not A to Z, and keys them by option id', async () => {
    const { result } = setup(statusFields, statusRows, {});

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(labels(result)).toEqual(['Todo', 'Doing', 'Done']);
    expect(toCategoryItems(result.current.seriesData).map((item) => item.key)).toEqual(['o-todo', 'o-doing', 'o-done']);
  });

  it('keeps two options with the same name as two categories (desktop #23)', async () => {
    const { result } = setup(
      (fields) => addField(fields, 'status', FieldType.SingleSelect, [...STATUS, { id: 'o-doing-2', name: 'Doing', color: 3 }]),
      [
        { id: 'r1', cells: { status: select('o-doing') } },
        { id: 'r2', cells: { status: select('o-doing-2') } },
        { id: 'r3', cells: { status: select('o-done') } },
      ],
      {}
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.key, item.label, item.value])).toEqual([
      ['o-doing', 'Doing', 1],
      ['o-done', 'Done', 1],
      ['o-doing-2', 'Doing', 1],
    ]);
  });

  it('leaves hidden groups out of the chart and lists them for the Groups page', async () => {
    const { result } = setup(statusFields, statusRows, { extended: { hiddenGroups: ['o-doing'] } });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(labels(result)).toEqual(['Todo', 'Done']);
    expect(result.current.allGroups.map((group) => [group.key, group.hidden, group.count])).toEqual([
      ['o-todo', false, 1],
      ['o-doing', true, 1],
      ['o-done', false, 1],
    ]);
  });

  it('sorts by value, high to low', async () => {
    const { result } = setup(statusFields, statusRows, {
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'estimate',
      extended: { xSort: 'value_desc' },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.label, item.value])).toEqual([
      ['Done', 8],
      ['Todo', 5],
      ['Doing', 3],
    ]);
  });

  it('groups a text property by first letter', async () => {
    const { result } = setup(
      (fields) => addField(fields, 'name', FieldType.RichText),
      [
        { id: 'r1', cells: { name: createCell(FieldType.RichText, 'API cleanup') } },
        { id: 'r2', cells: { name: createCell(FieldType.RichText, 'Mobile app') } },
        { id: 'r3', cells: { name: createCell(FieldType.RichText, 'apple') } },
        { id: 'r4', cells: { name: createCell(FieldType.RichText, '   ') } },
      ],
      { xFieldId: 'name', extended: { xTextGrouping: 'first_letter' } }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.key, item.label, item.value])).toEqual([
      ['l:A', 'A', 2],
      ['l:M', 'M', 1],
      ['__empty__', 'No name', 1],
    ]);
  });

  it('groups a number property into ranges', async () => {
    const rows = statusRows.map((row) => ({ id: row.id, cells: { estimate: row.cells.estimate } }));
    const auto = setup(statusFields, rows, { xFieldId: 'estimate' });

    await waitFor(() => expect(auto.result.current.isLoading).toBe(false));
    expect(labels(auto.result)).toEqual(['3–3.5', '5–5.5', '8–8.5']);

    const sized = setup(statusFields, rows, { xFieldId: 'estimate', extended: { xNumberBucketSize: 5 } });

    await waitFor(() => expect(sized.result.current.isLoading).toBe(false));
    expect(toCategoryItems(sized.result.current.seriesData).map((item) => [item.key, item.label, item.value])).toEqual([
      ['n:0', '0–5', 1],
      ['n:5', '5–10', 2],
    ]);
  });

  it('names Person groups after the workspace members', async () => {
    mockMembers = [{ person_id: 'p-ann', uid: '1001', name: 'Ann', email: 'ann@example.com' }];
    const { result } = setup(
      (fields) => addField(fields, 'owner', FieldType.Person),
      [
        { id: 'r1', cells: { owner: createCell(FieldType.Person, JSON.stringify(['p-ann'])) } },
        { id: 'r2', cells: { owner: createCell(FieldType.Person, JSON.stringify(['p-ann', 'p-zed'])) } },
      ],
      { xFieldId: 'owner' }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.key, item.label, item.value])).toEqual([
      ['p-ann', 'Ann', 2],
      ['p-zed', 'Unknown person', 1],
    ]);
  });

  it('relabels Person groups when the members arrive, without regrouping the rows', async () => {
    const compute = jest.spyOn(chartCompute, 'computeChartFacts');

    try {
      const { result, rerender } = setup(
        (fields) => addField(fields, 'owner', FieldType.Person),
        [{ id: 'r1', cells: { owner: createCell(FieldType.Person, JSON.stringify(['p-ann'])) } }],
        { xFieldId: 'owner' }
      );
      const groups = () => toCategoryItems(result.current.seriesData).map((item) => [item.key, item.label]);

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(groups()).toEqual([['p-ann', 'Unknown person']]);
      const computed = compute.mock.calls.length;

      // The members list arrives in the background.
      mockMembers = [{ person_id: 'p-ann', uid: '1001', name: 'Ann', email: 'ann@example.com' }];
      rerender();
      expect(groups()).toEqual([['p-ann', 'Ann']]);
      expect(compute.mock.calls.length).toBe(computed);
    } finally {
      compute.mockRestore();
    }
  });

  it('leaves the rows grouped when a property the chart does not read changes, and regroups for one it reads', async () => {
    const compute = jest.spyOn(chartCompute, 'computeChartFacts');
    let notes: YDatabaseField | undefined;
    let status: YDatabaseField | undefined;

    try {
      const { result } = setup(
        (fields) => {
          statusFields(fields);
          status = fields.get('status');
          notes = addField(fields, 'notes', FieldType.RichText);
        },
        statusRows,
        {}
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(labels(result)).toEqual(['Todo', 'Doing', 'Done']);
      const computed = compute.mock.calls.length;

      // A column renamed in a grid next to the chart.
      act(() => {
        notes?.set(YjsDatabaseKey.name, 'Remarks');
      });
      expect(compute.mock.calls.length).toBe(computed);

      // The X property renamed: its empty group is named after it.
      act(() => {
        status?.set(YjsDatabaseKey.name, 'Stage');
      });
      expect(compute.mock.calls.length).toBe(computed + 1);
    } finally {
      compute.mockRestore();
    }
  });

  it.each(['X axis', 'Group by'] as const)('refreshes Person fallback names after a %s field option changes', async (axis) => {
    const typeOption = new Y.Map() as YMapFieldTypeOption;
    const { result } = setup(
      (fields) => {
        addField(fields, 'status', FieldType.SingleSelect, STATUS);
        const owner = addField(fields, 'owner', FieldType.Person);
        const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;

        owner.set(YjsDatabaseKey.type_option, typeOptions);
        typeOptions.set(String(FieldType.Person), typeOption);
        typeOption.set(YjsDatabaseKey.content, JSON.stringify({ persons: [{ id: 'p-ann', name: 'Ann' }] }));
      },
      [{ id: 'r1', cells: { status: select('o-todo'), owner: createCell(FieldType.Person, JSON.stringify(['p-ann'])) } }],
      axis === 'X axis' ? { xFieldId: 'owner' } : { extended: { groupByFieldId: 'owner' } }
    );
    const personGroups = () =>
      axis === 'X axis' ? result.current.seriesData.categories : result.current.seriesData.series;

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(personGroups()).toEqual([expect.objectContaining({ key: 'p-ann', label: 'Ann' })]);

    act(() => {
      typeOption.set(YjsDatabaseKey.content, JSON.stringify({ persons: [{ id: 'p-ann', name: 'Beth' }] }));
    });

    await waitFor(() => expect(personGroups()).toEqual([expect.objectContaining({ key: 'p-ann', label: 'Beth' })]));
  });

  it('groups Created by from the row attribute', async () => {
    mockMembers = [{ person_id: 'p-cleo', uid: '1001', name: 'Cleo', email: 'cleo@example.com' }];
    const { result } = setup(
      (fields) => addField(fields, 'creator', FieldType.CreatedBy),
      [
        { id: 'r1', cells: {}, createdBy: '1001' },
        { id: 'r2', cells: {}, createdBy: '1001' },
        { id: 'r3', cells: {}, createdBy: '2002' },
      ],
      { xFieldId: 'creator' }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.key, item.label, item.value])).toEqual([
      ['1001', 'Cleo', 2],
      ['2002', 'Unknown user', 1],
    ]);
  });

  it('computes Percent checked and Earliest on a Number chart', async () => {
    const due = (days: number) => createCell(FieldType.DateTime, String(1717200000 + days * 86400));
    const fields = (all: YDatabaseFields) => {
      addField(all, 'urgent', FieldType.Checkbox);
      addField(all, 'due', FieldType.DateTime);
    };

    const rows: ChartRow[] = [
      { id: 'r1', cells: { urgent: createCell(FieldType.Checkbox, 'Yes'), due: due(3) } },
      { id: 'r2', cells: { urgent: createCell(FieldType.Checkbox, 'Yes'), due: due(0) } },
      { id: 'r3', cells: { urgent: createCell(FieldType.Checkbox, 'No') } },
    ];
    const percent = setup(fields, rows, {
      chartType: ChartType.Number,
      aggregationType: ChartAggregationType.PercentChecked,
      yFieldId: 'urgent',
    });

    await waitFor(() => expect(percent.result.current.isLoading).toBe(false));
    expect(numberValue(percent.result)).toBeCloseTo(66.6667, 3);
    expect(percent.result.current.effectiveAggregation).toBe(ChartAggregationType.PercentChecked);

    // A legacy Min over a date reads as Earliest, stored in days for R-FORMAT.
    const earliest = setup(fields, rows, { chartType: ChartType.Number, aggregationType: ChartAggregationType.Min, yFieldId: 'due' });

    await waitFor(() => expect(earliest.result.current.isLoading).toBe(false));
    expect(earliest.result.current.effectiveAggregation).toBe(ChartAggregationType.Earliest);
    expect(numberValue(earliest.result)).toBe(1717200000 / 86400);
  });

  it('shows no value for an average over empty cells on a Number chart', async () => {
    const { result } = setup(
      (fields) => addField(fields, 'estimate', FieldType.Number),
      [{ id: 'r1', cells: {} }],
      { chartType: ChartType.Number, aggregationType: ChartAggregationType.Average, yFieldId: 'estimate' }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numberItem).toBeNull();
  });

  it('runs the cumulative sum only where it applies', async () => {
    const bar = setup(statusFields, statusRows, { cumulative: true });

    await waitFor(() => expect(bar.result.current.isLoading).toBe(false));
    expect(toCategoryItems(bar.result.current.seriesData).map((item) => item.value)).toEqual([1, 2, 3]);

    const donut = setup(statusFields, statusRows, { cumulative: true, chartType: ChartType.Donut });

    await waitFor(() => expect(donut.result.current.isLoading).toBe(false));
    expect(toCategoryItems(donut.result.current.seriesData).map((item) => item.value)).toEqual([1, 1, 1]);
  });
});

describe('useChartData Group by (WP12)', () => {
  const databaseId = 'series-database';
  const CHANNEL = [
    { id: 'o-blog', name: 'Blog', color: 'Purple' as unknown as number },
    { id: 'o-video', name: 'Video', color: 'Pink' as unknown as number },
  ];
  const AUDIENCE = [
    { id: 'o-biz', name: 'Business', color: 'Orange' as unknown as number },
    { id: 'o-con', name: 'Consumers', color: 'Blue' as unknown as number },
  ];
  const select = (id: string) => createCell(FieldType.SingleSelect, id);

  function setup(overrides: Partial<ChartLayoutSettings> & { extended?: Partial<ChartLayoutSettings['extended']> }) {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    addField(fields, 'channel', FieldType.SingleSelect, CHANNEL).set(YjsDatabaseKey.name, 'Channel');
    addField(fields, 'audience', FieldType.SingleSelect, AUDIENCE).set(YjsDatabaseKey.name, 'Audience');
    const rowMetas = {
      r1: createRowDoc('r1', databaseId, { channel: select('o-blog'), audience: select('o-biz') }),
      r2: createRowDoc('r2', databaseId, { channel: select('o-blog'), audience: select('o-con') }),
      r3: createRowDoc('r3', databaseId, { channel: select('o-video'), audience: select('o-con') }),
    };

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

    const settings: ChartLayoutSettings = {
      chartType: ChartType.Bar,
      xFieldId: 'channel',
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Count,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      ...overrides,
      extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...overrides.extended },
    };

    return { rowMetas, hook: renderHook(() => useChartData({ settings })) };
  }

  const seriesOf = (result: { current: UseChartDataReturn }) =>
    result.current.seriesData.series.map((series) => ({
      key: series.key,
      label: series.label,
      color: chartColorToFixture(series.color),
      values: series.values,
      rowIds: series.rowIds,
    }));

  it('groups by a second select field: one series per option, coloured by the option', async () => {
    const { result } = setup({ extended: { groupByFieldId: 'audience' } }).hook;

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupByField?.get(YjsDatabaseKey.id)).toBe('audience');
    expect(result.current.seriesData.categories.map((category) => [category.key, category.color])).toEqual([
      ['o-blog', null],
      ['o-video', null],
    ]);
    expect(seriesOf(result)).toEqual([
      { key: 'o-biz', label: 'Business', color: '#DE9255', values: [1, 0], rowIds: [['r1'], []] },
      { key: 'o-con', label: 'Consumers', color: '#5E9FE8', values: [1, 1], rowIds: [['r2'], ['r3']] },
    ]);
  });

  it('re-derives when a Group by cell is edited in place', async () => {
    const { rowMetas, hook } = setup({ extended: { groupByFieldId: 'audience' } });
    const { result } = hook;

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      const row = rowMetas.r3.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get('audience').set(YjsDatabaseKey.data, 'o-biz');
    });
    await waitFor(() =>
      expect(seriesOf(result).map((series) => [series.key, series.values])).toEqual([
        ['o-biz', [1, 1]],
        ['o-con', [1, 0]],
      ])
    );
  });

  it('ignores a stored Group by equal to the X field, without rewriting it', async () => {
    const { result } = setup({ extended: { groupByFieldId: 'channel' } }).hook;

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupByField).toBeNull();
    expect(result.current.seriesData.series.map((series) => series.key)).toEqual([CHART_ALL_SERIES_KEY]);
    expect(toCategoryItems(result.current.seriesData).map((item) => [item.key, item.value])).toEqual([
      ['o-blog', 2],
      ['o-video', 1],
    ]);
  });

  it('builds a single series for a donut with a stored Group by', async () => {
    const { result } = setup({ chartType: ChartType.Donut, extended: { groupByFieldId: 'audience', groupStyle: 'grouped' } }).hook;

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupByField).toBeNull();
    expect(seriesOf(result)).toEqual([
      { key: CHART_ALL_SERIES_KEY, label: '', color: null, values: [2, 1], rowIds: [['r1', 'r2'], ['r3']] },
    ]);
    expect(result.current.seriesData.categories.map((category) => chartColorToFixture(category.color))).toEqual([
      '#BF8EDA',
      '#DF84A8',
    ]);
  });

  it('keeps the series of a line and leaves the Number chart without one', async () => {
    const line = setup({ chartType: ChartType.Line, extended: { groupByFieldId: 'audience' } }).hook;

    await waitFor(() => expect(line.result.current.isLoading).toBe(false));
    expect(line.result.current.seriesData.series.map((series) => series.key)).toEqual(['o-biz', 'o-con']);

    const number = setup({ chartType: ChartType.Number, extended: { groupByFieldId: 'audience' } }).hook;

    await waitFor(() => expect(number.result.current.isLoading).toBe(false));
    expect(number.result.current.seriesData.categories).toEqual([]);
    expect(number.result.current.numberItem?.value).toBe(3);
    expect(number.result.current.groupByField).toBeNull();
  });
});
