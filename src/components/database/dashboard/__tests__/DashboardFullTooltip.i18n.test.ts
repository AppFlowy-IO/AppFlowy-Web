import { readFileSync } from 'fs';
import { join } from 'path';

import i18next, { i18n } from 'i18next';

import en from '@/@types/translations/en.json';
import { DASHBOARD_MAX_WIDGETS_PER_ROW } from '@/application/database-yjs/dashboard.type';

import { dashboardFullAnnouncement, dashboardRowLimitAnnouncement } from '../DashboardFullTooltip';

/**
 * The limit refusals against real i18next and the shipped `en.json`. The
 * component tests stub `t` with each call's `defaultValue`, so a renamed or
 * missing key, or a `{{count}}` that no longer interpolates, would pass there.
 * The BDD features of both clients assert these exact sentences.
 */
interface ManifestConcept {
  id: string;
  en: string;
}

const MANIFEST = join(__dirname, '../../../../application/database-yjs/__fixtures__/dashboard-parity/i18n/manifest.json');

function canonicalEnglish(id: string): string {
  const { concepts } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { concepts: ManifestConcept[] };
  const concept = concepts.find((entry) => entry.id === id);

  if (!concept) throw new Error(`The shared translation table has no "${id}"`);
  return concept.en;
}

describe('dashboard limit texts with the shipped English translations', () => {
  let t: i18n['t'];

  beforeAll(async () => {
    const instance = i18next.createInstance();

    await instance.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } } });
    t = instance.t;
  });

  it('announces a full dashboard with the two tooltip lines', () => {
    expect(dashboardFullAnnouncement(t)).toBe('Dashboard is full. Delete a view to add a new one.');
  });

  it('announces a full row with the shared row limit', () => {
    expect(DASHBOARD_MAX_WIDGETS_PER_ROW).toBe(4);
    expect(dashboardRowLimitAnnouncement(t)).toBe('A row holds up to 4 widgets.');
  });

  it('reads the keys of the shared translation table, so desktop says the same', () => {
    expect(t('dashboard.limit.fullTitle')).toBe(canonicalEnglish('dashboard.limit.fullTitle'));
    expect(t('dashboard.limit.fullHint')).toBe(canonicalEnglish('dashboard.limit.fullHint'));
    expect(t('dashboard.rowLimit', { count: DASHBOARD_MAX_WIDGETS_PER_ROW })).toBe(
      canonicalEnglish('dashboard.rowLimit').replace('{count}', String(DASHBOARD_MAX_WIDGETS_PER_ROW))
    );
  });
});
