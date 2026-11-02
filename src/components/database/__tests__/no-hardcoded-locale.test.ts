/**
 * Charts and dashboards format with the app locale (WP14 §1.6.6): R-FORMAT
 * and the chart date labels get `useAppLocale()`, and the fallback locale
 * lives only in `src/i18n/intl-locale.ts`. This guard keeps a literal
 * `'en-US'` out of the chart and dashboard sources (tests may pin it).
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

const DATABASE_DIR = join(__dirname, '..');
const SCANNED = ['chart', 'dashboard'];
const SOURCE = /\.(ts|tsx)$/;
const TEST = /(^|\/)(__tests__|__mocks__|__fixtures__)\/|\.test\.(ts|tsx)$/;
const LITERAL = /(['"`])en-US\1/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return sources(path);
    return entry.isFile() && SOURCE.test(entry.name) ? [path] : [];
  });
}

const files = SCANNED.flatMap((name) => sources(join(DATABASE_DIR, name)))
  .map((path) => relative(DATABASE_DIR, path).split(sep).join('/'))
  .filter((path) => !TEST.test(path));

describe('no hard-coded locale in chart and dashboard sources', () => {
  it('scans the chart and dashboard sources', () => {
    expect(files).toContain('chart/useChartContext.ts');
    expect(files).toContain('chart/hooks/useChartFormatter.ts');
    expect(files.some((path) => path.startsWith('dashboard/'))).toBe(true);
    expect(files.some((path) => TEST.test(path))).toBe(false);
  });

  it('finds no en-US literal', () => {
    const offenders = files.flatMap((path) =>
      readFileSync(join(DATABASE_DIR, path), 'utf8')
        .split('\n')
        .flatMap((line, index) => (LITERAL.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : []))
    );

    expect(offenders).toEqual([]);
  });

  it('recognizes every quote style', () => {
    expect(LITERAL.test("locale: 'en-US'")).toBe(true);
    expect(LITERAL.test('locale: "en-US"')).toBe(true);
    expect(LITERAL.test('locale: `en-US`')).toBe(true);
    expect(LITERAL.test("locale: 'en-USD'")).toBe(false);
    expect(LITERAL.test('// en-US')).toBe(false);
  });
});
