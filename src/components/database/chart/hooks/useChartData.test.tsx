import { act, renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { TFunction } from 'i18next';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

// Real English strings, so labels read like the UI ("No Status", "Week of …").
jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    initImmediate: false,
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
  });
  // react-i18next memoizes `t`; one reference keeps the chart memo honest.
  const t = i18n.t.bind(i18n);

  return { useTranslation: () => ({ t }) };
});

jest.mock('@/application/database-yjs', () => {
  const actual = jest.requireActual('@/application/database-yjs');

  return {
    ...actual,
    useDatabaseContext: jest.fn(),
    useDatabaseFields: jest.fn(),
    useDatabaseView: jest.fn(),
    useRowMap: jest.fn(),
    useRowOrdersSelector: jest.fn(),
  };
});

import {
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useRowMap,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_LAYOUT_SETTINGS } from '@/application/database-yjs/chart-layout-setting';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  CHECKBOX_CHECKED_COLOR,
  CHECKBOX_UNCHECKED_COLOR,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { SelectOption, SelectOptionColor } from '@/application/database-yjs/fields';
import { DatabaseHistoryRowStore } from '@/application/database-yjs/history-row-store';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YDoc,
  YjsDatabaseKey,
  YMapFieldTypeOption,
} from '@/application/types';
import { chartDataEqual } from '@/components/database/chart/widgets/chartUtils';

import {
  aggregateChartValues,
  bucketKeyToLabel,
  compareDateBucketKeys,
  dateToBucketKey,
  relativeBucketSortOrder,
  useChartData,
} from './useChartData';

const { t } = (jest.requireMock('react-i18next') as { useTranslation: () => { t: TFunction } }).useTranslation();

interface FieldSpec {
  id: string;
  type: FieldType;
  name?: string;
  options?: SelectOption[];
}

interface RowSpec {
  id: string;
  cells?: Record<string, ReturnType<typeof createCell>>;
  createdAt?: string;
}

function addField(fields: YDatabaseFields, { id, type, name = id, options }: FieldSpec): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  fields.set(id, field);
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
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

async function renderChart({
  fields: fieldSpecs,
  rows,
  settings: patch = {},
  fieldOrder,
}: {
  fields: FieldSpec[];
  rows: RowSpec[];
  settings?: Partial<ChartLayoutSettings>;
  /** The view's `field_orders`; omitted means the hook sees no view. */
  fieldOrder?: string[];
}) {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const fieldMaps = Object.fromEntries(fieldSpecs.map((spec) => [spec.id, addField(fields, spec)]));
  const rowMetas: Record<string, YDoc> = Object.fromEntries(
    rows.map(({ id, cells = {}, createdAt }) => [id, createRowDoc(id, 'chart-database', cells, createdAt)])
  );
  const view = fieldOrder ? doc.getMap('view') : undefined;
  const fieldOrders = new Y.Array<{ id: string }>();

  if (view && fieldOrder) {
    view.set(YjsDatabaseKey.field_orders, fieldOrders);
    fieldOrders.push(fieldOrder.map((id) => ({ id })));
  }

  const rowOrders = rows.map(({ id }) => ({ id }));

  (useDatabaseFields as jest.Mock).mockReturnValue(fields);
  (useDatabaseView as jest.Mock).mockReturnValue(view);
  (useRowOrdersSelector as jest.Mock).mockReturnValue(rowOrders);
  (useRowMap as jest.Mock).mockReturnValue(rowMetas);
  (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: jest.fn().mockResolvedValue(undefined) });

  const settings: ChartLayoutSettings = { ...DEFAULT_CHART_LAYOUT_SETTINGS, ...patch };
  const hook = renderHook(() => useChartData({ settings }));

  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

  return { ...hook, doc, fieldMaps, fieldOrders, rowMetas };
}

const summarize = (data: ChartDataItem[]) => data.map(({ label, value }) => [label, value]);
const labelsOf = (data: ChartDataItem[]) => data.map(({ label }) => label);

/** A local date-time, so bucket keys do not depend on the test's time zone. */
const at = (year: number, month: number, day: number, hour = 12) => dayjs(new Date(year, month - 1, day, hour));
const dateCell = (year: number, month: number, day: number, hour?: number) =>
  createCell(FieldType.DateTime, String(at(year, month, day, hour).unix()));

const STATUS_OPTIONS: SelectOption[] = [
  { id: 'opt-todo', name: 'Todo', color: SelectOptionColor.OptionColor2 },
  { id: 'opt-done', name: 'Done', color: SelectOptionColor.OptionColor12 },
];
const STATUS_FIELD: FieldSpec = { id: 'status', name: 'Status', type: FieldType.SingleSelect, options: STATUS_OPTIONS };
const TAGS_FIELD: FieldSpec = {
  id: 'tags',
  name: 'Tags',
  type: FieldType.MultiSelect,
  options: [
    { id: 'opt-a', name: 'A', color: SelectOptionColor.OptionColor1 },
    { id: 'opt-b', name: 'B', color: SelectOptionColor.OptionColor3 },
  ],
};
const DUE_FIELD: FieldSpec = { id: 'due', name: 'Due', type: FieldType.DateTime };
const DONE_FIELD: FieldSpec = { id: 'done', name: 'Done', type: FieldType.Checkbox };
const AMOUNT_FIELD: FieldSpec = { id: 'amount', name: 'Amount', type: FieldType.Number };

const status = (optionId: string) => createCell(FieldType.SingleSelect, optionId);
const tags = (optionIds: string) => createCell(FieldType.MultiSelect, optionIds);
const amount = (value: number) => createCell(FieldType.Number, String(value));

describe('useChartData desktop-model field conversion', () => {
  it('parses both chart axes with the current fields and reacts to schema-only changes', async () => {
    const { result, doc, fieldMaps } = await renderChart({
      fields: [
        {
          id: 'x-field',
          type: FieldType.MultiSelect,
          options: [{ id: 'opt-yes', name: 'Yes', color: SelectOptionColor.OptionColor1 }],
        },
        { id: 'y-field', type: FieldType.Number },
      ],
      rows: [
        {
          id: 'row-a',
          cells: {
            'x-field': createCell(FieldType.RichText, 'Yes'),
            'y-field': createCell(FieldType.RichText, 'true'),
          },
        },
      ],
      settings: { xFieldId: 'x-field', yFieldId: 'y-field', aggregationType: ChartAggregationType.Sum },
    });

    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Yes', value: 0, rowIds: ['row-a'] }),
      expect.objectContaining({ label: 'No x-field', value: 0, rowIds: [], isEmptyCategory: true }),
    ]);

    act(() => {
      doc.transact(() => {
        fieldMaps['x-field'].set(YjsDatabaseKey.type, FieldType.Checkbox);
        fieldMaps['y-field'].set(YjsDatabaseKey.type, FieldType.Checkbox);
      });
    });

    await waitFor(() => {
      expect(result.current.chartData).toEqual([
        expect.objectContaining({ label: 'Checked', value: 1, rowIds: ['row-a'] }),
      ]);
    });
  });

  it('aggregates all historical rows through the bounded snapshot accessor without live hydration', async () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;

    addField(fields, { id: 'category', type: FieldType.Checkbox });
    addField(fields, { id: 'amount', type: FieldType.Number });
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
    const settings: ChartLayoutSettings = {
      ...DEFAULT_CHART_LAYOUT_SETTINGS,
      xFieldId: 'category',
      yFieldId: 'amount',
      aggregationType: ChartAggregationType.Sum,
    };

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useDatabaseView as jest.Mock).mockReturnValue(undefined);
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rows);
    (useRowMap as jest.Mock).mockReturnValue(store.rows);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow, dataSource: { type: 'history', id: 'chart' } });
    const { result, unmount } = renderHook(() => useChartData({ settings }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(summarize(result.current.chartData)).toEqual([
      ['Checked', 40000],
      ['Unchecked', 39800],
    ]);
    expect(ensureRow).not.toHaveBeenCalled();
    expect(store.cachedDocumentCount).toBeLessThanOrEqual(128);
    unmount();
    store.destroy();
    doc.destroy();
  });
});

describe('useChartData "No {field}" bucket', () => {
  it('always emits it for single and multi select fields, even with no rows', async () => {
    const single = await renderChart({ fields: [STATUS_FIELD], rows: [] });

    expect(single.result.current.chartData).toEqual([
      { label: 'No Status', value: 0, rowIds: [], isEmptyCategory: true },
    ]);

    const multi = await renderChart({
      fields: [TAGS_FIELD],
      rows: [{ id: 'r1', cells: { tags: tags('opt-a,opt-b') } }, { id: 'r2', cells: { tags: tags('opt-a') } }],
    });

    expect(multi.result.current.chartData).toEqual([
      expect.objectContaining({ label: 'A', value: 2, rowIds: ['r1', 'r2'] }),
      expect.objectContaining({ label: 'B', value: 1, rowIds: ['r1'] }),
      expect.objectContaining({ label: 'No Tags', value: 0, rowIds: [], isEmptyCategory: true }),
    ]);
  });

  it('collects select rows without a known option and is dropped by omitEmptyValues', async () => {
    const rows: RowSpec[] = [
      { id: 'r1', cells: { status: status('opt-todo') } },
      { id: 'r2' },
      { id: 'r3', cells: { status: status('') } },
    ];
    const shown = await renderChart({ fields: [STATUS_FIELD], rows });

    expect(shown.result.current.chartData.map(({ label, rowIds }) => [label, rowIds])).toEqual([
      ['Todo', ['r1']],
      ['No Status', ['r2', 'r3']],
    ]);

    const omitted = await renderChart({ fields: [STATUS_FIELD], rows, settings: { omitEmptyValues: true } });

    expect(labelsOf(omitted.result.current.chartData)).toEqual(['Todo']);

    const emptyMulti = await renderChart({ fields: [TAGS_FIELD], rows: [], settings: { omitEmptyValues: true } });

    expect(emptyMulti.result.current.chartData).toEqual([]);
  });

  it('never exists for checkbox fields: missing cells count as Unchecked', async () => {
    const rows: RowSpec[] = [
      { id: 'r1', cells: { done: createCell(FieldType.Checkbox, 'Yes') } },
      { id: 'r2', cells: { done: createCell(FieldType.Checkbox, 'No') } },
      { id: 'r3' },
      // Collab's checkbox parse: 1 / true / yes in any case.
      { id: 'r4', cells: { done: createCell(FieldType.Checkbox, 'TRUE') } },
      { id: 'r5', cells: { done: createCell(FieldType.Checkbox, '1') } },
    ];

    for (const omitEmptyValues of [false, true]) {
      const { result } = await renderChart({ fields: [DONE_FIELD], rows, settings: { omitEmptyValues } });

      // `isCheckedCategory` lets the drill-down filter by value, not by the localized label.
      expect(result.current.chartData).toEqual([
        {
          label: 'Checked',
          value: 3,
          rowIds: ['r1', 'r4', 'r5'],
          isEmptyCategory: false,
          isCheckedCategory: true,
          color: CHECKBOX_CHECKED_COLOR,
        },
        {
          label: 'Unchecked',
          value: 2,
          rowIds: ['r2', 'r3'],
          isEmptyCategory: false,
          isCheckedCategory: false,
          color: CHECKBOX_UNCHECKED_COLOR,
        },
      ]);
    }
  });

  it('exists for date fields only when some rows have no date, and is dropped by omitEmptyValues', async () => {
    const dated = await renderChart({
      fields: [DUE_FIELD],
      rows: [{ id: 'r1', cells: { due: dateCell(2026, 3, 15) } }],
      settings: { dateCondition: DateGroupCondition.Month },
    });

    expect(labelsOf(dated.result.current.chartData)).toEqual(['Mar 2026']);

    const rows: RowSpec[] = [
      { id: 'r1', cells: { due: dateCell(2026, 3, 15) } },
      { id: 'r2' },
      { id: 'r3', cells: { due: createCell(FieldType.DateTime, '') } },
    ];
    const shown = await renderChart({ fields: [DUE_FIELD], rows, settings: { dateCondition: DateGroupCondition.Month } });

    // The bucket key travels with the item for the drill-down's date range.
    expect(shown.result.current.chartData).toEqual([
      { label: 'Mar 2026', value: 1, rowIds: ['r1'], isEmptyCategory: false, sortKey: '2026-03' },
      { label: 'No Due', value: 2, rowIds: ['r2', 'r3'], isEmptyCategory: true },
    ]);

    const omitted = await renderChart({
      fields: [DUE_FIELD],
      rows,
      settings: { dateCondition: DateGroupCondition.Month, omitEmptyValues: true },
    });

    expect(labelsOf(omitted.result.current.chartData)).toEqual(['Mar 2026']);
  });

  it('translates the label with the raw field name', async () => {
    const { result } = await renderChart({
      fields: [{ ...STATUS_FIELD, name: 'Q1 & <Q2>' }],
      rows: [],
    });

    expect(labelsOf(result.current.chartData)).toEqual(['No Q1 & <Q2>']);
  });
});

describe('useChartData select / checkbox buckets', () => {
  it('sorts labels by UTF-16 code units, not locale order, with the empty bucket last', async () => {
    const names = ['b', 'é', 'B', '9', 'a', 'Ä', 'Z', '10'];
    const options = names.map((name, i) => ({ id: `opt-${i}`, name, color: SelectOptionColor.OptionColor1 }));
    const { result } = await renderChart({
      fields: [{ id: 'letter', name: 'Letter', type: FieldType.SingleSelect, options }],
      rows: options.map((option) => ({ id: `row-${option.id}`, cells: { letter: createCell(FieldType.SingleSelect, option.id) } })),
    });

    expect(labelsOf(result.current.chartData)).toEqual(['10', '9', 'B', 'Z', 'a', 'b', 'Ä', 'é', 'No Letter']);
    // localeCompare would interleave cases and accents instead.
    expect([...names].sort((x, y) => x.localeCompare(y))).not.toEqual(['10', '9', 'B', 'Z', 'a', 'b', 'Ä', 'é']);
  });

  it('resolves a single select to its first known option and drops unknown ids', async () => {
    const { result } = await renderChart({
      fields: [STATUS_FIELD],
      rows: [
        { id: 'r1', cells: { status: status('ghost,opt-done') } },
        { id: 'r2', cells: { status: status('ghost') } },
        { id: 'r3', cells: { status: status('opt-todo,opt-done') } },
      ],
    });

    expect(result.current.chartData.map(({ label, rowIds }) => [label, rowIds])).toEqual([
      ['Done', ['r1']],
      ['Todo', ['r3']],
      ['No Status', ['r2']],
    ]);
  });

  it('merges options that share a name, keeping the first color seen, and labels unnamed options by id', async () => {
    const { result } = await renderChart({
      fields: [
        {
          id: 'kind',
          name: 'Kind',
          type: FieldType.MultiSelect,
          options: [
            { id: 'dup-1', name: 'Dup', color: SelectOptionColor.OptionColor3 },
            { id: 'dup-2', name: 'Dup', color: SelectOptionColor.OptionColor5 },
            { id: 'nameless', name: '', color: SelectOptionColor.OptionColor7 },
          ],
        },
      ],
      rows: [
        { id: 'r1', cells: { kind: tags('dup-2') } },
        { id: 'r2', cells: { kind: tags('dup-1,nameless') } },
      ],
    });

    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Dup', rowIds: ['r1', 'r2'], color: 'var(--tag-fill-05-light)' }),
      expect.objectContaining({ label: 'nameless', rowIds: ['r2'], color: 'var(--tag-fill-07-light)' }),
      expect.objectContaining({ label: 'No Kind', rowIds: [] }),
    ]);
  });

  it('counts a row holding two same-named options once in their shared bucket', async () => {
    // Desktop adds the row once per option: a count of 2, a Y value counted
    // twice, and the row listed twice in the drill-down.
    const { result } = await renderChart({
      fields: [
        {
          id: 'kind',
          name: 'Kind',
          type: FieldType.MultiSelect,
          options: [
            { id: 'dup-1', name: 'Dup', color: SelectOptionColor.OptionColor3 },
            { id: 'dup-2', name: 'Dup', color: SelectOptionColor.OptionColor5 },
            { id: 'other', name: 'Other', color: SelectOptionColor.OptionColor7 },
          ],
        },
        AMOUNT_FIELD,
      ],
      rows: [
        { id: 'r1', cells: { kind: tags('dup-1,dup-2,other'), amount: amount(5) } },
        { id: 'r2', cells: { kind: tags('dup-2'), amount: amount(7) } },
      ],
      settings: { xFieldId: 'kind', yFieldId: 'amount', aggregationType: ChartAggregationType.Sum },
    });

    expect(result.current.chartData).toEqual([
      expect.objectContaining({ label: 'Dup', value: 12, rowIds: ['r1', 'r2'] }),
      expect.objectContaining({ label: 'Other', value: 5, rowIds: ['r1'] }),
      expect.objectContaining({ label: 'No Kind', rowIds: [] }),
    ]);
  });

  it('colors option buckets with tag tokens and leaves other buckets to the palette, whatever the label', async () => {
    const { result } = await renderChart({
      fields: [
        {
          ...STATUS_FIELD,
          // An option named like a checkbox bucket still gets its own tag color.
          options: [...STATUS_OPTIONS, { id: 'opt-checked', name: 'Checked', color: SelectOptionColor.OptionColor5 }],
        },
      ],
      rows: [
        { id: 'r1', cells: { status: status('opt-todo') } },
        { id: 'r2', cells: { status: status('opt-done') } },
        { id: 'r3', cells: { status: status('opt-checked') } },
        { id: 'r4' },
      ],
    });

    expect(result.current.chartData).toEqual([
      {
        label: 'Checked',
        value: 1,
        rowIds: ['r3'],
        isEmptyCategory: false,
        color: 'var(--tag-fill-05-light)',
        textColor: 'var(--tag-text-05-light)',
      },
      {
        label: 'Done',
        value: 1,
        rowIds: ['r2'],
        isEmptyCategory: false,
        color: 'var(--tag-fill-02-thick)',
        textColor: 'var(--tag-text-02-thick)',
      },
      {
        label: 'Todo',
        value: 1,
        rowIds: ['r1'],
        isEmptyCategory: false,
        color: 'var(--tag-fill-02-light)',
        textColor: 'var(--tag-text-02-light)',
      },
      { label: 'No Status', value: 1, rowIds: ['r4'], isEmptyCategory: true },
    ]);
    expect(result.current.chartData[3]).not.toHaveProperty('color');
    expect(result.current.chartData[3]).not.toHaveProperty('textColor');

    const dates = await renderChart({ fields: [DUE_FIELD], rows: [{ id: 'r1', cells: { due: dateCell(2026, 3, 1) } }] });

    expect(dates.result.current.chartData[0]).not.toHaveProperty('color');
    expect(dates.result.current.chartData[0]).not.toHaveProperty('textColor');
  });
});

describe('useChartData aggregation', () => {
  const rows: RowSpec[] = [
    { id: 'r1', cells: { status: status('opt-todo'), amount: amount(10) } },
    { id: 'r2', cells: { status: status('opt-todo'), amount: amount(20) } },
    { id: 'r3', cells: { status: status('opt-todo'), amount: amount(20) } },
    { id: 'r4', cells: { status: status('opt-todo') } },
    { id: 'r5', cells: { status: status('opt-done'), amount: amount(5) } },
    { id: 'r6', cells: { amount: amount(7) } },
  ];

  it.each([
    { name: 'Count', type: ChartAggregationType.Count, expected: [1, 4, 1] },
    { name: 'Sum', type: ChartAggregationType.Sum, expected: [5, 50, 7] },
    { name: 'Average', type: ChartAggregationType.Average, expected: [5, 50 / 3, 7] },
    { name: 'Min', type: ChartAggregationType.Min, expected: [5, 10, 7] },
    { name: 'Max', type: ChartAggregationType.Max, expected: [5, 20, 7] },
    { name: 'Median', type: ChartAggregationType.Median, expected: [5, 20, 7] },
    { name: 'CountValues', type: ChartAggregationType.CountValues, expected: [1, 2, 1] },
  ])('$name folds each bucket like desktop', async ({ type, expected }) => {
    const { result } = await renderChart({
      fields: [STATUS_FIELD, AMOUNT_FIELD],
      rows,
      settings: { xFieldId: 'status', yFieldId: 'amount', aggregationType: type },
    });

    expect(summarize(result.current.chartData)).toEqual([
      ['Done', expected[0]],
      ['Todo', expected[1]],
      ['No Status', expected[2]],
    ]);
  });

  it('leaves non-Count buckets at 0 without a usable Y field', async () => {
    const withoutY = await renderChart({
      fields: [STATUS_FIELD, AMOUNT_FIELD],
      rows,
      settings: { xFieldId: 'status', aggregationType: ChartAggregationType.Sum },
    });

    expect(withoutY.result.current.chartData.map(({ label, value, rowIds }) => [label, value, rowIds.length])).toEqual([
      ['Done', 0, 1],
      ['Todo', 0, 4],
      ['No Status', 0, 1],
    ]);

    // A text field never yields Y values, even when its text is numeric.
    const textY = await renderChart({
      fields: [STATUS_FIELD, { id: 'note', type: FieldType.RichText }],
      rows: [{ id: 'r1', cells: { status: status('opt-todo'), note: createCell(FieldType.RichText, '42') } }],
      settings: { xFieldId: 'status', yFieldId: 'note', aggregationType: ChartAggregationType.Sum },
    });

    expect(summarize(textY.result.current.chartData)).toEqual([
      ['Todo', 0],
      ['No Status', 0],
    ]);
  });

  it('counts a multi-select row without options in the empty bucket but skips its Y value (desktop quirk)', async () => {
    const { result } = await renderChart({
      fields: [TAGS_FIELD, AMOUNT_FIELD],
      rows: [
        { id: 'r1', cells: { tags: tags('opt-a'), amount: amount(10) } },
        { id: 'r2', cells: { amount: amount(7) } },
        { id: 'r3', cells: { tags: tags('opt-a,opt-b'), amount: amount(1) } },
      ],
      settings: { xFieldId: 'tags', yFieldId: 'amount', aggregationType: ChartAggregationType.Sum },
    });

    expect(result.current.chartData.map(({ label, value, rowIds }) => [label, value, rowIds])).toEqual([
      ['A', 11, ['r1', 'r3']],
      ['B', 1, ['r3']],
      ['No Tags', 0, ['r2']],
    ]);
  });

  it('reads checkbox Y values as 1 / 0 with empty cells counting as 0', async () => {
    const checkboxRows: RowSpec[] = [
      { id: 'r1', cells: { status: status('opt-todo'), done: createCell(FieldType.Checkbox, 'Yes') } },
      { id: 'r2', cells: { status: status('opt-todo'), done: createCell(FieldType.Checkbox, 'No') } },
      { id: 'r3', cells: { status: status('opt-todo') } },
      { id: 'r4', cells: { status: status('opt-todo'), done: createCell(FieldType.Checkbox, 'yes') } },
    ];
    const average = await renderChart({
      fields: [STATUS_FIELD, DONE_FIELD],
      rows: checkboxRows,
      settings: { xFieldId: 'status', yFieldId: 'done', aggregationType: ChartAggregationType.Average },
    });

    expect(summarize(average.result.current.chartData)).toEqual([
      ['Todo', 0.5],
      ['No Status', 0],
    ]);

    const distinct = await renderChart({
      fields: [STATUS_FIELD, DONE_FIELD],
      rows: checkboxRows,
      settings: { xFieldId: 'status', yFieldId: 'done', aggregationType: ChartAggregationType.CountValues },
    });

    expect(summarize(distinct.result.current.chartData)[0]).toEqual(['Todo', 2]);
  });

  it('reads date Y values as days since the epoch', async () => {
    const { result } = await renderChart({
      fields: [STATUS_FIELD, DUE_FIELD],
      rows: [
        { id: 'r1', cells: { status: status('opt-todo'), due: createCell(FieldType.DateTime, '86400') } },
        { id: 'r2', cells: { status: status('opt-todo'), due: createCell(FieldType.DateTime, '172800') } },
        { id: 'r3', cells: { status: status('opt-todo') } },
      ],
      settings: { xFieldId: 'status', yFieldId: 'due', aggregationType: ChartAggregationType.Average },
    });

    expect(summarize(result.current.chartData)[0]).toEqual(['Todo', 1.5]);

    // Created time lives on the row, not in a cell.
    const created = await renderChart({
      fields: [STATUS_FIELD, { id: 'created', type: FieldType.CreatedTime }],
      rows: [
        { id: 'r1', cells: { status: status('opt-todo') }, createdAt: String(10 * 86400) },
        { id: 'r2', cells: { status: status('opt-todo') }, createdAt: String(4 * 86400) },
      ],
      settings: { xFieldId: 'status', yFieldId: 'created', aggregationType: ChartAggregationType.Max },
    });

    expect(summarize(created.result.current.chartData)[0]).toEqual(['Todo', 10]);
  });

  it('matches aggregateValuesForTest for the pure fold', () => {
    expect(aggregateChartValues(ChartAggregationType.Count, 3, [])).toBe(3);
    expect(aggregateChartValues(ChartAggregationType.Count, 2, [5, 6, 7])).toBe(2);
    expect(aggregateChartValues(ChartAggregationType.CountValues, 3, [1, 1, 2])).toBe(2);
    expect(aggregateChartValues(ChartAggregationType.Median, 4, [3, 1, 10, 2])).toBe(2.5);
    expect(aggregateChartValues(ChartAggregationType.Median, 3, [3, 1, 10])).toBe(3);
    expect(aggregateChartValues(ChartAggregationType.Min, 2, [-4, 2])).toBe(-4);
    expect(aggregateChartValues(ChartAggregationType.Max, 2, [-4, 2])).toBe(2);

    for (const type of [
      ChartAggregationType.Sum,
      ChartAggregationType.Average,
      ChartAggregationType.Min,
      ChartAggregationType.Max,
      ChartAggregationType.Median,
      ChartAggregationType.CountValues,
    ]) {
      expect(aggregateChartValues(type, 5, [])).toBe(0);
    }
  });

  it('never accumulates values across buckets', async () => {
    const legacySettings = { dateCondition: DateGroupCondition.Month, cumulative: true } as Partial<ChartLayoutSettings>;
    const { result } = await renderChart({
      fields: [DUE_FIELD],
      rows: [
        { id: 'r1', cells: { due: dateCell(2026, 2, 3) } },
        { id: 'r2', cells: { due: dateCell(2026, 3, 3) } },
        { id: 'r3', cells: { due: dateCell(2026, 3, 9) } },
        { id: 'r4', cells: { due: dateCell(2026, 4, 1) } },
        { id: 'r5', cells: { due: dateCell(2026, 4, 2) } },
        { id: 'r6', cells: { due: dateCell(2026, 4, 3) } },
      ],
      settings: legacySettings,
    });

    expect(summarize(result.current.chartData)).toEqual([
      ['Feb 2026', 1],
      ['Mar 2026', 2],
      ['Apr 2026', 3],
    ]);
  });
});

describe('useChartData date buckets', () => {
  it('buckets Day / Week / Month / Year chronologically with desktop labels', async () => {
    const rows: RowSpec[] = [
      { id: 'r1', cells: { due: dateCell(2026, 3, 15, 10) } },
      { id: 'r2', cells: { due: dateCell(2026, 4, 1) } },
      { id: 'r3', cells: { due: dateCell(2026, 3, 15, 22) } },
      { id: 'r4', cells: { due: dateCell(2026, 1, 1) } },
      { id: 'r5', cells: { due: dateCell(2025, 2, 10) } },
    ];
    const run = async (dateCondition: DateGroupCondition) =>
      summarize((await renderChart({ fields: [DUE_FIELD], rows, settings: { dateCondition } })).result.current.chartData);

    expect(await run(DateGroupCondition.Day)).toEqual([
      ['February 10, 2025', 1],
      ['January 1, 2026', 1],
      ['March 15, 2026', 2],
      ['April 1, 2026', 1],
    ]);
    expect(await run(DateGroupCondition.Week)).toEqual([
      ['Week of Feb 10 - 16 2025', 1],
      ['Week of Dec 29 2025 - Jan 04 2026', 1],
      ['Week of Mar 09 - 15 2026', 2],
      ['Week of Mar 30 - Apr 05 2026', 1],
    ]);
    expect(await run(DateGroupCondition.Month)).toEqual([
      ['Feb 2025', 1],
      ['Jan 2026', 1],
      ['Mar 2026', 2],
      ['Apr 2026', 1],
    ]);
    expect(await run(DateGroupCondition.Year)).toEqual([
      ['2025', 1],
      ['2026', 4],
    ]);
  });

  it('buckets Relative dates against now in desktop order', async () => {
    jest.useFakeTimers({
      now: new Date(2026, 2, 15, 12),
      doNotFake: [
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
      ],
    });

    try {
      const { result } = await renderChart({
        fields: [DUE_FIELD],
        rows: [
          { id: 'next-month', cells: { due: dateCell(2026, 6, 1) } },
          { id: 'tomorrow', cells: { due: dateCell(2026, 3, 16) } },
          { id: 'last-30', cells: { due: dateCell(2026, 2, 20) } },
          { id: 'none' },
          { id: 'today', cells: { due: dateCell(2026, 3, 15, 8) } },
          { id: 'next-30', cells: { due: dateCell(2026, 4, 1) } },
          { id: 'last-7', cells: { due: dateCell(2026, 3, 10) } },
          { id: 'old-month', cells: { due: dateCell(2025, 12, 5) } },
          { id: 'yesterday', cells: { due: dateCell(2026, 3, 14) } },
          { id: 'next-7', cells: { due: dateCell(2026, 3, 20) } },
          { id: 'jan', cells: { due: dateCell(2026, 1, 10) } },
        ],
        settings: { dateCondition: DateGroupCondition.Relative },
      });

      expect(result.current.chartData.map(({ label, rowIds }) => [label, rowIds])).toEqual([
        ['Last 30 days', ['last-30']],
        ['Last 7 days', ['last-7']],
        ['Yesterday', ['yesterday']],
        ['Today', ['today']],
        ['Tomorrow', ['tomorrow']],
        ['Next 7 days', ['next-7']],
        ['Next 30 days', ['next-30']],
        ['Dec 2025', ['old-month']],
        ['Jan 2026', ['jan']],
        ['Jun 2026', ['next-month']],
        ['No Due', ['none']],
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads created time from the row', async () => {
    const { result } = await renderChart({
      fields: [{ id: 'created', name: 'Created', type: FieldType.CreatedTime }],
      rows: [
        { id: 'r1', createdAt: String(at(2026, 3, 2).unix()) },
        { id: 'r2', createdAt: String(at(2026, 1, 20).unix()) },
        { id: 'r3', createdAt: String(at(2026, 3, 28).unix()) },
      ],
      settings: { dateCondition: DateGroupCondition.Month },
    });

    expect(summarize(result.current.chartData)).toEqual([
      ['Jan 2026', 1],
      ['Mar 2026', 2],
    ]);
  });

  it('ports ChartUtils.dateToBucketKey', () => {
    const now = at(2026, 3, 15);
    const key = (date: dayjs.Dayjs, condition: DateGroupCondition) => dateToBucketKey(date, condition, now);

    expect(key(at(2026, 3, 15, 23), DateGroupCondition.Day)).toBe('2026-03-15');
    // Weeks start on Monday: Sunday the 15th belongs to Monday the 9th.
    expect(key(at(2026, 3, 15), DateGroupCondition.Week)).toBe('2026-03-09');
    expect(key(at(2026, 3, 9), DateGroupCondition.Week)).toBe('2026-03-09');
    expect(key(at(2026, 4, 1), DateGroupCondition.Week)).toBe('2026-03-30');
    expect(key(at(2026, 1, 1), DateGroupCondition.Week)).toBe('2025-12-29');
    expect(key(at(2026, 3, 15), DateGroupCondition.Month)).toBe('2026-03');
    expect(key(at(2026, 3, 15), DateGroupCondition.Year)).toBe('2026');

    expect(key(at(2026, 3, 15, 0), DateGroupCondition.Relative)).toBe('today');
    expect(key(at(2026, 3, 14, 23), DateGroupCondition.Relative)).toBe('yesterday');
    expect(key(at(2026, 3, 16, 0), DateGroupCondition.Relative)).toBe('tomorrow');
    expect(key(at(2026, 3, 13), DateGroupCondition.Relative)).toBe('last_7_days');
    expect(key(at(2026, 3, 8), DateGroupCondition.Relative)).toBe('last_7_days');
    expect(key(at(2026, 3, 7), DateGroupCondition.Relative)).toBe('last_30_days');
    expect(key(at(2026, 2, 13), DateGroupCondition.Relative)).toBe('last_30_days');
    expect(key(at(2026, 2, 12), DateGroupCondition.Relative)).toBe('month_2026-02');
    expect(key(at(2026, 3, 17), DateGroupCondition.Relative)).toBe('next_7_days');
    expect(key(at(2026, 3, 22), DateGroupCondition.Relative)).toBe('next_7_days');
    expect(key(at(2026, 3, 23), DateGroupCondition.Relative)).toBe('next_30_days');
    expect(key(at(2026, 4, 14), DateGroupCondition.Relative)).toBe('next_30_days');
    expect(key(at(2026, 4, 15), DateGroupCondition.Relative)).toBe('month_2026-04');
  });

  it('ports ChartUtils.bucketKeyToLabel', () => {
    expect(bucketKeyToLabel('2026-03-05', DateGroupCondition.Day, t)).toBe('March 5, 2026');
    expect(bucketKeyToLabel('2026-03-09', DateGroupCondition.Week, t)).toBe('Week of Mar 09 - 15 2026');
    expect(bucketKeyToLabel('2026-03-30', DateGroupCondition.Week, t)).toBe('Week of Mar 30 - Apr 05 2026');
    expect(bucketKeyToLabel('2025-12-29', DateGroupCondition.Week, t)).toBe('Week of Dec 29 2025 - Jan 04 2026');
    expect(bucketKeyToLabel('2026-03', DateGroupCondition.Month, t)).toBe('Mar 2026');
    expect(bucketKeyToLabel('2026', DateGroupCondition.Year, t)).toBe('2026');
    expect(bucketKeyToLabel('today', DateGroupCondition.Relative, t)).toBe('Today');
    expect(bucketKeyToLabel('yesterday', DateGroupCondition.Relative, t)).toBe('Yesterday');
    expect(bucketKeyToLabel('tomorrow', DateGroupCondition.Relative, t)).toBe('Tomorrow');
    expect(bucketKeyToLabel('last_7_days', DateGroupCondition.Relative, t)).toBe('Last 7 days');
    expect(bucketKeyToLabel('next_7_days', DateGroupCondition.Relative, t)).toBe('Next 7 days');
    expect(bucketKeyToLabel('last_30_days', DateGroupCondition.Relative, t)).toBe('Last 30 days');
    expect(bucketKeyToLabel('next_30_days', DateGroupCondition.Relative, t)).toBe('Next 30 days');
    expect(bucketKeyToLabel('month_2026-01', DateGroupCondition.Relative, t)).toBe('Jan 2026');
    expect(bucketKeyToLabel('garbage', DateGroupCondition.Day, t)).toBe('garbage');
  });

  it('ports the Relative sort order: ranges first, then months chronologically', () => {
    const keys = [
      'month_2026-06',
      'today',
      'next_30_days',
      'month_2025-12',
      'last_7_days',
      'tomorrow',
      'last_30_days',
      'month_2026-01',
      'yesterday',
      'next_7_days',
    ];

    expect([...keys].sort((a, b) => compareDateBucketKeys(a, b, DateGroupCondition.Relative))).toEqual([
      'last_30_days',
      'last_7_days',
      'yesterday',
      'today',
      'tomorrow',
      'next_7_days',
      'next_30_days',
      'month_2025-12',
      'month_2026-01',
      'month_2026-06',
    ]);
    expect(relativeBucketSortOrder('month_2026-01')).toBe(7);
    expect(relativeBucketSortOrder('unknown')).toBe(8);
  });
});

describe('useChartData X-axis field', () => {
  it('defaults to the first groupable field in the view order and follows reordering', async () => {
    const { result, fieldOrders } = await renderChart({
      fields: [STATUS_FIELD, AMOUNT_FIELD, DONE_FIELD],
      rows: [{ id: 'r1', cells: { status: status('opt-todo'), done: createCell(FieldType.Checkbox, 'Yes') } }],
      fieldOrder: ['amount', 'done', 'status'],
    });

    expect(result.current.groupableFields.map(({ id }) => id)).toEqual(['done', 'status']);
    expect(labelsOf(result.current.chartData)).toEqual(['Checked']);

    act(() => {
      fieldOrders.delete(0, fieldOrders.length);
      fieldOrders.push([{ id: 'status' }, { id: 'done' }, { id: 'amount' }]);
    });

    await waitFor(() => expect(labelsOf(result.current.chartData)).toEqual(['Todo', 'No Status']));
  });
});

describe('useChartData loading state', () => {
  const rowsOf = (ids: string[]) => ids.map((id) => ({ id }));

  it('shows the spinner only until the first rows are ensured', async () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;

    addField(fields, STATUS_FIELD);
    const rowMetas = { r1: createRowDoc('r1', 'chart-database', { status: status('opt-todo') }) };
    let finishLoad!: () => void;
    const ensureRow = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        })
    );

    (useDatabaseFields as jest.Mock).mockReturnValue(fields);
    (useDatabaseView as jest.Mock).mockReturnValue(undefined);
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rowsOf(['r1']));
    (useRowMap as jest.Mock).mockReturnValue(rowMetas);
    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });
    const { result } = renderHook(() => useChartData({ settings: DEFAULT_CHART_LAYOUT_SETTINGS }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.chartData).toEqual([]);
    await waitFor(() => expect(ensureRow).toHaveBeenCalledWith('r1'));
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(summarize(result.current.chartData)).toEqual([
      ['Todo', 1],
      ['No Status', 0],
    ]);
  });

  it('keeps the last chart on screen while rows that arrive later load, instead of the spinner', async () => {
    const { result, rerender, rowMetas } = await renderChart({
      fields: [STATUS_FIELD],
      rows: [{ id: 'r1', cells: { status: status('opt-todo') } }],
    });
    const shown = result.current.chartData;

    expect(summarize(shown)).toEqual([
      ['Todo', 1],
      ['No Status', 0],
    ]);

    // A collaborator adds a row: its doc needs a network round trip.
    let finishLoad!: () => void;
    const ensureRow = jest.fn((rowId: string) =>
      rowId === 'r2'
        ? new Promise<void>((resolve) => {
            finishLoad = resolve;
          })
        : Promise.resolve()
    );

    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });
    (useRowOrdersSelector as jest.Mock).mockReturnValue(rowsOf(['r1', 'r2']));
    (useRowMap as jest.Mock).mockReturnValue({
      ...rowMetas,
      r2: createRowDoc('r2', 'chart-database', { status: status('opt-done') }),
    });
    rerender();

    await waitFor(() => expect(ensureRow).toHaveBeenCalledWith('r2'));
    expect(result.current.isLoading).toBe(false);
    // The pending row is neither shown as a spinner nor bucketed as empty.
    expect(summarize(result.current.chartData)).toEqual(summarize(shown));

    await act(async () => {
      finishLoad();
    });
    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 1],
        ['No Status', 0],
      ])
    );
    expect(result.current.isLoading).toBe(false);
  });
});

describe('chartDataEqual', () => {
  it('compares text colors', () => {
    const item: ChartDataItem = { label: 'A', value: 1, rowIds: ['r1'], color: 'var(--a)', textColor: 'var(--b)' };

    expect(chartDataEqual([item], [{ ...item }])).toBe(true);
    expect(chartDataEqual([item], [{ ...item, textColor: 'var(--c)' }])).toBe(false);
  });
});
