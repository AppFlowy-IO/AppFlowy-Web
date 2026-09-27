import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { parseRollupVisualizationOption } from '@/application/database-yjs/fields/rollup/parse';
import { RollupVisualizationOption } from '@/application/database-yjs/fields/rollup/rollup.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { FormulaTypeOption } from './formula.type';

export function parseFormulaTypeOption(field: YDatabaseField): FormulaTypeOption {
  const raw = getTypeOptions(field, FieldType.Formula)?.toJSON() as
    | (Partial<Omit<FormulaTypeOption, 'formula'>> & { [YjsDatabaseKey.expression]?: unknown })
    | undefined;
  const format = Number.parseInt(String(raw?.format ?? NumberFormat.Num), 10);
  const expression = raw?.[YjsDatabaseKey.expression];

  return {
    formula: typeof expression === 'string' ? expression : '',
    format: NumberFormat[format] === undefined ? NumberFormat.Num : (format as NumberFormat),
    __rollup_show_as_type__:
      raw?.__rollup_show_as_type__ === undefined ? undefined : Number(raw.__rollup_show_as_type__),
    __rollup_show_as_color__: raw?.__rollup_show_as_color__,
    __rollup_show_as_divisor__:
      raw?.__rollup_show_as_divisor__ === undefined ? undefined : Number(raw.__rollup_show_as_divisor__),
    __rollup_show_as_show_number__: raw?.__rollup_show_as_show_number__,
  };
}

export function parseFormulaVisualizationOption(option: FormulaTypeOption): RollupVisualizationOption {
  return parseRollupVisualizationOption({
    relation_field_id: '',
    target_field_id: '',
    calculation_type: 0,
    show_as: 0,
    __rollup_show_as_type__: option.__rollup_show_as_type__,
    __rollup_show_as_color__: option.__rollup_show_as_color__,
    __rollup_show_as_divisor__: option.__rollup_show_as_divisor__,
    __rollup_show_as_show_number__: option.__rollup_show_as_show_number__,
  });
}
