/**
 * Number range buckets of a Number X axis (WP11 §1.5), pinned by
 * `dashboard-parity/group-keys.json#numberBuckets` on both clients.
 */
import type { ChartGroupRef } from './group-keys';

/** At most this many ranges; a smaller size is widened (chart-22). */
export const MAX_NUMBER_BUCKETS = 200;

export interface ChartNumberBucketSettings {
  /** `x_number_bucket_size`; used when finite and above zero. */
  size?: number | null;
  /** `x_number_bucket_min`. */
  min?: number | null;
  /** `x_number_bucket_max`; ignored unless above `min`. */
  max?: number | null;
}

export interface ResolvedNumberBuckets {
  size: number;
  start: number;
  /** Set: values below go to `n:lt:<min>`. */
  min?: number;
  /** Set: values at or above go to `n:ge:<max>`. */
  max?: number;
}

/** `m × 10^k` without float noise: a division by an exact power of ten rounds like the decimal literal. */
function scaled(mantissa: number, exponent: number): number {
  return exponent >= 0 ? mantissa * 10 ** exponent : mantissa / 10 ** -exponent;
}

/** The smallest of {1, 2, 5} × 10^k that is at least `x`; 1 for `x ≤ 0` (or not finite). */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exponent = Math.floor(Math.log10(x));

  for (let k = exponent - 1; k <= exponent + 1; k++) {
    for (const mantissa of [1, 2, 5]) {
      const step = scaled(mantissa, k);

      if (step >= x) return step;
    }
  }

  return scaled(1, exponent + 2);
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The ranges over `values` (the finite numbers of the rows): the size is the
 * setting or `niceStep(span / 10)`, the start is `min` or the data minimum
 * floored to the size, and more than 200 ranges widen the size. `null` when
 * there are no numbers.
 */
export function resolveNumberBuckets(
  values: readonly number[],
  settings: ChartNumberBucketSettings
): ResolvedNumberBuckets | null {
  const numbers = values.filter((value) => Number.isFinite(value));

  if (numbers.length === 0) return null;
  let dataMin = numbers[0];
  let dataMax = numbers[0];

  numbers.forEach((value) => {
    if (value < dataMin) dataMin = value;
    if (value > dataMax) dataMax = value;
  });

  const min = finite(settings.min);
  const rawMax = finite(settings.max);
  const max = rawMax !== undefined && (min === undefined || rawMax > min) ? rawMax : undefined;
  const setSize = finite(settings.size);
  const lo = min ?? dataMin;
  const hi = max ?? dataMax;
  let size = setSize !== undefined && setSize > 0 ? setSize : niceStep((hi - lo) / 10);
  const startFor = (step: number) => (min !== undefined ? min : Math.floor(lo / step) * step);
  let start = startFor(size);

  if (Math.floor((hi - start) / size) + 1 > MAX_NUMBER_BUCKETS) {
    size = niceStep((hi - start) / (MAX_NUMBER_BUCKETS - 1));
    start = startFor(size);
  }

  const buckets: ResolvedNumberBuckets = { size, start };

  if (min !== undefined) buckets.min = min;
  if (max !== undefined) buckets.max = max;
  return buckets;
}

/** The range group of `value`: `n:<lower>` "a–b", `n:lt:<min>` "< min" or `n:ge:<max>` "≥ max". */
export function numberBucketRef(
  value: number,
  buckets: ResolvedNumberBuckets,
  formatAxis: (value: number) => string
): ChartGroupRef {
  const canonical = canonicalNumber;

  if (buckets.min !== undefined && value < buckets.min) {
    return {
      key: `n:lt:${canonical(buckets.min)}`,
      label: `< ${formatAxis(buckets.min)}`,
      hint: { rank: Number.NEGATIVE_INFINITY },
    };
  }

  if (buckets.max !== undefined && value >= buckets.max) {
    return {
      key: `n:ge:${canonical(buckets.max)}`,
      label: `≥ ${formatAxis(buckets.max)}`,
      hint: { rank: Number.POSITIVE_INFINITY },
    };
  }

  const index = Math.floor((value - buckets.start) / buckets.size + 1e-9);
  const lower = Number(canonical(buckets.start + index * buckets.size));
  const upper = lower + buckets.size;

  return {
    key: `n:${canonical(lower)}`,
    label: `${formatAxis(lower)}–${formatAxis(Number(canonical(upper)))}`,
    hint: { rank: lower },
  };
}

/**
 * A number as group keys print it (WP11 §1.4): `-0` is `0`; a value within
 * `1e-9 × max(1, |x|)` of an integer is that integer; anything else is the
 * shortest round-trip form of its 12 significant digits
 * (`0.30000000000000004` → `0.3`, `1e21` → `1e+21`).
 */
export function canonicalNumber(x: number): string {
  if (x === 0) return '0';
  const rounded = Math.round(x);

  if (Math.abs(x - rounded) <= 1e-9 * Math.max(1, Math.abs(x))) return rounded === 0 ? '0' : String(rounded);
  return String(Number(x.toPrecision(12)));
}
