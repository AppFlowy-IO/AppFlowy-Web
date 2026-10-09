#!/usr/bin/env node
/**
 * Writes the dashboard translations of the shared canonical table into the web
 * locale files (WP14c-I18N).
 *
 *   pnpm i18n:dashboard                 apply every locale
 *   node scripts/i18n/apply-dashboard-translations.cjs --check [<locale id>...]
 *
 * Reads   src/application/database-yjs/__fixtures__/dashboard-parity/i18n/manifest.json
 *         and i18n/locales/<id>.json (canonical placeholders: named {name}, positional {0}).
 * Writes  src/@types/translations/<web stem>.json for every manifest locale with a web stem.
 *         Never en.json: English is written by the lanes that add the strings, and the
 *         completeness test checks it against manifest `en`.
 *
 * For every concept with a web path the value is merged at that nested path:
 *   - an existing key keeps its place; a new key goes at the end of its object;
 *   - a plural concept becomes sibling keys `<key>_<category>` (i18next JSON v4), written
 *     where the key's first existing form was; a plain key at the same path and categories
 *     the translation no longer has are deleted;
 *   - named placeholders become `{{name}}`, positional ones `{}`.
 * Then every `removed.web` key (and its plural siblings) is deleted.
 *
 * Each file keeps its own JSON indentation and final newline (most files are a 2-space
 * dump plus "\n"; a few differ), and a file that does not round-trip byte for byte through
 * JSON.parse/JSON.stringify is refused rather than reformatted. A locale whose translation
 * file does not exist yet is skipped with a warning. Running it twice changes nothing.
 * `--check` writes nothing and exits 1 when a write would change a file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const I18N_DIR = path.join(ROOT, 'src/application/database-yjs/__fixtures__/dashboard-parity/i18n');
const WEB_TRANSLATIONS_DIR = path.join(ROOT, 'src/@types/translations');
const ENGLISH_WEB_STEM = 'en';
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical placeholders to i18next syntax: `{name}` -> `{{name}}`, `{0}` -> `{}`. */
function toWebText(text) {
  return text.replace(/\{(\w+)\}/g, (_, name) => (/^\d+$/.test(name) ? '{}' : `{{${name}}}`));
}

/** The JSON layout of a file: its indentation unit and whether it ends with a newline. */
function detectFormat(text) {
  const match = /^\{\r?\n([ \t]+)\S/.exec(text);

  return { indent: match ? match[1] : '  ', finalNewline: text.endsWith('\n') };
}

function serialize(obj, format) {
  return JSON.stringify(obj, null, format.indent) + (format.finalNewline ? '\n' : '');
}

/** Parses a locale file, refusing one that would not be rewritten byte for byte. */
function parseLocaleFile(text, label) {
  const format = detectFormat(text);
  const obj = JSON.parse(text);

  if (!isRecord(obj)) throw new Error(`${label}: the root is not a JSON object`);
  if (serialize(obj, format) !== text) {
    throw new Error(
      `${label}: does not round-trip through JSON.parse/JSON.stringify (duplicate keys, integer-like keys or ` +
        'mixed indentation); fix the file by hand first'
    );
  }

  return { obj, format };
}

/**
 * Sets the keys of one concept group in `parent` (mutates it). The group is `leaf` and
 * every `leaf_<category>`; it is replaced by `entries` ([key, text] pairs). The first
 * existing group key marks where the entries go (existing keys of the group keep their
 * order, new ones follow them); without one they are appended. Every other key keeps its
 * place.
 */
function replaceGroup(parent, leaf, entries) {
  const groupKeys = new Set([leaf, ...PLURAL_CATEGORIES.map((category) => `${leaf}_${category}`)]);
  const next = new Map(entries);
  const existing = Object.keys(parent).filter((key) => groupKeys.has(key));
  const ordered = [
    ...existing.filter((key) => next.has(key)),
    ...entries.map(([key]) => key).filter((key) => !existing.includes(key)),
  ];
  const result = {};
  const place = () => ordered.forEach((groupKey) => (result[groupKey] = next.get(groupKey)));
  let placed = false;

  Object.keys(parent).forEach((key) => {
    if (!groupKeys.has(key)) {
      result[key] = parent[key];
    } else if (!placed) {
      placed = true;
      place();
    }
  });
  if (!placed) place();
  if (JSON.stringify(result) === JSON.stringify(parent)) return;
  Object.keys(parent).forEach((key) => delete parent[key]);
  Object.assign(parent, result);
}

/** The object at `segments` under `root`, created (at the end of each parent) when missing. */
function ensureObject(root, segments, label) {
  let node = root;

  segments.forEach((segment, index) => {
    if (node[segment] === undefined) node[segment] = {};
    if (!isRecord(node[segment])) {
      throw new Error(`${label}: ${segments.slice(0, index + 1).join('.')} is not an object`);
    }

    node = node[segment];
  });
  return node;
}

function setConcept(root, concept, value, label) {
  const segments = concept.web.split('.');
  const leaf = segments.pop();
  const parent = ensureObject(root, segments, label);

  if (isRecord(parent[leaf])) {
    throw new Error(`${label}: ${concept.web} is an object, expected a string`);
  }

  const entries = concept.plural
    ? PLURAL_CATEGORIES.filter((category) => typeof value[category] === 'string').map((category) => [
        `${leaf}_${category}`,
        toWebText(value[category]),
      ])
    : [[leaf, toWebText(value)]];

  replaceGroup(parent, leaf, entries);
}

/** Deletes a removed key and its plural siblings, then any object it left empty. */
function removeKey(root, keyPath) {
  const segments = keyPath.split('.');
  const leaf = segments.pop();
  const chain = [root];

  for (const segment of segments) {
    const node = chain[chain.length - 1][segment];

    if (!isRecord(node)) return;
    chain.push(node);
  }

  const parent = chain[chain.length - 1];
  let removed = false;

  [leaf, ...PLURAL_CATEGORIES.map((category) => `${leaf}_${category}`)].forEach((key) => {
    if (key in parent) {
      delete parent[key];
      removed = true;
    }
  });
  if (!removed) return;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (Object.keys(chain[index + 1]).length > 0) break;
    delete chain[index][segments[index]];
  }
}

function describeValue(concept, value) {
  if (concept.plural) {
    if (!isRecord(value)) return 'a plural concept needs an object {category: text}';
    const categories = Object.keys(value);

    if (categories.length === 0) return 'the plural object is empty';
    const unknown = categories.filter((category) => !PLURAL_CATEGORIES.includes(category));

    if (unknown.length > 0) return `unknown plural categories ${unknown.join(', ')}`;
    if (categories.some((category) => typeof value[category] !== 'string')) return 'a plural text is not a string';
    return null;
  }

  return typeof value === 'string' ? null : 'needs a string';
}

/**
 * Applies one locale's translations to a parsed web locale object (mutates it).
 * Returns the warnings (concepts without a usable translation).
 */
function applyTranslations(root, manifest, translations, label) {
  const warnings = [];

  manifest.concepts.forEach((concept) => {
    if (!concept.web) return;
    if (!(concept.id in translations)) {
      warnings.push(`${label}: no translation for ${concept.id}`);
      return;
    }

    const value = translations[concept.id];
    const problem = describeValue(concept, value);

    if (problem) {
      warnings.push(`${label}: ${concept.id}: ${problem}; skipped`);
      return;
    }

    setConcept(root, concept, value, label);
  });
  (manifest.removed.web || []).forEach((keyPath) => removeKey(root, keyPath));
  return warnings;
}

/** The new text of one web locale file, or `null` when its translation file is missing. */
function renderLocale(manifest, locale, { i18nDir = I18N_DIR, webDir = WEB_TRANSLATIONS_DIR } = {}) {
  if (locale.web === ENGLISH_WEB_STEM) throw new Error('the dashboard writer never writes en.json');
  const translationsPath = path.join(i18nDir, 'locales', `${locale.id}.json`);
  const webPath = path.join(webDir, `${locale.web}.json`);

  if (!fs.existsSync(translationsPath)) {
    return { skipped: `${locale.id}: ${path.relative(ROOT, translationsPath)} does not exist yet; skipped` };
  }

  if (!fs.existsSync(webPath)) {
    return { skipped: `${locale.id}: ${path.relative(ROOT, webPath)} does not exist; skipped` };
  }

  const original = fs.readFileSync(webPath, 'utf8');
  const { obj, format } = parseLocaleFile(original, locale.web);
  const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
  const warnings = applyTranslations(obj, manifest, translations, locale.id);
  const text = serialize(obj, format);

  return { webPath, original, text, warnings };
}

function main(argv) {
  const check = argv.includes('--check');
  const only = argv.filter((arg) => !arg.startsWith('--'));
  const manifest = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'manifest.json'), 'utf8'));
  const locales = manifest.locales.filter((locale) => locale.web && (only.length === 0 || only.includes(locale.id)));
  const unknown = only.filter((id) => !manifest.locales.some((locale) => locale.id === id && locale.web));

  if (unknown.length > 0) {
    console.error(`unknown or desktop-only locale ids: ${unknown.join(', ')}`);
    return 2;
  }

  const changed = [];
  let skipped = 0;
  let warningCount = 0;

  locales.forEach((locale) => {
    const result = renderLocale(manifest, locale);

    if (result.skipped) {
      console.warn(`warning: ${result.skipped}`);
      skipped += 1;
      return;
    }

    result.warnings.slice(0, 5).forEach((warning) => console.warn(`warning: ${warning}`));
    if (result.warnings.length > 5) console.warn(`warning: ${locale.id}: ${result.warnings.length - 5} more`);
    warningCount += result.warnings.length;
    if (result.text === result.original) return;
    changed.push(locale.web);
    if (!check) fs.writeFileSync(result.webPath, result.text, 'utf8');
  });

  const applied = locales.length - skipped;

  if (check) {
    if (changed.length > 0) {
      console.error(`${changed.length} web locale file(s) are out of date: ${changed.join(', ')}`);
      console.error('run `pnpm i18n:dashboard`');
    } else {
      console.log(`${applied} web locale file(s) up to date (${skipped} skipped, ${warningCount} warnings)`);
    }

    return changed.length > 0 ? 1 : 0;
  }

  console.log(
    `wrote ${changed.length} of ${applied} web locale file(s)` +
      `${changed.length ? `: ${changed.join(', ')}` : ''} (${skipped} skipped, ${warningCount} warnings)`
  );
  return 0;
}

module.exports = {
  PLURAL_CATEGORIES,
  applyTranslations,
  detectFormat,
  parseLocaleFile,
  renderLocale,
  serialize,
  toWebText,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
