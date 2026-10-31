import * as Y from 'yjs';

import {
  calculationTypeToAggregation,
  computeBoardGroupCalculation,
  formatBoardGroupCalculation,
  GROUP_CALCULATION_COUNT_ALL,
  GROUP_CALCULATION_SUPPORTED_FIELD_TYPES,
  GROUP_CALCULATION_TO_AGGREGATION,
  GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE,
  readBoardGroupCalculation,
  validGroupCalculationTypes,
  type BoardGroupCalculationRow,
} from '@/application/database-yjs/board-group-calculation';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { groupCalculationValue, writeBoardLayoutKeys } from '@/application/database-yjs/dispatch/board';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { decodeParityJson, loadParityFixture, normalizeNumbers } from './dashboard-parity-helpers';
import { createField, createFieldWithTypeOption } from './test-helpers';

interface CalculationCase {
  name: string;
  field: { type: number; number_format?: number; date_format?: number; options?: [string, string][] };
  cells: unknown[];
  row_timestamps?: { created_at: number; modified_at: number }[];
  type: number;
  time_zone?: string;
  expected: { kind: 'none' | 'number' | 'date'; value?: number; timestamp_ms?: number };
  formatted: string;
}

interface CalculationFixture {
  supported_field_types: number[];
  valid_types_by_field_type: Record<string, number[]>;
  calculation_to_aggregation: Record<string, number>;
  cases: CalculationCase[];
}

interface BoardSettingsFixture {
  board: Record<string, unknown>;
  fields: { id: string; type: number }[];
  read_cases: { name: string; stored: Record<string, unknown>; read: { type: number; field_id: string } | null }[];
  write_cases: {
    name: string;
    stored: Record<string, unknown>;
    write: Record<string, unknown>;
    writtenKeys: string[];
    expected: Record<string, unknown>;
  }[];
}

const calculations = loadParityFixture<CalculationFixture>('group-calculations.json');
const boardSettings = loadParityFixture<BoardSettingsFixture>('layouts/board-settings.json');

function buildField(spec: CalculationCase['field']): YDatabaseField {
  const type = spec.type as FieldType;

  if (spec.options) {
    return createField('f', type, { options: spec.options.map(([id, name]) => ({ id, name, color: 'Purple' })) });
  }

  if (spec.number_format !== undefined) return createFieldWithTypeOption('f', type, { format: spec.number_format });
  if (spec.date_format !== undefined) {
    return createFieldWithTypeOption('f', type, { [YjsDatabaseKey.date_format]: spec.date_format });
  }

  return createField('f', type);
}

/** One fixture cell as the web stores it (`group-calculations.json` `encoding.cells`). */
function cellData(type: FieldType, value: unknown): string {
  switch (type) {
    case FieldType.Checkbox:
      return value ? 'Yes' : 'No';
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return Array.isArray(value) ? value.join(',') : String(value);
    case FieldType.Checklist: {
      const tasks = (value as { tasks: [string, boolean][] }).tasks;
      const options = tasks.map(([name], index) => ({ id: `t${index}`, name, color: 'Purple' }));

      return JSON.stringify({
        options,
        selected_option_ids: tasks.flatMap(([, done], index) => (done ? [`t${index}`] : [])),
      });
    }

    default:
      return String(value);
  }
}

function buildRows(testCase: CalculationCase): BoardGroupCalculationRow[] {
  const doc = new Y.Doc();
  const cells = doc.getMap('cells');

  return testCase.cells.map((value, index) => {
    const timestamps = testCase.row_timestamps?.[index];
    let cell: YDatabaseCell | undefined;

    if (value !== null) {
      cell = new Y.Map() as YDatabaseCell;
      cells.set(String(index), cell);
      cell.set(YjsDatabaseKey.field_type, testCase.field.type);
      cell.set(YjsDatabaseKey.data, cellData(testCase.field.type as FieldType, value));
    }

    return { cell, createdAt: timestamps?.created_at, lastModified: timestamps?.modified_at };
  });
}

describe('board group calculation tables', () => {
  it('match group-calculations.json exactly', () => {
    expect(GROUP_CALCULATION_SUPPORTED_FIELD_TYPES).toEqual(calculations.supported_field_types);
    expect(GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE).toEqual(calculations.valid_types_by_field_type);
    expect(GROUP_CALCULATION_TO_AGGREGATION).toEqual(calculations.calculation_to_aggregation);
  });

  it('lists the valid calculations of a field type in menu order, and none for other types', () => {
    expect(validGroupCalculationTypes(FieldType.Number)).toEqual([17, 6, 7, 15, 16, 4, 0, 3, 1, 2, 11]);
    expect(validGroupCalculationTypes(FieldType.URL)).toEqual([CalculationType.CountUnique]);
    expect(validGroupCalculationTypes(FieldType.Person)).toEqual([]);
    expect(calculationTypeToAggregation(CalculationType.Sum)).toBe(1);
  });
});

describe('computeBoardGroupCalculation and formatBoardGroupCalculation (group-calculations.json)', () => {
  it.each(calculations.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const field = buildField(testCase.field);
    const result = computeBoardGroupCalculation({
      type: testCase.type as CalculationType,
      field,
      rows: buildRows(testCase),
    });

    expect(result.kind).toBe(testCase.expected.kind);
    if (result.kind === 'number') expect(result.value).toBeCloseTo(testCase.expected.value ?? NaN, 9);
    if (result.kind === 'date') expect(result.timestampMs).toBe(testCase.expected.timestamp_ms);
    expect(
      formatBoardGroupCalculation(result, {
        type: testCase.type as CalculationType,
        field,
        locale: 'en-US',
        timeZone: testCase.time_zone,
      })
    ).toBe(testCase.formatted);
  });
});

describe('computeBoardGroupCalculation on a large column', () => {
  // Past the spread-argument limit of every engine (~124k in Chrome): `Math.min(...numbers)` overflows the call stack.
  const count = 200_000;

  it('finds the extents of a Number column of 200k cards in a loop', () => {
    const field = createField('f', FieldType.Number);
    const doc = new Y.Doc();
    const cells = doc.getMap('cells');
    const rows: BoardGroupCalculationRow[] = [];

    doc.transact(() => {
      for (let index = 0; index < count; index += 1) {
        const cell = new Y.Map() as YDatabaseCell;

        cells.set(String(index), cell);
        cell.set(YjsDatabaseKey.field_type, FieldType.Number);
        // A permutation of 0..count-1, so the extremes sit mid-column.
        cell.set(YjsDatabaseKey.data, String((index * 7919) % count));
        rows.push({ cell });
      }
    });

    const compute = (type: CalculationType) => computeBoardGroupCalculation({ type, field, rows });

    expect(compute(CalculationType.Min)).toEqual({ kind: 'number', value: 0 });
    expect(compute(CalculationType.Max)).toEqual({ kind: 'number', value: count - 1 });
    expect(compute(CalculationType.NumberRange)).toEqual({ kind: 'number', value: count - 1 });
    expect(compute(CalculationType.CountUnique)).toEqual({ kind: 'number', value: count });
  });

  it('finds the earliest, latest and range of 200k created times in a loop', () => {
    const field = createField('f', FieldType.CreatedTime);
    const day = 86_400;
    const rows: BoardGroupCalculationRow[] = Array.from({ length: count }, (_, index) => ({
      createdAt: ((index * 7919) % count) * day,
    }));
    const compute = (type: CalculationType) => computeBoardGroupCalculation({ type, field, rows });

    expect(compute(CalculationType.DateEarliest)).toEqual({ kind: 'date', timestampMs: 0 });
    expect(compute(CalculationType.DateLatest)).toEqual({ kind: 'date', timestampMs: (count - 1) * day * 1000 });
    expect(compute(CalculationType.DateRange)).toEqual({ kind: 'number', value: count - 1 });
  });
});

describe('readBoardGroupCalculation (layouts/board-settings.json)', () => {
  const fieldTypes = new Map(boardSettings.fields.map((field) => [field.id, field.type]));
  const resolveFieldType = (fieldId: string) => fieldTypes.get(fieldId);

  it.each(boardSettings.read_cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const stored = decodeParityJson(testCase.stored) as Record<string, unknown>;
    const read = readBoardGroupCalculation(stored.group_calculation, resolveFieldType);

    expect(read ? { type: read.type, field_id: read.fieldId } : null).toEqual(testCase.read);
  });

  it('reads a calculation stored as a Y.Map', () => {
    const doc = new Y.Doc();
    const layout = doc.getMap('layout');
    const stored = new Y.Map();

    layout.set('group_calculation', stored);
    stored.set('type', 4);
    stored.set('field_id', 'f_amount');
    expect(readBoardGroupCalculation(layout.get('group_calculation'), resolveFieldType)).toEqual({
      type: CalculationType.Sum,
      fieldId: 'f_amount',
    });
  });

  it('rejects a fractional type and a calculation the field type does not offer', () => {
    expect(readBoardGroupCalculation({ type: 4.5, field_id: 'f_amount' }, resolveFieldType)).toBeUndefined();
    expect(
      readBoardGroupCalculation({ type: CalculationType.Sum, field_id: 'f_name' }, resolveFieldType)
    ).toBeUndefined();
  });
});

describe('board layout writes (layouts/board-settings.json)', () => {
  it.each(boardSettings.write_cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const doc = new Y.Doc();
    const layout = doc.getMap<unknown>('layout');

    doc.transact(() => {
      Object.entries(decodeParityJson(testCase.stored) as Record<string, unknown>).forEach(([key, value]) =>
        layout.set(key, value)
      );
    });
    const before = normalizeNumbers(layout.toJSON()) as Record<string, unknown>;
    const write = decodeParityJson(testCase.write) as Record<string, unknown>;

    expect(Object.keys(write)).toEqual(testCase.writtenKeys);
    writeBoardLayoutKeys(layout, write);
    const after = normalizeNumbers(layout.toJSON()) as Record<string, unknown>;

    expect(after).toEqual(testCase.expected);
    Object.keys(before)
      .filter((key) => !testCase.writtenKeys.includes(key))
      .forEach((key) => expect(after[key]).toEqual(before[key]));
  });

  it('writes Count all as type 5 with an empty field id, and a calculation as the whole object', () => {
    expect(groupCalculationValue(null)).toEqual({ type: 5, field_id: '' });
    expect(groupCalculationValue({ type: CalculationType.Count, fieldId: 'f_amount' })).toEqual(
      GROUP_CALCULATION_COUNT_ALL
    );
    expect(groupCalculationValue({ type: CalculationType.Sum, fieldId: 'f_amount' })).toEqual({
      type: 4,
      field_id: 'f_amount',
    });
  });
});
