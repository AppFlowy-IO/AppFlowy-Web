/**
 * Value normalization and comparison of the dashboard visual parity probes
 * (VISUAL-PARITY.md §3.3, §3.4): colors become `#RRGGBBAA` with the alpha
 * quantized as `round(a × 255)`, numbers pass within the px tolerance, colors
 * and strings must be equal, lists compare item by item.
 */

export interface ShadowValue {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

const hex2 = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 1;
  const text = raw.trim();

  return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
}

function parseChannel(raw: string): number {
  const text = raw.trim();

  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * 255 : Number(text);
}

/**
 * `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()` / `rgba()` (comma or space
 * syntax), `color(srgb r g b / a)` (what Chromium computes for `color-mix`) and
 * `transparent` → `#RRGGBBAA`. Anything else (`none`, gradients, names other
 * than `transparent`) → `null`.
 */
export function normalizeColor(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const value = input.trim().toLowerCase();

  if (value === 'transparent') return '#00000000';
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);

  if (hex) {
    const digits = hex[1];

    if (digits.length === 3 || digits.length === 4) {
      const full = digits
        .split('')
        .map((digit) => digit + digit)
        .join('');

      return `#${(full.length === 6 ? `${full}ff` : full).toUpperCase()}`;
    }

    if (digits.length === 6) return `#${digits.toUpperCase()}FF`;
    if (digits.length === 8) return `#${digits.toUpperCase()}`;
    return null;
  }

  const rgb = /^rgba?\(([^)]*)\)$/.exec(value);

  if (rgb) {
    const body = rgb[1].trim();
    let parts: string[];
    let alpha: string | undefined;

    if (body.includes(',')) {
      parts = body.split(',').map((part) => part.trim());
      alpha = parts[3];
      parts = parts.slice(0, 3);
    } else {
      const [channels, slashAlpha] = body.split('/');

      parts = channels.trim().split(/\s+/);
      alpha = slashAlpha?.trim();
    }

    if (parts.length !== 3) return null;
    const [r, g, b] = parts.map(parseChannel);

    if ([r, g, b].some((channel) => !Number.isFinite(channel))) return null;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(parseAlpha(alpha) * 255)}`;
  }

  const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(value);

  if (srgb) {
    const [channels, slashAlpha] = srgb[1].split('/');
    const parts = channels.trim().split(/\s+/);

    if (parts.length !== 3) return null;
    const [r, g, b] = parts.map((part) =>
      part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part) * 255
    );

    if ([r, g, b].some((channel) => !Number.isFinite(channel))) return null;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(parseAlpha(slashAlpha) * 255)}`;
  }

  return null;
}

/** `rgba(…)`-style alpha multiplied by `factor` (effective icon color). */
export function multiplyAlpha(color: string, factor: number): string {
  const alpha = parseInt(color.slice(7, 9), 16) / 255;

  return `${color.slice(0, 7)}${hex2(alpha * factor * 255)}`;
}

export type CompareResult = { pass: boolean; detail?: string };

function isShadowList(value: unknown): value is ShadowValue[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && 'blur' in item);
}

/** Compare a measured value with the expected one. `null` / `undefined` actual never passes. */
export function compareValues(expected: unknown, actual: unknown, tolerancePx: number): CompareResult {
  if (actual === null || actual === undefined) return { pass: false, detail: 'not measured' };
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return { pass: false, detail: 'not a number' };
    const delta = Math.abs(actual - expected);

    return delta <= tolerancePx + 1e-6 ? { pass: true } : { pass: false, detail: `off by ${round2(actual - expected)}` };
  }

  if (isShadowList(expected)) {
    if (!isShadowList(actual)) return { pass: false, detail: 'not a shadow list' };
    if (expected.length !== actual.length) return { pass: false, detail: `${actual.length} shadows, expected ${expected.length}` };
    for (let index = 0; index < expected.length; index += 1) {
      const want = expected[index];
      const got = actual[index];

      for (const key of ['x', 'y', 'blur', 'spread'] as const) {
        if (Math.abs(want[key] - got[key]) > tolerancePx + 1e-6) {
          return { pass: false, detail: `shadow ${index} ${key} ${got[key]} ≠ ${want[key]}` };
        }
      }

      if (want.color !== got.color) return { pass: false, detail: `shadow ${index} color ${got.color} ≠ ${want.color}` };
    }

    return { pass: true };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return { pass: false, detail: 'list differs' };
    for (let index = 0; index < expected.length; index += 1) {
      const result = compareValues(expected[index], actual[index], tolerancePx);

      if (!result.pass) return { pass: false, detail: `item ${index}: ${result.detail ?? 'differs'}` };
    }

    return { pass: true };
  }

  return expected === actual ? { pass: true } : { pass: false };
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
