import { YDatabaseField } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { RollupTypeOption } from './rollup.type';

export function parseRollupTypeOption(field: YDatabaseField) {
  const rollupTypeOption = getTypeOptions(field)?.toJSON();

  return rollupTypeOption as RollupTypeOption;
}
