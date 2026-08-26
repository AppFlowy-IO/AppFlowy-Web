import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';

const fieldsWithoutEmptyState = [FieldType.URL, FieldType.Checkbox, FieldType.LastEditedTime, FieldType.CreatedTime];

export function getAvailableRollupCalculations(fieldType?: FieldType) {
  const calculationTypes: CalculationType[] = [CalculationType.Count];

  if (fieldType === undefined) return calculationTypes;

  calculationTypes.push(CalculationType.CountUnique);

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
      calculationTypes.push(CalculationType.DateEarliest, CalculationType.DateLatest, CalculationType.DateRange);
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
      calculationTypes.push(CalculationType.CountValue);
      break;
    default:
      break;
  }

  return calculationTypes;
}

export type RollupCalculationGroupKey = 'count' | 'percent' | 'moreOptions' | 'date';

export type RollupCalculationGroup = {
  key: RollupCalculationGroupKey;
  calculations: CalculationType[];
};

const calculationGroups: Array<{
  key: RollupCalculationGroupKey;
  candidates: CalculationType[];
}> = [
  {
    key: 'count',
    candidates: [
      CalculationType.Count,
      CalculationType.CountValue,
      CalculationType.CountUnique,
      CalculationType.CountEmpty,
      CalculationType.CountNonEmpty,
      CalculationType.CountChecked,
      CalculationType.CountUnchecked,
    ],
  },
  {
    key: 'percent',
    candidates: [
      CalculationType.PercentEmpty,
      CalculationType.PercentNotEmpty,
      CalculationType.PercentChecked,
      CalculationType.PercentUnchecked,
    ],
  },
  {
    key: 'moreOptions',
    candidates: [
      CalculationType.Sum,
      CalculationType.Average,
      CalculationType.Median,
      CalculationType.Min,
      CalculationType.Max,
      CalculationType.NumberRange,
      CalculationType.NumberMode,
    ],
  },
  {
    key: 'date',
    candidates: [CalculationType.DateEarliest, CalculationType.DateLatest, CalculationType.DateRange],
  },
];

export function getRollupCalculationGroups(fieldType?: FieldType): RollupCalculationGroup[] {
  const supported = new Set(getAvailableRollupCalculations(fieldType));

  return calculationGroups
    .map(({ key, candidates }) => ({
      key,
      calculations: candidates.filter((type) => supported.has(type)),
    }))
    .filter((group) => group.calculations.length > 0);
}

export function getAvailableRollupDisplayModes(fieldType?: FieldType): RollupDisplayMode[] {
  const modes = [RollupDisplayMode.OriginalList];

  if (fieldType !== FieldType.Checkbox && fieldType !== FieldType.Checklist) {
    modes.push(RollupDisplayMode.UniqueList);
  }

  return modes;
}
