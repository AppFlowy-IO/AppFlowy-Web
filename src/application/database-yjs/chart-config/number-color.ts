/**
 * The Number card value color (WP11 §1.12), pinned by
 * `dashboard-parity/number-color.json` on both clients.
 */
import {
  ChartNumberColor,
  NumberColorOperator,
  NumberColorRule,
  NumberConditionalColor,
  parseChartNumberColor,
} from '../chart-extended-settings';

/** The rule operators in menu order, with the symbol the operator button shows. */
export const NUMBER_COLOR_OPERATORS: ReadonlyArray<{
  value: NumberColorOperator;
  symbol: string;
  labelKey: string;
  fallback: string;
}> = [
  { value: 'gt', symbol: '>', labelKey: 'chart.numberColor.greaterThan', fallback: 'Greater than' },
  { value: 'gte', symbol: '≥', labelKey: 'chart.numberColor.greaterThanOrEqual', fallback: 'Greater than or equal' },
  { value: 'lt', symbol: '<', labelKey: 'chart.numberColor.lessThan', fallback: 'Less than' },
  { value: 'lte', symbol: '≤', labelKey: 'chart.numberColor.lessThanOrEqual', fallback: 'Less than or equal' },
  { value: 'eq', symbol: '=', labelKey: 'chart.numberColor.equal', fallback: 'Equal' },
  { value: 'neq', symbol: '≠', labelKey: 'chart.numberColor.notEqual', fallback: 'Not equal' },
];

/** `|a − b| ≤ 1e-9 × max(1, |a|, |b|)`, so `0.1 + 0.2` equals `0.3`. */
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Whether `value` satisfies `rule`. An unknown operator or a non-finite rule value never matches. */
export function matchesNumberRule(value: number, rule: Pick<NumberColorRule, 'operator' | 'value'>): boolean {
  if (!Number.isFinite(rule.value) || !Number.isFinite(value)) return false;
  switch (rule.operator) {
    case 'gt':
      return value > rule.value;
    case 'gte':
      return value >= rule.value;
    case 'lt':
      return value < rule.value;
    case 'lte':
      return value <= rule.value;
    case 'eq':
      return nearlyEqual(value, rule.value);
    case 'neq':
      return !nearlyEqual(value, rule.value);
    default:
      return false;
  }
}

/**
 * The color the value is drawn in: none for "No data"; with dynamic color on,
 * the first matching rule's color, else `else_color`, else `number_color`;
 * otherwise `number_color`. Unknown names render as `default`.
 */
export function resolveNumberColor(
  value: number | null,
  numberColor: string | null | undefined,
  conditional: NumberConditionalColor | null | undefined
): ChartNumberColor | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (conditional?.enabled) {
    const rule = conditional.rules.find((candidate) => matchesNumberRule(value, candidate));

    if (rule) return parseChartNumberColor(rule.color);
    return parseChartNumberColor(conditional.elseColor ?? numberColor);
  }

  return parseChartNumberColor(numberColor);
}

/** A new rule's defaults: greater than 0 in green, under a fresh `ncr:` id. */
export function createNumberColorRule(id: string): NumberColorRule {
  return { id, operator: 'gt', value: 0, color: 'green' };
}
