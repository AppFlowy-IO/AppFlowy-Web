import * as Y from 'yjs';

/**
 * Codec primitives for persisted layout-settings maps (ARCHITECTURE §3.1),
 * shared by the dashboard and chart codecs. Rust has the same rules in
 * `layout_codec.rs`:
 *
 * - absent or wrong-typed values read as the documented default;
 * - numbers may be JS numbers (web) or bigints (native clients), compared by value;
 * - a new enum is a string, and an unknown string reads as the default without
 *   being rewritten;
 * - writes go key by key and skip a key whose stored value is already equal;
 * - objects in arrays keep the unknown keys another client stored on them.
 */

/** A Y.Map / Y.Array (at any depth) as plain JSON; other values unchanged, bigints kept. */
export function toPlainValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const record: Record<string, unknown> = {};

    value.forEach((item, key) => {
      record[key] = toPlainValue(item);
    });
    return record;
  }

  if (value instanceof Y.Array) return value.toArray().map(toPlainValue);
  return value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A finite number (rounded like Rust's `integer_value`) or a bigint; anything else is `undefined`. */
export function readInteger(value: unknown): number | undefined {
  const number = readNumber(value);

  return number === undefined ? undefined : Math.round(number);
}

/** A finite number or a bigint; anything else is `undefined`. */
export function readNumber(value: unknown): number | undefined {
  const number = typeof value === 'bigint' ? Number(value) : value;

  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/** `value` when it is one of `allowed`; an unknown string or another type reads as `fallback`. */
export function readStringEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The strings of a stored list (plain or Y.Array); other entries are dropped. */
export function readStringList(value: unknown): string[] {
  const plain = toPlainValue(value);

  return Array.isArray(plain) ? plain.filter((item): item is string => typeof item === 'string') : [];
}

/** `clampInteger` of the dashboard codec: `readInteger`, clamped, or `fallback`. */
export function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = readInteger(value);

  if (number === undefined) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Deep equality of persisted values: a number equals a bigint of the same
 * value, object keys compare in any order, arrays in order. Y types compare
 * by their JSON.
 */
export function sameLayoutValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = toPlainValue(a);
  const right = toPlainValue(b);

  if (left === right) return true;
  const leftNumber = typeof left === 'number' || typeof left === 'bigint';
  const rightNumber = typeof right === 'number' || typeof right === 'bigint';

  if (leftNumber || rightNumber) {
    // Compare through Number so 1 === 1n; a NaN never equals anything.
    return leftNumber && rightNumber && Number(left) === Number(right);
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameLayoutValue(item, right[index]))
    );
  }

  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const keys = Object.keys(left);

  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameLayoutValue(left[key], right[key]))
  );
}

/** Write `value` under `key` unless the stored value is already equal. Returns whether it wrote. */
export function setLayoutKeyIfChanged(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  key: string,
  value: unknown
): boolean {
  if (sameLayoutValue(map.get(key), value)) return false;
  map.set(key, value);
  return true;
}

/** The entries of `record` whose keys are not in `known`, or `undefined` when there are none. */
export function pickUnknownKeys(
  record: Record<string, unknown>,
  known: ReadonlySet<string>
): Record<string, unknown> | undefined {
  let extras: Record<string, unknown> | undefined;

  Object.entries(record).forEach(([key, value]) => {
    if (known.has(key)) return;
    extras = extras ?? {};
    extras[key] = value;
  });
  return extras;
}
