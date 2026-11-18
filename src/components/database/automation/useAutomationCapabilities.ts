import { useMemo, useSyncExternalStore } from 'react';

import { getServerInfoSnapshot, SERVER_INFO_LOADING, subscribeToServerInfo } from '@/utils/server-info';

import { ruleCapabilities } from './model';

export function useAutomationCapabilities() {
  const { info } = useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);

  return useMemo(() => ruleCapabilities(info), [info]);
}
