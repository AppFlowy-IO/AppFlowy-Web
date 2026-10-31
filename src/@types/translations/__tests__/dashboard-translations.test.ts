/**
 * WP14c-I18N completeness: the web locale files carry every dashboard string of the
 * shared canonical table (`dashboard-parity/i18n/`), in web syntax, and English equals
 * the table. The desktop `dashboard_translations_test` applies the same rules to the
 * desktop files, so both clients ship the same translations.
 *
 * A failure that names a missing or different translation means the table and the
 * locale files are out of step: run `pnpm i18n:dashboard` (never edit the generated
 * keys by hand). A new English key under `dashboard.` or `chart.` must be added to
 * `i18n/manifest.json` and translated first.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type CanonicalText = string | Partial<Record<PluralCategory, string>>;

interface Concept {
  id: string;
  web: string | null;
  desktop: string | null;
  en: CanonicalText;
  placeholders: string[];
  plural: boolean;
  source: string;
}

interface ManifestLocale {
  id: string;
  web: string | null;
  desktop: string | null;
  plural: PluralCategory[];
}

interface Manifest {
  version: number;
  concepts: Concept[];
  locales: ManifestLocale[];
  english: { id: string; web: string | null; desktop: string | null; copy_of?: string }[];
  removed: { web: string[]; desktop: string[] };
}

interface Glossary {
  locale: string;
  terms: Record<string, string>;
  untranslated_ok: string[];
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface Writer {
  PLURAL_CATEGORIES: PluralCategory[];
  toWebText(text: string): string;
  detectFormat(text: string): { indent: string; finalNewline: boolean };
  serialize(obj: JsonObject, format: { indent: string; finalNewline: boolean }): string;
  parseLocaleFile(text: string, label: string): { obj: JsonObject; format: { indent: string; finalNewline: boolean } };
  applyTranslations(
    root: JsonObject,
    manifest: Manifest,
    translations: Record<string, CanonicalText>,
    label: string
  ): string[];
}

const ROOT = join(__dirname, '..', '..', '..', '..');
const TRANSLATIONS_DIR = join(__dirname, '..');
const I18N_DIR = join(ROOT, 'src/application/database-yjs/__fixtures__/dashboard-parity/i18n');
const PLURAL_CATEGORIES: PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];
const SCOPED_PREFIXES = ['dashboard.', 'chart.'];
const REQUIRED_GLOSSARY_TERMS = ['dashboard', 'widget', 'chart'];
// A6: web takes desktop's existing "New page" translations for the new-row button.
const NEW_ROW_ID = 'grid.row.newRow';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const writer = require(join(ROOT, 'scripts/i18n/apply-dashboard-translations.cjs')) as Writer;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPath(root: JsonObject, path: string[]): Json | undefined {
  let node: Json | undefined = root;

  for (const segment of path) {
    if (!isObject(node)) return undefined;
    node = node[segment];
  }

  return node;
}

/** `parent` object and leaf key of a dotted web path. */
function locate(root: JsonObject, webPath: string): { parent: JsonObject | undefined; leaf: string } {
  const segments = webPath.split('.');
  const leaf = segments.pop() as string;
  const parent = getPath(root, segments);

  return { parent: isObject(parent) ? parent : undefined, leaf };
}

function flatten(obj: JsonObject, prefix = ''): Record<string, Json> {
  return Object.entries(obj).reduce<Record<string, Json>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isObject(value)) Object.assign(acc, flatten(value, path));
    else acc[path] = value;
    return acc;
  }, {});
}

/** The placeholders of a web text: `{{name}}` names and one `{}` per positional slot. */
function webPlaceholders(text: string): string[] {
  const named = [...text.matchAll(/\{\{\s*-?\s*(\w+)\s*\}\}/g)].map((match) => match[1]);
  const positional = (text.match(/\{\}/g) ?? []).map(() => '{}');

  return [...named, ...positional].sort();
}

function canonicalPlaceholders(en: CanonicalText): string[] {
  const texts = typeof en === 'string' ? [en] : Object.values(en);
  const names = new Set(texts.flatMap((text) => [...(text ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1])));

  const rank = (name: string) => Number(!/^\d+$/.test(name));

  // Positional slots first, then names, in code point order (as the seed builder sorts them).
  return [...names].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The English text a category is compared with: its own form, else `other`. */
function englishFor(concept: Concept, category: PluralCategory | null): string {
  if (typeof concept.en === 'string') return writer.toWebText(concept.en);
  const text = (category && concept.en[category]) ?? concept.en.other ?? '';

  return writer.toWebText(text);
}

/** Every `leaf_<category>` present (as a string) beside `leaf`. */
function presentCategories(parent: JsonObject | undefined, leaf: string): PluralCategory[] {
  if (!parent) return [];
  return PLURAL_CATEGORIES.filter((category) => typeof parent[`${leaf}_${category}`] === 'string');
}

function intlCategories(tag: string): PluralCategory[] {
  try {
    return new Intl.PluralRules(tag).resolvedOptions().pluralCategories as PluralCategory[];
  } catch {
    return [];
  }
}

const manifest = readJson<Manifest>(join(I18N_DIR, 'manifest.json'));
const webConcepts = manifest.concepts.filter((concept) => concept.web !== null);
const webLocales = manifest.locales.filter((locale) => locale.web !== null);
const english = manifest.english.find((entry) => entry.id === 'en');

function loadLocaleFixture(id: string): Record<string, CanonicalText> | undefined {
  const path = join(I18N_DIR, 'locales', `${id}.json`);

  return existsSync(path) ? readJson<Record<string, CanonicalText>>(path) : undefined;
}

function loadGlossary(id: string): Glossary | undefined {
  const path = join(I18N_DIR, 'glossary', `${id}.json`);

  return existsSync(path) ? readJson<Glossary>(path) : undefined;
}

/** Every key path one web concept occupies in English (`key`, or `key_<category>`). */
function englishWebForms(concept: Concept): string[] {
  const web = concept.web as string;

  if (typeof concept.en === 'string') return [web];
  return PLURAL_CATEGORIES.filter(
    (category) => typeof (concept.en as Record<string, string>)[category] === 'string'
  ).map((category) => `${web}_${category}`);
}

/** The problems of one web locale file against the table (empty when complete). */
function localeProblems(locale: ManifestLocale): string[] {
  const problems: string[] = [];
  const file = readJson<JsonObject>(join(TRANSLATIONS_DIR, `${locale.web}.json`));
  const fixture = loadLocaleFixture(locale.id);
  const glossary = loadGlossary(locale.id);
  const untranslatedOk = new Set(glossary?.untranslated_ok ?? []);
  const intl = intlCategories(locale.web as string).filter((category) => locale.plural.includes(category));

  if (!fixture) problems.push(`i18n/locales/${locale.id}.json does not exist`);

  const checkText = (concept: Concept, key: string, text: Json | undefined, category: PluralCategory | null) => {
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${key}: missing or empty`);
      return;
    }

    const englishText = englishFor(concept, category);

    if (webPlaceholders(text).join(',') !== webPlaceholders(englishText).join(',')) {
      problems.push(
        `${key}: placeholders [${webPlaceholders(text)}] differ from English [${webPlaceholders(englishText)}]`
      );
    }

    if (text === englishText && !untranslatedOk.has(concept.id)) {
      problems.push(`${key}: identical to English (translate it or list ${concept.id} in untranslated_ok)`);
    }

    const canonical = fixture?.[concept.id];
    const expected = category === null ? canonical : isObject(canonical) ? canonical[category] : undefined;

    if (fixture && typeof expected === 'string' && text !== writer.toWebText(expected)) {
      problems.push(`${key}: differs from i18n/locales/${locale.id}.json (run pnpm i18n:dashboard)`);
    }
  };

  webConcepts.forEach((concept) => {
    const { parent, leaf } = locate(file, concept.web as string);

    if (!concept.plural) {
      checkText(concept, concept.web as string, parent?.[leaf], null);
      return;
    }

    const present = presentCategories(parent, leaf);
    const required = [
      ...locale.plural,
      ...(isObject(concept.en) && 'zero' in concept.en && !locale.plural.includes('zero') ? (['zero'] as const) : []),
    ];
    const missing = required.filter((category) => !present.includes(category));
    const missingIntl = intl.filter((category) => !present.includes(category));

    if (parent && leaf in parent) problems.push(`${concept.web}: a plain key beside its plural forms`);
    if (missing.length > 0) problems.push(`${concept.web}: missing plural categories ${missing.join(', ')}`);
    if (missingIntl.length > 0) {
      problems.push(`${concept.web}: missing the Intl.PluralRules categories ${missingIntl.join(', ')}`);
    }

    const canonical = fixture?.[concept.id];

    if (isObject(canonical)) {
      const expected = PLURAL_CATEGORIES.filter((category) => typeof canonical[category] === 'string');

      if (expected.join(',') !== present.join(',')) {
        problems.push(
          `${concept.web}: categories [${present}] differ from i18n/locales/${locale.id}.json [${expected}]`
        );
      }
    }

    present.forEach((category) => {
      checkText(concept, `${concept.web}_${category}`, parent?.[`${leaf}_${category}`], category);
    });
  });

  manifest.removed.web.forEach((key) => {
    const { parent, leaf } = locate(file, key);

    [leaf, ...PLURAL_CATEGORIES.map((category) => `${leaf}_${category}`)].forEach((name) => {
      if (parent && name in parent) problems.push(`${key}: removed from English but still present (${name})`);
    });
  });

  return problems;
}

describe('dashboard translation table (i18n/manifest.json)', () => {
  it('has unique concept ids and web paths', () => {
    const ids = manifest.concepts.map((concept) => concept.id);
    const webPaths = webConcepts.map((concept) => concept.web);

    expect(manifest.version).toBe(1);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    expect(webPaths.filter((path, index) => webPaths.indexOf(path) !== index)).toEqual([]);
  });

  it('describes every concept consistently', () => {
    manifest.concepts.forEach((concept) => {
      expect(concept.web !== null || concept.desktop !== null).toBe(true);
      expect(concept.plural).toBe(isObject(concept.en));
      expect(concept.placeholders).toEqual(canonicalPlaceholders(concept.en));
      if (isObject(concept.en)) expect(concept.en.other).toEqual(expect.any(String));
    });
  });

  it('lists the 34 locales with their plural categories and a web file for each web stem', () => {
    const ids = manifest.locales.map((locale) => locale.id);
    const webFiles = readdirSync(TRANSLATIONS_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length));

    expect(manifest.locales).toHaveLength(34);
    expect(new Set(ids).size).toBe(ids.length);
    expect(webLocales).toHaveLength(32);
    expect(english?.web).toBe('en');
    expect(webFiles.sort()).toEqual([english?.web, ...webLocales.map((locale) => locale.web)].sort());
    manifest.locales.forEach((locale) => {
      expect(locale.plural).toContain('other');
      expect(locale.plural.every((category) => PLURAL_CATEGORIES.includes(category))).toBe(true);
    });
  });

  it('never lists a removed web key as a live concept', () => {
    const webPaths = new Set(webConcepts.map((concept) => concept.web));

    expect(manifest.removed.web.filter((key) => webPaths.has(key))).toEqual([]);
  });

  it('gives web grid.row.newRow the desktop key and its existing translations (A6)', () => {
    const concept = manifest.concepts.find((entry) => entry.id === NEW_ROW_ID);

    expect(concept).toMatchObject({ web: NEW_ROW_ID, desktop: NEW_ROW_ID, source: 'desktop-existing' });
  });
});

describe('English web copy (en.json)', () => {
  const en = readJson<JsonObject>(join(TRANSLATIONS_DIR, `${english?.web ?? 'en'}.json`));
  const flat = flatten(en);

  it('equals manifest en for every web concept', () => {
    const problems: string[] = [];

    webConcepts.forEach((concept) => {
      const { parent, leaf } = locate(en, concept.web as string);

      if (typeof concept.en === 'string') {
        if (parent?.[leaf] !== writer.toWebText(concept.en)) {
          problems.push(
            `${concept.web}: ${JSON.stringify(parent?.[leaf])} != ${JSON.stringify(writer.toWebText(concept.en))}`
          );
        }

        return;
      }

      const expected = PLURAL_CATEGORIES.filter((category) => typeof (concept.en as JsonObject)[category] === 'string');

      if (parent && leaf in parent) problems.push(`${concept.web}: a plain key beside its plural forms`);
      if (presentCategories(parent, leaf).join(',') !== expected.join(',')) {
        problems.push(`${concept.web}: categories [${presentCategories(parent, leaf)}] != [${expected}]`);
      }

      expected.forEach((category) => {
        const actual = parent?.[`${leaf}_${category}`];

        if (actual !== englishFor(concept, category)) {
          problems.push(
            `${concept.web}_${category}: ${JSON.stringify(actual)} != ${JSON.stringify(englishFor(concept, category))}`
          );
        }
      });
    });
    expect(problems).toEqual([]);
  });

  it('has no dashboard. or chart. key outside the table', () => {
    const listed = new Set(webConcepts.flatMap(englishWebForms));
    const unlisted = Object.keys(flat).filter(
      (key) => SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix)) && !listed.has(key)
    );

    expect(unlisted).toEqual([]);
  });

  it('no longer has the removed web keys', () => {
    const present = manifest.removed.web.filter((key) =>
      [key, ...PLURAL_CATEGORIES.map((category) => `${key}_${category}`)].some((name) => name in flat)
    );

    expect(present).toEqual([]);
  });
});

describe.each(webLocales.map((locale) => [locale.id, locale] as const))('web locale %s', (id, locale) => {
  it('carries every dashboard concept, translated, in web syntax', () => {
    expect(localeProblems(locale)).toEqual([]);
  });

  it('takes the desktop translation of grid.row.newRow (A6)', () => {
    const file = readJson<JsonObject>(join(TRANSLATIONS_DIR, `${locale.web}.json`));
    const canonical = loadLocaleFixture(id)?.[NEW_ROW_ID];

    expect(typeof canonical).toBe('string');
    expect(getPath(file, NEW_ROW_ID.split('.'))).toBe(writer.toWebText(canonical as string));
  });
});

describe('translation fixtures (i18n/locales, i18n/glossary)', () => {
  const ids = new Set(manifest.concepts.map((concept) => concept.id));

  it.each(manifest.locales.map((locale) => locale.id))('%s has a translation for every concept', (id) => {
    const fixture = loadLocaleFixture(id);

    expect(fixture).toBeDefined();
    expect([...ids].filter((conceptId) => !(conceptId in (fixture ?? {})))).toEqual([]);
    expect(Object.keys(fixture ?? {}).filter((conceptId) => !ids.has(conceptId))).toEqual([]);
  });

  it.each(manifest.locales.map((locale) => locale.id))('%s has a glossary with the dashboard terms', (id) => {
    const glossary = loadGlossary(id);

    expect(glossary).toBeDefined();
    expect(glossary?.locale).toBe(id);
    REQUIRED_GLOSSARY_TERMS.forEach((term) => {
      expect(glossary?.terms?.[term]).toEqual(expect.stringMatching(/\S/));
    });
    expect(Array.isArray(glossary?.untranslated_ok)).toBe(true);
    expect((glossary?.untranslated_ok ?? []).filter((conceptId) => !ids.has(conceptId))).toEqual([]);
  });
});

describe('apply-dashboard-translations writer', () => {
  const concept = (id: string, en: CanonicalText, web: string | null = id): Concept => ({
    id,
    web,
    desktop: id,
    en,
    placeholders: canonicalPlaceholders(en),
    plural: isObject(en),
    source: 'en',
  });
  const tableOf = (concepts: Concept[], removed: string[] = []): Manifest => ({
    version: 1,
    concepts,
    locales: [],
    english: [],
    removed: { web: removed, desktop: [] },
  });

  it('converts canonical placeholders to web syntax', () => {
    expect(writer.toWebText('No {0}')).toBe('No {}');
    expect(writer.toWebText('{0} - {1}')).toBe('{} - {}');
    expect(writer.toWebText('{count} rows')).toBe('{{count}} rows');
    expect(writer.toWebText('{calculation} of {property}')).toBe('{{calculation}} of {{property}}');
    expect(writer.toWebText('Plain')).toBe('Plain');
  });

  it('keeps a file’s indentation and final newline, and refuses one that does not round-trip', () => {
    ['{\n  "a": {\n    "b": "c"\n  }\n}\n', '{\n    "a": "b"\n}\n', '{\n  "a": "b"\n}'].forEach((text) => {
      const { obj, format } = writer.parseLocaleFile(text, 'case');

      expect(writer.serialize(obj, format)).toBe(text);
    });
    expect(() => writer.parseLocaleFile('{\n  "a": "1",\n  "a": "2"\n}\n', 'duplicate')).toThrow('round-trip');
  });

  it('merges at the nested path, keeps the key order and appends new keys', () => {
    const root: JsonObject = { appName: 'AppFlowy', grid: { row: { newRow: 'old', other: 'kept' }, z: 'z' } };
    const table = tableOf([
      concept('grid.row.newRow', 'New page'),
      concept('chart.a11y.table', 'Chart data'),
      concept('grid.row.added', 'Added'),
    ]);
    const warnings = writer.applyTranslations(
      root,
      table,
      { 'grid.row.newRow': 'Neue Seite', 'chart.a11y.table': 'Diagrammdaten', 'grid.row.added': 'Hinzugefügt' },
      'de-DE'
    );

    expect(warnings).toEqual([]);
    expect(JSON.stringify(root)).toBe(
      JSON.stringify({
        appName: 'AppFlowy',
        grid: { row: { newRow: 'Neue Seite', other: 'kept', added: 'Hinzugefügt' }, z: 'z' },
        chart: { a11y: { table: 'Diagrammdaten' } },
      })
    );
  });

  it('writes plural concepts as sibling keys where the key was, dropping a plain key and stale categories', () => {
    const root: JsonObject = {
      chart: {
        drilldown: { a: 'a', rowCount: '{{count}} rows', b: 'b' },
        value: { days_one: 'x', days_few: 'stale', days_other: 'y', c: 'c' },
      },
    };
    const table = tableOf([
      concept('chart.drilldown.rowCount', { one: '{count} row', other: '{count} rows' }),
      concept('chart.value.days', { one: '{count} day', other: '{count} days' }),
    ]);

    writer.applyTranslations(
      root,
      table,
      {
        'chart.drilldown.rowCount': { one: '{count} ligne', many: '{count} de lignes', other: '{count} lignes' },
        'chart.value.days': { one: '{count} jour', other: '{count} jours' },
      },
      'fr-FR'
    );
    expect(JSON.stringify(root)).toBe(
      JSON.stringify({
        chart: {
          drilldown: {
            a: 'a',
            rowCount_one: '{{count}} ligne',
            rowCount_many: '{{count}} de lignes',
            rowCount_other: '{{count}} lignes',
            b: 'b',
          },
          value: { days_one: '{{count}} jour', days_other: '{{count}} jours', c: 'c' },
        },
      })
    );
  });

  it('deletes removed keys with their plural siblings and the objects they leave empty', () => {
    const root: JsonObject = {
      chart: { drilldown: { title: 'Titel', noRows_one: 'x', noRows_other: 'y' }, kept: 'k' },
      dashboard: { picker: { title: 'T', search: 'S' } },
    };

    writer.applyTranslations(
      root,
      tableOf([], ['chart.drilldown.title', 'chart.drilldown.noRows', 'dashboard.picker.title', 'dashboard.absent.key']),
      {},
      'de-DE'
    );
    expect(JSON.stringify(root)).toBe(JSON.stringify({ chart: { kept: 'k' }, dashboard: { picker: { search: 'S' } } }));
  });

  it('skips concepts without a usable translation and is idempotent', () => {
    const table = tableOf([
      concept('dashboard.a', 'A'),
      concept('dashboard.b', { one: '{count} b', other: '{count} bs' }),
      concept('dashboard.desktopOnly', 'D', null),
    ]);
    const root: JsonObject = { dashboard: { a: 'alt' } };
    const translations = { 'dashboard.b': 'not a plural object' };

    expect(writer.applyTranslations(root, table, translations, 'de-DE')).toEqual([
      'de-DE: no translation for dashboard.a',
      'de-DE: dashboard.b: a plural concept needs an object {category: text}; skipped',
    ]);
    expect(root).toEqual({ dashboard: { a: 'alt' } });

    const full = { 'dashboard.a': 'Ä', 'dashboard.b': { one: '{count} B', other: '{count} Bs' } };

    writer.applyTranslations(root, table, full, 'de-DE');
    const once = JSON.stringify(root);

    writer.applyTranslations(root, table, full, 'de-DE');
    expect(JSON.stringify(root)).toBe(once);
    expect(root).toEqual({ dashboard: { a: 'Ä', b_one: '{{count}} B', b_other: '{{count}} Bs' } });
  });
});
