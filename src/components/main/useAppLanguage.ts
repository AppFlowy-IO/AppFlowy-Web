import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useAppLanguage(savedLanguage?: string) {
  const { i18n } = useTranslation();
  const preferredLanguage = savedLanguage?.trim();

  useEffect(() => {
    let requestId = 0;
    const invalidatePendingChange = () => {
      requestId += 1;
    };

    const detectLanguageChange = () => {
      const language = preferredLanguage || window.navigator.language;
      const currentRequest = ++requestId;

      if (i18n.language === language) return;

      // Loading must not activate a language: an older download may finish last.
      // Target this language's resources without accumulating unrelated preloads.
      i18n.loadResources(language, () => {
        if (currentRequest !== requestId) return;
        void i18n.changeLanguage(language);
      });
    };

    // A newer choice in Settings supersedes any pending automatic change.
    i18n.on('languageChanging', invalidatePendingChange);
    detectLanguageChange();
    // Browser changes only apply when the user has no explicit preference.
    if (!preferredLanguage) window.addEventListener('languagechange', detectLanguageChange);

    return () => {
      invalidatePendingChange();
      i18n.off('languageChanging', invalidatePendingChange);
      window.removeEventListener('languagechange', detectLanguageChange);
    };
  }, [i18n, preferredLanguage]);
}
