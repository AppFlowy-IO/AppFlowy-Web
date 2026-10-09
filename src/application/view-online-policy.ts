import i18next from 'i18next';

import { ViewLayout } from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';

const ONLINE_VIEW_CREATION_REQUIRED = 'Connect to the internet to create Form or Chart views.';

export const ONLINE_DASHBOARD_VIEW_CREATION_REQUIRED = 'Connect to the internet to create dashboard widget views.';

/** Owned views must be admitted by the server in every hosting mode. */
export function assertDashboardViewCreationOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      i18next.t('databaseViewCreation.dashboardOnlineRequired', {
        defaultValue: ONLINE_DASHBOARD_VIEW_CREATION_REQUIRED,
      }) || ONLINE_DASHBOARD_VIEW_CREATION_REQUIRED
    );
  }
}

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
