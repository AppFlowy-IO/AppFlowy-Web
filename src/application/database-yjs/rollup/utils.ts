import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { parseRollupTypeOption } from '@/application/database-yjs/fields';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

const NUMERIC_ROLLUP_CALCULATIONS = new Set<CalculationType>([
  CalculationType.Count,
  CalculationType.CountEmpty,
  CalculationType.CountNonEmpty,
  CalculationType.Sum,
  CalculationType.Average,
  CalculationType.Min,
  CalculationType.Max,
  CalculationType.Median,
  CalculationType.NumberRange,
  CalculationType.NumberMode,
  CalculationType.CountChecked,
  CalculationType.CountUnchecked,
  CalculationType.PercentChecked,
  CalculationType.PercentUnchecked,
  CalculationType.PercentEmpty,
  CalculationType.PercentNotEmpty,
  CalculationType.CountUnique,
  CalculationType.CountValue,
]);

export function isNumericRollupField(field?: YDatabaseField) {
  if (!field || Number(field.get(YjsDatabaseKey.type)) !== FieldType.Rollup) return false;
  const option = parseRollupTypeOption(field);

  if (!option) return false;
  const showAs = Number(option.show_as ?? RollupDisplayMode.Calculated) as RollupDisplayMode;

  if (showAs !== RollupDisplayMode.Calculated) return false;
  const calc = Number(option.calculation_type ?? CalculationType.Count) as CalculationType;

  return NUMERIC_ROLLUP_CALCULATIONS.has(calc);
}
