import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { getErrorCatalogRevision, retainServerErrorCatalog, subscribeToErrorCatalog } from '@/application/errors/server-error-catalog';

/** Public copy can load before authentication without delaying sign-in or startup. */
export function useServerErrorCatalog(serverUrl: string): void {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  useEffect(() => retainServerErrorCatalog(serverUrl, locale), [serverUrl, locale]);
}

/** Existing error surfaces can update when the server changes its public wording. */
export function useErrorCatalogRevision(): void {
  useSyncExternalStore(subscribeToErrorCatalog, getErrorCatalogRevision, () => 0);
}
