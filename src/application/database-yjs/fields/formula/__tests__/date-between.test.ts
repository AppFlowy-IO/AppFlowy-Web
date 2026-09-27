import dayjs from 'dayjs';

import { FieldType } from '@/application/database-yjs/database.type';

import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import { createFields, createRow } from './fixture';

// Date-only cells can retain timestamps after the user hides the time.
// Exercise the Yjs cell adapter as well as dateBetween (AppFlowy #9042).
function between(start: string, end: string, startTime: boolean, endTime: boolean, unit = 'days') {
  const fields = createFields([
    { id: 'in', name: 'Check in', type: FieldType.DateTime },
    { id: 'out', name: 'Check out', type: FieldType.DateTime },
    {
      id: 'nights',
      name: 'Duration (nights)',
      type: FieldType.Formula,
      typeOption: { expression: `dateBetween(prop("Check out"), prop("Check in"), "${unit}")` },
    },
  ]);
  const { row } = createRow('reservation', {
    in: { type: FieldType.DateTime, data: String(dayjs(start).unix()), extra: { include_time: startTime } },
    out: { type: FieldType.DateTime, data: String(dayjs(end).unix()), extra: { include_time: endTime } },
  });

  return evaluateFormulaCell({
    schema: readFormulaSchema(fields),
    field: fields.get('nights'),
    fieldId: 'nights',
    row,
    rowId: 'reservation',
  }).rawNumeric;
}

describe('dateBetween with stored date cells', () => {
  it.each<[string, string, number]>([
    ['2026-09-24T18:00', '2026-09-26T09:00', 2],
    ['2026-09-24T23:59:59', '2026-10-03T00:00', 9],
    ['2026-09-01T00:00', '2026-09-10T00:00', 9],
    ['2026-09-24T06:00', '2026-09-26T09:00', 2],
    ['2026-09-24T00:00', '2026-09-24T23:59:59', 0],
    ['2024-03-09T23:00', '2024-03-11T01:00', 2],
    ['2024-11-02T23:00', '2024-11-04T01:00', 2],
  ])('counts calendar days with hidden times: %s → %s', (start, end, expected) => {
    expect(between(start, end, false, false)).toBe(expected);
    expect(between(end, start, false, false)).toBe(-expected || 0);
  });

  it.each<[string, string, string, number]>([
    ['2026-09-24T18:00', '2026-09-26T09:00', 'hours', 48],
    ['2026-09-24T18:00', '2026-10-01T09:00', 'weeks', 1],
    ['2026-09-24T18:00', '2026-10-24T09:00', 'months', 1],
  ])('uses midnight for hidden times: %s → %s in %s', (start, end, unit, expected) => {
    expect(between(start, end, false, false, unit)).toBe(expected);
  });

  it.each<[boolean, boolean, number, number]>([
    [true, true, 1, 39],
    [false, true, 2, 57],
    [true, false, 1, 30],
  ])('preserves visible times: includeTime=%s/%s', (startTime, endTime, days, hours) => {
    const start = '2026-09-24T18:00';
    const end = '2026-09-26T09:00';

    expect(between(start, end, startTime, endTime)).toBe(days);
    expect(between(end, start, endTime, startTime)).toBe(-days);
    expect(between(start, end, startTime, endTime, 'hours')).toBe(hours);
  });

  it('ignores hidden times in date range endpoints', () => {
    const fields = createFields([
      { id: 'stay', name: 'Stay', type: FieldType.DateTime },
      {
        id: 'nights',
        name: 'Nights',
        type: FieldType.Formula,
        typeOption: { expression: 'dateBetween(dateEnd(prop("Stay")), dateStart(prop("Stay")), "days")' },
      },
    ]);
    const { row } = createRow('reservation', {
      stay: {
        type: FieldType.DateTime,
        data: String(dayjs('2026-09-24T18:00').unix()),
        extra: { include_time: false, is_range: true, end_timestamp: String(dayjs('2026-09-26T09:00').unix()) },
      },
    });

    expect(
      evaluateFormulaCell({
        schema: readFormulaSchema(fields),
        field: fields.get('nights'),
        fieldId: 'nights',
        row,
        rowId: 'reservation',
      }).rawNumeric
    ).toBe(2);
  });
});
