/**
 * The two Notion formulas from AppFlowy issue #9039, pasted verbatim (see
 * issue-9039-formulas.json). They are long, multi-line, use block comments,
 * nested if/ifs, lets, list methods and Notion's style(), and name properties
 * with leading, trailing and doubled spaces.
 */
import dayjs, { Dayjs } from 'dayjs';

import { FieldType } from '@/application/database-yjs/database.type';

import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import { CellSpec, createFields, createRow, FieldSpec } from './fixture';
import issue from './issue-9039-formulas.json';

// Tuesday, ISO week 10.
const NOW = dayjs('2024-03-05T10:30:00');
const TODAY = NOW.startOf('day');
const day = (offset: number) => TODAY.add(offset, 'day');

type Value = boolean | number | Dayjs | null;

const INPUTS: Array<[name: string, type: FieldType]> = [
  ['Done', FieldType.Checkbox],
  ['Archives', FieldType.Checkbox],
  ['Next ', FieldType.Checkbox],
  ['Hold', FieldType.Checkbox],
  ['Snooze Deadline', FieldType.DateTime],
  ['Deadline Date', FieldType.DateTime],
  [' Start  Date', FieldType.DateTime],
  ['Completed', FieldType.Number],
  ['Goal', FieldType.Number],
];

function cellOf(type: FieldType, value: Value): CellSpec | undefined {
  if (value === null || value === false) return undefined;
  switch (type) {
    case FieldType.Checkbox:
      return { type, data: 'Yes' };
    case FieldType.DateTime:
      return {
        type,
        data: String((value as Dayjs).unix()),
        extra: { is_range: false, include_time: false },
      };
    default:
      return { type, data: String(value) };
  }
}

function evaluate(expression: string, values: Record<string, Value>) {
  const fields = createFields([
    ...INPUTS.map(([name, type], index): FieldSpec => ({ id: `f${index}`, name, type })),
    { id: 'probe', name: 'Probe', type: FieldType.Formula, typeOption: { expression } },
  ]);
  const cells: Record<string, CellSpec> = {};

  INPUTS.forEach(([name, type], index) => {
    const cell = cellOf(type, values[name] ?? null);

    if (cell) cells[`f${index}`] = cell;
  });
  const { row } = createRow('row', cells);

  return evaluateFormulaCell({
    schema: readFormulaSchema(fields),
    field: fields.get('probe'),
    fieldId: 'probe',
    row,
    rowId: 'row',
    now: () => NOW.valueOf(),
  });
}

function formula(expression: string, values: Record<string, Value>): string {
  const result = evaluate(expression, values);

  if (result.error) throw new Error(result.error);
  return result.text;
}

describe('issue #9039 status formula (nested if, formatDate, style, progress bar)', () => {
  // In progress since Sunday, due in 5 days, snoozable for 9: 3 of 10 done.
  const BASE: Record<string, Value> = {
    ' Start  Date': day(-2),
    'Deadline Date': day(5),
    'Snooze Deadline': day(9),
    Completed: 3,
    Goal: 10,
  };
  const PROGRESS = ' ➜  ██░░░░░░░ 30%';

  it.each<[title: string, changes: Record<string, Value>, expected: string]>([
    ['done hides the progress', { Done: true }, '✅Done'],
    ['archived hides the progress', { Archives: true }, '🗃️ Archive '],
    ['next (property name with a trailing space)', { 'Next ': true }, `🔵 Next goal${PROGRESS}`],
    ['on hold', { Hold: true }, `▶️ Hold ${PROGRESS}`],
    ['snooze deadline passed', { 'Snooze Deadline': day(-4) }, ` 🔴 Late Snooze Friday${PROGRESS}`],
    [
      'due today, inside the snooze window',
      { 'Deadline Date': TODAY, 'Snooze Deadline': day(3) },
      `⏰ In progress${PROGRESS}`,
    ],
    [
      'deadline passed with no snooze (style() is dropped)',
      { 'Deadline Date': day(-1), 'Snooze Deadline': null },
      ` 🔴 Late Deadline Monday${PROGRESS}`,
    ],
    ['in progress (property name with doubled spaces)', {}, `🟢 In progress Sunday${PROGRESS}`],
    [
      'starts later this ISO week',
      { ' Start  Date': day(3), 'Deadline Date': day(10), 'Snooze Deadline': day(15) },
      `🔵 The Next Goal Friday${PROGRESS}`,
    ],
    [
      'starts next ISO week',
      { ' Start  Date': day(7), 'Deadline Date': day(10), 'Snooze Deadline': day(15) },
      `↗ The Next Goal  Tuesday${PROGRESS}`,
    ],
    [
      'starts in a month',
      { ' Start  Date': day(28), 'Deadline Date': day(35), 'Snooze Deadline': day(40) },
      `↗ The future${PROGRESS}`,
    ],
    ['goal reached (style() is dropped)', { Completed: 10 }, '🟢 In progress Sunday ➜ 100% Completed 💪'],
    // Like Notion, empty(0) is true, so the formula appends "0%" to the rounded 0.
    ['nothing completed yet', { Completed: 0 }, '🟢 In progress Sunday ➜ ░░░░░░░░░░ 00%'],
  ])('%s', (_title, changes, expected) => {
    expect(formula(issue.statusFormula, { ...BASE, ...changes })).toBe(expected);
  });
});

describe('issue #9039 Hijri month formula (lets, block comments, lists, ifs)', () => {
  // Expected months follow the formula's own 30-year-cycle approximation.
  it.each<[start: string, expected: string]>([
    ['2023-12-01', '📅 جمادى الأولى'],
    ['2024-01-01', '📅 جمادى الآخرة'],
    ['2024-03-03', '📅 شعبان'],
    ['2024-03-20', '📅 رمضان'],
    ['2024-04-20', '📅 شوال'],
    ['2024-07-10', '📅 محرم'],
    ['2025-06-15', '📅 ذو الحجة'],
  ])('%s is %s', (start, expected) => {
    expect(formula(issue.hijriMonthFormula, { ' Start  Date': dayjs(start) })).toBe(expected);
  });

  it('is empty without a start date', () => {
    expect(formula(issue.hijriMonthFormula, {})).toBe('');
  });
});

describe('style() and unstyle()', () => {
  it.each<[expression: string, expected: string]>([
    ['style("Done")', 'Done'],
    ['style("Done", "b")', 'Done'],
    ['"Late".style("c", "b", "red", "red_background")', 'Late'],
    ['"a".style("b") + "b".style("i")', 'ab'],
    ['unstyle("Done")', 'Done'],
    ['"Done".style("b").unstyle("b")', 'Done'],
  ])('%s', (expression, expected) => {
    expect(formula(expression, {})).toBe(expected);
  });

  it('keeps the text type', () => {
    expect(evaluate('style("x", "b")', {}).resultType).toBe('text');
  });

  it('only styles text', () => {
    expect(evaluate('style(1, "b")', {}).error).toBeTruthy();
  });
});
