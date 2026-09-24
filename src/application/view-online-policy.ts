import i18next from 'i18next';

import { ViewLayout } from '@/application/types';

const ONLINE_VIEW_CREATION_REQUIRED = 'Connect to the internet to create Form or Chart views.';

export function onlineViewCreationRequiredError(): Error {
  return new Error(
    i18next.t('databaseViewCreation.onlineRequired', { defaultValue: ONLINE_VIEW_CREATION_REQUIRED }) ||
      ONLINE_VIEW_CREATION_REQUIRED
  );
}

/** An online browser still has to await the server request; this is only an early offline error. */
export function assertViewCreationOnline(layout: ViewLayout): void {
  if (
    (layout === ViewLayout.Form || layout === ViewLayout.Chart) &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    throw onlineViewCreationRequiredError();
  }
}
