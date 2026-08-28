import i18next, { i18n } from 'i18next';

import en from '@/@types/translations/en.json';

/**
 * `ImportDialog` reports counts through i18next plurals. Those only resolve when the option is
 * named `count` — pass `total` and i18next quietly hands back the raw key instead of a sentence.
 * The component tests stub `t`, so this is the only place that check happens against real
 * i18next and the real `en.json`.
 */
async function createI18n(lng: string): Promise<i18n> {
  const instance = i18next.createInstance();

  await instance.init({
    lng,
    fallbackLng: 'en',
    resources: { en: { translation: en } },
  });

  return instance;
}

describe('import panel count strings', () => {
  let t: i18n['t'];

  beforeAll(async () => {
    t = (await createI18n('en')).t;
  });

  it('resolves the batch success count as a sentence, not the key', () => {
    expect(t('importPanel.successCount', { count: 3 })).toBe('Imported 3 files');
    expect(t('importPanel.successCount', { count: 1 })).toBe('Imported 1 file');
  });

  it('resolves the partial success count', () => {
    expect(t('importPanel.partialSuccess', { success: 2, count: 5 })).toBe('Imported 2 of 5 files');
  });

  it('inflects the failure overflow marker', () => {
    expect(t('importPanel.failedFilesOverflow', { names: 'a.csv, b.csv, c.csv', count: 1 })).toBe(
      'Could not import: a.csv, b.csv, c.csv and 1 more'
    );
    expect(t('importPanel.failedFilesOverflow', { names: 'a.csv, b.csv, c.csv', count: 4 })).toBe(
      'Could not import: a.csv, b.csv, c.csv and 4 more'
    );
  });

  it('leaves file names and server messages unescaped', () => {
    // i18next HTML-escapes interpolations by default; a toast is plain text, so `Q1&Q2.csv`
    // must not arrive as `Q1&amp;Q2.csv`.
    expect(
      t('importPanel.failedFile', {
        name: 'Q1&Q2.csv',
        reason: 'quote & escape mismatch',
        interpolation: { escapeValue: false },
      })
    ).toBe('Could not import Q1&Q2.csv: quote & escape mismatch');
  });

  it('announces progress with words rather than a bare ratio', () => {
    expect(t('importPanel.importingProgress', { current: 2, total: 7 })).toBe('Importing file 2 of 7');
  });

  it('picks a locale-specific plural form where one exists', async () => {
    // English lumps every count above one into `_other`; Czech splits 2-4 out into `_few`, which
    // a single hardcoded "{{n}} files" string can never get right. Only `en` is loaded here, so
    // this asserts the plural *category* resolution — the part that stops working the moment the
    // interpolation is called anything other than `count`.
    const cs = await createI18n('cs');

    expect(cs.services.pluralResolver.getSuffix('cs', 1)).toBe('_one');
    expect(cs.services.pluralResolver.getSuffix('cs', 3)).toBe('_few');
    expect(cs.services.pluralResolver.getSuffix('cs', 8)).toBe('_other');
  });
});
