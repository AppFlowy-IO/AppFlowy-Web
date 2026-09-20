import { act, renderHook } from '@testing-library/react';
import i18next, { BackendModule, ReadCallback } from 'i18next';
import { ReactNode, StrictMode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { useAppLanguage } from '../useAppLanguage';

describe('useAppLanguage', () => {
  let i18n: ReturnType<typeof i18next.createInstance>;
  let pending: Map<string, ReadCallback>;
  let browserLanguage: jest.SpyInstance;

  function wrapper({ children }: { children: ReactNode }) {
    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
  }

  function renderLanguage(language?: string) {
    return renderHook(({ language: preference }) => useAppLanguage(preference), {
      initialProps: { language },
      wrapper,
    });
  }

  async function finishLoading(language: string, error?: Error) {
    const callback = pending.get(language);

    expect(callback).toBeDefined();
    pending.delete(language);
    await act(async () => callback!(error ?? null, error ? false : { title: language }));
  }

  beforeEach(async () => {
    pending = new Map();

    const backend: BackendModule = {
      type: 'backend',
      init: () => undefined,
      read(language, _namespace, callback) {
        pending.set(language, callback);
      },
    };

    i18n = i18next.createInstance();
    await i18n.use(backend).init({
      lng: 'en',
      fallbackLng: 'en',
      load: 'currentOnly',
      partialBundledLanguages: true,
      resources: { en: { translation: { title: 'English' } } },
    });
    browserLanguage = jest.spyOn(window.navigator, 'language', 'get').mockReturnValue('de-DE');
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses the profile preference on startup and ignores browser changes', async () => {
    renderLanguage('fr-FR');
    await finishLoading('fr-FR');

    expect(i18n.language).toBe('fr-FR');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    expect(pending.size).toBe(0);
    expect(i18n.language).toBe('fr-FR');
  });

  it('applies a preference when the profile arrives and follows later account changes', async () => {
    const { rerender } = renderLanguage();

    await finishLoading('de-DE');
    expect(i18n.language).toBe('de-DE');
    rerender({ language: 'ja-JP' });
    await finishLoading('ja-JP');
    expect(i18n.language).toBe('ja-JP');
    rerender({ language: 'fr-FR' });
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('fr-FR');
    rerender({ language: undefined });
    expect(i18n.language).toBe('de-DE');
    expect(pending.size).toBe(0);
  });

  it('follows browser changes only while mounted without a preference', async () => {
    const { unmount } = renderLanguage();

    await finishLoading('de-DE');
    browserLanguage.mockReturnValue('es-VE');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    await finishLoading('es-VE');
    expect(i18n.language).toBe('es-VE');
    unmount();
    browserLanguage.mockReturnValue('fr-FR');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    expect(pending.size).toBe(0);
    expect(i18n.language).toBe('es-VE');
  });

  it('applies the saved language without waiting for an older browser-language download', async () => {
    const { rerender } = renderLanguage();
    const onLanguageChanged = jest.fn();

    i18n.on('languageChanged', onLanguageChanged);
    rerender({ language: 'fr-FR' });
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('fr-FR');
    await finishLoading('de-DE');
    expect(i18n.language).toBe('fr-FR');
    expect(onLanguageChanged.mock.calls).toEqual([['fr-FR']]);
  });

  it('does not activate an obsolete language even when its download finishes first', async () => {
    const { rerender } = renderLanguage('fr-FR');

    rerender({ language: 'ja-JP' });
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('en');
    await finishLoading('ja-JP');
    expect(i18n.language).toBe('ja-JP');
  });

  it('invalidates a pending download when the preference matches the active language', async () => {
    const { rerender } = renderLanguage();

    rerender({ language: 'en' });
    await finishLoading('de-DE');
    expect(i18n.language).toBe('en');
  });

  it('keeps the latest browser language when downloads finish out of order', async () => {
    renderLanguage();
    browserLanguage.mockReturnValue('es-VE');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    await finishLoading('es-VE');
    expect(i18n.language).toBe('es-VE');
    await finishLoading('de-DE');
    expect(i18n.language).toBe('es-VE');
  });

  it('discards a pending profile language when the preference is removed', async () => {
    const { rerender } = renderLanguage('fr-FR');

    rerender({ language: undefined });
    await finishLoading('de-DE');
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('de-DE');
  });

  it('waits for a shared download when switching back to a pending language', async () => {
    const { rerender } = renderLanguage('fr-FR');

    rerender({ language: 'ja-JP' });
    rerender({ language: 'fr-FR' });
    expect(i18n.language).toBe('en');
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('fr-FR');
    await finishLoading('ja-JP');
    expect(i18n.language).toBe('fr-FR');
  });

  it.each([undefined, 'fr-FR'])('discards a pending language after unmount (preference: %s)', async (preference) => {
    const { unmount } = renderLanguage(preference);

    unmount();
    await finishLoading(preference || 'de-DE');
    expect(i18n.language).toBe('en');
  });

  it('only activates the current request during Strict Mode effect replay', async () => {
    const onLanguageChanged = jest.fn();

    i18n.on('languageChanged', onLanguageChanged);
    renderHook(() => useAppLanguage('fr-FR'), {
      wrapper: ({ children }) => <StrictMode>{wrapper({ children })}</StrictMode>,
    });
    expect(i18n.language).toBe('en');
    await finishLoading('fr-FR');
    expect(onLanguageChanged.mock.calls).toEqual([['fr-FR']]);
  });

  it('yields to a newer language change from Settings while downloading', async () => {
    renderLanguage();
    void act(() => {
      void i18n.changeLanguage('ja-JP');
    });
    await finishLoading('de-DE');
    expect(i18n.language).toBe('en');
    await finishLoading('ja-JP');
    expect(i18n.language).toBe('ja-JP');
  });

  it('loads the language hierarchy before activation without waiting for obsolete downloads', async () => {
    i18n.options.load = 'all';

    const { rerender } = renderLanguage();

    rerender({ language: 'fr-FR' });
    await finishLoading('fr-FR');
    expect(i18n.language).toBe('en');
    await finishLoading('fr', new Error('No base-language translation'));
    expect(i18n.language).toBe('fr-FR');
    await finishLoading('de-DE');
    await finishLoading('de', new Error('No base-language translation'));
    expect(i18n.language).toBe('fr-FR');
  });

  it('preserves the English fallback when the preferred translation cannot be loaded', async () => {
    renderLanguage('fr-FR');
    await finishLoading('fr-FR', new Error('Translation unavailable'));
    expect(i18n.language).toBe('fr-FR');
    expect(i18n.resolvedLanguage).toBe('en');
  });
});
