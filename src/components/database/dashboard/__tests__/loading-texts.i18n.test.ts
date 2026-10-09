import { readFileSync } from 'fs';
import { join } from 'path';

import i18next, { i18n } from 'i18next';

import en from '@/@types/translations/en.json';

/**
 * The loading texts the BDD of both clients assert word for word
 * (`dashboard-loading-edge.feature`, `dashboard-widgets.feature`), against
 * real i18next, the shipped `en.json` and the shared translation table. The
 * component tests stub `t` with each call's `defaultValue`, so a renamed or
 * missing key would pass there and only show as a key on screen.
 */
interface ManifestConcept {
  id: string;
  web: string | null;
  desktop: string | null;
  en: string;
}

const MANIFEST = join(
  __dirname,
  '../../../../application/database-yjs/__fixtures__/dashboard-parity/i18n/manifest.json'
);

function concept(id: string): ManifestConcept {
  const { concepts } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { concepts: ManifestConcept[] };
  const found = concepts.find((entry) => entry.id === id);

  if (!found) throw new Error(`The shared translation table has no "${id}"`);
  return found;
}

describe('dashboard loading texts with the shipped English translations', () => {
  let t: i18n['t'];

  beforeAll(async () => {
    const instance = i18next.createInstance();

    await instance.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } } });
    t = instance.t;
  });

  it('counts the rows read so far in the loading row: "Loading rows… N/M"', () => {
    expect(t('grid.row.loadingRowsProgress', { loaded: 256, total: 603 })).toBe('Loading rows… 256/603');
    expect(concept('grid.row.loadingRowsProgress')).toMatchObject({
      web: 'grid.row.loadingRowsProgress',
      desktop: 'grid.row.loadingRowsProgress',
    });
  });

  it.each([
    ['dashboard.widget.loading', 'Loading…'],
    ['dashboard.widget.notFound', 'This view no longer exists'],
    ['dashboard.widget.noAccess', "You don't have access to this database"],
    ['dashboard.widget.offline', "Available when you're back online"],
    ['dashboard.historyPreviewUnavailable', 'Dashboards are not previewed in version history.'],
    ['chart.state.noData', 'No data'],
    ['chart.state.retry', 'Retry'],
  ])('says %s as "%s", the same key on both clients', (key, english) => {
    expect(t(key)).toBe(english);
    expect(concept(key)).toMatchObject({ web: key, desktop: key, en: english });
  });

  // Fix B3 (LOADING-DESIGN R8): a real failure says so, with a retry, in the
  // words desktop shows already (`grid.row.rowsNotLoadedYet`).
  it('says a failed row load as "Some rows haven\'t loaded yet", the key desktop uses', () => {
    expect(concept('grid.row.rowsNotLoadedYet')).toMatchObject({
      web: 'grid.row.rowsNotLoadedYet',
      desktop: 'grid.row.rowsNotLoadedYet',
      en: "Some rows haven't loaded yet",
    });
    expect(t('grid.row.rowsNotLoadedYet')).toBe("Some rows haven't loaded yet");
  });
});
