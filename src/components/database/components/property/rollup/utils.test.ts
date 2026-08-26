import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs';

import { getAvailableRollupCalculations, getAvailableRollupDisplayModes, getRollupCalculationGroups } from './utils';

describe('rollup calculation options', () => {
  it('treats RichText as a real target field type instead of an unset value', () => {
    expect(getAvailableRollupCalculations(FieldType.RichText)).toEqual([
      CalculationType.Count,
      CalculationType.CountUnique,
      CalculationType.CountEmpty,
      CalculationType.CountNonEmpty,
      CalculationType.PercentEmpty,
      CalculationType.PercentNotEmpty,
    ]);
  });

  it('organizes supported number calculations into the Desktop Calculate groups', () => {
    const groups = getRollupCalculationGroups(FieldType.Number);

    expect(groups.map((group) => group.key)).toEqual(['count', 'percent', 'moreOptions']);
    expect(groups.find((group) => group.key === 'count')?.calculations).toEqual([
      CalculationType.Count,
      CalculationType.CountUnique,
      CalculationType.CountEmpty,
      CalculationType.CountNonEmpty,
    ]);
    expect(groups.find((group) => group.key === 'moreOptions')?.calculations).toEqual([
      CalculationType.Sum,
      CalculationType.Average,
      CalculationType.Median,
      CalculationType.Min,
      CalculationType.Max,
      CalculationType.NumberRange,
      CalculationType.NumberMode,
    ]);
  });

  it('hides Unique list for Checkbox and Checklist targets', () => {
    expect(getAvailableRollupDisplayModes(FieldType.Checkbox)).toEqual([RollupDisplayMode.OriginalList]);
    expect(getAvailableRollupDisplayModes(FieldType.Checklist)).toEqual([RollupDisplayMode.OriginalList]);
    expect(getAvailableRollupDisplayModes(FieldType.RichText)).toEqual([
      RollupDisplayMode.OriginalList,
      RollupDisplayMode.UniqueList,
    ]);
  });
});
