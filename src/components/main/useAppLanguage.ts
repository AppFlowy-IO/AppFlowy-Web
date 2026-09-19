import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useAppLanguage(savedLanguage?: string) {
  const { i18n } = useTranslation();
  const preferredLanguage = savedLanguage?.trim();

  useEffect(() => {
    const detectLanguageChange = () => {
      const language = preferredLanguage || window.navigator.language;

      if (i18n.language !== language) void i18n.changeLanguage(language);
    };

    detectLanguageChange();
    // Browser changes only apply when the user has no explicit preference.
    if (preferredLanguage) return;

    window.addEventListener('languagechange', detectLanguageChange);
    return () => {
      window.removeEventListener('languagechange', detectLanguageChange);
    };
  }, [i18n, preferredLanguage]);
}
