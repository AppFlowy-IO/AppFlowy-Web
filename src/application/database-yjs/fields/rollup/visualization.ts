import { CalculationType } from '@/application/database-yjs/database.type';

const percentCalculationTypes = new Set<CalculationType>([
  CalculationType.PercentEmpty,
  CalculationType.PercentNotEmpty,
  CalculationType.PercentChecked,
  CalculationType.PercentUnchecked,
]);

export const MAX_ROLLUP_VISUALIZATION_DIVISOR = 2_147_483_647;

export function isRollupPercentCalculation(calculationType: CalculationType) {
  return percentCalculationTypes.has(calculationType);
}

export function getRollupVisualizationRatio(
  rawValue: number,
  calculationType: CalculationType,
  configuredDivisor: number
) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0;

  const divisor = isRollupPercentCalculation(calculationType) ? 100 : configuredDivisor > 0 ? configuredDivisor : 100;

  return Math.min(rawValue / divisor, 1);
}
