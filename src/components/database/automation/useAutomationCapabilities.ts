import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { configuredServerUrl, getServerInfoSnapshot, SERVER_INFO_LOADING, subscribeToServerInfo } from '@/utils/server-info';

import { ruleCapabilities, type Capabilities } from './model';

export function useAutomationCapabilities() {
  const { info, status } = useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);

  return useMemo(
    () => ({ ...ruleCapabilities(info), temporarilyUnavailable: status === 'loading' || status === 'unavailable' }),
    [info, status]
  );
}

// Keep an already open form mounted across a transient server-info refresh.
export function useEditorCapabilities() {
  const current = useAutomationCapabilities();
  const server = configuredServerUrl();
  const previous = useRef<{ server: string; caps: Capabilities }>();
  const waiting = current.temporarilyUnavailable;

  useEffect(() => {
    if (!waiting) previous.current = { server, caps: current };
  }, [waiting, current, server]);

  return { caps: waiting && previous.current?.server === server ? previous.current.caps : current, waiting };
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
