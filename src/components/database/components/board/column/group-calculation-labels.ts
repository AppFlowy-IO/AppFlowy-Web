import { CalculationType } from '@/application/database-yjs/database.type';

import type { TFunction } from 'i18next';


/** The menu label of a column calculation: `grid.calculationTypeLabel.*`, the same keys as desktop. */
export function groupCalculationLabel(t: TFunction, type: CalculationType): string {
  switch (type) {
    case CalculationType.Average:
      return t('grid.calculationTypeLabel.average');
    case CalculationType.Max:
      return t('grid.calculationTypeLabel.max');
    case CalculationType.Median:
      return t('grid.calculationTypeLabel.median');
    case CalculationType.Min:
      return t('grid.calculationTypeLabel.min');
    case CalculationType.Sum:
      return t('grid.calculationTypeLabel.sum');
    case CalculationType.Count:
      return t('grid.calculationTypeLabel.count');
    case CalculationType.CountEmpty:
      return t('grid.calculationTypeLabel.countEmpty');
    case CalculationType.CountNonEmpty:
      return t('grid.calculationTypeLabel.countNonEmpty');
    case CalculationType.DateEarliest:
      return t('grid.calculationTypeLabel.dateEarliest');
    case CalculationType.DateLatest:
      return t('grid.calculationTypeLabel.dateLatest');
    case CalculationType.DateRange:
      return t('grid.calculationTypeLabel.dateRange');
    case CalculationType.NumberRange:
      return t('grid.calculationTypeLabel.numberRange');
    case CalculationType.CountChecked:
      return t('grid.calculationTypeLabel.countChecked');
    case CalculationType.CountUnchecked:
      return t('grid.calculationTypeLabel.countUnchecked');
    case CalculationType.PercentEmpty:
      return t('grid.calculationTypeLabel.percentEmpty');
    case CalculationType.PercentNotEmpty:
      return t('grid.calculationTypeLabel.percentNotEmpty');
    case CalculationType.CountUnique:
      return t('grid.calculationTypeLabel.countUnique');
    case CalculationType.PercentChecked:
      return t('grid.calculationTypeLabel.percentChecked');
    case CalculationType.PercentUnchecked:
      return t('grid.calculationTypeLabel.percentUnchecked');
    default:
      return '';
  }
}
