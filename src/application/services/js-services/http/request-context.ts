import { t } from 'i18next';

import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { getAxios } from './core';

/** Capture the actual transport and actor before a permission-dependent workflow awaits. */
export function captureApiContext() {
  const client = getAxios();
  const userId = getTokenParsed()?.user?.id;
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

  return {
    client,
    serverUrl,
    userId,
    assertCurrent() {
      if (
        getAxios() !== client ||
        getTokenParsed()?.user?.id !== userId ||
        getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud') !== serverUrl
      ) {
        throw new Error(t('workspaceCreation.contextChanged'));
      }
    },
  };
}
