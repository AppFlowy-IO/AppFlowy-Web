import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { getServerInfoSnapshot, SERVER_INFO_LOADING, subscribeToServerInfo } from '@/utils/server-info';

import { ruleCapabilities } from './model';

export function useAutomationCapabilities() {
  const { info } = useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);

  return useMemo(() => ruleCapabilities(info), [info]);
}

/** Read once when an editor opens. An unavailable policy leaves ordinary actions editable. */
export function useWebhookSetupAllowed(workspace: string, readPolicy: boolean) {
  const [allowedWorkspace, setAllowedWorkspace] = useState<string>();

  useEffect(() => {
    if (!readPolicy) return;
    const controller = new AbortController();

    setAllowedWorkspace(undefined);
    void ruleApi.workspaceWebhookPolicy(workspace, controller.signal).then(
      (policy) => {
        if (!controller.signal.aborted && policy.disable_automation_webhooks === false) setAllowedWorkspace(workspace);
      },
      () => {
        if (!controller.signal.aborted) setAllowedWorkspace(undefined);
      }
    );
    return () => controller.abort();
  }, [workspace, readPolicy]);

  return !readPolicy || allowedWorkspace === workspace;
}
