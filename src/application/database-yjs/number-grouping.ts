/** Desktop-compatible numeric identity, validation, ordering and group prefills. */
export enum NumberGroupMode {
  Legacy = 0,
  Exact = 1,
  Range = 2,
}

export interface NumberGroupConfiguration {
  hide_empty: boolean;
  mode: NumberGroupMode;
  range_start: string;
  range_end: string;
  range_interval: string;
  sort_descending: boolean;
}

export type NumberGroupValidationError =
  | 'invalidNumber'
  | 'invalidBounds'
  | 'invalidInterval'
  | 'tooManyRanges'
  | 'precisionExceeded';

export type NumberGroupValidationResult =
  | { valid: true; configuration: NumberGroupConfiguration }
  | { valid: false; error: NumberGroupValidationError };

const SCALE = 28;
const TEN = BigInt(10);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const UNIT = TEN ** BigInt(SCALE);
const MAX_COEFFICIENT = (ONE << BigInt(96)) - ONE;

export const MAX_NUMBER_GROUP_BUCKETS = 1000;

interface Decimal {
  coefficient: bigint;
  scale: number;
}

interface NumberGroupDefinition {
  id: string;
  value: bigint;
  kind: 'exact' | 'legacy' | 'interval' | 'closed' | 'below' | 'above';
  end?: bigint;
}

export function defaultNumberGroupConfiguration(mode = NumberGroupMode.Legacy): NumberGroupConfiguration {
  return {
    hide_empty: false,
    mode,
    range_start: '0',
    range_end: '100',
    range_interval: '10',
    sort_descending: false,
  };
}

function scaled(decimal: Decimal): bigint {
  return decimal.coefficient * TEN ** BigInt(SCALE - decimal.scale);
}

function isRepresentable(scaledValue: bigint): boolean {
  let value = scaledValue;

  for (let scale = SCALE; scale > 0 && value % TEN === ZERO; scale--) value /= TEN;
  return (value < ZERO ? -value : value) <= MAX_COEFFICIENT;
}

function canonical(value: bigint): string {
  if (value === ZERO) return '0';
  const negative = value < ZERO;
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  const integer = digits.slice(0, -SCALE);

  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

/** Rust's normal decimal parser rounds discarded fractional digits; its exact parser rejects them. */
function parseDecimal(input: string, exact: boolean): Decimal | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(input);

  if (!match || (!match[2] && !match[3])) return null;
  const integer = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const fraction = match[3] || '';

  if (integer.length > 29 || BigInt(integer) > MAX_COEFFICIENT) return null;
  let scale = Math.min(fraction.length, SCALE);
  let coefficient = BigInt(`${integer}${fraction.slice(0, scale)}`);

  if (exact && (fraction.length > SCALE || coefficient > MAX_COEFFICIENT)) return null;
  while (coefficient > MAX_COEFFICIENT && scale > 0) {
    coefficient /= TEN;
    scale--;
  }

  if (coefficient > MAX_COEFFICIENT) return null;
  if (!exact && fraction.length > scale && fraction.charAt(scale) >= '5') {
    coefficient++;
    if (coefficient > MAX_COEFFICIENT) {
      if (scale === 0) return null;
      coefficient = (coefficient + BigInt(4)) / TEN;
      scale--;
    }
  }

  return { coefficient: match[1] === '-' ? -coefficient : coefficient, scale };
}

function parseConfigurationDecimal(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 64 || /[eE_]/.test(value)) return null;
  const decimal = parseDecimal(value, true);

  return decimal ? scaled(decimal) : null;
}

/**
 * Group raw stored cell strings using NumberTypeOption::default(), never the
 * formatted Percent/Currency display value. Preserve its legacy extraction
 * and lowercase-scientific detection; cell writes normalize input separately.
 */
export function parseNumberGroupCell(value: unknown): string | null {
  const parsed = parseStoredNumber(value);

  return parsed === null ? null : canonical(parsed);
}

function parseStoredNumber(value: unknown): bigint | null {
  if (typeof value !== 'string' || !value) return null;
  if (/([+-]?\d*\.?\d+)e([+-]?\d+)/.test(value)) {
    const match = /^([+-]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*))[eE]([+-]?\d+)$/.exec(value);

    if (!match) return null;
    const base = parseDecimal(match[1].replaceAll('_', ''), false);
    const exponentText = match[2].replace(/^[+-]?0*/, '');

    if (!base || exponentText.length > 2) return null;
    const exponent = Number(match[2]);

    if (Math.abs(exponent) > SCALE || (exponent < 0 && base.scale - exponent > SCALE)) return null;
    const result = exponent < 0
      ? scaled(base) / TEN ** BigInt(-exponent)
      : scaled(base) * TEN ** BigInt(exponent);

    return isRepresentable(result) ? result : null;
  }

  const leadingFraction = /^\.\d+/.exec(value)?.[0];
  const token = leadingFraction ? `0${leadingFraction}` : /-?\d+(\.\d+)?/.exec(value)?.[0];
  const decimal = token ? parseDecimal(token, false) : null;

  return decimal ? scaled(decimal) : null;
}

function parseGroupDefinition(id: string): NumberGroupDefinition | null {
  const single = /^number_(value|below|above)_(.+)$/.exec(id);

  if (single) {
    const value = parseConfigurationDecimal(single[2]);

    if (value === null) return null;
    return { id, value, kind: single[1] === 'value' ? 'exact' : single[1] as 'below' | 'above' };
  }

  const pair = /^number_(range|interval|interval_closed)_([^_]+)_([^_]+)$/.exec(id);

  if (!pair) return null;
  const value = parseConfigurationDecimal(pair[2]);
  const end = parseConfigurationDecimal(pair[3]);

  if (value === null || end === null || value >= end) return null;
  return { id, value, end, kind: pair[1] === 'range' ? 'legacy' : pair[1] === 'interval' ? 'interval' : 'closed' };
}

function compareValues(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface NumberGroupingPolicy {
  readonly configuration: NumberGroupConfiguration;
  readonly retainsEmptyGroups: boolean;
  configuredGroupIds(): string[];
  groupIdForCell(value: unknown): string | null;
  compareGroupIds(left: string, right: string): number;
  valueForGroup(groupId: string): string | undefined;
  isValidGroupId(groupId: string): boolean;
}

function makePolicy(
  configuration: NumberGroupConfiguration,
  start: bigint,
  end: bigint,
  interval: bigint,
  rangeIds: string[]
): NumberGroupingPolicy {
  const belowId = `number_below_${canonical(start)}`;
  const aboveId = `number_above_${canonical(end)}`;
  const range = configuration.mode === NumberGroupMode.Range;
  const groupForValue = (value: bigint): string | null => {
    if (configuration.mode === NumberGroupMode.Exact) return `number_value_${canonical(value)}`;
    if (range) {
      if (value < start) return belowId;
      if (value > end) return aboveId;
      if (value === end) return rangeIds[rangeIds.length - 1];
      return rangeIds[Number((value - start) / interval)];
    }

    const width = BigInt(100) * UNIT;
    const quotient = value / width - (value < ZERO && value % width !== ZERO ? ONE : ZERO);
    const lower = quotient * width;
    const upper = lower + width;

    return isRepresentable(lower) && isRepresentable(upper)
      ? `number_range_${canonical(lower)}_${canonical(upper)}`
      : null;
  };

  const valueForGroup = (id: string): string | undefined => {
    const group = parseGroupDefinition(id);

    if (!group) return undefined;
    const value = group.kind === 'below' ? start - interval : group.kind === 'above' ? end + interval : group.value;

    return groupForValue(value) === id ? canonical(value) : undefined;
  };

  return {
    configuration,
    retainsEmptyGroups: range,
    configuredGroupIds: () => range ? [belowId, ...rangeIds, aboveId] : [],
    groupIdForCell: (value) => {
      const parsed = parseStoredNumber(value);

      return parsed === null ? null : groupForValue(parsed);
    },
    compareGroupIds: (left, right) => {
      const a = parseGroupDefinition(left);
      const b = parseGroupDefinition(right);
      const rank = (group: NumberGroupDefinition) => group.kind === 'below' ? 0 : group.kind === 'above' ? 2 : 1;
      const order = a && b
        ? rank(a) - rank(b) || compareValues(a.value, b.value)
        : a ? 1 : b ? -1 : 0;

      return configuration.sort_descending ? -order : order;
    },
    valueForGroup,
    isValidGroupId: (id) => valueForGroup(id) !== undefined,
  };
}

type PolicyValidation = { valid: true; policy: NumberGroupingPolicy } | { valid: false; error: NumberGroupValidationError };

function validatePolicy(configuration: NumberGroupConfiguration): PolicyValidation {
  if (!configuration || ![0, 1, 2].includes(configuration.mode) ||
    typeof configuration.hide_empty !== 'boolean' || typeof configuration.sort_descending !== 'boolean') {
    return { valid: false, error: 'invalidNumber' };
  }

  const start = parseConfigurationDecimal(configuration.range_start);
  const end = parseConfigurationDecimal(configuration.range_end);
  const interval = parseConfigurationDecimal(configuration.range_interval);

  if (start === null || end === null || interval === null) return { valid: false, error: 'invalidNumber' };
  if (start >= end) return { valid: false, error: 'invalidBounds' };
  if (interval <= ZERO) return { valid: false, error: 'invalidInterval' };
  if (end - start > interval * BigInt(MAX_NUMBER_GROUP_BUCKETS)) return { valid: false, error: 'tooManyRanges' };
  if (!isRepresentable(start - interval) || !isRepresentable(end + interval)) {
    return { valid: false, error: 'precisionExceeded' };
  }

  const rangeIds: string[] = [];

  for (let lower = start; lower < end;) {
    const next = lower + interval;

    if (!isRepresentable(next)) return { valid: false, error: 'precisionExceeded' };
    const upper: bigint = next < end ? next : end;

    rangeIds.push(`number_interval_${upper === end ? 'closed_' : ''}${canonical(lower)}_${canonical(upper)}`);
    lower = upper;
  }

  return {
    valid: true,
    policy: makePolicy({
      ...configuration,
      range_start: canonical(start),
      range_end: canonical(end),
      range_interval: canonical(interval),
    }, start, end, interval, rangeIds),
  };
}

export function validateNumberGroupConfiguration(configuration: NumberGroupConfiguration): NumberGroupValidationResult {
  const result = validatePolicy(configuration);

  return result.valid ? { valid: true, configuration: result.policy.configuration } : result;
}

const LEGACY_POLICY = makePolicy(defaultNumberGroupConfiguration(), ZERO, BigInt(100) * UNIT, BigInt(10) * UNIT, []);

export function createNumberGroupingPolicy(content?: string): NumberGroupingPolicy {
  if (!content) return LEGACY_POLICY;
  try {
    const parsed: unknown = JSON.parse(content);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return LEGACY_POLICY;
    const result = validatePolicy({ ...defaultNumberGroupConfiguration(), ...parsed });

    return result.valid ? result.policy : LEGACY_POLICY;
  } catch {
    return LEGACY_POLICY;
  }
}

export function parseNumberGroupConfiguration(content?: string): NumberGroupConfiguration {
  return { ...createNumberGroupingPolicy(content).configuration };
}

export function getNumberGroupLabel(id: string): string | null {
  const group = parseGroupDefinition(id);

  if (!group) return null;
  const value = canonical(group.value);

  switch (group.kind) {
    case 'exact': return value;
    case 'below': return `Below ${value}`;
    case 'above': return `Above ${value}`;
    case 'legacy': return `${value} to ${canonical(group.end as bigint)}`;
    case 'interval': return `${value}–<${canonical(group.end as bigint)}`;
    case 'closed': return `${value}–${canonical(group.end as bigint)}`;
  }
}
