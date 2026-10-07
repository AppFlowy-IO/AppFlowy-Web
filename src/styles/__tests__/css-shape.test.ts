/**
 * @jest-environment node
 */
/**
 * CSS shape budget (PERFORMANCE-REPORT 4.3 A, budget 13): the app's CSS has
 * no selector shape that makes Blink restyle the whole page or a whole
 * hovered subtree.
 *
 * 1. Sibling rules under `<id> :is()` (W1). `important: '#body'` makes
 *    Tailwind wrap every utility in `#body :is(...)`. With a sibling
 *    combinator inside, a child inserted into <body> or into a grid restyles
 *    every element; postcss/unwrap-sibling-is.cjs un-nests them. A sibling
 *    combinator whose left-hand compound has a class, id or attribute (the
 *    `peer-*` rules) is cheap; unwrapping with a descendant combinator inside
 *    would change what matches, so the plugin leaves those.
 * 2. `:hover`, `:focus` or `:active` followed by a descendant whose subject
 *    has no class, id or attribute (W9), such as
 *    `.appflowy-scroller:hover *::-webkit-scrollbar-thumb`: one such rule
 *    makes every hover change restyle the hovered element's whole subtree.
 *
 * The input is what the repo's PostCSS config produces from
 * src/styles/tailwind.css (Tailwind with the real config), every SCSS file
 * of src/styles and the editor (compiled with sass), and the
 * `@appflowyinc/editor` stylesheet the app loads. Set CSS_SHAPE_BUILD_DIR to
 * a production build (`pnpm build`, then the folder holding its CSS) to run
 * the same budget over the built CSS.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

import postcss from 'postcss';
import * as sass from 'sass';

// autoprefixer's browserslist would warn about its caniuse data on every run.
process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = path.resolve(__dirname, '../../..');
const BUILD_DIR = process.env.CSS_SHAPE_BUILD_DIR;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postcssConfig = require(path.join(ROOT, 'postcss.config.cjs')) as { plugins: postcss.AcceptedPlugin[] };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NESTED_SCROLLERS } = require(path.join(ROOT, 'postcss/scope-scrollbar-hover.cjs')) as {
  NESTED_SCROLLERS: string[];
};

// ---------------------------------------------------------------------------
// Selector shapes
// ---------------------------------------------------------------------------

/** Escapes and strings replaced, so that only the selector structure is left. */
function plain(selector: string): string {
  return selector
    .replace(/\\[0-9a-fA-F]{1,6}\s?/g, 'x')
    .replace(/\\[\s\S]/g, 'x')
    .replace(/"[^"]*"|'[^']*'/g, '""')
    .trim();
}

function closingParen(text: string, open: number): number {
  let depth = 0;

  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(' || text[index] === '[') depth += 1;
    if (text[index] === ')' || text[index] === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(text.slice(start).trim());
  return parts;
}

interface Compound {
  /** The combinator before this compound: ' ', '>', '+', '~', or null for the first. */
  combinator: string | null;
  text: string;
}

function compoundsOf(selector: string): Compound[] {
  const compounds: Compound[] = [];
  let depth = 0;
  let current = '';
  let combinator: string | null = null;

  for (const char of selector) {
    if (depth === 0 && /[\s>+~]/.test(char)) {
      if (current) {
        compounds.push({ combinator, text: current });
        current = '';
        combinator = ' ';
      }

      if (char !== ' ' && !/\s/.test(char)) combinator = char;
      continue;
    }

    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    current += char;
  }

  if (current) compounds.push({ combinator, text: current });
  if (compounds[0]) compounds[0].combinator = null;
  return compounds;
}

/**
 * Whether a compound has a class, id or attribute: outside functional
 * pseudo-classes, or in an `:is()` / `:where()` whose every entry has one.
 */
function hasFeature(compound: string): boolean {
  let outside = '';
  let index = 0;

  while (index < compound.length) {
    const forgiving = /^:(is|where|matches)\(/i.exec(compound.slice(index));

    if (forgiving) {
      const open = index + forgiving[0].length - 1;
      const close = closingParen(compound, open);
      const entries = splitList(compound.slice(open + 1, close));

      if (entries.every((entry) => entry && compoundsOf(entry).every((part) => hasFeature(part.text)))) return true;
      index = close + 1;
    } else if (compound[index] === '(') {
      index = closingParen(compound, index) + 1;
    } else {
      outside += compound[index];
      index += 1;
    }
  }

  return /[.#[]/.test(outside);
}

/** `<id> :is(X)<suffix>`, split into the entries of X. */
function idIs(selector: string): { id: string; entries: string[]; suffix: string } | null {
  const match = /^(#[-\w]+)\s+:is\(/.exec(selector);

  if (!match) return null;
  const open = match[0].length - 1;
  const close = closingParen(selector, open);

  if (close < 0) return null;
  return { id: match[1], entries: splitList(selector.slice(open + 1, close)), suffix: selector.slice(close + 1) };
}

interface SiblingShape {
  /** `<id> :is(X)` with a `~` or `+` in X. */
  siblingUnderIdIs: boolean;
  /** ...where the compound left of that combinator has no class, id or attribute (W1, whole-page restyles). */
  featureless: boolean;
  /** ...and X has no descendant combinator: unwrap-sibling-is must have un-nested it. */
  unwrappable: boolean;
}

function siblingShape(rawSelector: string): SiblingShape {
  const shape = { siblingUnderIdIs: false, featureless: false, unwrappable: false };
  const wrapper = idIs(plain(rawSelector));

  wrapper?.entries.forEach((entry) => {
    const compounds = compoundsOf(entry);
    const siblings = compounds
      .map((compound, index) => ({ compound, index }))
      .filter(({ compound }) => compound.combinator === '~' || compound.combinator === '+');

    if (siblings.length === 0) return;
    shape.siblingUnderIdIs = true;
    if (siblings.some(({ index }) => !hasFeature(compounds[index - 1].text))) shape.featureless = true;
    if (!compounds.some((compound) => compound.combinator === ' ')) shape.unwrappable = true;
  });
  return shape;
}

/** `#id :is(A, B)` read as `#id A` and `#id B`, so that the shapes inside are seen. */
function expandIdIs(selector: string): string[] {
  const wrapper = idIs(selector);

  if (!wrapper) return [selector];
  return wrapper.entries.flatMap((entry) => expandIdIs(`${wrapper.id} ${entry}${wrapper.suffix}`));
}

/** `:hover`, `:focus` or `:active` followed by a descendant whose subject has no class, id or attribute (W9). */
function isUniversalUnderUserAction(rawSelector: string): boolean {
  return expandIdIs(plain(rawSelector)).some((selector) => {
    const compounds = compoundsOf(selector);
    const subject = compounds[compounds.length - 1];

    if (!subject || hasFeature(subject.text)) return false;
    return compounds.slice(0, -1).some((compound, index) => {
      const outside = compound.text.replace(/\([^()]*\)/g, '');

      return (
        /:(hover|focus|active)/.test(outside) &&
        compounds.slice(index + 1).some((later) => later.combinator === ' ' || later.combinator === '>')
      );
    });
  });
}

// ---------------------------------------------------------------------------
// The CSS
// ---------------------------------------------------------------------------

interface Budget {
  featurelessSiblings: string[];
  unwrappableSiblings: string[];
  keptSiblings: string[];
  universalUnderUserAction: string[];
}

function measure(sources: { name: string; css: string }[]): Budget {
  const budget: Budget = { featurelessSiblings: [], unwrappableSiblings: [], keptSiblings: [], universalUnderUserAction: [] };

  sources.forEach(({ name, css }) => {
    postcss.parse(css).walkRules((rule) => {
      const parent = rule.parent;

      if (parent?.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name)) return;
      splitList(rule.selector).forEach((selector) => {
        const where = `${name}: ${selector}`;
        const shape = siblingShape(selector);

        if (shape.featureless) budget.featurelessSiblings.push(where);
        if (shape.unwrappable) budget.unwrappableSiblings.push(where);
        if (shape.siblingUnderIdIs && !shape.unwrappable) budget.keptSiblings.push(where);
        if (isUniversalUnderUserAction(selector)) budget.universalUnderUserAction.push(where);
      });
    });
  });
  return budget;
}

function scssFiles(): string[] {
  const styles = path.join(ROOT, 'src/styles');

  return [
    ...readdirSync(styles)
      .filter((file) => file.endsWith('.scss'))
      .map((file) => path.join(styles, file)),
    path.join(ROOT, 'src/components/editor/editor.scss'),
  ];
}

function compileScss(file: string): string {
  return sass.compile(file, { loadPaths: [ROOT], style: 'expanded' }).css;
}

async function processWith(plugins: postcss.AcceptedPlugin[], css: string, from: string): Promise<string> {
  return (await postcss(plugins).process(css, { from })).css;
}

/** The CSS sources the app loads, through `plugins`. */
async function appCss(plugins: postcss.AcceptedPlugin[]): Promise<{ name: string; css: string }[]> {
  const tailwind = path.join(ROOT, 'src/styles/tailwind.css');
  const editorPackage = require.resolve('@appflowyinc/editor/style');
  const sources = [
    { name: 'src/styles/tailwind.css', css: readFileSync(tailwind, 'utf8'), from: tailwind },
    ...scssFiles().map((file) => ({ name: path.relative(ROOT, file), css: compileScss(file), from: file })),
    { name: '@appflowyinc/editor/style', css: readFileSync(editorPackage, 'utf8'), from: editorPackage },
  ];

  return Promise.all(
    sources.map(async ({ name, css, from }) => ({ name, css: await processWith(plugins, css, from) }))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSS shape guard', () => {
  it('recognizes the shapes it guards against', () => {
    const shape = siblingShape('#body :is(.space-y-1>:not([hidden])~:not([hidden]))');

    expect(shape).toEqual({ siblingUnderIdIs: true, featureless: true, unwrappable: true });
    expect(siblingShape('#body :is(.stack > svg + div)').featureless).toBe(true);
    expect(siblingShape('#body :is(.stack > svg ~ *)').featureless).toBe(true);
    expect(siblingShape('#body .space-y-1>:not([hidden])~:not([hidden])').siblingUnderIdIs).toBe(false);
    expect(siblingShape('#body :is(.peer:disabled ~ .peer-x)')).toEqual({
      siblingUnderIdIs: true,
      featureless: false,
      unwrappable: true,
    });
    expect(siblingShape('#body :is(.menu [data-slot=x]>.ml-auto+svg)')).toEqual({
      siblingUnderIdIs: true,
      featureless: false,
      unwrappable: false,
    });
    expect(siblingShape('#body :is(.a\\~b > .c)').siblingUnderIdIs).toBe(false);

    expect(isUniversalUnderUserAction('.appflowy-scroller:hover *::-webkit-scrollbar-thumb')).toBe(true);
    expect(isUniversalUnderUserAction('.x:hover ::-webkit-scrollbar-thumb')).toBe(true);
    expect(isUniversalUnderUserAction('.x:focus-within > div')).toBe(true);
    expect(isUniversalUnderUserAction('#body :is(.group:active svg)')).toBe(true);
    expect(isUniversalUnderUserAction('.x:hover :where(.a, div)::-webkit-scrollbar-thumb')).toBe(true);
    expect(isUniversalUnderUserAction('.x:hover::-webkit-scrollbar-thumb')).toBe(false);
    expect(isUniversalUnderUserAction('.x *:hover::-webkit-scrollbar-thumb')).toBe(false);
    expect(isUniversalUnderUserAction('.x:hover :where(.a, .b)::-webkit-scrollbar-thumb')).toBe(false);
    expect(isUniversalUnderUserAction('#body :is(.group:hover .group-x)')).toBe(false);
    expect(isUniversalUnderUserAction('.x:hover ~ *')).toBe(false);
    expect(isUniversalUnderUserAction('.x:not(:hover) *')).toBe(false);
  });
});

describe('CSS shape budget (PERFORMANCE-REPORT 4.3 A, budget 13)', () => {
  jest.setTimeout(180_000);

  let budget: Budget;

  beforeAll(async () => {
    budget = measure(await appCss(postcssConfig.plugins));
  });

  it('has no sibling rule under `<id> :is()` with a featureless left-hand compound (W1)', () => {
    expect(budget.featurelessSiblings).toEqual([]);
  });

  it('has no `<id> :is()` sibling rule left that unwrap-sibling-is could un-nest', () => {
    expect(budget.unwrappableSiblings).toEqual([]);
  });

  it('keeps only sibling rules whose :is() holds a descendant combinator, all with featured compounds', () => {
    // Today one: WidgetSettingsHost's `[&_[data-slot=dropdown-menu-sub-trigger]>.ml-auto+svg]` (`.ml-auto` is a class).
    budget.keptSiblings.forEach((selector) => {
      expect(siblingShape(selector.slice(selector.indexOf(': ') + 2))).toEqual({
        siblingUnderIdIs: true,
        featureless: false,
        unwrappable: false,
      });
    });
  });

  it('has no universal subject under :hover, :focus or :active (W9)', () => {
    expect(budget.universalUnderUserAction).toEqual([]);
  });

  it('would catch the shapes without the plugins', async () => {
    const tailwindOnly = postcssConfig.plugins.slice(0, 1);
    const raw = measure(await appCss(tailwindOnly));

    // The 9 space-* and divide-* rules and the 2 alert rules of the app, the 2 alert rules of the
    // editor package; and the editor package's `.appflowy-scrollbar:hover *::-webkit-scrollbar-thumb`.
    expect(raw.featurelessSiblings).toHaveLength(13);
    expect(raw.universalUnderUserAction).toEqual([
      '@appflowyinc/editor/style: .appflowy-scrollbar:hover *::-webkit-scrollbar-thumb',
    ]);
  });

  it('gives nested scrollers the same list in the SCSS mixin and in scope-scrollbar-hover', () => {
    const css = compileScss(path.join(ROOT, 'src/styles/app.scss'));
    const lists = [...css.matchAll(/:hover :where\(([^)]*)\)::-webkit-scrollbar-thumb/g)].map((match) =>
      splitList(match[1])
    );

    // .MuiBox-root (Windows), .appflowy-scroller, .appflowy-hidden-scroller, .appflowy-scrollbar.
    expect(lists).toHaveLength(4);
    lists.forEach((list) => expect(list).toEqual(NESTED_SCROLLERS));
  });
});

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);

    if (statSync(file).isDirectory()) return cssFilesUnder(file);
    return file.endsWith('.css') ? [file] : [];
  });
}

(BUILD_DIR ? describe : describe.skip)('CSS shape budget of a production build (CSS_SHAPE_BUILD_DIR)', () => {
  it('has none of the guarded shapes in the built CSS', () => {
    const files = cssFilesUnder(BUILD_DIR as string);
    const built = measure(files.map((file) => ({ name: path.relative(BUILD_DIR as string, file), css: readFileSync(file, 'utf8') })));

    // eslint-disable-next-line no-console
    console.log(
      `built CSS (${files.length} files): featureless sibling rules ${built.featurelessSiblings.length}, ` +
        `unwrappable ${built.unwrappableSiblings.length}, kept ${built.keptSiblings.length}, ` +
        `universal under :hover/:focus/:active ${built.universalUnderUserAction.length}`
    );
    expect(files.length).toBeGreaterThan(0);
    expect(built.featurelessSiblings).toEqual([]);
    expect(built.unwrappableSiblings).toEqual([]);
    expect(built.universalUnderUserAction).toEqual([]);
  });
});
