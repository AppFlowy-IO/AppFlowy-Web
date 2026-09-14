import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { RollupVisualizationOption } from '@/application/database-yjs/fields/rollup/rollup.type';

import { FormulaType, FormulaValue } from './values';

/** Persisted under `type_option["19"]` (stored keys: `expression`, `format`, `__rollup_show_as_*__`). */
export interface FormulaTypeOption {
  /** Expression source (stored as `expression`); property references are prop("<field_id>"). */
  formula: string;
  /** Number format applied when the result is a number. */
  format: NumberFormat;
  /** Same show-as keys Rollup persists (`__rollup_show_as_*__`), reused for number results. */
  __rollup_show_as_type__?: number;
  __rollup_show_as_color__?: string;
  __rollup_show_as_divisor__?: number;
  __rollup_show_as_show_number__?: boolean;
}

export const FORMULA_MAX_DEPTH = 15;

/** Result of evaluating a formula for one row. */
export interface FormulaCellResult {
  /** The evaluated value; `EMPTY` when the formula is blank or failed. */
  value: FormulaValue;
  /** Static result type of the expression (`any` when the expression is invalid). */
  resultType: FormulaType;
  /** Display text with number/date formatting applied. */
  text: string;
  /** Number for numeric results (used by sorts, filters, Show as and Calculate). */
  rawNumeric?: number;
  /** Unix seconds start/end for date results (used by sorts and filters). */
  rawDate?: { start: number; end?: number; includeTime: boolean };
  rawBoolean?: boolean;
  /** A parse, type or evaluation error message; the cell shows an error state. */
  error?: string;
}

export interface FormulaCellDisplayOptions {
  numberFormat?: NumberFormat;
  visualization?: RollupVisualizationOption;
}
