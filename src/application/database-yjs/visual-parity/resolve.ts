/**
 * Resolves the expected value of a `visual-metrics.json` metric for one client
 * and state (VISUAL-PARITY.md §2.3): numbers, `#RRGGBBAA` literals, tokens.json
 * paths (colors per theme, shadows per theme), `ref:<css-var>` colors, per-mode
 * and per-theme objects, `calc` expressions and literal strings / booleans.
 */
import { CalcError, evaluateCalc, MissingMeasurementError, parseCalc, TOKEN_ROOTS } from './calc';
import { normalizeColor, ShadowValue } from './compare';
import { ParityClient, ParityState } from './types';

/** tokens.json, loosely typed: the resolver walks it by path. */
export type TokensFixture = Record<string, unknown> & { color: Record<string, ColorToken> };

export interface ColorToken {
  kind: string;
  ref?: string;
  resolved: { light: string; dark: string; desktopDark?: string };
}

export interface ResolveContext {
  tokens: TokensFixture;
  state: ParityState;
  client: ParityClient;
  /** Measured metrics of the same instance scope (`$id.metric`, `$self.metric`). */
  measured?: (id: string, metric: string) => number | undefined;
}

export type ResolvedValue = number | string | boolean | number[] | ShadowValue[];

export type Resolution =
  | { ok: true; value: ResolvedValue }
  | { ok: false; error: string; missing?: { id: string; metric: string } };

const COLOR_LITERAL = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

function isTokenPath(value: string) {
  const root = value.split('.')[0];

  return value.includes('.') && (TOKEN_ROOTS as readonly string[]).includes(root) && /^[A-Za-z0-9.]+$/.test(value);
}

/** The raw value at a dotted tokens.json path, or `undefined`. */
export function lookupToken(tokens: TokensFixture, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }

    return undefined;
  }, tokens);
}

function isColorToken(value: unknown): value is ColorToken {
  return Boolean(value && typeof value === 'object' && 'resolved' in (value as Record<string, unknown>));
}

function colorOf(token: ColorToken, ctx: ResolveContext): string | null {
  const { theme } = ctx.state;
  const raw =
    ctx.client === 'desktop' && theme === 'dark' && token.resolved.desktopDark
      ? token.resolved.desktopDark
      : token.resolved[theme];

  return normalizeColor(raw);
}

function shadowsOf(value: unknown, ctx: ResolveContext): ShadowValue[] | null {
  if (!value || typeof value !== 'object') return null;
  const list = (value as Record<string, unknown>)[ctx.state.theme];

  if (!Array.isArray(list)) return null;
  const shadows: ShadowValue[] = [];

  for (const item of list as Record<string, unknown>[]) {
    const color = normalizeColor(String(item.color));

    if (color === null) return null;
    shadows.push({
      x: Number(item.x),
      y: Number(item.y),
      blur: Number(item.blur),
      spread: Number(item.spread),
      color,
    });
  }

  return shadows;
}

/** Every color token of kind `ref` that names `ref`; they must resolve to the same color in this state. */
function resolveRef(ref: string, ctx: ResolveContext): Resolution {
  const colors = new Set<string>();

  Object.values(ctx.tokens.color).forEach((token) => {
    if (token.kind !== 'ref' || token.ref !== ref) return;
    const color = colorOf(token, ctx);

    if (color) colors.add(color);
  });
  if (colors.size === 0) return { ok: false, error: `no tokens.json color of kind "ref" names "${ref}"` };
  if (colors.size > 1) return { ok: false, error: `the tokens naming "${ref}" disagree: ${[...colors].join(', ')}` };
  return { ok: true, value: [...colors][0] };
}

function resolveTokenPath(path: string, ctx: ResolveContext): Resolution {
  const raw = lookupToken(ctx.tokens, path);

  if (raw === undefined) return { ok: false, error: `unknown token "${path}"` };
  if (path.startsWith('color.')) {
    if (!isColorToken(raw)) return { ok: false, error: `"${path}" is not a color token` };
    const color = colorOf(raw, ctx);

    return color ? { ok: true, value: color } : { ok: false, error: `"${path}" has no ${ctx.state.theme} color` };
  }

  if (path.startsWith('shadow.')) {
    const shadows = shadowsOf(raw, ctx);

    return shadows ? { ok: true, value: shadows } : { ok: false, error: `"${path}" is not a shadow token` };
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') return { ok: true, value: raw };
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'number')) return { ok: true, value: raw as number[] };
  if (typeof raw === 'string') {
    const color = normalizeColor(raw);

    return color ? { ok: true, value: color } : { ok: true, value: raw };
  }

  return { ok: false, error: `"${path}" is not a value` };
}

function numericToken(tokens: TokensFixture, path: string): number {
  const raw = lookupToken(tokens, path);

  if (typeof raw !== 'number') throw new CalcError(`token "${path}" is not a number`);
  return raw;
}

export function resolveExpected(spec: unknown, ctx: ResolveContext): Resolution {
  if (typeof spec === 'number' || typeof spec === 'boolean') return { ok: true, value: spec };
  if (Array.isArray(spec)) {
    if (spec.every((item) => typeof item === 'number')) return { ok: true, value: spec as number[] };
    return { ok: false, error: 'only number lists are literal values' };
  }

  if (typeof spec === 'string') {
    if (COLOR_LITERAL.test(spec)) return { ok: true, value: normalizeColor(spec) as string };
    if (spec.startsWith('ref:')) return resolveRef(spec.slice(4), ctx);
    if (isTokenPath(spec)) return resolveTokenPath(spec, ctx);
    return { ok: true, value: spec };
  }

  if (spec && typeof spec === 'object') {
    const object = spec as Record<string, unknown>;
    const keys = Object.keys(object);

    if (typeof object.calc === 'string') {
      try {
        const value = evaluateCalc(parseCalc(object.calc), {
          token: (path) => numericToken(ctx.tokens, path),
          measured: (id, metric) => ctx.measured?.(id, metric),
        });

        return { ok: true, value };
      } catch (error) {
        if (error instanceof MissingMeasurementError) {
          return { ok: false, error: error.message, missing: { id: error.id, metric: error.metric } };
        }

        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (keys.length > 0 && keys.every((key) => key === 'view' || key === 'edit')) {
      return key(object, ctx.state.mode, ctx);
    }

    if (keys.length > 0 && keys.every((key) => key === 'light' || key === 'dark')) {
      return key(object, ctx.state.theme, ctx);
    }
  }

  return { ok: false, error: `unsupported value form ${JSON.stringify(spec)}` };
}

function key(object: Record<string, unknown>, name: string, ctx: ResolveContext): Resolution {
  if (!(name in object)) return { ok: false, error: `no "${name}" value` };
  return resolveExpected(object[name], ctx);
}

/** Metrics that are parameters of another metric, never measured on their own. */
export const PARAMETER_METRICS = new Set(['gapAxis']);

/** Metrics whose value is a color. */
export const COLOR_METRICS = new Set([
  'background',
  'borderColor',
  'ringColor',
  'outlineColor',
  'color',
  'iconColor',
  'effectiveIconColor',
  'strokeColor',
]);
