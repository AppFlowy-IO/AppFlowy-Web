/**
 * Tests for the filter-creation defaults + rollup-aware filter routing.
 *
 * Covers the changes that brought the web filter editors to desktop parity:
 *   - Number's default filter content key is `content` (not `value`)
 *   - Time fields seed a NumberFilterCondition default
 *   - Rollup fields seed Number conditions when the calculation is numeric,
 *     and Text conditions otherwise — matching desktop's rollup.dart branching
 *   - `isNumericRollupField` honors both calculation_type and show_as
 */
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { NumberFilterCondition, TextFilterCondition } from '@/application/database-yjs/fields';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { getDefaultFilterCondition } from '@/application/database-yjs/filter';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { YDatabaseField, YDatabaseFields, YjsDatabaseKey } from '@/application/types';

import { createField } from './test-helpers';

function makeRollupField(opts: {
  calculationType?: CalculationType;
  showAs?: RollupDisplayMode;
  relationFieldId?: string;
  targetFieldId?: string;
}): YDatabaseField {
  // createRollupField returns a detached Y.Map; nested-map reads only work
  // after attaching it to a parent doc — same pattern as rollup-desktop-parity.test.ts.
  const fieldId = `rollup-${Math.random().toString(36).slice(2, 8)}`;
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  fields.set(fieldId, createRollupField(fieldId));
  const field = fields.get(fieldId) as YDatabaseField;

  const option = field.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Rollup)) as Y.Map<unknown> | undefined;

  if (!option) throw new Error('Rollup field is missing its type-option map');

  option.set(YjsDatabaseKey.calculation_type, opts.calculationType ?? CalculationType.Count);
  option.set(YjsDatabaseKey.show_as, opts.showAs ?? RollupDisplayMode.Calculated);
  option.set(YjsDatabaseKey.relation_field_id, opts.relationFieldId ?? '');
  option.set(YjsDatabaseKey.target_field_id, opts.targetFieldId ?? '');

  return field;
}

describe('getDefaultFilterCondition', () => {
  it('Number seeds an Equal condition with empty content (regression: was `value`)', () => {
    const result = getDefaultFilterCondition(FieldType.Number);

    expect(result).toEqual({
      condition: NumberFilterCondition.Equal,
      content: '',
    });
    expect(result).not.toHaveProperty('value');
  });

  it('Time seeds the same Number-style default as Number', () => {
    expect(getDefaultFilterCondition(FieldType.Time)).toEqual({
      condition: NumberFilterCondition.Equal,
      content: '',
    });
  });

  it('Text and URL seed TextContains', () => {
    const text = getDefaultFilterCondition(FieldType.RichText);
    const url = getDefaultFilterCondition(FieldType.URL);

    expect(text).toEqual({ condition: TextFilterCondition.TextContains, content: '' });
    expect(url).toEqual({ condition: TextFilterCondition.TextContains, content: '' });
  });

  describe('Rollup (target-aware)', () => {
    it('Sum calculation seeds NumberFilterCondition.Equal', () => {
      const field = makeRollupField({ calculationType: CalculationType.Sum });

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: NumberFilterCondition.Equal,
        content: '',
      });
    });

    it('Average calculation seeds Number defaults', () => {
      const field = makeRollupField({ calculationType: CalculationType.Average });

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: NumberFilterCondition.Equal,
        content: '',
      });
    });

    it('Count calculation (Calculated mode) seeds Number defaults', () => {
      // Count is also numeric — desktop renders Number conditions for it.
      const field = makeRollupField({ calculationType: CalculationType.Count });

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: NumberFilterCondition.Equal,
        content: '',
      });
    });

    it('OriginalList display (e.g. listing related strings) seeds Text defaults', () => {
      const field = makeRollupField({
        calculationType: CalculationType.Sum, // calc is numeric, but show_as overrides it
        showAs: RollupDisplayMode.OriginalList,
      });

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: TextFilterCondition.TextContains,
        content: '',
      });
    });

    it('UniqueList display seeds Text defaults', () => {
      const field = makeRollupField({
        calculationType: CalculationType.Sum,
        showAs: RollupDisplayMode.UniqueList,
      });

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: TextFilterCondition.TextContains,
        content: '',
      });
    });

    it('Falls back to Text defaults when no field is provided', () => {
      // Defensive: callers should pass the field, but if they don't, we
      // shouldn't crash — text is the safe default since text is structurally
      // compatible with any rollup.
      expect(getDefaultFilterCondition(FieldType.Rollup)).toEqual({
        condition: TextFilterCondition.TextContains,
        content: '',
      });
    });
  });
});

describe('isNumericRollupField', () => {
  it('returns false for non-rollup fields', () => {
    const numberField = createField('n', FieldType.Number);
    const textField = createField('t', FieldType.RichText);

    expect(isNumericRollupField(numberField)).toBe(false);
    expect(isNumericRollupField(textField)).toBe(false);
  });

  it('returns false for undefined input', () => {
    expect(isNumericRollupField(undefined)).toBe(false);
  });

  it.each([
    ['Sum', CalculationType.Sum],
    ['Average', CalculationType.Average],
    ['Count', CalculationType.Count],
    ['CountEmpty', CalculationType.CountEmpty],
    ['CountNonEmpty', CalculationType.CountNonEmpty],
    ['Min', CalculationType.Min],
    ['Max', CalculationType.Max],
    ['Median', CalculationType.Median],
    ['NumberRange', CalculationType.NumberRange],
    ['NumberMode', CalculationType.NumberMode],
    ['CountChecked', CalculationType.CountChecked],
    ['CountUnchecked', CalculationType.CountUnchecked],
    ['PercentChecked', CalculationType.PercentChecked],
    ['PercentUnchecked', CalculationType.PercentUnchecked],
    ['PercentEmpty', CalculationType.PercentEmpty],
    ['PercentNotEmpty', CalculationType.PercentNotEmpty],
    ['CountUnique', CalculationType.CountUnique],
    ['CountValue', CalculationType.CountValue],
  ])('returns true for %s with Calculated display', (_label, calc) => {
    const field = makeRollupField({ calculationType: calc, showAs: RollupDisplayMode.Calculated });

    expect(isNumericRollupField(field)).toBe(true);
  });

  it('returns false for OriginalList display even with numeric calc', () => {
    const field = makeRollupField({
      calculationType: CalculationType.Sum,
      showAs: RollupDisplayMode.OriginalList,
    });

    expect(isNumericRollupField(field)).toBe(false);
  });

  it('returns false for UniqueList display', () => {
    const field = makeRollupField({
      calculationType: CalculationType.Sum,
      showAs: RollupDisplayMode.UniqueList,
    });

    expect(isNumericRollupField(field)).toBe(false);
  });

  it('defaults missing show_as to Calculated and missing calc to Count → numeric', () => {
    // createRollupField bootstraps with calc=Count + show_as=Calculated;
    // the util should treat that bare field as numeric.
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;

    fields.set('rollup-defaults', createRollupField('rollup-defaults'));
    const field = fields.get('rollup-defaults') as YDatabaseField;

    expect(isNumericRollupField(field)).toBe(true);
  });
});
