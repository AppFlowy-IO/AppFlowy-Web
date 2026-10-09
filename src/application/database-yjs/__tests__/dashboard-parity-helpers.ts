/**
 * Helpers for the tests that bind the web client to the shared
 * `dashboard-parity/` fixtures (the same bytes desktop tests read from
 * `frontend/resources/dashboard-parity/`).
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

import * as Y from 'yjs';

export const PARITY_DIR = join(__dirname, '..', '__fixtures__', 'dashboard-parity');
export const MANIFEST_FILE = 'FIXTURES.sha256';
export const MANIFEST_HEADER =
  '# dashboard-parity v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md';

/** Every file of the fixture folder, as `/`-separated paths relative to it. */
export function listParityFiles(dir = PARITY_DIR): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const path = join(current, entry.name);

      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(dir, path).split(sep).join('/'));
    });
  };

  walk(dir);
  return files;
}

export function readParityFile(name: string): Buffer {
  return readFileSync(join(PARITY_DIR, name));
}

/** A fixture file parsed as JSON (numbers stay JS numbers; see `decodeParityJson` for `$bigint`). */
export function loadParityFixture<T = unknown>(name: string): T {
  return JSON.parse(readParityFile(name).toString('utf8')) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{"$bigint": "N"}` → `BigInt(N)` (a native client's integer), recursively; everything else unchanged. */
export function decodeParityJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeParityJson);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);

  if (keys.length === 1 && keys[0] === '$bigint' && typeof value.$bigint === 'string') return BigInt(value.$bigint);
  return Object.fromEntries(keys.map((key) => [key, decodeParityJson(value[key])]));
}

/** Every bigint → number, recursively, so values compare by number as the fixtures require. */
export function normalizeNumbers(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNumbers(item)]));
}

/**
 * Store `value` under `key` as a native client would, bigints included (yrs
 * `Any::BigInt`). Desktop integers reach the web in decoded updates, but the
 * Yjs API refuses to author a top-level bigint (it accepts one nested in
 * JSON), so for that one case Yjs briefly takes the bigint for a number; it is
 * stored and encoded as a bigint all the same.
 */
export function setParityValue(map: Y.Map<unknown>, key: string, value: unknown) {
  if (typeof value !== 'bigint') {
    map.set(key, value);
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(BigInt.prototype, 'constructor');

  Object.defineProperty(BigInt.prototype, 'constructor', { value: Number, configurable: true, writable: true });
  try {
    map.set(key, value);
  } finally {
    if (descriptor) Object.defineProperty(BigInt.prototype, 'constructor', descriptor);
  }
}

/** Seed a Y.Map with a decoded fixture map (see `decodeParityJson`), one key at a time. */
export function seedParityMap(map: Y.Map<unknown>, entries: Record<string, unknown>) {
  Object.entries(entries).forEach(([key, value]) => setParityValue(map, key, value));
}

function byteOrder(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return Buffer.compare(left, right);
}

/**
 * The manifest the README's command produces: the header, then
 * `<sha256>  <path>` for every file except the manifest, in byte (`LC_ALL=C`)
 * path order, with one trailing newline.
 */
export function computeManifest(dir = PARITY_DIR): string {
  const lines = listParityFiles(dir)
    .filter((path) => path !== MANIFEST_FILE)
    .sort(byteOrder)
    .map(
      (path) =>
        `${createHash('sha256')
          .update(readFileSync(join(dir, path)))
          .digest('hex')}  ${path}`
    );

  return [MANIFEST_HEADER, ...lines].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export interface CssRule {
  /** The rule's selector, whitespace-normalized. */
  selector: string;
  /** Enclosing at-rule preludes (`@supports not (...)`), outermost first. */
  within: string[];
  /** Custom properties declared in the rule, in order. */
  variables: Record<string, string>;
}

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

/** Every style rule of a stylesheet with its custom properties (a small parser for our own token files). */
export function parseCssRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let buffer = '';

  for (const char of source) {
    if (char === '{') {
      stack.push(normalizeSpace(buffer));
      buffer = '';
    } else if (char === '}') {
      const prelude = stack.pop() ?? '';

      if (!prelude.startsWith('@')) {
        const variables: Record<string, string> = {};

        buffer.split(';').forEach((declaration) => {
          const index = declaration.indexOf(':');

          if (index === -1) return;
          const name = declaration.slice(0, index).trim();

          if (name.startsWith('--')) variables[name] = normalizeSpace(declaration.slice(index + 1));
        });
        rules.push({ selector: prelude, within: [...stack], variables });
      }

      buffer = '';
    } else if (char === ';' && (stack.length === 0 || stack[stack.length - 1].startsWith('@'))) {
      // A statement outside a style rule (`@import …;`, `@tailwind …;`) ends here.
      buffer = '';
    } else {
      buffer += char;
    }
  }

  return rules;
}

/**
 * The custom properties `selector` declares, merged in source order. Without
 * `within`, only rules outside any at-rule count; with it, only rules inside
 * an at-rule whose prelude starts with `within`.
 */
export function parseCssVariables(css: string, selector: string, within?: string): Record<string, string> {
  const wanted = normalizeSpace(selector);
  const variables: Record<string, string> = {};

  parseCssRules(css)
    .filter(
      (rule) =>
        rule.selector === wanted &&
        (within === undefined ? rule.within.length === 0 : rule.within.some((prelude) => prelude.startsWith(within)))
    )
    .forEach((rule) => Object.assign(variables, rule.variables));
  return variables;
}

function toHex(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** `#RRGGBB`, or `#RRGGBBAA` when the color is not opaque (alpha = round(a × 255)). */
function formatColor(r: number, g: number, b: number, alpha255: number) {
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  const alpha = Math.round(alpha255);

  return alpha >= 255 ? hex : `${hex}${toHex(alpha)}`;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–255 */
  a: number;
}

function parseColor(value: string, variables: Record<string, string>, depth: number): Rgba {
  if (depth > 20) throw new Error(`Color reference cycle at ${value}`);
  const color = normalizeSpace(value).toLowerCase();
  const reference = /^var\((--[\w-]+)\)$/.exec(color);

  if (reference) {
    const next = variables[reference[1]];

    if (next === undefined) throw new Error(`Unknown CSS variable ${reference[1]}`);
    return parseColor(next, variables, depth + 1);
  }

  if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(color);

  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    const channel = (index: number) => parseInt(digits.slice(index * 2, index * 2 + 2), 16);

    return { r: channel(0), g: channel(1), b: channel(2), a: digits.length === 8 ? channel(3) : 255 };
  }

  const rgb = /^rgba?\(([^)]*)\)$/.exec(color);

  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1].split(/[\s,/]+/).filter(Boolean);

    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) * 255 };
  }

  // color-mix(in srgb, <color> P%, transparent): the color at P% of its alpha
  // (premultiplied mixing with transparent keeps the channels).
  const mix = /^color-mix\(in srgb, (.+) ([\d.]+)%, transparent\)$/.exec(color);

  if (mix) {
    const base = parseColor(mix[1], variables, depth + 1);

    return { ...base, a: (base.a * Number(mix[2])) / 100 };
  }

  throw new Error(`Unsupported CSS color: ${value}`);
}

/** Resolve a CSS color (through `var()` references in `variables`) to `#RRGGBB` / `#RRGGBBAA`, uppercase. */
export function resolveCssColor(value: string, variables: Record<string, string> = {}): string {
  const { r, g, b, a } = parseColor(value, variables, 0);

  return formatColor(r, g, b, a);
}

export interface ParsedShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/**
 * A `box-shadow` list as `tokens.json` writes shadows (colors resolved to
 * hex). Fully transparent layers (`0 0 0 0 transparent`) are dropped, so a
 * "no shadow" placeholder reads as `[]`.
 */
export function parseCssShadows(value: string, variables: Record<string, string> = {}): ParsedShadow[] {
  const layers: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  layers.push(current);
  return layers
    .map((layer) => {
      const text = normalizeSpace(layer);
      const colorStart = text.search(/(rgba?\(|#|transparent|var\(|color-mix\()/);
      const lengths = text.slice(0, colorStart).trim().split(' ').filter(Boolean).map(parseFloat);
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;

      return { x, y, blur, spread, color: resolveCssColor(text.slice(colorStart), variables) };
    })
    .filter((shadow) => !(shadow.color.length === 9 && shadow.color.endsWith('00')));
}
