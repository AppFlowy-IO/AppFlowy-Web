import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { toIntlLocale } from './intl-locale';

export { FALLBACK_INTL_LOCALE, INTL_LOCALE_ALIASES, toIntlLocale } from './intl-locale';

/** The part of the i18next instance the hook reads (test doubles may lack the events). */
type LanguageSource = {
  language?: string;
  on?: (event: 'languageChanged', listener: () => void) => unknown;
  off?: (event: 'languageChanged', listener: () => void) => unknown;
};

/**
 * The app locale for formatting: `toIntlLocale(i18n.language)`. It renders
 * again when the language changes and keeps its value (a string) while the
 * language is the same, so memo dependencies on it stay stable.
 */
export function useAppLocale(): string {
  const { i18n } = useTranslation();
  const source = i18n as LanguageSource | undefined;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!source?.on || !source.off) return () => undefined;
      source.on('languageChanged', onChange);
      return () => {
        source.off?.('languageChanged', onChange);
      };
    },
    [source]
  );
  const readLanguage = () => source?.language ?? '';
  const language = useSyncExternalStore(subscribe, readLanguage, readLanguage);

  return useMemo(() => toIntlLocale(language), [language]);
}

export default useAppLocale;
