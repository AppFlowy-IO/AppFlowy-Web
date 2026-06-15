jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import * as Y from 'yjs';

import { calculateFieldValue } from '@/application/database-yjs/calculation';
import { CalculationType, FieldType, FilterType } from '@/application/database-yjs/database.type';
import { filterBy } from '@/application/database-yjs/filter';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields';
import { EnhancedBigStats } from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { Row } from '@/application/database-yjs/selector';
import { CsvDatabaseFixture, loadV069DatabaseFixture } from './test-helpers';
import {
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createFilters(
  configs: { fieldId: string; fieldType: FieldType; condition: number; content?: string }[]
): YDatabaseFilters {
  const filters = configs.map((config, index) => {
    const doc = new Y.Doc();
    const filter = doc.getMap(`filter-${index}`) as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, `filter-${index}`);
    filter.set(YjsDatabaseKey.field_id, config.fieldId);
    filter.set(YjsDatabaseKey.type, config.fieldType);
    filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    filter.set(YjsDatabaseKey.condition, config.condition);
    filter.set(YjsDatabaseKey.content, config.content ?? '');

    return filter;
  });

  return {
    toArray: () => filters,
  } as YDatabaseFilters;
}

function collectCellValues(
  fixture: CsvDatabaseFixture,
  fieldId: string,
  rows?: Row[]
): unknown[] {
  const rowIds = rows ? rows.map((row) => row.id) : fixture.rowIds;

  return rowIds.map((rowId) => {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells)?.get(fieldId);

    return cell ? cell.get(YjsDatabaseKey.data) : '';
  });
}

describe('calculation tests', () => {
  it('calculates sum of number field', () => {
    const stats = new EnhancedBigStats(['1', '2', '3']);
    expect(stats.sum().toString()).toBe('6');
  });

  it('calculates sum with negative numbers', () => {
    const stats = new EnhancedBigStats(['-5', '10']);
    expect(stats.sum().toString()).toBe('5');
  });

  it('calculates sum with decimals', () => {
    const stats = new EnhancedBigStats(['1.5', '2.25']);
    expect(stats.sum().toString()).toBe('3.75');
  });

  it('calculates minimum of number field', () => {
    const stats = new EnhancedBigStats(['3', '1', '2']);
    expect(stats.min().toString()).toBe('1');
  });

  it('calculates maximum of number field', () => {
    const stats = new EnhancedBigStats(['3', '1', '2']);
    expect(stats.max().toString()).toBe('3');
  });

  it('calculates average of number field', () => {
    const stats = new EnhancedBigStats(['3', '1', '2']);
    expect(stats.average().toString()).toBe('2');
  });

  it('calculates average with decimals', () => {
    const stats = new EnhancedBigStats(['1.5', '2.5']);
    expect(stats.average().toString()).toBe('2');
  });

  it('calculates median of odd count', () => {
    const stats = new EnhancedBigStats(['3', '1', '2']);
    expect(stats.median().toString()).toBe('2');
  });

  it('calculates median of even count', () => {
    const stats = new EnhancedBigStats(['1', '2', '3', '4']);
    expect(stats.median().toString()).toBe('2.5');
  });

  it('counts all rows', () => {
    const stats = new EnhancedBigStats(['1', '2', '3']);
    expect(stats.getStats().count).toBe(3);
  });

  it('handles empty dataset', () => {
    const stats = new EnhancedBigStats([]);
    expect(stats.sum().toString()).toBe('0');
    expect(stats.getStats().count).toBe(0);
  });

  it('handles single value', () => {
    const stats = new EnhancedBigStats(['42']);
    expect(stats.sum().toString()).toBe('42');
    expect(stats.median().toString()).toBe('42');
  });

  it('handles very large numbers', () => {
    const stats = new EnhancedBigStats(['9007199254740993', '2']);
    expect(stats.sum().toString()).toBe('9007199254740995');
  });
});

describe('calculation dispatch tests', () => {
  const baseNumberValues = ['1', '2', '3', '14', '', '5', ''];
  const baseTextValues = ['A', '', 'C', 'DA', 'AE', 'AE', 'CB'];

  it('matches rust grid number calculations', () => {
    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Sum,
        cellValues: baseNumberValues,
      })
    ).toBe('25');
    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Min,
        cellValues: baseNumberValues,
      })
    ).toBe('1');
    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Average,
        cellValues: baseNumberValues,
      })
    ).toBe('5');
    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Max,
        cellValues: baseNumberValues,
      })
    ).toBe('14');
    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Median,
        cellValues: baseNumberValues,
      })
    ).toBe('3');
  });

  it('counts empty and non-empty text values like rust grid', () => {
    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.CountEmpty,
        cellValues: baseTextValues,
      })
    ).toBe(1);
    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.CountNonEmpty,
        cellValues: baseTextValues,
      })
    ).toBe(6);

    const updatedValues = [...baseTextValues];
    updatedValues[1] = 'change';

    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.CountEmpty,
        cellValues: updatedValues,
      })
    ).toBe(0);
    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.CountNonEmpty,
        cellValues: updatedValues,
      })
    ).toBe(7);
  });

  it('updates count when rows are duplicated', () => {
    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.Count,
        cellValues: baseTextValues,
      })
    ).toBe(7);

    const duplicated = [...baseTextValues, baseTextValues[1]];

    expect(
      calculateFieldValue({
        fieldType: FieldType.RichText,
        calculationType: CalculationType.Count,
        cellValues: duplicated,
      })
    ).toBe(8);
  });

  it('updates sum after cell updates', () => {
    const updatedValues = [...baseNumberValues];
    updatedValues[0] = '100';

    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Sum,
        cellValues: updatedValues,
      })
    ).toBe('124');
  });

  it('updates sum after row deletion', () => {
    const deletedValues = baseNumberValues.slice(1);

    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Sum,
        cellValues: deletedValues,
      })
    ).toBe('24');
  });

  it('updates sum after row duplication', () => {
    const duplicatedValues = [...baseNumberValues, baseNumberValues[0]];

    expect(
      calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Sum,
        cellValues: duplicatedValues,
      })
    ).toBe('26');
  });

  it('calculates sum on filtered rows', () => {
    const fixture = loadV069DatabaseFixture();
    const amountFieldId = fixture.fieldIdByName.get('Amount');
    const checkboxFieldId = fixture.fieldIdByName.get('Registration Complete');

    if (!amountFieldId || !checkboxFieldId) {
      throw new Error('Missing expected v069 fields for calculation filter test.');
    }

    const filters = createFilters([
      {
        fieldId: checkboxFieldId,
        fieldType: FieldType.Checkbox,
        condition: CheckboxFilterCondition.IsChecked,
      },
    ]);

    const baseValues = collectCellValues(fixture, amountFieldId);
    const baseSum = calculateFieldValue({
      fieldType: FieldType.Number,
      calculationType: CalculationType.Sum,
      cellValues: baseValues,
    });

    const filteredRows = filterBy(
      fixture.rows,
      filters,
      fixture.fields,
      fixture.rowMetas
    );
    const filteredValues = collectCellValues(fixture, amountFieldId, filteredRows);
    const filteredSum = calculateFieldValue({
      fieldType: FieldType.Number,
      calculationType: CalculationType.Sum,
      cellValues: filteredValues,
    });

    if (baseSum === null || filteredSum === null) {
      throw new Error('Expected calculation results for filtered sum test.');
    }

    const baseSumValue = Number(baseSum);
    const filteredSumValue = Number(filteredSum);

    expect(baseSumValue).toBe(1507703);
    expect(filteredSumValue).toBeLessThan(baseSumValue);
  });
});
