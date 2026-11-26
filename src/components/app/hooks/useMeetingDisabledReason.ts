import { useTranslation } from 'react-i18next';

import { useServerInfoState } from './useServerInfo';

/** Meetings require an explicit server opt-in as well as server-backed AI. */
export function useMeetingDisabledReason(): string | undefined {
  const { info } = useServerInfoState();
  const { t } = useTranslation();

  if (info?.enable_meeting === true && info.ai_enabled !== false) return undefined;
  return `${t('userError.FEATURE_UNAVAILABLE')} ${t('landingPage.error.contactAdministrator')}`;
}
