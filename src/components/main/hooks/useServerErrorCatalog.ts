import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { getErrorCatalogRevision, retainServerErrorCatalog, subscribeToErrorCatalog } from '@/application/errors/server-error-catalog';

/** Public copy can load before authentication without delaying sign-in or startup. */
export function useServerErrorCatalog(serverUrl: string): void {
  const { i18n } = useTranslation();
  // A missing UI translation bundle must not replace the user's server locale.
  const locale = i18n.language || i18n.resolvedLanguage || 'en';

  useEffect(() => retainServerErrorCatalog(serverUrl, locale), [serverUrl, locale]);
}

/** Existing error surfaces can update when the server changes its public wording. */
export function useErrorCatalogRevision(): void {
  useSyncExternalStore(subscribeToErrorCatalog, getErrorCatalogRevision, () => 0);
}
