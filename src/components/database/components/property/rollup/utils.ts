import { CalculationType, FieldType } from '@/application/database-yjs';

const fieldsWithoutEmptyState = [
  FieldType.URL,
  FieldType.Checkbox,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

export function getAvailableRollupCalculations(fieldType?: FieldType) {
  const calculationTypes: CalculationType[] = [CalculationType.Count];

  if (!fieldType) return calculationTypes;

  if (!fieldsWithoutEmptyState.includes(fieldType)) {
    calculationTypes.push(
      CalculationType.CountEmpty,
      CalculationType.CountNonEmpty,
      CalculationType.PercentEmpty,
      CalculationType.PercentNotEmpty
    );
  }

  switch (fieldType) {
    case FieldType.Number:
      calculationTypes.push(
        CalculationType.Sum,
        CalculationType.Average,
        CalculationType.Min,
        CalculationType.Max,
        CalculationType.Median,
        CalculationType.NumberRange,
        CalculationType.NumberMode
      );
      break;
    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime:
      calculationTypes.push(
        CalculationType.DateEarliest,
        CalculationType.DateLatest,
        CalculationType.DateRange
      );
      break;
    case FieldType.Checkbox:
      calculationTypes.push(
        CalculationType.CountChecked,
        CalculationType.CountUnchecked,
        CalculationType.PercentChecked,
        CalculationType.PercentUnchecked
      );
      break;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      calculationTypes.push(CalculationType.CountValue, CalculationType.CountUnique);
      break;
    default:
      break;
  }

  return calculationTypes;
}
