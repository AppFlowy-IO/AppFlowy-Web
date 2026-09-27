import i18next from 'i18next';

import { ViewLayout } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';

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
    getWorkspacePlanPolicy().requiresOnlineViewCreation(layout) &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    throw onlineViewCreationRequiredError();
  }
}
