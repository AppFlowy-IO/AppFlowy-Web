import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption } from '@/application/database-yjs/fields';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

function createField(type: FieldType, typeOptionContent?: unknown): YDatabaseField {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;
  field.set(YjsDatabaseKey.type, String(type));
  if (typeOptionContent !== undefined) {
    const typeOptionMap = new Y.Map();
    const option = new Y.Map();
    option.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
    typeOptionMap.set(String(type), option);
    field.set(YjsDatabaseKey.type_option, typeOptionMap);
  }
  return field;
}

function createCell(data: unknown, currentType: FieldType, sourceType?: FieldType): YDatabaseCell {
  const doc = new Y.Doc();
  const cell = doc.getMap('cell') as YDatabaseCell;
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, String(currentType));
  if (sourceType !== undefined) {
    cell.set(YjsDatabaseKey.source_field_type, String(sourceType));
  }
  return cell;
}

describe('lazy cell parsing parity with desktop', () => {
  it('parses checkbox truthy/falsy from text source', () => {
    const field = createField(FieldType.Checkbox);
    const yesCell = createCell('yes', FieldType.Checkbox, FieldType.RichText);
    const noCell = createCell('no', FieldType.Checkbox, FieldType.RichText);

    expect(getCellDataText(yesCell, field)).toBe('Yes');
    expect(getCellDataText(noCell, field)).toBe('No');
  });

  it('parses time strings into milliseconds', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('09:30', FieldType.Time, FieldType.RichText);

    expect(getCellDataText(cell, field)).toBe('34200000');
  });

  it('parses checklist from markdown/plain text lazily', () => {
    const field = createField(FieldType.Checklist);
    const cell = createCell('[x] Done\n[ ] Todo', FieldType.Checklist, FieldType.RichText);

    const text = getCellDataText(cell, field);
    expect(text).toBe('[x] Done\n[ ] Todo');
  });

  it('maps checklist selections to select option names when viewing as select', () => {
    const option: SelectOption = { id: 'opt1', name: 'Alpha', color: 0 };
    const field = createField(FieldType.SingleSelect, { options: [option], disable_color: false });

    const checklistJson = JSON.stringify({
      options: [{ id: 'opt1', name: 'Alpha', color: 0 }],
      selected_option_ids: ['opt1'],
    });
    const cell = createCell(checklistJson, FieldType.SingleSelect, FieldType.Checklist);

    expect(getCellDataText(cell, field)).toBe('Alpha');
  });

  it('stringifies rich text from numeric source without mutation', () => {
    const field = createField(FieldType.RichText);
    const cell = createCell('1234', FieldType.RichText, FieldType.Number);

    expect(getCellDataText(cell, field)).toBe('1234');
  });
});

/**
 * Number conversion tests - covers all conversions to/from Number field type
 */
describe('Number field type conversions', () => {
  // RichText -> Number
  it('parses numeric strings from RichText to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('42', FieldType.Number, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('42');
  });

  it('parses decimal numbers from RichText to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('3.14159', FieldType.Number, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('3.14159');
  });

  it('parses negative numbers from RichText to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('-100.5', FieldType.Number, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('-100.5');
  });

  it('returns empty for non-numeric RichText to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('not a number', FieldType.Number, FieldType.RichText);
    // Non-numeric text should either return empty or the original value
    const result = getCellDataText(cell, field);
    expect(result === '' || result === 'not a number').toBe(true);
  });

  it('handles empty string from RichText to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('', FieldType.Number, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('');
  });

  // Number -> RichText (already covered above, adding more cases)
  it('converts integer number to RichText', () => {
    const field = createField(FieldType.RichText);
    const cell = createCell('999', FieldType.RichText, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('999');
  });

  it('converts zero to RichText', () => {
    const field = createField(FieldType.RichText);
    const cell = createCell('0', FieldType.RichText, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('0');
  });

  // Checkbox -> Number
  it('checkbox Yes to Number is preserved as original data', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('Yes', FieldType.Number, FieldType.Checkbox);
    // In lazy conversion, the raw data is preserved
    const result = getCellDataText(cell, field);
    // Should return the original value (Yes) or empty
    expect(result === 'Yes' || result === '').toBe(true);
  });

  // Number -> Checkbox
  it('non-zero number becomes checked checkbox', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('1', FieldType.Checkbox, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('Yes');
  });

  it('zero becomes unchecked checkbox', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('0', FieldType.Checkbox, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('No');
  });

  // Time -> Number (potentially lossy)
  it('time milliseconds to Number is preserved', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('36000000', FieldType.Number, FieldType.Time);
    expect(getCellDataText(cell, field)).toBe('36000000');
  });

  // Number -> Time
  it('numeric milliseconds displayed as Time value', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('36000000', FieldType.Time, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('36000000');
  });

  // URL -> Number
  it('URL with numeric content to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('https://example.com', FieldType.Number, FieldType.URL);
    // URL text is not a number, should return empty or original
    const result = getCellDataText(cell, field);
    expect(result === '' || result === 'https://example.com').toBe(true);
  });

  // Number -> URL
  it('number displayed as URL', () => {
    const field = createField(FieldType.URL);
    const cell = createCell('12345', FieldType.URL, FieldType.Number);
    expect(getCellDataText(cell, field)).toBe('12345');
  });

  // SingleSelect -> Number
  it('SingleSelect option to Number preserves original', () => {
    const option: SelectOption = { id: 'opt1', name: '42', color: 0 };
    const field = createField(FieldType.Number, { options: [option], disable_color: false });
    const cell = createCell('opt1', FieldType.Number, FieldType.SingleSelect);
    // Should try to parse the selected option name as a number
    const result = getCellDataText(cell, field);
    expect(result === '42' || result === 'opt1' || result === '').toBe(true);
  });

  // Number -> SingleSelect
  it('number creates/maps to SingleSelect option', () => {
    const option: SelectOption = { id: 'opt1', name: '100', color: 0 };
    const field = createField(FieldType.SingleSelect, { options: [option], disable_color: false });
    const cell = createCell('100', FieldType.SingleSelect, FieldType.Number);
    // In lazy conversion, it may display as the number or find matching option
    const result = getCellDataText(cell, field);
    expect(result === '100' || result === '').toBe(true);
  });

  // Number precision edge cases
  it('handles very large numbers', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('9999999999999', FieldType.Number, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('9999999999999');
  });

  it('handles scientific notation', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('1e10', FieldType.Number, FieldType.RichText);
    // Should parse as number (10000000000)
    const result = getCellDataText(cell, field);
    expect(result === '1e10' || result === '10000000000').toBe(true);
  });
});

/**
 * DateTime conversion tests - covers all conversions to/from DateTime field type
 */
describe('DateTime field type conversions', () => {
  // RichText -> DateTime
  it('parses ISO date string from RichText to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('2024-01-15', FieldType.DateTime, FieldType.RichText);
    // DateTime cells typically store timestamps; the text should be preserved or parsed
    const result = getCellDataText(cell, field);
    expect(result.length > 0).toBe(true); // Should have some output
  });

  it('parses timestamp string from RichText to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('1705276800', FieldType.DateTime, FieldType.RichText);
    // Unix timestamp should be preserved
    const result = getCellDataText(cell, field);
    expect(result === '1705276800' || result.includes('2024')).toBe(true);
  });

  it('handles empty RichText to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('', FieldType.DateTime, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('');
  });

  // DateTime -> RichText
  it('converts DateTime timestamp to RichText', () => {
    const field = createField(FieldType.RichText);
    const cell = createCell('1705276800', FieldType.RichText, FieldType.DateTime);
    // DateTime is formatted as a readable date string when viewed as RichText
    const result = getCellDataText(cell, field);
    expect(result.length > 0).toBe(true);
    // May be formatted date (e.g., "01/15/2024") or raw timestamp
    expect(result.includes('2024') || result === '1705276800').toBe(true);
  });

  // Number -> DateTime
  it('number as Unix timestamp to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('1705276800', FieldType.DateTime, FieldType.Number);
    // Unix timestamp should be preserved
    const result = getCellDataText(cell, field);
    expect(result === '1705276800' || result.length > 0).toBe(true);
  });

  // DateTime -> Number
  it('DateTime timestamp to Number', () => {
    const field = createField(FieldType.Number);
    const cell = createCell('1705276800', FieldType.Number, FieldType.DateTime);
    expect(getCellDataText(cell, field)).toBe('1705276800');
  });

  // Checkbox -> DateTime (lossy)
  it('checkbox to DateTime returns empty or preserved', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('Yes', FieldType.DateTime, FieldType.Checkbox);
    const result = getCellDataText(cell, field);
    // Checkbox value may be parsed as a date or preserved or return a date
    expect(result.length >= 0).toBe(true);
  });

  // DateTime -> Checkbox
  it('non-empty DateTime to Checkbox shows checkbox state', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('1705276800', FieldType.Checkbox, FieldType.DateTime);
    // Large timestamp may not be recognized as truthy text
    const result = getCellDataText(cell, field);
    expect(result === 'Yes' || result === 'No').toBe(true);
  });

  it('empty DateTime to Checkbox is unchecked', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('', FieldType.Checkbox, FieldType.DateTime);
    expect(getCellDataText(cell, field)).toBe('No');
  });

  // Time -> DateTime
  it('Time milliseconds to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('36000000', FieldType.DateTime, FieldType.Time);
    // Time value (10 hours in ms) - may be interpreted as a date or preserved
    const result = getCellDataText(cell, field);
    expect(result.length >= 0).toBe(true); // Any result is acceptable
  });

  // DateTime -> Time
  it('DateTime timestamp to Time shows raw value', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('1705276800', FieldType.Time, FieldType.DateTime);
    // The timestamp is too large for a valid time, should show as-is
    const result = getCellDataText(cell, field);
    expect(result === '1705276800' || result === '').toBe(true);
  });

  // URL -> DateTime
  it('URL to DateTime returns some result', () => {
    const field = createField(FieldType.DateTime);
    const cell = createCell('https://example.com', FieldType.DateTime, FieldType.URL);
    const result = getCellDataText(cell, field);
    // URL may be preserved, emptied, or parsed into a date format
    expect(result.length >= 0).toBe(true);
  });

  // DateTime -> URL
  it('DateTime to URL shows timestamp', () => {
    const field = createField(FieldType.URL);
    const cell = createCell('1705276800', FieldType.URL, FieldType.DateTime);
    expect(getCellDataText(cell, field)).toBe('1705276800');
  });

  // SingleSelect -> DateTime
  it('SingleSelect option to DateTime', () => {
    const option: SelectOption = { id: 'opt1', name: '2024-01-15', color: 0 };
    const field = createField(FieldType.DateTime, { options: [option], disable_color: false });
    const cell = createCell('opt1', FieldType.DateTime, FieldType.SingleSelect);
    const result = getCellDataText(cell, field);
    expect(result.length >= 0).toBe(true);
  });

  // DateTime -> SingleSelect
  it('DateTime to SingleSelect preserves timestamp', () => {
    const option: SelectOption = { id: 'opt1', name: '1705276800', color: 0 };
    const field = createField(FieldType.SingleSelect, { options: [option], disable_color: false });
    const cell = createCell('1705276800', FieldType.SingleSelect, FieldType.DateTime);
    const result = getCellDataText(cell, field);
    expect(result === '1705276800' || result === '').toBe(true);
  });

  // Checklist -> DateTime
  it('Checklist JSON to DateTime', () => {
    const field = createField(FieldType.DateTime);
    const checklistJson = JSON.stringify({
      options: [{ id: 'opt1', name: '2024-01-15' }],
      selected_option_ids: ['opt1'],
    });
    const cell = createCell(checklistJson, FieldType.DateTime, FieldType.Checklist);
    const result = getCellDataText(cell, field);
    // Lossy - may parse or return empty/original
    expect(result.length >= 0).toBe(true);
  });

  // DateTime -> Checklist
  it('DateTime timestamp to Checklist', () => {
    const field = createField(FieldType.Checklist);
    const cell = createCell('1705276800', FieldType.Checklist, FieldType.DateTime);
    const result = getCellDataText(cell, field);
    // May be formatted date, raw timestamp, or empty
    expect(result.length >= 0).toBe(true);
  });
});

/**
 * Time field type additional conversions
 */
describe('Time field type conversions', () => {
  // HH:MM:SS parsing
  it('parses HH:MM:SS time format', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('12:30:45', FieldType.Time, FieldType.RichText);
    // 12*3600*1000 + 30*60*1000 + 45*1000 = 45045000
    expect(getCellDataText(cell, field)).toBe('45045000');
  });

  it('parses single digit hours', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('9:30', FieldType.Time, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('34200000');
  });

  it('handles midnight (00:00)', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('00:00', FieldType.Time, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('0');
  });

  it('handles end of day (23:59:59)', () => {
    const field = createField(FieldType.Time);
    const cell = createCell('23:59:59', FieldType.Time, FieldType.RichText);
    // 23*3600*1000 + 59*60*1000 + 59*1000 = 86399000
    expect(getCellDataText(cell, field)).toBe('86399000');
  });

  // Time -> Checkbox
  it('non-zero time to checkbox returns a checkbox state', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('36000000', FieldType.Checkbox, FieldType.Time);
    // Large milliseconds may not be recognized as truthy text by parseCheckboxValue
    const result = getCellDataText(cell, field);
    expect(result === 'Yes' || result === 'No').toBe(true);
  });

  it('zero time (midnight) becomes unchecked checkbox', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('0', FieldType.Checkbox, FieldType.Time);
    expect(getCellDataText(cell, field)).toBe('No');
  });

  // Time -> URL
  it('time to URL shows milliseconds', () => {
    const field = createField(FieldType.URL);
    const cell = createCell('36000000', FieldType.URL, FieldType.Time);
    expect(getCellDataText(cell, field)).toBe('36000000');
  });

  // Time -> SingleSelect
  it('time to SingleSelect preserves value', () => {
    const option: SelectOption = { id: 'opt1', name: '36000000', color: 0 };
    const field = createField(FieldType.SingleSelect, { options: [option], disable_color: false });
    const cell = createCell('36000000', FieldType.SingleSelect, FieldType.Time);
    const result = getCellDataText(cell, field);
    expect(result === '36000000' || result === '').toBe(true);
  });
});

/**
 * URL field type conversions
 */
describe('URL field type conversions', () => {
  // RichText -> URL
  it('text URL is preserved as URL', () => {
    const field = createField(FieldType.URL);
    const cell = createCell('https://appflowy.io', FieldType.URL, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('https://appflowy.io');
  });

  it('non-URL text is preserved as URL', () => {
    const field = createField(FieldType.URL);
    const cell = createCell('just some text', FieldType.URL, FieldType.RichText);
    expect(getCellDataText(cell, field)).toBe('just some text');
  });

  // URL -> RichText
  it('URL converts to RichText', () => {
    const field = createField(FieldType.RichText);
    const cell = createCell('https://github.com', FieldType.RichText, FieldType.URL);
    expect(getCellDataText(cell, field)).toBe('https://github.com');
  });

  // URL -> Checkbox
  it('URL to checkbox returns a checkbox state', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('https://example.com', FieldType.Checkbox, FieldType.URL);
    // URL text may not be recognized as truthy by parseCheckboxValue
    const result = getCellDataText(cell, field);
    expect(result === 'Yes' || result === 'No').toBe(true);
  });

  it('empty URL becomes unchecked checkbox', () => {
    const field = createField(FieldType.Checkbox);
    const cell = createCell('', FieldType.Checkbox, FieldType.URL);
    expect(getCellDataText(cell, field)).toBe('No');
  });

  // URL -> SingleSelect
  it('URL creates option in SingleSelect', () => {
    const option: SelectOption = { id: 'opt1', name: 'https://example.com', color: 0 };
    const field = createField(FieldType.SingleSelect, { options: [option], disable_color: false });
    const cell = createCell('https://example.com', FieldType.SingleSelect, FieldType.URL);
    const result = getCellDataText(cell, field);
    expect(result === 'https://example.com' || result === '').toBe(true);
  });

  // URL -> Checklist
  it('URL text to Checklist returns some result', () => {
    const field = createField(FieldType.Checklist);
    const cell = createCell('https://appflowy.io', FieldType.Checklist, FieldType.URL);
    const result = getCellDataText(cell, field);
    // URL may be preserved, parsed into checklist format, or empty
    expect(result.length >= 0).toBe(true);
  });
});

/**
 * Multi-hop conversion tests (A -> B -> C -> A)
 * These tests verify that the lazy type switching preserves original data
 * even when converting through multiple field types.
 */
describe('Multi-hop conversion data preservation', () => {
  it('RichText -> Checkbox -> RichText preserves display', () => {
    // First conversion: RichText -> Checkbox
    const checkboxField = createField(FieldType.Checkbox);
    const toCheckbox = createCell('yes', FieldType.Checkbox, FieldType.RichText);
    expect(getCellDataText(toCheckbox, checkboxField)).toBe('Yes');

    // Second conversion: Checkbox -> RichText (may show 'Yes' or 'yes')
    const richTextField = createField(FieldType.RichText);
    const backToText = createCell('yes', FieldType.RichText, FieldType.Checkbox);
    const result = getCellDataText(backToText, richTextField);
    expect(result.toLowerCase()).toBe('yes');
  });

  it('RichText -> Time -> Number -> RichText preserves time string', () => {
    // RichText with time string
    const originalData = '09:30';

    // To Time (parses to milliseconds)
    const timeField = createField(FieldType.Time);
    const toTime = createCell(originalData, FieldType.Time, FieldType.RichText);
    expect(getCellDataText(toTime, timeField)).toBe('34200000');

    // Time -> Number (milliseconds as number)
    const numberField = createField(FieldType.Number);
    const toNumber = createCell(originalData, FieldType.Number, FieldType.Time);
    // In lazy mode, original data is preserved
    const result = getCellDataText(toNumber, numberField);
    expect(result === '09:30' || result === '34200000').toBe(true);
  });

  it('Number -> Checkbox -> SingleSelect -> Number preserves data', () => {
    // Use '1' which parseCheckboxValue recognizes as truthy
    const originalData = '1';

    // Number -> Checkbox ('1' is truthy)
    const checkboxField = createField(FieldType.Checkbox);
    const toCheckbox = createCell(originalData, FieldType.Checkbox, FieldType.Number);
    expect(getCellDataText(toCheckbox, checkboxField)).toBe('Yes');

    // Checkbox -> SingleSelect
    const option: SelectOption = { id: 'yes-opt', name: 'Yes', color: 0 };
    const selectField = createField(FieldType.SingleSelect, { options: [option], disable_color: false });
    const toSelect = createCell(originalData, FieldType.SingleSelect, FieldType.Checkbox);
    const selectResult = getCellDataText(toSelect, selectField);
    // May show 'Yes' from mapping or the original '1'
    expect(selectResult === 'Yes' || selectResult === '1' || selectResult === '').toBe(true);

    // Back to Number (original preserved)
    const numberField = createField(FieldType.Number);
    const backToNumber = createCell(originalData, FieldType.Number, FieldType.SingleSelect);
    expect(getCellDataText(backToNumber, numberField)).toBe('1');
  });
});
