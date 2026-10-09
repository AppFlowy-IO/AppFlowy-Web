#!/usr/bin/env node
// Dashboard visual parity: cross-client comparator (layers L3 and L4 of parity-plan/VISUAL-PARITY.md §6.1).
//
// The same file lives in AppFlowy-Web/scripts/dashboard-parity/ and AppFlowy-Premium/scripts/dashboard-parity/.
// Change both copies together. Plain Node 18 or newer, no dependencies.
//
// Reads the probe files written by the web Playwright probe and the desktop integration-test probe
// (web-<state>.json, desktop-<state>.json), resolves every expected value itself from tokens.json,
// visual-metrics.json and icons.json, and writes:
//   visual-parity-report.md    per element: contract, resolved value, web value, desktop value, verdicts
//   visual-parity-report.html  web | desktop | Notion captures per state, scene and interaction, with the
//                              failing elements outlined from the probes' bounding boxes
//   visual-parity-report.json  the same rows, for tooling
//
// Run with --help for usage.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `Dashboard visual parity comparator (web vs desktop)

Usage:
  node scripts/dashboard-parity/compare-visual-parity.mjs --probes <dir> [--probes <dir>] [options]
  node scripts/dashboard-parity/compare-visual-parity.mjs --web <file> --desktop <file> [options]

Inputs:
  --probes <dir>        Folder with web-<state>.json and/or desktop-<state>.json probe files (repeatable).
                        <state> is view-light, view-dark, edit-light or edit-dark.
  --web <file>          One web probe file (repeatable). Its state comes from the file.
  --desktop <file>      One desktop probe file (repeatable).
  --fixtures <dir>      The dashboard-parity fixture folder (tokens.json, visual-metrics.json, icons.json,
                        FIXTURES.sha256). Default: this repo's copy.
  --tokens <file>, --metrics <file>, --icons <file>
                        Override one fixture file.
  --notion-dir <dir>    Folder that the Notion reference images in visual-metrics.json are relative to
                        (its notionRoot, scratchpad/notion-ui). Default: $DASHBOARD_PARITY_NOTION_DIR.

Outputs:
  --out <dir>           Where visual-parity-report.{md,html,json} go. Default: report/ next to the
                        first probe folder or file.
  --embed-images        Inline the PNG/JPEG captures as data: URIs so the HTML is one portable file.
  --failing-only        The markdown element tables list only rows that do not pass everywhere.
  --emit-plan <dir>     Also write plan-<state>.json: every row a probe must measure, with the values
                        that resolve without measurement. Needs no probe files.

Gate (same meaning as in the probes):
  --wave <N>            Entries with wave <= N are in scope (env DASHBOARD_PARITY_WAVE).
  --strict              In-scope pending entries also fail the exit code (env DASHBOARD_PARITY_STRICT=1).
  --allow-contract-mismatch
                        Compare even when a probe was made against a different FIXTURES.sha256.

Exit code: 0 no blocking failure, 1 blocking failures (enforced rows, or in-scope rows with --strict),
2 bad arguments or input.`;

const STATES = ['view-light', 'view-dark', 'edit-light', 'edit-dark'];
const CLIENTS = ['web', 'desktop'];
const CLIENT_LABEL = { web: 'Web', desktop: 'Desktop' };
const PROBE_SCHEMA = 'appflowy.dashboard-parity.visual-probe';
const METRICS_SCHEMA = 'appflowy.dashboard-parity.visual-metrics';
const PROBE_FILE_RE = /^(web|desktop)-(view-light|view-dark|edit-light|edit-dark)\.json$/;
const REPORT_NAME = 'visual-parity-report';
// The fixture folder relative to the repo root: AppFlowy-Web, then AppFlowy-Premium.
const FIXTURE_DIRS = [
  'src/application/database-yjs/__fixtures__/dashboard-parity',
  'frontend/resources/dashboard-parity',
];
const STRING_METRICS = new Set(['text', 'placeholder', 'accessibleName', 'textOverflow', 'cursor', 'gapAxis', 'icon']);
const TEXT_METRICS = new Set(['text', 'placeholder', 'accessibleName']);
const COLOR_METRICS = new Set([
  'background',
  'color',
  'borderColor',
  'ringColor',
  'outlineColor',
  'iconColor',
  'effectiveIconColor',
  'strokeColor',
]);
// Keys inside `metrics` that qualify another metric instead of being measured.
const MODIFIER_METRICS = new Set(['gapAxis']);
const TOKEN_PATH_RE = /^(color|shadow|chart|layout|geometry|typography|motion)(\.[A-Za-z0-9]+)+$/;
const PROBLEM = new Set(['fail', 'missing', 'error']);
const EPSILON = 1e-9;

class InputError extends Error {}

const die = (message) => {
  throw new InputError(message);
};

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv, env) {
  const envWave = env.DASHBOARD_PARITY_WAVE;
  const o = {
    probes: [],
    web: [],
    desktop: [],
    fixtures: null,
    tokens: null,
    metrics: null,
    icons: null,
    out: null,
    notionDir: env.DASHBOARD_PARITY_NOTION_DIR ? resolve(env.DASHBOARD_PARITY_NOTION_DIR) : null,
    embedImages: false,
    failingOnly: false,
    emitPlan: null,
    wave: envWave ? Number(envWave) : null,
    strict: env.DASHBOARD_PARITY_STRICT === '1',
    allowContractMismatch: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => {
      if (eq > 0) return arg.slice(eq + 1);
      i += 1;
      if (i >= argv.length) die(`${flag} needs a value`);
      return argv[i];
    };

    switch (flag) {
      case '--probes':
        o.probes.push(resolve(value()));
        break;
      case '--web':
        o.web.push(resolve(value()));
        break;
      case '--desktop':
        o.desktop.push(resolve(value()));
        break;
      case '--fixtures':
        o.fixtures = resolve(value());
        break;
      case '--tokens':
        o.tokens = resolve(value());
        break;
      case '--metrics':
        o.metrics = resolve(value());
        break;
      case '--icons':
        o.icons = resolve(value());
        break;
      case '--out':
        o.out = resolve(value());
        break;
      case '--notion-dir':
        o.notionDir = resolve(value());
        break;
      case '--embed-images':
        o.embedImages = true;
        break;
      case '--failing-only':
        o.failingOnly = true;
        break;
      case '--emit-plan':
        o.emitPlan = resolve(value());
        break;
      case '--wave':
        o.wave = Number(value());
        break;
      case '--strict':
        o.strict = true;
        break;
      case '--allow-contract-mismatch':
        o.allowContractMismatch = true;
        break;
      case '-h':
      case '--help':
        o.help = true;
        break;
      default:
        die(`unknown argument ${arg} (see --help)`);
    }
  }

  if (o.wave !== null && !Number.isInteger(o.wave)) die('the wave (--wave or DASHBOARD_PARITY_WAVE) must be an integer');
  return o;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readJson(path, what) {
  let text;

  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    die(`cannot read ${what} ${path}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    die(`${what} ${path} is not valid JSON: ${error.message}`);
  }
}

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const modeOf = (state) => state.split('-')[0];
const themeOf = (state) => state.split('-')[1];
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isShadow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && 'blur' in v;
const hasValue = (item) => item.actual !== undefined && item.actual !== null;
const toPosix = (p) => p.split(sep).join('/');

/** A path relative to the working directory when it lies below it, absolute otherwise. */
function displayPath(p) {
  const rel = relative(process.cwd(), p);

  return toPosix(rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p);
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Normalizes a colour to #RRGGBBAA uppercase (alpha = round(a × 255)); null when it is not a colour. */
function normColor(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();

  if (/^transparent$/i.test(s)) return '#00000000';
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);

  if (m) {
    let hex = m[1];

    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    return `#${hex.toUpperCase()}`;
  }

  m = /^rgba?\(\s*([^)]*)\)$/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);

  if (parts.length < 3 || parts.length > 4) return null;
  const channels = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
  const alphaText = parts[3];
  const alpha =
    alphaText === undefined ? 1 : alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);

  if ([...channels, alpha].some((n) => Number.isNaN(n))) return null;
  const hex = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');

  return `#${channels.map(hex).join('')}${hex(alpha * 255)}`.toUpperCase();
}

function normShadow(s) {
  return {
    x: s.x ?? 0,
    y: s.y ?? 0,
    blur: s.blur ?? 0,
    spread: s.spread ?? 0,
    color: normColor(s.color) ?? s.color,
  };
}

function normBox(box) {
  if (!box) return null;
  if (Array.isArray(box) && box.length === 4 && box.every(isNumber)) {
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  }

  const x = box.x ?? box.left;
  const y = box.y ?? box.top;

  if (![x, y, box.width, box.height].every(isNumber)) return null;
  return { x, y, width: box.width, height: box.height };
}

function fmtShadow(s) {
  const n = normShadow(s);

  return `${fmtNum(n.x)} ${fmtNum(n.y)} ${fmtNum(n.blur)} ${fmtNum(n.spread)} ${n.color}`;
}

function fmtValue(v, metric) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return TEXT_METRICS.has(metric) ? JSON.stringify(v) : v;
  if (Array.isArray(v)) {
    if (metric === 'shadow' || (v.length && v.every(isShadow))) return v.length ? v.map(fmtShadow).join(', ') : 'none';
    return `[${v.map((x) => fmtValue(x, metric)).join(', ')}]`;
  }

  if (typeof v === 'object' && metric === 'icon') {
    return v.asset ?? v.symbol ?? (v.sha256 ? `svg-norm ${v.sha256.slice(0, 12)}` : v.name ?? JSON.stringify(v));
  }

  return JSON.stringify(v);
}

/** Unique display values of a list, shortened for a table cell. */
function fmtValues(values, metric) {
  const unique = [...new Set(values.map((v) => fmtValue(v, metric)))];

  if (unique.length <= 3) return unique.join(' / ');
  return `${unique[0]} … ${unique[unique.length - 1]} (${unique.length} values)`;
}

function globToRegExp(glob) {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]*');

  return new RegExp(`^${body}$`);
}

// ── Contract ──────────────────────────────────────────────────────────────────────────────────────

function loadContract(o) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir =
    o.fixtures ??
    FIXTURE_DIRS.map((d) => join(repoRoot, d)).find((d) => existsSync(join(d, 'visual-metrics.json'))) ??
    null;
  const pathOf = (override, name) =>
    override ?? (dir ? join(dir, name) : die(`cannot find ${name}; pass --fixtures <dashboard-parity folder>`));
  const paths = {
    tokens: pathOf(o.tokens, 'tokens.json'),
    metrics: pathOf(o.metrics, 'visual-metrics.json'),
    icons: pathOf(o.icons, 'icons.json'),
  };
  const tokens = readJson(paths.tokens, 'tokens');
  const metrics = readJson(paths.metrics, 'visual metrics');
  const icons = existsSync(paths.icons) ? readJson(paths.icons, 'icons') : null;

  if (metrics.schema !== METRICS_SCHEMA) die(`${paths.metrics}: schema must be "${METRICS_SCHEMA}"`);
  if (!Array.isArray(metrics.elements)) die(`${paths.metrics}: elements must be a list`);
  const manifestPath = dir ? join(dir, 'FIXTURES.sha256') : null;
  const manifestSha = manifestPath && existsSync(manifestPath) ? sha256(readFileSync(manifestPath)) : null;

  return { dir, paths, tokens, metrics, icons, manifestSha };
}

function makeResolver(contract) {
  const { tokens, icons } = contract;
  const iconByName = new Map((icons?.icons ?? []).map((icon) => [icon.name, icon]));

  const tokenAt = (path) => path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), tokens);

  function colorOfToken(node, ctx) {
    if (typeof node === 'string') return normColor(node);
    const r = node?.resolved;

    if (!r) return null;
    if (ctx.client === 'desktop' && ctx.theme === 'dark' && r.desktopDark) return normColor(r.desktopDark);
    return normColor(r[ctx.theme]);
  }

  function resolveToken(path, ctx) {
    const node = tokenAt(path);

    if (node === undefined) return { error: `token ${path} is not in tokens.json`, label: path };
    if (path.startsWith('color.')) {
      const value = colorOfToken(node, ctx);

      return value ? { value, label: path } : { error: `token ${path} has no ${ctx.theme} colour`, label: path };
    }

    if (path.startsWith('shadow.')) {
      const list = node[ctx.theme];

      if (!Array.isArray(list)) return { error: `token ${path} has no ${ctx.theme} list`, label: path };
      return { value: list.map(normShadow), label: path };
    }

    if (node && typeof node === 'object' && !Array.isArray(node) && ('light' in node || 'dark' in node)) {
      return { value: node[ctx.theme], label: path };
    }

    return { value: node, label: path };
  }

  function resolveRef(name, ctx) {
    const label = `ref:${name}`;
    const hits = Object.values(tokens.color ?? {}).filter((t) => t && t.kind === 'ref' && t.ref === name);

    if (!hits.length) return { error: `no tokens.json colour has ref ${name}`, label };
    const values = [...new Set(hits.map((t) => colorOfToken(t, ctx)))];

    if (values.length !== 1 || !values[0]) return { error: `${label} resolves to different values: ${values}`, label };
    return { value: values[0], label };
  }

  // calc grammar (VISUAL-PARITY.md §2.3):
  //   expr := term (('+' | '-') term)*      term := factor (('*' | '/') factor)*
  //   factor := NUMBER | TOKEN_PATH | MEASURED | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
  function evalCalc(expr, ctx, lookup) {
    const re =
      /\s*(?:(\$(?:self|[a-z0-9-]+(?:__[a-z0-9-]+)?)\.[A-Za-z]+)|([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)|([A-Za-z]+)(?=\s*\()|(\d+(?:\.\d+)?|\.\d+)|([-+*/(),]))/y;
    const toks = [];
    let pos = 0;

    while (pos < expr.length) {
      if (/^\s*$/.test(expr.slice(pos))) break;
      re.lastIndex = pos;
      const m = re.exec(expr);

      if (!m) throw new Error(`calc: unexpected input at "${expr.slice(pos)}"`);
      pos = re.lastIndex;
      if (m[1]) toks.push({ t: 'measured', v: m[1] });
      else if (m[2]) toks.push({ t: 'token', v: m[2] });
      else if (m[3]) toks.push({ t: 'func', v: m[3] });
      else if (m[4]) toks.push({ t: 'num', v: Number(m[4]) });
      else toks.push({ t: 'op', v: m[5] });
    }

    let i = 0;
    const peek = () => toks[i];
    const take = (op) => {
      const tok = toks[i];

      if (!tok || tok.t !== 'op' || tok.v !== op) throw new Error(`calc: expected "${op}" in ${expr}`);
      i += 1;
    };

    function parseExpr() {
      let v = parseTerm();

      while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = toks[i].v;

        i += 1;
        const rhs = parseTerm();

        v = op === '+' ? v + rhs : v - rhs;
      }

      return v;
    }

    function parseTerm() {
      let v = parseFactor();

      while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = toks[i].v;

        i += 1;
        const rhs = parseFactor();

        v = op === '*' ? v * rhs : v / rhs;
      }

      return v;
    }

    function parseFactor() {
      const tok = toks[i];

      if (!tok) throw new Error(`calc: unexpected end of ${expr}`);
      i += 1;
      if (tok.t === 'num') return tok.v;
      if (tok.t === 'token') {
        const v = tokenAt(tok.v);

        if (!isNumber(v)) throw new Error(`calc: ${tok.v} is not a number in tokens.json`);
        return v;
      }

      if (tok.t === 'measured') {
        const dot = tok.v.lastIndexOf('.');
        const id = tok.v.slice(1, dot);
        const metric = tok.v.slice(dot + 1);
        const v = lookup ? lookup(id, metric) : undefined;

        if (!isNumber(v)) throw new Error(`needs ${tok.v}`);
        return v;
      }

      if (tok.t === 'func') {
        take('(');
        const args = [parseExpr()];

        while (peek()?.t === 'op' && peek().v === ',') {
          i += 1;
          args.push(parseExpr());
        }

        take(')');
        if (tok.v === 'clamp' && args.length === 3) return Math.min(Math.max(args[1], args[0]), args[2]);
        if (tok.v === 'min' && args.length >= 2) return Math.min(...args);
        if (tok.v === 'max' && args.length >= 2) return Math.max(...args);
        if (tok.v === 'round' && args.length === 1) return Math.sign(args[0]) * Math.round(Math.abs(args[0]));
        throw new Error(`calc: ${tok.v}() with ${args.length} arguments is not allowed`);
      }

      if (tok.t === 'op' && tok.v === '(') {
        const v = parseExpr();

        take(')');
        return v;
      }

      throw new Error(`calc: unexpected "${tok.v}" in ${expr}`);
    }

    const value = parseExpr();

    if (i !== toks.length) throw new Error(`calc: trailing input in ${expr}`);
    return value;
  }

  /** Resolves one contract value for a client and state. Returns { value, label } or { error, label }. */
  function resolveSpec(spec, ctx, metric, lookup) {
    if (spec === null || typeof spec === 'number' || typeof spec === 'boolean')
      return { value: spec, label: String(spec) };
    if (Array.isArray(spec)) return { value: spec, label: JSON.stringify(spec) };
    if (typeof spec === 'object') {
      if ('calc' in spec) {
        try {
          return { value: evalCalc(spec.calc, ctx, lookup), label: `calc(${spec.calc})`, calc: true };
        } catch (error) {
          return { error: error.message, label: `calc(${spec.calc})`, calc: true };
        }
      }

      const keys = Object.keys(spec);

      if (keys.length && keys.every((k) => k === 'view' || k === 'edit')) {
        if (!(ctx.mode in spec)) return { error: `no ${ctx.mode} value`, label: JSON.stringify(spec) };
        return resolveSpec(spec[ctx.mode], ctx, metric, lookup);
      }

      if (keys.length && keys.every((k) => k === 'light' || k === 'dark')) {
        if (!(ctx.theme in spec)) return { error: `no ${ctx.theme} value`, label: JSON.stringify(spec) };
        return resolveSpec(spec[ctx.theme], ctx, metric, lookup);
      }

      return { error: `unknown value object ${JSON.stringify(spec)}`, label: JSON.stringify(spec) };
    }

    if (typeof spec === 'string') {
      if (STRING_METRICS.has(metric))
        return { value: spec, label: TEXT_METRICS.has(metric) ? JSON.stringify(spec) : spec };
      if (/^#[0-9a-fA-F]{8}$/.test(spec)) return { value: spec.toUpperCase(), label: spec };
      if (spec.startsWith('ref:')) return resolveRef(spec.slice(4), ctx);
      if (TOKEN_PATH_RE.test(spec)) return resolveToken(spec, ctx);
      return { value: spec, label: spec };
    }

    return { error: `unsupported value ${JSON.stringify(spec)}`, label: String(spec) };
  }

  // ── Icons: icons.json glyph identity ──

  const normAsset = (p) =>
    String(p)
      .replace(/^\.?\//, '')
      .replace(/^(assets|resources)\//, '');

  /** What a probe's icon value points at: { name, role, sha, label }. */
  function glyphOf(actual, client) {
    if (typeof actual === 'string' && iconByName.has(actual)) {
      return { name: actual, role: 'asserted', sha: iconByName.get(actual).canonical?.sha256 ?? null, label: actual };
    }

    let a = actual;

    if (typeof a === 'string') a = a.startsWith('FlowySvgs.') ? { symbol: a } : { asset: a };
    if (!a || typeof a !== 'object') return { name: null, role: null, sha: null, label: String(actual) };
    const asset = a.asset ? normAsset(a.asset) : null;
    const label = a.asset ?? a.symbol ?? (a.sha256 ? `svg-norm ${a.sha256.slice(0, 12)}` : a.name ?? '?');

    for (const icon of iconByName.values()) {
      for (const role of ['target', 'current']) {
        const entry = icon[client]?.[role];

        if (!entry) continue;
        const sameAsset = asset && entry.asset && normAsset(entry.asset) === asset;
        const sameSymbol = a.symbol && entry.symbol === a.symbol;

        if (sameAsset || sameSymbol) return { name: icon.name, role, sha: a.sha256 ?? entry.sha256 ?? null, label };
      }
    }

    if (a.sha256) {
      const canonical = [...iconByName.values()].find((icon) => icon.canonical?.sha256 === a.sha256);

      if (canonical) return { name: canonical.name, role: 'canonical', sha: a.sha256, label };
    }

    return { name: a.name ?? null, role: null, sha: a.sha256 ?? null, label };
  }

  function compareIcon(expectedName, actual, client) {
    const icon = iconByName.get(expectedName);

    if (!icon) return { pass: false, reason: `icon ${expectedName} is not in icons.json` };
    const glyph = glyphOf(actual, client);

    if (typeof actual === 'string' && actual === expectedName) return { pass: true, glyph };
    const target = icon[client]?.target ?? {};
    const a = typeof actual === 'object' && actual ? actual : {};
    const asset = a.asset ?? (typeof actual === 'string' && !actual.startsWith('FlowySvgs.') ? actual : null);
    const symbol = a.symbol ?? (typeof actual === 'string' && actual.startsWith('FlowySvgs.') ? actual : null);
    const canonicalSha = icon.canonical?.sha256 ?? null;
    const pass =
      (asset && target.asset && normAsset(asset) === normAsset(target.asset)) ||
      (symbol && target.symbol && symbol === target.symbol) ||
      (glyph.sha && canonicalSha && glyph.sha === canonicalSha);

    if (pass) {
      if (!glyph.sha && target.sha256) glyph.sha = target.sha256;
      return { pass: true, glyph };
    }

    const known = glyph.name ? ` (icons.json ${glyph.name}${glyph.role ? `, ${glyph.role}` : ''})` : '';
    const want = target.asset ?? target.symbol ?? expectedName;

    return { pass: false, reason: `renders ${glyph.label}${known}; target ${want}`, glyph };
  }

  return { resolveSpec, compareIcon, glyphOf, tokenAt };
}

// ── Plan: every row the contract asks for ─────────────────────────────────────────────────────────

function buildPlan(metrics) {
  const defaults = metrics.defaults ?? {};
  const defaultScene = (metrics.scenes ?? []).find((s) => s.default)?.id ?? 'two-widgets';
  const defaultWhen = defaults.when ?? 'rest';
  const defaultStates = defaults.states ?? STATES;
  const defaultTolerance = defaults.tolerancePx ?? 0.5;
  const attach = new Map();

  for (const e of [...metrics.elements, ...(metrics.ids ?? [])]) if (e.attach) attach.set(e.id, e.attach);
  const attachFor = (id) => attach.get(id) ?? attach.get(String(id).split('__')[0]) ?? null;

  const checks = [];

  for (const e of metrics.elements) {
    const base = {
      kind: 'metric',
      check: e.id,
      variant: null,
      description: e.description ?? '',
      scene: e.scene ?? defaultScene,
      when: e.when ?? defaultWhen,
      instance: e.instance ?? null,
      relativeTo: e.relativeTo ?? null,
      appliesTo: e.appliesTo ?? null,
      content: e.content ?? null,
      states: e.states ?? defaultStates,
      metrics: e.metrics ?? {},
      tolerance: e.tolerance?.px ?? defaultTolerance,
      desktopMeasure: e.desktopMeasure ?? null,
      wave: e.wave,
      status: e.status ?? 'pending',
      waiver: e.waiver ?? null,
      clientWaivers: e.clientWaivers ?? null,
      attach: e.attach ?? attachFor(e.id),
      source: e.source ?? null,
      note: null,
      notionReferences: e.notionReferences ?? null,
      reference: Boolean(e.reference),
    };

    checks.push(base);
    (e.variants ?? []).forEach((v, index) => {
      checks.push({
        ...base,
        variant: index,
        scene: v.scene ?? base.scene,
        when: v.when ?? base.when,
        instance: v.instance ?? base.instance,
        relativeTo: v.relativeTo ?? base.relativeTo,
        states: v.states ?? base.states,
        metrics: v.metrics ?? {},
        wave: v.wave ?? base.wave,
        status: v.status ?? base.status,
        waiver: v.waiver ?? base.waiver,
        clientWaivers: v.clientWaivers ?? base.clientWaivers,
        note: v.note ?? null,
        notionReferences: v.notionReferences ?? base.notionReferences,
      });
    });
  }

  const orders = (metrics.orderChecks ?? []).map((c) => ({
    kind: 'order',
    check: c.id,
    variant: null,
    description: c.description ?? '',
    container: c.container,
    axis: c.axis ?? 'x',
    scene: c.scene ?? defaultScene,
    when: c.when ?? defaultWhen,
    instance: c.instance ?? null,
    states: c.states ?? defaultStates,
    expected: c.expected,
    wave: c.wave,
    status: c.status ?? 'pending',
    waiver: c.waiver ?? null,
    clientWaivers: c.clientWaivers ?? null,
    attach: attachFor(c.container),
    source: c.source ?? null,
  }));

  // The element entry that measures an id: itself, the entry whose appliesTo matches it, or the same for its owner.
  const elementFor = (id) => {
    for (const candidate of [id, String(id).split('__')[0]]) {
      const exact = metrics.elements.find((e) => e.id === candidate);

      if (exact) return exact;
      const glob = metrics.elements.find((e) => e.appliesTo?.includes('*') && globToRegExp(e.appliesTo).test(candidate));

      if (glob) return glob;
    }

    return null;
  };

  // A text check inherits what it leaves out (scene, when, instance, states) from the element it reads.
  const texts = (metrics.textChecks ?? []).map((c) => {
    const owner = elementFor(c.element);
    const scene = c.scene ?? owner?.scene ?? defaultScene;

    return {
      kind: 'text',
      check: c.id,
      variant: null,
      description: c.description ?? '',
      element: c.element,
      textKind: c.kind ?? 'text',
      scene,
      when: c.when ?? owner?.when ?? defaultWhen,
      instance: c.instance ?? (owner && owner.scene === scene ? owner.instance : null) ?? null,
      states: c.states ?? owner?.states ?? defaultStates,
      expected: c.expected,
      wave: c.wave,
      status: c.status ?? 'pending',
      waiver: c.waiver ?? null,
      clientWaivers: c.clientWaivers ?? null,
      attach: attachFor(c.element),
      source: c.source ?? null,
    };
  });

  return { checks, orders, texts, defaultScene, defaultWhen, scenes: metrics.scenes ?? [], metrics, attachFor };
}

const rowKey = (check, variant, scene, when, instance, metric) =>
  [check, variant ?? '-', scene, when, instance ?? '-', metric].join('|');
const scopeKey = (id, scene, when, instance) => [id, scene, when, instance ?? '-'].join('|');

/** Plan rows for one state: one per (check, variant, metric). */
function planRowsFor(plan, state) {
  const rows = [];

  for (const c of plan.checks) {
    if (!c.states.includes(state)) continue;
    for (const [metric, spec] of Object.entries(c.metrics)) {
      if (MODIFIER_METRICS.has(metric)) continue;
      rows.push({ ...c, state, metric, spec, key: rowKey(c.check, c.variant, c.scene, c.when, c.instance, metric) });
    }
  }

  for (const c of [...plan.orders, ...plan.texts]) {
    if (!c.states.includes(state)) continue;
    rows.push({ ...c, state, metric: c.kind, key: rowKey(c.check, null, c.scene, c.when, c.instance, c.kind) });
  }

  return rows;
}

// ── Probe files ───────────────────────────────────────────────────────────────────────────────────

function newBucket(client, state) {
  return {
    client,
    state,
    files: [],
    headers: [],
    measurements: [],
    orderChecks: [],
    textChecks: [],
    boxes: [],
    missing: [],
    screenshots: [],
  };
}

function loadProbes(o, plan, warnings) {
  const sources = [];

  for (const dir of o.probes) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) die(`--probes ${dir} is not a folder`);
    const names = readdirSync(dir)
      .filter((n) => PROBE_FILE_RE.test(n))
      .sort();

    if (!names.length) warnings.push(`No web-<state>.json or desktop-<state>.json in ${dir}.`);
    for (const name of names) {
      const [, client, state] = PROBE_FILE_RE.exec(name);

      sources.push({ client, state, path: join(dir, name) });
    }
  }

  for (const client of CLIENTS) for (const path of o[client]) sources.push({ client, state: null, path });
  if (!sources.length) die('no probe files: pass --probes <dir> or --web/--desktop <file> (see --help)');

  const probes = { web: new Map(), desktop: new Map() };
  const scope = (x) => ({
    scene: x.scene ?? plan.defaultScene,
    when: x.when ?? plan.defaultWhen,
    instance: x.instance ?? null,
  });

  for (const src of sources) {
    const doc = readJson(src.path, `${src.client} probe`);

    if (doc.schema !== PROBE_SCHEMA) die(`${src.path}: schema must be "${PROBE_SCHEMA}"`);
    if (doc.version !== 1) die(`${src.path}: unsupported probe version ${doc.version}`);
    if (doc.client && doc.client !== src.client) {
      die(`${src.path}: the file says client "${doc.client}" but was given as ${src.client}`);
    }

    if (src.state && doc.state && doc.state !== src.state) {
      die(`${src.path}: the file name says ${src.state} but the file says ${doc.state}`);
    }

    const fileState = doc.state ?? src.state ?? null;

    if (fileState && !STATES.includes(fileState)) die(`${src.path}: unknown state ${fileState}`);
    const base = dirname(src.path);
    const header = {
      file: src.path,
      commit: doc.commit ?? null,
      fixturesSha256: doc.fixturesSha256 ?? null,
      generatedAt: doc.generatedAt ?? null,
      environment: doc.environment ?? null,
    };
    const bucketFor = (state) => {
      const s = state ?? fileState;

      if (!STATES.includes(s)) die(`${src.path}: an entry has no valid state (set "state" on the file or the entry)`);
      if (!probes[src.client].has(s)) probes[src.client].set(s, newBucket(src.client, s));
      const bucket = probes[src.client].get(s);

      if (!bucket.files.includes(src.path)) {
        bucket.files.push(src.path);
        bucket.headers.push(header);
      }

      return bucket;
    };

    if (fileState) bucketFor(fileState);

    for (const m of doc.measurements ?? []) {
      if (!m || !m.check || !m.metric) die(`${src.path}: every measurement needs "check" and "metric"`);
      const variant = m.variant === null || m.variant === undefined ? null : Number(m.variant);

      bucketFor(m.state).measurements.push({
        ...scope(m),
        check: m.check,
        variant: Number.isInteger(variant) ? variant : null,
        metric: m.metric,
        target: m.target ?? m.check,
        index: m.index ?? 0,
        instanceLabel: m.instanceLabel ?? null,
        actual: m.actual,
        measure: m.measure ?? 'render',
        box: normBox(m.box),
        refs: m.refs ?? null,
        expected: m.expected,
        error: m.error ?? null,
      });
    }

    for (const kind of ['orderChecks', 'textChecks']) {
      for (const x of doc[kind] ?? []) {
        if (!x || !x.check) die(`${src.path}: every ${kind} entry needs "check"`);
        bucketFor(x.state)[kind].push({
          ...scope(x),
          check: x.check,
          actual: x.actual,
          box: normBox(x.box),
          boxes: (x.boxes ?? []).map((b) => ({ id: b.id, box: normBox(b) })).filter((b) => b.box),
          error: x.error ?? null,
        });
      }
    }

    for (const x of doc.boxes ?? []) {
      const box = normBox(x);

      if (x && x.id && box) bucketFor(x.state).boxes.push({ ...scope(x), id: x.id, index: x.index ?? 0, box });
    }

    for (const x of doc.missing ?? []) {
      if (x && x.id) bucketFor(x.state).missing.push({ ...scope(x), id: x.id });
    }

    for (const x of doc.screenshots ?? []) {
      if (!x || !x.path) die(`${src.path}: every screenshot needs "path"`);
      bucketFor(x.state).screenshots.push({
        ...scope(x),
        path: isAbsolute(x.path) ? x.path : resolve(base, x.path),
        width: x.width ?? null,
        height: x.height ?? null,
        devicePixelRatio: x.devicePixelRatio ?? 1,
        origin: { x: x.origin?.x ?? 0, y: x.origin?.y ?? 0 },
      });
    }
  }

  for (const buckets of Object.values(probes)) for (const bucket of buckets.values()) indexBucket(bucket);
  return probes;
}

function indexBucket(bucket) {
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  bucket.byKey = new Map();
  bucket.byTarget = new Map();
  bucket.boxIndex = new Map();
  for (const m of bucket.measurements) {
    push(bucket.byKey, rowKey(m.check, m.variant, m.scene, m.when, m.instance, m.metric), m);
    push(bucket.byTarget, [m.target, m.metric, m.scene, m.when, m.instance ?? '-'].join('|'), m);
  }

  for (const b of bucket.boxes) {
    const key = scopeKey(b.id, b.scene, b.when, b.instance);

    if (!bucket.boxIndex.has(key)) bucket.boxIndex.set(key, b.box);
  }

  for (const m of bucket.measurements) {
    if (!m.box) continue;
    const key = scopeKey(m.target, m.scene, m.when, m.instance);

    if (!bucket.boxIndex.has(key)) bucket.boxIndex.set(key, m.box);
  }

  bucket.missingSet = new Set(bucket.missing.map((x) => scopeKey(x.id, x.scene, x.when, x.instance)));
  bucket.isMissing = (id, scene, when, instance) =>
    bucket.missingSet.has(scopeKey(id, scene, when, instance)) || bucket.missingSet.has(scopeKey(id, scene, when, null));
  bucket.boxOf = (id, scene, when, instance) =>
    bucket.boxIndex.get(scopeKey(id, scene, when, instance)) ??
    bucket.boxIndex.get(scopeKey(id, scene, when, null)) ??
    null;
  bucket.orderIndex = new Map(bucket.orderChecks.map((x) => [scopeKey(x.check, x.scene, x.when, x.instance), x]));
  bucket.textIndex = new Map(bucket.textChecks.map((x) => [scopeKey(x.check, x.scene, x.when, x.instance), x]));
}

/** Measured inputs of a calc ($id.metric) for one measurement, same instance scope. */
function makeLookup(bucket, m) {
  return (id, metric) => {
    const target = id === 'self' ? m.target : id;
    const refs = m.refs ?? {};

    for (const k of [`${target}.${metric}`, `$${target}.${metric}`, `${id}.${metric}`, `$${id}.${metric}`]) {
      if (isNumber(refs[k])) return refs[k];
    }

    const candidates =
      bucket.byTarget.get([target, metric, m.scene, m.when, m.instance ?? '-'].join('|')) ??
      bucket.byTarget.get([target, metric, m.scene, m.when, '-'].join('|')) ??
      [];
    const sameIndex = candidates.find((c) => c.index === m.index && isNumber(c.actual));
    const any = candidates.find((c) => isNumber(c.actual));

    if (id === 'self' && sameIndex) return sameIndex.actual;
    if (any) return (sameIndex ?? any).actual;
    if (metric === 'width' || metric === 'height') {
      const box = bucket.boxOf(target, m.scene, m.when, m.instance) ?? (id === 'self' ? m.box : null);

      if (box) return box[metric];
    }

    return undefined;
  };
}

// ── Comparison ────────────────────────────────────────────────────────────────────────────────────

function compareValue(metric, expected, actual, tol) {
  if (actual === undefined || actual === null) return { pass: false, reason: 'no value' };
  if (metric === 'shadow' || (Array.isArray(expected) && expected.length && expected.every(isShadow))) {
    if (!Array.isArray(actual)) return { pass: false, reason: 'shadow must be a list' };
    if (actual.length !== expected.length)
      return { pass: false, reason: `${actual.length} shadows, want ${expected.length}` };
    for (let i = 0; i < expected.length; i += 1) {
      const a = normShadow(actual[i] ?? {});
      const e = normShadow(expected[i]);
      const nums = ['x', 'y', 'blur', 'spread'].every((k) => isNumber(a[k]) && Math.abs(a[k] - e[k]) <= tol + EPSILON);

      if (!nums || a.color !== e.color) return { pass: false, reason: `shadow ${i + 1} differs` };
    }

    return { pass: true };
  }

  if (isNumber(expected)) {
    const values = Array.isArray(actual) ? actual : [actual];

    if (!values.length || !values.every(isNumber)) return { pass: false, reason: 'not a number' };
    let pass;

    if (metric === 'widthMin') pass = values.every((v) => v >= expected - tol - EPSILON);
    else if (metric === 'widthMax') pass = values.every((v) => v <= expected + tol + EPSILON);
    else pass = values.every((v) => Math.abs(v - expected) <= tol + EPSILON);
    return pass
      ? { pass }
      : { pass, reason: `off by ${fmtNum(Math.max(...values.map((v) => Math.abs(v - expected))))}` };
  }

  if (typeof expected === 'boolean') return { pass: actual === expected };
  if (typeof expected === 'string') {
    const expectedColor = COLOR_METRICS.has(metric) || /^#[0-9A-F]{8}$/.test(expected) ? normColor(expected) : null;

    if (expectedColor) {
      const a = normColor(actual);

      if (!a) return { pass: false, reason: 'not a colour' };
      return { pass: a === expectedColor };
    }

    if (TEXT_METRICS.has(metric)) return { pass: collapse(actual) === collapse(expected) };
    return { pass: String(actual) === expected };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      return { pass: false, reason: 'list length differs' };
    const pass = expected.every((e, i) =>
      isNumber(e) ? isNumber(actual[i]) && Math.abs(actual[i] - e) <= tol + EPSILON : actual[i] === e
    );

    return { pass };
  }

  return { pass: JSON.stringify(actual) === JSON.stringify(expected) };
}

/** Normalized form of a measured value for cross-client comparison and display. */
function canon(metric, v) {
  if (typeof v === 'string' && TEXT_METRICS.has(metric)) return collapse(v);
  if (typeof v === 'string' && (COLOR_METRICS.has(metric) || v.startsWith('#') || v.startsWith('rgb'))) {
    return normColor(v) ?? v;
  }

  if (Array.isArray(v) && v.every(isShadow)) return v.map(normShadow);
  return v;
}

function sameValue(metric, a, b, tol) {
  if (metric === 'icon') {
    if (a.glyph?.sha && b.glyph?.sha) return a.glyph.sha === b.glyph.sha;
    if (a.glyph?.name && b.glyph?.name) return a.glyph.name === b.glyph.name;
    return JSON.stringify(a.actual) === JSON.stringify(b.actual);
  }

  // A probe may report every gap or pitch, or one number when they agree.
  const single = (v) =>
    Array.isArray(v) && v.length && v.every(isNumber) && v.every((n) => Math.abs(n - v[0]) <= tol + EPSILON) ? v[0] : v;
  const x = single(canon(metric, a.actual));
  const y = single(canon(metric, b.actual));

  if (isNumber(x) && isNumber(y)) {
    // The contract value depends on what each client measured (a `calc` over its own boxes, such as half of
    // the row width in differently wide windows): compare how far each client is from its own value.
    if (isNumber(a.expected) && isNumber(b.expected) && Math.abs(a.expected - b.expected) > EPSILON) {
      return Math.abs(x - a.expected - (y - b.expected)) <= tol + EPSILON;
    }

    return Math.abs(x - y) <= tol + EPSILON;
  }
  if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
    return x.every((xi, i) => {
      const yi = y[i];

      if (isNumber(xi) && isNumber(yi)) return Math.abs(xi - yi) <= tol + EPSILON;
      if (isShadow(xi) && isShadow(yi)) {
        return (
          ['x', 'y', 'blur', 'spread'].every((k) => Math.abs(xi[k] - yi[k]) <= tol + EPSILON) && xi.color === yi.color
        );
      }

      return JSON.stringify(xi) === JSON.stringify(yi);
    });
  }

  return JSON.stringify(x) === JSON.stringify(y);
}

function aggregate(items) {
  if (items.every((i) => i.result === 'pass')) return 'pass';
  if (items.some((i) => i.result === 'fail')) return 'fail';
  if (items.some((i) => i.result === 'error')) return 'error';
  return 'missing';
}

function evalMetricClient(row, client, ctx) {
  const bucket = ctx.probes[client].get(row.state);
  const rctx = { client, state: row.state, mode: modeOf(row.state), theme: themeOf(row.state) };
  const bare = ctx.resolver.resolveSpec(row.spec, rctx, row.metric, null);
  const out = { result: 'not-run', items: [], expected: bare, reason: '' };

  if (!bucket) return { ...out, reason: `no ${client}-${row.state}.json` };
  let ms = bucket.byKey.get(row.key) ?? [];

  if (!ms.length) {
    const ids = [row.check, row.appliesTo].filter(Boolean);
    const missing = ids.some((id) => bucket.isMissing(id, row.scene, row.when, row.instance));

    if (missing && row.metric === 'count') {
      ms = [{ target: row.check, index: 0, actual: 0, measure: 'missing-id', box: null, refs: null, scene: row.scene }];
    } else if (missing) {
      return { ...out, result: 'missing', reason: 'id not found' };
    } else {
      return { ...out, reason: 'not measured' };
    }
  }

  const items = ms.map((m) => {
    const item = {
      target: m.target,
      index: m.index,
      instanceLabel: m.instanceLabel ?? null,
      actual: m.actual,
      measure: m.measure,
      box: m.box ?? bucket.boxOf(m.target, row.scene, row.when, row.instance),
    };

    if (!hasValue(m)) {
      const missing = !m.error || m.error === 'missing-id';

      return { ...item, result: missing ? 'missing' : 'error', reason: m.error ?? 'no value' };
    }

    const exp = ctx.resolver.resolveSpec(row.spec, rctx, row.metric, makeLookup(bucket, m));

    if (exp.error) return { ...item, result: 'error', reason: exp.error };
    const cmp =
      row.metric === 'icon'
        ? ctx.resolver.compareIcon(exp.value, m.actual, client)
        : compareValue(row.metric, exp.value, m.actual, row.tolerance);
    let drift;

    if (m.expected !== undefined && m.expected !== null) {
      const same =
        row.metric === 'icon'
          ? m.expected === exp.value
          : compareValue(row.metric, exp.value, m.expected, row.tolerance).pass;

      if (!same) drift = m.expected;
    }

    return {
      ...item,
      expected: exp.value,
      result: cmp.pass ? 'pass' : 'fail',
      reason: cmp.reason ?? '',
      glyph: cmp.glyph,
      drift,
    };
  });

  const result = aggregate(items);
  const reason = items.find((i) => i.result !== 'pass')?.reason ?? '';

  return { result, items, expected: bare, reason };
}

function evalListClient(row, client, ctx) {
  const bucket = ctx.probes[client].get(row.state);
  const expected =
    row.kind === 'order' ? orderExpected(row) : { value: row.expected, label: JSON.stringify(row.expected) };
  const out = { result: 'not-run', items: [], expected, reason: '' };

  if (!bucket) return { ...out, reason: `no ${client}-${row.state}.json` };
  const index = row.kind === 'order' ? bucket.orderIndex : bucket.textIndex;
  const entry = index.get(scopeKey(row.check, row.scene, row.when, row.instance));
  const id = row.kind === 'order' ? row.container : row.element;

  if (!entry) {
    if (bucket.isMissing(id, row.scene, row.when, row.instance))
      return { ...out, result: 'missing', reason: `${id} not found` };
    return { ...out, reason: 'not measured' };
  }

  const box = entry.box ?? bucket.boxOf(id, row.scene, row.when, row.instance);
  const item = { target: id, index: 0, actual: entry.actual, box, boxes: entry.boxes ?? [], measure: 'render' };

  if (!hasValue(entry)) {
    const missing = !entry.error || entry.error === 'missing-id';

    return {
      ...out,
      result: missing ? 'missing' : 'error',
      items: [{ ...item, result: 'missing' }],
      reason: entry.error ?? '',
    };
  }

  if (expected.error) return { ...out, result: 'error', items: [{ ...item, result: 'error' }], reason: expected.error };
  let pass;

  if (row.kind === 'order') {
    pass = Array.isArray(entry.actual) && JSON.stringify(entry.actual) === JSON.stringify(expected.value);
  } else {
    pass = typeof entry.actual === 'string' && collapse(entry.actual) === collapse(expected.value);
  }

  const result = pass ? 'pass' : 'fail';

  return { result, items: [{ ...item, expected: expected.value, result }], expected, reason: pass ? '' : 'differs' };
}

function orderExpected(row) {
  const e = row.expected;

  if (Array.isArray(e)) return { value: e, label: 'list' };
  const mode = modeOf(row.state);

  if (e && Array.isArray(e[mode])) return { value: e[mode], label: mode };
  return { error: `no ${mode} order`, label: JSON.stringify(e) };
}

function evalCross(row, w, d) {
  if (row.status === 'waived') return { result: 'waived', reason: row.waiver ?? '' };
  const wi = w.items.filter(hasValue);
  const di = d.items.filter(hasValue);

  if (!wi.length && !di.length) {
    if (w.result === 'not-run' && d.result === 'not-run') return { result: 'not-run', reason: '' };
    return { result: 'n/a', reason: `web ${w.result}, desktop ${d.result}` };
  }

  // One side not measured at all: nothing to compare yet. One side missing the id: a real divergence.
  if (!wi.length)
    return w.result === 'not-run'
      ? { result: 'not-run', reason: 'web not measured' }
      : { result: 'fail', reason: `web ${w.result}` };
  if (!di.length) {
    return d.result === 'not-run'
      ? { result: 'not-run', reason: 'desktop not measured' }
      : { result: 'fail', reason: `desktop ${d.result}` };
  }

  if (row.kind !== 'metric') {
    const same =
      row.kind === 'order'
        ? JSON.stringify(wi[0].actual) === JSON.stringify(di[0].actual)
        : collapse(wi[0].actual) === collapse(di[0].actual);

    return same ? { result: 'pass', reason: '' } : { result: 'fail', reason: 'web and desktop differ' };
  }

  const byTarget = (items) => {
    const map = new Map();

    for (const item of items) {
      if (!map.has(item.target)) map.set(item.target, []);
      map.get(item.target).push(item);
    }

    return map;
  };
  const wt = byTarget(wi);
  const dt = byTarget(di);
  const reasons = [];

  for (const t of wt.keys()) if (!dt.has(t)) reasons.push(`${t} only on web`);
  for (const t of dt.keys()) if (!wt.has(t)) reasons.push(`${t} only on desktop`);
  for (const [t, wl] of wt) {
    const dl = dt.get(t);

    if (!dl) continue;
    const uniform = (list) => list.every((x) => sameValue(row.metric, x, list[0], row.tolerance));

    if (uniform(wl) && uniform(dl)) {
      if (!sameValue(row.metric, wl[0], dl[0], row.tolerance))
        reasons.push(t === row.check ? 'values differ' : `${t} differs`);
      continue;
    }

    // Instances disagree among themselves on at least one client: compare the sorted value lists.
    const sorted = (list) =>
      list
        .map((x) => canon(row.metric, x.actual))
        .sort((a, b) => (isNumber(a) && isNumber(b) ? a - b : JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const ws = sorted(wl);
    const ds = sorted(dl);
    const same =
      ws.length === ds.length &&
      ws.every((x, i) => sameValue(row.metric, { actual: x }, { actual: ds[i] }, row.tolerance));

    if (!same) reasons.push(`${t} instances differ`);
  }

  return reasons.length ? { result: 'fail', reason: reasons.join('; ') } : { result: 'pass', reason: '' };
}

function evaluate(plan, probes, resolver, opts) {
  const probedStates = STATES.filter((s) => probes.web.has(s) || probes.desktop.has(s));
  const ctx = { probes, resolver };
  const rows = [];

  for (const state of probedStates) {
    for (const row of planRowsFor(plan, state)) {
      const inScope = opts.wave === null || (isNumber(row.wave) && row.wave <= opts.wave);
      let web;
      let desktop;
      let cross;

      if (row.status === 'waived') {
        const waived = { result: 'waived', items: [], expected: { label: '' }, reason: row.waiver ?? '' };

        web = waived;
        desktop = waived;
        cross = { result: 'waived', reason: row.waiver ?? '' };
      } else {
        const evalClient = row.kind === 'metric' ? evalMetricClient : evalListClient;
        // `clientWaivers`: one client cannot measure the entry (its verdict and the comparison are waived with
        // that reason, the other client is still checked), or only the comparison is waived (`cross`).
        const waivers = row.clientWaivers ?? {};
        const waivedSide = (reason) => ({ result: 'waived', items: [], expected: { label: '' }, reason });

        web = waivers.web ? waivedSide(waivers.web) : evalClient(row, 'web', ctx);
        desktop = waivers.desktop ? waivedSide(waivers.desktop) : evalClient(row, 'desktop', ctx);
        const crossWaiver = waivers.cross ?? waivers.web ?? waivers.desktop;

        cross = crossWaiver ? { result: 'waived', reason: crossWaiver } : evalCross(row, web, desktop);
      }

      const results = [web.result, desktop.result, cross.result];
      const allPass =
        row.status === 'waived' ||
        (results.every((r) => r === 'pass' || r === 'waived') && results.some((r) => r === 'pass'));
      const gated = row.status === 'enforced' || (opts.strict && inScope && row.status === 'pending');
      const blocking = gated && !allPass;
      // The probe wrote its own expected value and it differs from this script's resolution: a resolver bug.
      const drift = CLIENTS.filter((c, i) => [web, desktop][i].items.some((item) => item.drift !== undefined));

      rows.push({ ...row, inScope, web, desktop, cross, allPass, blocking, drift });
    }
  }

  return { rows, probedStates };
}

// ── Checks that the inputs belong together ────────────────────────────────────────────────────────

function checkInputs(contract, plan, probes, opts, warnings) {
  const env = contract.metrics.environment ?? {};
  const mismatches = [];

  for (const client of CLIENTS) {
    for (const bucket of probes[client].values()) {
      for (const h of bucket.headers) {
        if (!h.fixturesSha256) {
          warnings.push(`${toPosix(h.file)} does not record fixturesSha256; it may use another contract.`);
        } else if (contract.manifestSha && h.fixturesSha256 !== contract.manifestSha) {
          mismatches.push(`${toPosix(h.file)} was made against FIXTURES.sha256 ${h.fixturesSha256.slice(0, 12)}…`);
        }

        const pe = h.environment ?? {};

        if (env.viewport && pe.viewport) {
          if (pe.viewport.width !== env.viewport.width || pe.viewport.height !== env.viewport.height) {
            warnings.push(
              `${toPosix(h.file)}: viewport ${pe.viewport.width}×${pe.viewport.height}, contract ${env.viewport.width}×${
                env.viewport.height
              }.`
            );
          }
        }

        if (isNumber(pe.textScale) && isNumber(env.textScale) && pe.textScale !== env.textScale) {
          warnings.push(`${toPosix(h.file)}: text scale ${pe.textScale}, contract ${env.textScale}.`);
        }
      }
    }
  }

  if (mismatches.length) {
    const msg = `contract mismatch with ${contract.manifestSha?.slice(0, 12)}…: ${mismatches.join('; ')}`;

    if (!opts.allowContractMismatch) die(`${msg}. Re-run the probes, or pass --allow-contract-mismatch.`);
    warnings.push(`${msg} (compared anyway).`);
  }

  // Rows the probes wrote that the contract does not ask for (usually a probe out of date).
  const known = new Set();

  for (const state of STATES) for (const row of planRowsFor(plan, state)) known.add(`${state}|${row.key}`);
  const elements = new Map(plan.checks.filter((c) => c.variant === null).map((c) => [c.check, c]));

  for (const client of CLIENTS) {
    const unknown = [];
    const strayTargets = new Set();

    for (const bucket of probes[client].values()) {
      for (const m of bucket.measurements) {
        const key = rowKey(m.check, m.variant, m.scene, m.when, m.instance, m.metric);

        if (!known.has(`${bucket.state}|${key}`)) unknown.push(`${bucket.state} ${key}`);
        const element = elements.get(m.check);

        if (element && m.target !== m.check) {
          const ok = element.appliesTo && globToRegExp(element.appliesTo).test(m.target);

          if (!ok) strayTargets.add(`${m.check} → ${m.target}`);
        }
      }
    }

    if (unknown.length) {
      warnings.push(
        `${CLIENT_LABEL[client]} probe wrote ${
          unknown.length
        } measurement(s) the contract does not ask for, e.g. ${unknown.slice(0, 3).join(', ')}.`
      );
    }

    if (strayTargets.size) {
      warnings.push(`${CLIENT_LABEL[client]} targets outside appliesTo: ${[...strayTargets].slice(0, 5).join(', ')}.`);
    }
  }
}

// ── Summaries ─────────────────────────────────────────────────────────────────────────────────────

function tally(rows) {
  const t = { rows: rows.length, web: {}, desktop: {}, cross: {} };

  for (const r of rows) {
    for (const k of ['web', 'desktop', 'cross']) t[k][r[k].result] = (t[k][r[k].result] ?? 0) + 1;
  }

  return t;
}

function readyToEnforce(plan, evaluation, probes, opts) {
  const byCheck = new Map();

  for (const r of evaluation.rows) {
    if (!byCheck.has(r.check)) byCheck.set(r.check, []);
    byCheck.get(r.check).push(r);
  }

  const ready = [];
  const allChecks = [...new Map(plan.checks.map((c) => [c.check, c])).values(), ...plan.orders, ...plan.texts];

  for (const c of allChecks) {
    // Only the rows the gate covers: a variant may belong to a later wave than its element.
    const rows = (byCheck.get(c.check) ?? []).filter((r) => opts.wave === null || r.wave <= opts.wave);

    if (!rows.length || rows.some((r) => r.status !== 'pending')) continue;
    const scoped = [...plan.checks, ...plan.orders, ...plan.texts].filter(
      (x) => x.check === c.check && (opts.wave === null || x.wave <= opts.wave)
    );
    const states = new Set(scoped.flatMap((x) => x.states));
    const covered = [...states].every((s) => probes.web.has(s) && probes.desktop.has(s));

    if (covered && rows.every((r) => r.allPass)) ready.push(c.check);
  }

  return ready;
}

/** Ids whose absence failed a row (an absence the contract expects, count 0, is not listed). */
function missingIds(rows) {
  const out = { web: new Map(), desktop: new Map() };

  for (const r of rows) {
    const id = r.kind === 'metric' ? r.check : r.kind === 'order' ? r.container : r.element;

    for (const client of CLIENTS) {
      if (r[client].result !== 'missing') continue;
      if (!out[client].has(id)) out[client].set(id, new Set());
      out[client].get(id).add(r.scene);
    }
  }

  return out;
}

// ── Markdown ──────────────────────────────────────────────────────────────────────────────────────

const VERDICT_MD = {
  pass: 'pass',
  fail: '**FAIL**',
  missing: '**missing**',
  error: '**error**',
  'not-run': '—',
  waived: 'waived',
  'n/a': 'n/a',
};

const mdCell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
const mdCode = (s) => (s ? `\`${String(s).replace(/`/g, "'")}\`` : '');

function scopeText(r, base) {
  const parts = [];

  if (r.variant !== null) parts.push(`v${r.variant + 1}`);
  if (!base || r.scene !== base.scene || r.variant !== null) parts.push(r.scene);
  parts.push(r.when);
  if (r.instance) parts.push(r.instance);
  return parts.join(' · ');
}

function expectedText(r) {
  const show = (side) => {
    const values = side.items.filter((i) => i.expected !== undefined).map((i) => i.expected);

    if (values.length) return fmtValues(values, r.metric);
    if (side.expected?.error) return `(${side.expected.error})`;
    return fmtValue(side.expected?.value, r.metric);
  };

  if (r.status === 'waived') return `waived: ${r.waiver ?? 'no reason given'}`;
  // A side that was not measured adds nothing but noise once the other side has resolved values.
  const measured = CLIENTS.filter((c) => r[c].result !== 'not-run');
  const sides = measured.length ? measured : CLIENTS;
  const texts = sides.map((c) => [c, show(r[c])]);

  if (texts.length === 1 || texts[0][1] === texts[1][1]) return texts[0][1];
  return texts.map(([c, x]) => `${c} ${x}`).join(' · ');
}

function actualText(r, side) {
  const s = r[side];
  const values = s.items.filter(hasValue);

  if (!values.length)
    return s.result === 'missing' ? 'missing id' : s.result === 'fail' || s.result === 'error' ? s.reason : '';
  if (r.metric === 'icon') {
    const label = (i) => {
      const g = i.glyph;

      if (!g) return fmtValue(i.actual, 'icon');
      return g.name && g.name !== g.label
        ? `${g.label} = ${g.name}${g.role && g.role !== 'asserted' ? ` (${g.role})` : ''}`
        : g.label;
    };

    return [...new Set(values.map(label))].join(' / ');
  }

  let text = fmtValues(
    values.map((i) => canon(r.metric, i.actual)),
    r.metric
  );

  if (values.length > 1) text += ` (${values.length}×)`;
  if (side === 'desktop' && (r.desktopMeasure === 'style' || values.some((i) => i.measure === 'style')))
    text += ' [style]';
  const drift = values.find((i) => i.drift !== undefined);

  if (drift) text += ` [probe expected ${fmtValue(drift.drift, r.metric)}]`;
  return text;
}

function verdictText(side) {
  const v = VERDICT_MD[side.result] ?? side.result;

  if (side.result === 'fail' || side.result === 'error') return side.reason ? `${v} (${side.reason})` : v;
  return v;
}

function writeMarkdown(model) {
  const { contract, plan, evaluation, probes, opts, warnings, ready } = model;
  const rows = evaluation.rows;
  const lines = [];
  const add = (...l) => lines.push(...l);
  const headerOf = (client) =>
    STATES.filter((s) => probes[client].has(s))
      .map((s) => {
        const h = probes[client].get(s).headers[0];

        return `${s}${h?.commit ? ` (${h.commit})` : ''}`;
      })
      .join(', ') || 'none';

  add('# Dashboard visual parity report', '');
  add(
    `Generated ${new Date().toISOString()} by \`scripts/dashboard-parity/compare-visual-parity.mjs\`. Every expected value is resolved from \`tokens.json\` and \`visual-metrics.json\` by this script; probe-side expectations are only cross-checked.`,
    ''
  );
  add('| Input | Value |', '| --- | --- |');
  add(
    `| Contract | ${mdCell(
      contract.dir ? displayPath(contract.dir) : Object.values(contract.paths).map(displayPath).join(', ')
    )} |`
  );
  add(`| FIXTURES.sha256 | ${contract.manifestSha ? mdCode(contract.manifestSha.slice(0, 16)) : 'not found'} |`);
  add(`| Web probes | ${mdCell(headerOf('web'))} |`);
  add(`| Desktop probes | ${mdCell(headerOf('desktop'))} |`);
  add(
    `| Gate | ${opts.wave === null ? 'all waves' : `wave ≤ ${opts.wave}`}, ${
      opts.strict ? 'strict (in-scope pending rows block)' : 'only enforced rows block'
    } |`
  );
  add(`| States compared | ${evaluation.probedStates.join(', ') || 'none'} |`, '');

  if (warnings.length) {
    add('## Warnings', '');
    for (const w of warnings) add(`- ${w}`);
    add('');
  }

  add('## Summary', '');
  add(
    'A row is one metric of one element (or one order or text check) in one state. "Web" and "Desktop" compare each client with the contract; "Web ↔ Desktop" compares the two measurements with each other.',
    ''
  );
  add(
    '| Scope | Rows | Web pass | Desktop pass | Web ↔ Desktop pass | Missing ids (W / D) | Not measured (W / D) | Blocking |'
  );
  add('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const summaryLine = (label, list) => {
    const t = tally(list);
    const n = (side, k) => t[side][k] ?? 0;

    add(
      `| ${label} | ${t.rows} | ${n('web', 'pass')} | ${n('desktop', 'pass')} | ${n('cross', 'pass')} | ${n(
        'web',
        'missing'
      )} / ${n('desktop', 'missing')} | ${n('web', 'not-run')} / ${n('desktop', 'not-run')} | ${
        list.filter((r) => r.blocking).length
      } |`
    );
  };

  for (const s of evaluation.probedStates)
    summaryLine(
      s,
      rows.filter((r) => r.state === s)
    );
  for (const w of [...new Set(rows.map((r) => r.wave))].sort())
    summaryLine(
      `wave ${w}`,
      rows.filter((r) => r.wave === w)
    );
  summaryLine('**all**', rows);
  add('');

  const blocking = rows.filter((r) => r.blocking);

  add('## Blocking failures', '');
  if (!blocking.length) {
    add(
      opts.strict || rows.some((r) => r.status === 'enforced')
        ? 'None.'
        : 'None. No entry is `enforced` yet and `--strict` is off, so failures are reported but do not block.',
      ''
    );
  } else {
    add('| Check | State | Scope | Metric | Expected | Web | Desktop | Verdicts (W / D / W↔D) |');
    add('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of blocking) {
      add(
        `| ${mdCode(r.check)} | ${r.state} | ${mdCell(scopeText(r))} | ${r.metric} | ${mdCell(
          expectedText(r)
        )} | ${mdCell(actualText(r, 'web'))} | ${mdCell(actualText(r, 'desktop'))} | ${r.web.result} / ${
          r.desktop.result
        } / ${r.cross.result} |`
      );
    }

    add('');
  }

  add('## Ready to enforce', '');
  add(
    ready.length
      ? `Pending checks${
          opts.wave === null ? '' : ` of wave ≤ ${opts.wave}`
        } whose every row passes on both clients and across clients in every state they list: ${ready
          .map(mdCode)
          .join(', ')}.`
      : 'No pending check passes everywhere yet (a check needs both clients probed in every state it lists).',
    ''
  );

  const missing = missingIds(rows);

  if (missing.web.size || missing.desktop.size) {
    add('## Missing parity ids', '');
    add('Ids a probe looked for and did not find. Attach them where the contract says (VISUAL-PARITY.md §5.4).', '');
    add('| Id | Missing on | Scenes | Attach (web) | Attach (desktop) |', '| --- | --- | --- | --- | --- |');
    const ids = [...new Set([...missing.web.keys(), ...missing.desktop.keys()])].sort();

    for (const id of ids) {
      const on = CLIENTS.filter((c) => missing[c].has(id));
      const scenes = new Set(on.flatMap((c) => [...missing[c].get(id)]));
      const a = plan.attachFor(id) ?? {};

      add(
        `| ${mdCode(id)} | ${on.join(', ')} | ${[...scenes].join(', ')} | ${mdCell(a.web ?? '')} | ${mdCell(
          a.desktop ?? ''
        )} |`
      );
    }

    add('');
  }

  add('## Elements', '');
  add(
    "Columns: the contract value as written, the value it resolves to (per client when they differ, as for OD-2), each client's measurement, and the three verdicts. `[style]` marks a desktop value read from the chart style rather than measured (desktopMeasure). `—` means not measured.",
    ''
  );
  const metricRows = rows.filter((r) => r.kind === 'metric');
  const byCheck = new Map();

  for (const r of metricRows) {
    if (!byCheck.has(r.check)) byCheck.set(r.check, []);
    byCheck.get(r.check).push(r);
  }

  for (const element of plan.metrics.elements) {
    const list = byCheck.get(element.id);

    if (!list?.length) continue;
    const base = plan.checks.find((c) => c.check === element.id && c.variant === null);
    const shown = opts.failingOnly ? list.filter((r) => !r.allPass || r.drift.length) : list;
    const passCount = list.filter((r) => r.allPass).length;

    add(`### ${mdCode(element.id)}`, '');
    add(
      `${mdCell(element.description ?? '')} Wave ${element.wave}, ${element.status ?? 'pending'}. Scene \`${
        base.scene
      }\`${base.relativeTo ? `, relative to \`${base.relativeTo}\`` : ''}${
        base.appliesTo ? `, applies to \`${base.appliesTo}\`` : ''
      }. ${passCount} of ${list.length} rows pass everywhere.`,
      ''
    );
    if (base.attach) add(`Attach: web \`${mdCell(base.attach.web)}\`, desktop \`${mdCell(base.attach.desktop)}\`.`, '');
    if (!shown.length) continue;
    add('| Scope | State | Metric | Contract | Expected | Web value | Desktop value | Web | Desktop | Web ↔ Desktop |');
    add('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of shown) {
      add(
        `| ${mdCell(scopeText(r, base))} | ${r.state} | ${r.metric} | ${mdCell(
          mdCode(r.web.expected?.label ?? '')
        )} | ${mdCell(expectedText(r))} | ${mdCell(actualText(r, 'web'))} | ${mdCell(
          actualText(r, 'desktop')
        )} | ${mdCell(verdictText(r.web))} | ${mdCell(verdictText(r.desktop))} | ${mdCell(verdictText(r.cross))} |`
      );
    }

    add('');
  }

  for (const kind of ['order', 'text']) {
    const list = rows.filter((r) => r.kind === kind && (!opts.failingOnly || !r.allPass));

    add(kind === 'order' ? '## Order checks' : '## Text checks', '');
    if (!list.length) {
      add(opts.failingOnly ? 'All rows pass everywhere.' : 'No rows.', '');
      continue;
    }

    add(
      kind === 'order'
        ? '| Check | Container | State | Scope | Expected | Web | Desktop | Web | Desktop | Web ↔ Desktop |'
        : '| Check | Element | State | Scope | Expected | Web | Desktop | Web | Desktop | Web ↔ Desktop |'
    );
    add('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const show = (side) => {
      const item = side.items.find(hasValue);

      if (!item) return side.result === 'missing' ? 'missing id' : '';
      return Array.isArray(item.actual) ? item.actual.join(', ') : JSON.stringify(item.actual);
    };

    for (const r of list) {
      const exp = r.web.expected?.value ?? r.desktop.expected?.value;
      const expText = Array.isArray(exp) ? exp.join(', ') : JSON.stringify(exp ?? null);

      add(
        `| ${mdCode(r.check)} | ${mdCode(kind === 'order' ? r.container : r.element)} | ${r.state} | ${mdCell(
          scopeText(r)
        )} | ${mdCell(expText)} | ${mdCell(show(r.web))} | ${mdCell(show(r.desktop))} | ${mdCell(
          verdictText(r.web)
        )} | ${mdCell(verdictText(r.desktop))} | ${mdCell(verdictText(r.cross))} |`
      );
    }

    add('');
  }

  add('## Verdicts', '');
  add(
    '- `pass`: within the tolerance (0.5px unless the entry says otherwise; colours exact `#RRGGBBAA`).',
    '- `FAIL`: measured and wrong. Web ↔ Desktop fails when the two measurements differ, or when only one client has the element.',
    '- `missing`: the probe looked for the parity id and did not find it.',
    '- `error`: the expected value could not be resolved (for a `calc`, a measured input was not reported).',
    '- `—`: not measured (no probe file for that client and state, or the probe did not write the row).',
    '- `n/a`: neither client has a value to compare.',
    ''
  );

  return `${lines.join('\n')}\n`;
}

// ── HTML ──────────────────────────────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Pixel size of a PNG or JPEG, or null. */
function imageSize(path) {
  let buf;

  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }

  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;

    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);

      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }

      i += 2 + len;
    }
  }

  return null;
}

function imageSrc(path, outDir, embed) {
  if (!existsSync(path)) return null;
  if (embed) {
    const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  }

  return toPosix(relative(outDir, path))
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function notionFor(plan, groupRows, state, scene, when, notionDir) {
  const sceneDef = plan.scenes.find((s) => s.id === scene);
  const fromScene = sceneDef?.notionReferences ?? [];
  const fromRows = groupRows.flatMap((r) => r.notionReferences ?? []);
  const all = [...fromScene, ...fromRows];
  const matches = (ref, s) => (ref.when ?? 'rest') === when && (!ref.states || ref.states.includes(s));
  const seen = new Set();
  const pick = (list, fallbackState) =>
    list
      .filter((ref) => matches(ref, fallbackState ?? state))
      .filter((ref) => !seen.has(ref.image) && seen.add(ref.image))
      .map((ref) => ({
        ...ref,
        path: ref.image && notionDir ? (isAbsolute(ref.image) ? ref.image : join(notionDir, ref.image)) : null,
        shownFor: fallbackState ?? null,
      }));
  let refs = pick(all);

  if (!refs.length) {
    // Same mode, other theme: still useful for geometry, labelled as such.
    const other = `${modeOf(state)}-${themeOf(state) === 'light' ? 'dark' : 'light'}`;

    refs = pick(all, other);
  }

  return refs;
}

function writeHtml(model) {
  const { contract, plan, evaluation, probes, opts, outDir, warnings } = model;
  const sceneOrder = new Map(plan.scenes.map((s, i) => [s.id, i]));
  const whenOrder = new Map(Object.keys(plan.metrics.interactions ?? {}).map((w, i) => [w, i]));
  const groups = new Map();
  const groupKey = (state, scene, when) => `${state}|${scene}|${when}`;
  const ensure = (state, scene, when) => {
    const key = groupKey(state, scene, when);

    if (!groups.has(key)) groups.set(key, { state, scene, when, rows: [], shots: { web: [], desktop: [] } });
    return groups.get(key);
  };

  for (const r of evaluation.rows) ensure(r.state, r.scene, r.when).rows.push(r);
  for (const client of CLIENTS) {
    for (const bucket of probes[client].values()) {
      for (const shot of bucket.screenshots) ensure(bucket.state, shot.scene, shot.when).shots[client].push(shot);
    }
  }

  const isProblem = (r) => !r.allPass && [r.web.result, r.desktop.result, r.cross.result].some((x) => PROBLEM.has(x));
  const sorted = [...groups.values()]
    .filter((g) => g.shots.web.length || g.shots.desktop.length || g.rows.some(isProblem))
    .sort(
      (a, b) =>
        STATES.indexOf(a.state) - STATES.indexOf(b.state) ||
        (sceneOrder.get(a.scene) ?? 99) - (sceneOrder.get(b.scene) ?? 99) ||
        (whenOrder.get(a.when) ?? 99) - (whenOrder.get(b.when) ?? 99)
    );

  const t = tally(evaluation.rows);
  const pct = (n) => (t.rows ? `${Math.round((100 * (n ?? 0)) / t.rows)}%` : '—');
  const commitOf = (client, state) => probes[client].get(state)?.headers[0]?.commit ?? '';
  const sections = [];

  for (const g of sorted) {
    const problems = g.rows.filter(isProblem);
    const issues = new Map();

    for (const r of problems) {
      const key = [r.kind, r.check, r.variant ?? '-', r.instance ?? '-'].join('|');

      if (!issues.has(key)) issues.set(key, { n: issues.size + 1, rows: [] });
      issues.get(key).rows.push(r);
    }

    const panel = (client) => {
      const shot = g.shots[client].find((s) => !s.instance) ?? g.shots[client][0];
      const label = `${CLIENT_LABEL[client]}${
        commitOf(client, g.state) ? ` <small>${esc(commitOf(client, g.state))}</small>` : ''
      }`;

      if (!shot) {
        const why = probes[client].has(g.state)
          ? 'No capture for this scene and interaction.'
          : `No ${client}-${g.state}.json.`;

        return `<figure class="panel"><figcaption>${label}</figcaption><div class="noshot">${esc(why)}</div></figure>`;
      }

      const src = imageSrc(shot.path, outDir, opts.embedImages);

      if (!src) {
        return `<figure class="panel"><figcaption>${label}</figcaption><div class="noshot">Missing file ${esc(
          toPosix(shot.path)
        )}</div></figure>`;
      }

      const px = imageSize(shot.path);
      const dpr = shot.devicePixelRatio || 1;
      const width = shot.width ?? (px ? px.width / dpr : null);
      const height = shot.height ?? (px ? px.height / dpr : null);
      const boxes = new Map();
      const addBox = (box, cls, n) => {
        if (!box || !width || !height) return;
        const key = [box.x, box.y, box.width, box.height].join(',');
        const prev = boxes.get(key);

        if (prev) {
          if (n) prev.issues.add(n);
          if (cls === 'bad' || (cls === 'diff' && prev.cls === 'ok')) prev.cls = cls;
          return;
        }

        boxes.set(key, { box, cls, issues: new Set(n ? [n] : []) });
      };

      for (const issue of issues.values()) {
        for (const r of issue.rows) {
          const side = r[client];
          const cls = PROBLEM.has(side.result) ? 'bad' : 'diff';

          for (const item of side.items) {
            addBox(item.box, cls, issue.n);
            for (const b of item.boxes ?? []) addBox(b.box, cls, issue.n);
          }
        }
      }

      for (const r of g.rows) {
        if (isProblem(r)) continue;
        for (const item of r[client].items) if (item.result === 'pass') addBox(item.box, 'ok', 0);
      }

      const overlays = [...boxes.values()]
        .map(({ box, cls, issues: ns }) => {
          const left = ((box.x - shot.origin.x) / width) * 100;
          const top = ((box.y - shot.origin.y) / height) * 100;
          const w = (box.width / width) * 100;
          const h = (box.height / height) * 100;

          if (left > 100 || top > 100 || left + w < 0 || top + h < 0) return '';
          const list = [...ns].sort((a, b) => a - b);
          const style = `left:${left.toFixed(3)}%;top:${top.toFixed(3)}%;width:${Math.max(w, 0.15).toFixed(
            3
          )}%;height:${Math.max(h, 0.15).toFixed(3)}%`;

          return `<div class="box ${cls}" data-issues="${list.join(' ')}" style="${style}">${
            list.length ? `<span>${list.join(',')}</span>` : ''
          }</div>`;
        })
        .join('');
      const ratio = width && height ? ` style="aspect-ratio:${width} / ${height}"` : '';

      return `<figure class="panel"><figcaption>${label}</figcaption><div class="frame"${ratio}><img src="${esc(
        src
      )}" alt="${esc(
        `${CLIENT_LABEL[client]} capture, ${g.state}, ${g.scene}, ${g.when}`
      )}" loading="lazy">${overlays}</div></figure>`;
    };

    const notionRefs = notionFor(plan, g.rows, g.state, g.scene, g.when, opts.notionDir);
    let notionPanel = '';

    if (notionRefs.length) {
      const ref = notionRefs[0];
      const src = ref.path ? imageSrc(ref.path, outDir, opts.embedImages) : null;
      const caption = `Notion reference${ref.shownFor ? ` <small>(shows ${esc(ref.shownFor)})</small>` : ''}`;
      const more =
        notionRefs.length > 1
          ? `<p class="note">Also: ${notionRefs
              .slice(1)
              .map((x) => esc(x.image))
              .join(', ')}</p>`
          : '';
      const body = src
        ? `<div class="frame"><img src="${esc(src)}" alt="${esc(`Notion reference ${ref.image}`)}" loading="lazy"></div>`
        : `<div class="noshot">${esc(ref.image)}${
            opts.notionDir ? ' (file not found)' : ' (pass --notion-dir to show it)'
          }</div>`;

      notionPanel = `<figure class="panel notion"><figcaption>${caption}</figcaption>${body}<p class="note">${esc(
        ref.note ?? ref.image
      )}</p>${more}</figure>`;
    }

    const issueRows = [...issues.values()]
      .map((issue) =>
        issue.rows
          .map((r, i) => {
            const head =
              i === 0
                ? `<td rowspan="${issue.rows.length}" class="num"><span class="pill">${
                    issue.n
                  }</span></td><td rowspan="${issue.rows.length}"><code>${esc(r.check)}</code>${
                    r.variant !== null ? ` <small>v${r.variant + 1}</small>` : ''
                  }${r.instance ? `<br><small>${esc(r.instance)}</small>` : ''}</td>`
                : '';
            const metricLabel =
              r.kind === 'metric' ? r.metric : r.kind === 'order' ? `order (${esc(r.container)})` : 'text';
            const listValue = (side) => {
              const item = side.items.find(hasValue);

              return item
                ? Array.isArray(item.actual)
                  ? item.actual.join(', ')
                  : JSON.stringify(item.actual)
                : side.result === 'missing'
                ? 'missing id'
                : '—';
            };
            const value = (side) => (r.kind === 'metric' ? actualText(r, side) || '—' : listValue(r[side]));
            const expected =
              r.kind === 'metric'
                ? expectedText(r)
                : (() => {
                    const e = r.web.expected?.value ?? r.desktop.expected?.value;

                    return Array.isArray(e) ? e.join(', ') : JSON.stringify(e ?? null);
                  })();
            const verdict = (side) =>
              `<span class="v v-${esc(side.result)}" title="${esc(side.reason ?? '')}">${esc(side.result)}</span>`;

            return `<tr data-issue="${issue.n}">${head}<td>${esc(metricLabel)}</td><td><code>${esc(
              r.kind === 'metric' ? r.web.expected?.label ?? '' : ''
            )}</code></td><td>${esc(expected)}</td><td>${esc(value('web'))}</td><td>${esc(
              value('desktop')
            )}</td><td class="vc">${verdict(r.web)}</td><td class="vc">${verdict(
              r.desktop
            )}</td><td class="vc">${verdict(r.cross)}</td></tr>`;
          })
          .join('')
      )
      .join('');
    const sceneDef = plan.scenes.find((s) => s.id === g.scene);
    const ids = [...new Set(g.rows.map((r) => r.check))].join(' ');
    const notRun = g.rows.filter((r) => r.web.result === 'not-run' || r.desktop.result === 'not-run').length;
    const table = issues.size
      ? `<table class="issues"><thead><tr><th>#</th><th>Check</th><th>Metric</th><th>Contract</th><th>Expected</th><th>Web value</th><th>Desktop value</th><th class="vc">Web</th><th class="vc">Desktop</th><th class="vc">W↔D</th></tr></thead><tbody>${issueRows}</tbody></table>`
      : `<p class="note">No failing rows in this group${
          notRun ? ` (${notRun} rows not measured on at least one client)` : ''
        }.</p>`;

    sections.push(
      `<section class="group" data-state="${esc(g.state)}" data-problems="${issues.size}" data-ids="${esc(
        ids
      )}"><h2>${esc(g.state)} · ${esc(g.scene)} · ${esc(g.when)} <span class="badge${issues.size ? ' bad' : ''}">${
        issues.size ? `${issues.size} failing` : 'clean'
      }</span></h2>${
        sceneDef?.given
          ? `<p class="given">${esc(sceneDef.given)}${
              g.when !== 'rest' && plan.metrics.interactions?.[g.when]
                ? `; ${esc(plan.metrics.interactions[g.when])}`
                : ''
            }.</p>`
          : ''
      }<div class="panels">${panel('web')}${panel('desktop')}${notionPanel}</div>${table}</section>`
    );
  }

  const stateOptions = evaluation.probedStates.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const blocking = evaluation.rows.filter((r) => r.blocking).length;
  const warningList = warnings.length
    ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard visual parity</title>
<style>
:root { color-scheme: light dark; --bg: #f6f7fb; --card: #ffffff; --fg: #1f2329; --muted: #646a7d; --line: #dde2f1;
  --bad: #e5484d; --diff: #f5a524; --ok: #30a46c; --accent: #00b5ff; --code: #eef1f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #17181c; --card: #21232a; --fg: #e4e8f5; --muted: #9aa0b8;
  --line: #3d404f; --code: #2c2f38; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; }
header.top { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); padding: 12px 16px; }
h1 { font-size: 18px; line-height: 24px; margin: 0 0 4px; }
.meta { color: var(--muted); margin: 0 0 8px; font-size: 12px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.stat { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 4px 10px; }
.stat b { font-variant-numeric: tabular-nums; }
.controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.controls input[type=search] { min-width: 220px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
.controls select { padding: 3px 6px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
main { padding: 16px; max-width: 1800px; margin: 0 auto; }
.warnings { color: var(--diff); margin: 0 0 12px; }
.group { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin: 0 0 16px; }
.group h2 { font-size: 15px; line-height: 20px; margin: 0 0 4px; }
.given { color: var(--muted); margin: 0 0 8px; font-size: 12px; }
.badge { font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: 10px; background: var(--code); color: var(--muted); vertical-align: middle; }
.badge.bad { background: var(--bad); color: #fff; }
.panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; align-items: start; }
.panel { margin: 0; min-width: 0; }
.panel.zoom { grid-column: 1 / -1; }
.panel figcaption { font-weight: 600; margin-bottom: 4px; }
.panel figcaption small { font-weight: 400; color: var(--muted); }
.frame { position: relative; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; cursor: zoom-in; background: var(--bg); }
.panel.zoom .frame { cursor: zoom-out; }
.frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
.noshot { border: 1px dashed var(--line); border-radius: 6px; padding: 32px 12px; text-align: center; color: var(--muted); }
.note { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
.box { position: absolute; border: 2px solid var(--bad); border-radius: 2px; }
.box.diff { border-color: var(--diff); }
.box.ok { border: 1px dashed var(--ok); display: none; }
body.show-ok .box.ok { display: block; }
.box span { position: absolute; left: -2px; top: -2px; transform: translateY(-100%); background: var(--bad); color: #fff; font: 600 10px/14px system-ui, sans-serif; padding: 0 4px; border-radius: 3px 3px 3px 0; white-space: nowrap; }
.box.diff span { background: var(--diff); color: #1f2329; }
.box.hl { box-shadow: 0 0 0 3px var(--accent); z-index: 2; }
table.issues { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; line-height: 16px; }
table.issues th, table.issues td { border-top: 1px solid var(--line); padding: 4px 6px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
table.issues .vc { white-space: nowrap; width: 1%; }
table.issues th { color: var(--muted); font-weight: 500; }
table.issues tr.hl td { background: var(--code); }
td.num { width: 28px; }
.pill { display: inline-block; min-width: 18px; text-align: center; border-radius: 9px; background: var(--bad); color: #fff; font-weight: 600; }
code { background: var(--code); border-radius: 4px; padding: 0 3px; font-size: 12px; }
.v { font-weight: 600; }
.v-pass { color: var(--ok); } .v-fail, .v-missing, .v-error { color: var(--bad); } .v-not-run, .v-n\\/a, .v-waived { color: var(--muted); }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); margin-top: 6px; }
.legend i { display: inline-block; width: 12px; height: 10px; border: 2px solid var(--bad); vertical-align: middle; margin-right: 4px; }
.legend i.diff { border-color: var(--diff); } .legend i.ok { border: 1px dashed var(--ok); }
@media (max-width: 640px) { main { padding: 8px; } .group { padding: 8px; } table.issues { display: block; overflow-x: auto; } }
</style>
</head>
<body>
<header class="top">
<h1>Dashboard visual parity</h1>
<p class="meta">Generated ${esc(new Date().toISOString())} · contract FIXTURES.sha256 ${esc(
    contract.manifestSha ? contract.manifestSha.slice(0, 12) : 'unknown'
  )} · gate ${esc(opts.wave === null ? 'all waves' : `wave ≤ ${opts.wave}`)}${opts.strict ? ', strict' : ''}</p>
<div class="stats"><span class="stat">Rows <b>${t.rows}</b></span><span class="stat">Web pass <b>${pct(
    t.web.pass
  )}</b></span><span class="stat">Desktop pass <b>${pct(
    t.desktop.pass
  )}</b></span><span class="stat">Web ↔ Desktop pass <b>${pct(
    t.cross.pass
  )}</b></span><span class="stat">Blocking <b>${blocking}</b></span></div>
<div class="controls">
<label>State <select id="f-state"><option value="">All</option>${stateOptions}</select></label>
<label><input type="checkbox" id="f-problems"> Only groups with failures</label>
<label><input type="checkbox" id="f-ok"> Outline passing elements</label>
<input type="search" id="f-q" placeholder="Filter by parity id, e.g. dash-widget-card">
</div>
<div class="legend"><span><i></i>fails the contract on this client</span><span><i class="diff"></i>matches the contract here, differs from the other client</span><span><i class="ok"></i>passes</span><span>Click a capture to enlarge it.</span></div>
</header>
<main>
${warningList}
${sections.join('\n') || '<p class="note">No captures and no failing rows.</p>'}
</main>
<script>
(() => {
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const state = document.getElementById('f-state');
  const problems = document.getElementById('f-problems');
  const ok = document.getElementById('f-ok');
  const q = document.getElementById('f-q');
  const apply = () => {
    const s = state.value;
    const needle = q.value.trim();
    for (const g of all('.group')) {
      const show = (!s || g.dataset.state === s) && (!problems.checked || Number(g.dataset.problems) > 0) &&
        (!needle || g.dataset.ids.split(' ').some((id) => id.includes(needle)));
      g.hidden = !show;
    }
    document.body.classList.toggle('show-ok', ok.checked);
  };
  for (const el of [state, problems, ok]) el.addEventListener('change', apply);
  q.addEventListener('input', apply);
  const mark = (group, n, on) => {
    for (const b of all('.box', group)) if (b.dataset.issues.split(' ').includes(n)) b.classList.toggle('hl', on);
    for (const tr of all('tr[data-issue="' + n + '"]', group)) tr.classList.toggle('hl', on);
  };
  for (const group of all('.group')) {
    for (const tr of all('tr[data-issue]', group)) {
      tr.addEventListener('mouseenter', () => mark(group, tr.dataset.issue, true));
      tr.addEventListener('mouseleave', () => mark(group, tr.dataset.issue, false));
    }
    for (const b of all('.box', group)) {
      const ns = b.dataset.issues ? b.dataset.issues.split(' ') : [];
      b.addEventListener('mouseenter', () => ns.forEach((n) => mark(group, n, true)));
      b.addEventListener('mouseleave', () => ns.forEach((n) => mark(group, n, false)));
    }
    for (const frame of all('.frame', group)) frame.addEventListener('click', () => frame.parentElement.classList.toggle('zoom'));
  }
  apply();
})();
</script>
</body>
</html>
`;
}

// ── JSON ──────────────────────────────────────────────────────────────────────────────────────────

function writeJson(model) {
  const { contract, evaluation, probes, opts, warnings, ready } = model;
  const side = (s) => ({
    result: s.result,
    reason: s.reason || undefined,
    expected: s.items.length
      ? [...new Set(s.items.map((i) => JSON.stringify(i.expected ?? null)))].map((x) => JSON.parse(x))
      : s.expected?.value,
    actual: s.items
      .filter(hasValue)
      .map((i) => ({ target: i.target, index: i.index, value: i.actual, box: i.box ?? undefined })),
  });

  return `${JSON.stringify(
    {
      schema: 'appflowy.dashboard-parity.visual-comparison',
      version: 1,
      generatedAt: new Date().toISOString(),
      fixturesSha256: contract.manifestSha,
      gate: { wave: opts.wave, strict: opts.strict },
      probes: Object.fromEntries(
        CLIENTS.map((c) => [
          c,
          Object.fromEntries(
            [...probes[c].entries()].map(([s, b]) => [
              s,
              b.headers.map((h) => ({ file: toPosix(h.file), commit: h.commit })),
            ])
          ),
        ])
      ),
      summary: tally(evaluation.rows),
      blocking: evaluation.rows.filter((r) => r.blocking).length,
      readyToEnforce: ready,
      warnings,
      rows: evaluation.rows.map((r) => ({
        kind: r.kind,
        check: r.check,
        variant: r.variant,
        scene: r.scene,
        state: r.state,
        when: r.when,
        instance: r.instance,
        metric: r.metric,
        contract: r.kind === 'metric' ? r.spec : r.expected,
        wave: r.wave,
        status: r.status,
        web: side(r.web),
        desktop: side(r.desktop),
        cross: { result: r.cross.result, reason: r.cross.reason || undefined },
        blocking: r.blocking,
      })),
    },
    null,
    2
  )}\n`;
}

// ── Plan export ───────────────────────────────────────────────────────────────────────────────────

function writePlan(plan, resolver, dir) {
  mkdirSync(dir, { recursive: true });
  const written = [];

  for (const state of STATES) {
    const rows = planRowsFor(plan, state);
    const metricRows = rows
      .filter((r) => r.kind === 'metric')
      .map((r) => {
        const res = Object.fromEntries(
          CLIENTS.map((client) => {
            const x = resolver.resolveSpec(
              r.spec,
              { client, state, mode: modeOf(state), theme: themeOf(state) },
              r.metric,
              null
            );

            return [client, x.error ? null : x.value];
          })
        );
        const needs =
          typeof r.spec === 'object' && r.spec && 'calc' in r.spec
            ? r.spec.calc.match(/\$[a-z0-9_-]+\.[A-Za-z]+/g) ?? []
            : [];

        return {
          check: r.check,
          variant: r.variant,
          scene: r.scene,
          when: r.when,
          instance: r.instance,
          relativeTo: r.relativeTo ?? undefined,
          appliesTo: r.appliesTo ?? undefined,
          content: r.content ?? undefined,
          metric: r.metric,
          contract: r.spec,
          expected: res,
          needs: needs.length ? needs : undefined,
          desktopMeasure: r.desktopMeasure ?? undefined,
          wave: r.wave,
          status: r.status,
          clientWaivers: r.clientWaivers ?? undefined,
        };
      });
    const list = (kind) =>
      rows
        .filter((r) => r.kind === kind)
        .map((r) => ({
          check: r.check,
          scene: r.scene,
          when: r.when,
          instance: r.instance,
          ...(kind === 'order'
            ? { container: r.container, axis: r.axis, expected: orderExpected(r).value }
            : { element: r.element, kind: r.textKind, expected: r.expected }),
          wave: r.wave,
          status: r.status,
          clientWaivers: r.clientWaivers ?? undefined,
        }));
    const captures = [...new Set(rows.map((r) => `${r.scene}|${r.when}`))].map((k) => {
      const [scene, when] = k.split('|');

      return { scene, when };
    });
    const file = join(dir, `plan-${state}.json`);

    writeFileSync(
      file,
      `${JSON.stringify(
        {
          schema: 'appflowy.dashboard-parity.visual-plan',
          version: 1,
          state,
          captures,
          measurements: metricRows,
          orderChecks: list('order'),
          textChecks: list('text'),
        },
        null,
        2
      )}\n`
    );
    written.push(file);
  }

  return written;
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────

function main(argv, env) {
  const opts = parseArgs(argv, env);

  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const contract = loadContract(opts);
  const plan = buildPlan(contract.metrics);
  const resolver = makeResolver(contract);
  const warnings = [];

  if (!contract.icons) warnings.push(`icons.json not found at ${toPosix(contract.paths.icons)}; icon rows cannot pass.`);
  if (opts.emitPlan) {
    const files = writePlan(plan, resolver, opts.emitPlan);

    process.stdout.write(`Plan: ${files.map(toPosix).join(', ')}\n`);
    if (!opts.probes.length && !opts.web.length && !opts.desktop.length) return 0;
  }

  const probes = loadProbes(opts, plan, warnings);

  checkInputs(contract, plan, probes, opts, warnings);
  const evaluation = evaluate(plan, probes, resolver, opts);

  for (const client of CLIENTS) {
    const drifted = evaluation.rows.filter((r) => r.drift.includes(client));

    if (drifted.length) {
      warnings.push(
        `${CLIENT_LABEL[client]} probe resolved ${
          drifted.length
        } expected value(s) differently from the contract, e.g. ${drifted
          .slice(0, 3)
          .map((r) => `${r.check} ${r.metric} (${r.state})`)
          .join(', ')}; its resolver is out of date (marked "probe expected").`
      );
    }
  }

  const ready = readyToEnforce(plan, evaluation, probes, opts);
  const outDir = opts.out ?? join(opts.probes[0] ?? dirname(opts.web[0] ?? opts.desktop[0]), 'report');

  mkdirSync(outDir, { recursive: true });
  const model = { contract, plan, evaluation, probes, opts, warnings, ready, outDir };
  const md = join(outDir, `${REPORT_NAME}.md`);
  const html = join(outDir, `${REPORT_NAME}.html`);
  const json = join(outDir, `${REPORT_NAME}.json`);

  writeFileSync(md, writeMarkdown(model));
  writeFileSync(html, writeHtml(model));
  writeFileSync(json, writeJson(model));

  const t = tally(evaluation.rows);
  const blocking = evaluation.rows.filter((r) => r.blocking).length;

  process.stdout.write(
    [
      `States: ${evaluation.probedStates.join(', ') || 'none'}`,
      `Rows: ${t.rows}; web pass ${t.web.pass ?? 0}, desktop pass ${t.desktop.pass ?? 0}, web ↔ desktop pass ${
        t.cross.pass ?? 0
      }`,
      `Blocking: ${blocking}${opts.strict ? ' (strict)' : ''}; ready to enforce: ${ready.length}`,
      ...warnings.map((w) => `Warning: ${w}`),
      `Report: ${toPosix(md)}`,
      `Review page: ${toPosix(html)}`,
      `Rows (JSON): ${toPosix(json)}`,
    ].join('\n') + '\n'
  );
  return blocking ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2), process.env);
} catch (error) {
  if (error instanceof InputError) {
    process.stderr.write(`compare-visual-parity: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
