import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { EnhancedBigStats } from '@/application/database-yjs/fields/number/EnhancedBigStats';

type CalculationInput = {
  fieldType: FieldType;
  calculationType: CalculationType;
  cellValues: Iterable<unknown>;
};

function countBy<T>(values: T[], iteratee: (value: T) => string | number): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    const key = String(iteratee(value));

    result[key] = (result[key] ?? 0) + 1;

    return result;
  }, {});
}

export function calculateFieldValue({
  fieldType,
  calculationType,
  cellValues,
}: CalculationInput): string | number | null {
  const values = Array.from(cellValues);

  const countEmptyResult = countBy(values, (data) => {
    if (fieldType === FieldType.Checkbox) {
      return getChecked(data as string | number | boolean)
        ? CalculationType.CountNonEmpty
        : CalculationType.CountEmpty;
    }

    if (fieldType === FieldType.Checklist && typeof data === 'string') {
      try {
        const { options, selected_option_ids } = JSON.parse(data);
        const percentage = selected_option_ids.length / options.length;

        if (percentage === 1) {
          return CalculationType.CountNonEmpty;
        }

        return CalculationType.CountEmpty;
      } catch (e) {
        // fall through to treat the value as non-empty/empty
      }
    }

    if (!data) {
      return CalculationType.CountEmpty;
    }

    return CalculationType.CountNonEmpty;
  });

  const itemMap = (data: unknown) => {
    if (typeof data === 'number') {
      return data.toString();
    }

    if (typeof data === 'string') {
      return EnhancedBigStats.parse(data);
    }

    return null;
  };

  const nums = values.map(itemMap).filter((item) => !!item) as string[];
  const stats = new EnhancedBigStats(nums);

  switch (calculationType) {
    case CalculationType.CountEmpty:
      return countEmptyResult[CalculationType.CountEmpty] ?? 0;
    case CalculationType.CountNonEmpty:
      return countEmptyResult[CalculationType.CountNonEmpty] ?? 0;
    case CalculationType.Count:
      return values.length;
    case CalculationType.Sum:
      return stats.sum().toString();
    case CalculationType.Average:
      return stats.average().toString();
    case CalculationType.Median:
      return stats.median().toString();
    case CalculationType.Max:
      return stats.max().toString();
    case CalculationType.Min:
      return stats.min().toString();
    default:
      return null;
  }
}
