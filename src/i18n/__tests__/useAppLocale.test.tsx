import { act, render, renderHook, screen } from '@testing-library/react';
import i18next, { i18n as I18n } from 'i18next';
import { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { FALLBACK_INTL_LOCALE, toIntlLocale, useAppLocale } from '../useAppLocale';

async function createI18n(language: string): Promise<I18n> {
  const instance = i18next.createInstance();

  await instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources: { en: { translation: {} }, 'ja-JP': { translation: {} }, hin: { translation: {} } },
    interpolation: { escapeValue: false },
    // `useTranslation` itself does not re-render on a language change here, so the tests see
    // `useAppLocale`'s own `languageChanged` subscription.
    react: { bindI18n: '' },
  });
  return instance;
}

function wrapperOf(instance: I18n) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
  };
}

describe('toIntlLocale', () => {
  it.each([
    ['en', 'en-US'],
    ['hin', 'hi'],
    ['zh', 'zh-CN'],
    ['pt', 'pt-BR'],
    ['zh-CN', 'zh-CN'],
    ['zh_TW', 'zh-TW'],
    ['ja-JP', 'ja-JP'],
    ['de-DE', 'de-DE'],
    ['fr-FR', 'fr-FR'],
    ['xx', 'en-US'],
    ['qaa-ZZ', 'en-US'],
    ['not a locale', 'en-US'],
    ['', 'en-US'],
  ])('%p → %p', (language, expected) => {
    expect(toIntlLocale(language)).toBe(expected);
  });

  it('falls back to en-US', () => {
    expect(FALLBACK_INTL_LOCALE).toBe('en-US');
    expect(toIntlLocale(undefined)).toBe(FALLBACK_INTL_LOCALE);
    expect(toIntlLocale(null)).toBe(FALLBACK_INTL_LOCALE);
  });

  it('never changes the default locale of Intl', () => {
    const before = new Intl.DateTimeFormat().resolvedOptions().locale;

    toIntlLocale('ja-JP');
    toIntlLocale('hin');
    expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe(before);
  });
});

describe('useAppLocale', () => {
  it('maps the app language', async () => {
    const instance = await createI18n('en');
    const { result } = renderHook(() => useAppLocale(), { wrapper: wrapperOf(instance) });

    expect(result.current).toBe('en-US');
  });

  it('renders again with the new locale when the language changes', async () => {
    const instance = await createI18n('en');
    let renders = 0;

    function Probe() {
      renders += 1;
      return <span data-testid='locale'>{useAppLocale()}</span>;
    }

    render(
      <I18nextProvider i18n={instance}>
        <Probe />
      </I18nextProvider>
    );
    expect(screen.getByTestId('locale').textContent).toBe('en-US');

    await act(async () => {
      await instance.changeLanguage('ja-JP');
    });
    expect(screen.getByTestId('locale').textContent).toBe('ja-JP');

    await act(async () => {
      await instance.changeLanguage('hin');
    });
    expect(screen.getByTestId('locale').textContent).toBe('hi');

    // Setting the same language again does not change the locale.
    const settled = renders;

    await act(async () => {
      await instance.changeLanguage('hin');
    });
    expect(screen.getByTestId('locale').textContent).toBe('hi');
    expect(renders - settled).toBeLessThanOrEqual(1);
  });

  it('keeps its value while the language is the same', async () => {
    const instance = await createI18n('ja-JP');
    const { result, rerender } = renderHook(() => useAppLocale(), { wrapper: wrapperOf(instance) });
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
    expect(first).toBe('ja-JP');
  });
});
