import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { parseProgressPercent, serializeTimelineProgressPercent } from '../hooks/useTimelineFieldValues';

jest.mock('@/application/database-yjs', () => ({}));

function fixture(format: NumberFormat, stored: string) {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;
  const cell = doc.getMap('cell') as YDatabaseCell;
  const options = new Y.Map();
  const number = new Y.Map();

  field.set(YjsDatabaseKey.type, String(FieldType.Number));
  number.set(YjsDatabaseKey.format, format);
  options.set(String(FieldType.Number), number);
  field.set(YjsDatabaseKey.type_option, options);
  cell.set(YjsDatabaseKey.data, stored);
  return { cell, field, number };
}

describe('timeline progress storage units', () => {
  it.each([
    [NumberFormat.Num, '50', '50'],
    [NumberFormat.Percent, '0.5', '0.5'],
  ])('reads and writes half progress in format %s', (format, stored, expected) => {
    const { cell, field } = fixture(format as NumberFormat, stored as string);

    expect(parseProgressPercent(cell, field)).toBe(50);
    const data = serializeTimelineProgressPercent(50, field);

    expect(data).toBe(expected);
    cell.set(YjsDatabaseKey.data, data);
    expect(parseProgressPercent(cell, field)).toBe(50);
  });

  it.each([NumberFormat.Num, NumberFormat.Percent])('round trips handle limits for format %s', (format) => {
    const { cell, field } = fixture(format, '');

    for (const percent of [0, 25, 100]) {
      const data = serializeTimelineProgressPercent(percent, field);

      expect(Number(data)).toBe(format === NumberFormat.Percent ? percent / 100 : percent);
      cell.set(YjsDatabaseKey.data, data);
      expect(parseProgressPercent(cell, field)).toBe(percent);
    }
  });

  it('uses the current field format after a metadata change', () => {
    const { cell, field, number } = fixture(NumberFormat.Num, '0.5');

    expect(parseProgressPercent(cell, field)).toBe(0.5);
    number.set(YjsDatabaseKey.format, NumberFormat.Percent);
    expect(parseProgressPercent(cell, field)).toBe(50);
    expect(serializeTimelineProgressPercent(50, field)).toBe('0.5');
  });

  it('does not read or overwrite a progress field whose type changed', () => {
    const { cell, field } = fixture(NumberFormat.Percent, '0.5');

    field.set(YjsDatabaseKey.type, String(FieldType.RichText));
    expect(parseProgressPercent(cell, field)).toBeUndefined();
    expect(serializeTimelineProgressPercent(50, field)).toBeUndefined();
  });
});
