import { YDatabaseField } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { RollupShowAsType, RollupTypeOption, RollupVisualizationOption } from './rollup.type';

export const DEFAULT_ROLLUP_VISUALIZATION_COLOR = 'fill-default';

export function parseRollupVisualizationOption(option?: RollupTypeOption | null): RollupVisualizationOption {
  const rawType = option?.__rollup_show_as_type__;
  const type = rawType === RollupShowAsType.Bar || rawType === RollupShowAsType.Ring ? rawType : RollupShowAsType.Number;
  const rawDivisor = option?.__rollup_show_as_divisor__;

  return {
    type,
    color: option?.__rollup_show_as_color__ || DEFAULT_ROLLUP_VISUALIZATION_COLOR,
    divisor: typeof rawDivisor === 'number' && Number.isInteger(rawDivisor) && rawDivisor >= 0 ? rawDivisor : 0,
    showNumber: option?.__rollup_show_as_show_number__ === true,
  };
}

export function parseRollupTypeOption(field: YDatabaseField) {
  const rollupTypeOption = getTypeOptions(field)?.toJSON();

  return rollupTypeOption as RollupTypeOption;
}
