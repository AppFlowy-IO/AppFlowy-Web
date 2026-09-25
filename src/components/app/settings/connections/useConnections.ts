import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { notifyConnectionsChanged } from '@/application/integrations/connection-events';
import { authorizeIntegration, IntegrationOAuthError } from '@/application/integrations/oauth';
import {
  IntegrationConnection,
  IntegrationProvider,
  integrationProviders,
  isIntegrationProvider,
} from '@/application/integrations/types';
import * as IntegrationService from '@/application/services/domains/integration';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';

export function useConnections(workspaceId: string) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [configuredProviders, setConfiguredProviders] = useState<readonly IntegrationProvider[]>(integrationProviders);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<{ error: unknown }>();
  const [connectionFailure, setConnectionFailure] = useState<{ error: unknown }>();
  const [pending, setPending] = useState<{ provider: IntegrationProvider; stage: 'authorizing' | 'confirming' }>();
  const [disconnecting, setDisconnecting] = useState(false);
  const operation = useRef<AbortController>();
  const loadRequest = useRef<AbortController>();

  const reload = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();

    loadRequest.current = controller;
    setLoading(true);
    setLoadFailure(undefined);
    setConnectionFailure(undefined);
    try {
      const [result, configured] = await Promise.all([
        IntegrationService.listConnections(workspaceId, controller.signal),
        IntegrationService.getConfiguredProviders(controller.signal),
      ]);

      if (!controller.signal.aborted) {
        setConnections(result.filter((connection) => isIntegrationProvider(connection.provider)));
        setConfiguredProviders(configured);
        setRefreshVersion((version) => version + 1);
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadFailure({ error });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
    return () => {
      loadRequest.current?.abort();
    };
  }, [reload]);

  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = undefined;
    },
    []
  );

  const connect = useCallback(
    async (provider: IntegrationProvider) => {
      if (operation.current || loading || loadFailure || !configuredProviders.includes(provider)) return;
      const controller = new AbortController();

      operation.current = controller;
      setConnectionFailure(undefined);
      setPending({ provider, stage: 'authorizing' });
      try {
        const { connectionId, oauthQuery } = await authorizeIntegration(workspaceId, provider, controller.signal);

        if (controller.signal.aborted) return;
        setPending({ provider, stage: 'confirming' });
        const result = await IntegrationService.confirmConnection(
          workspaceId,
          provider,
          connectionId,
          oauthQuery,
          controller.signal
        );

        if (controller.signal.aborted) return;
        if (!result.success) throw new Error(t('settings.connections.connectionFailed'));
        notifyConnectionsChanged(workspaceId);
        await reload();
      } catch (error) {
        if (!controller.signal.aborted) {
          if (
            isAPIErrorCode(error, 1008) &&
            getErrorMessage(error, '').endsWith(`provider ${provider} is not configured`)
          ) {
            // Configuration can change after the panel loads. Disable further attempts
            // until the user refreshes, and show the same setup guidance as on startup.
            setConfiguredProviders((current) => current.filter((key) => key !== provider));
          } else if (error instanceof IntegrationOAuthError && error.code === 'cancelled') {
            return;
          } else {
            setConnectionFailure({ error });
          }
        }
      } finally {
        if (operation.current === controller) {
          operation.current = undefined;
          setPending(undefined);
        }
      }
    },
    [workspaceId, reload, t, loading, loadFailure, configuredProviders]
  );

  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = undefined;
    setPending(undefined);
  }, []);

  const disconnect = useCallback(
    async (connectionId: string): Promise<boolean> => {
      if (operation.current) return false;
      const controller = new AbortController();

      operation.current = controller;
      setDisconnecting(true);
      try {
        const result = await IntegrationService.disconnectConnection(connectionId, controller.signal);

        if (controller.signal.aborted) return false;
        if (!result.success) throw new Error(t('settings.connections.disconnectFailed'));
        setConnections((current) => current.filter((connection) => connection.id !== connectionId));
        notifyConnectionsChanged(workspaceId);
        return true;
      } catch (error) {
        if (!controller.signal.aborted) toast.error(getErrorMessage(error, t('settings.connections.disconnectFailed')));
        return false;
      } finally {
        if (operation.current === controller) {
          operation.current = undefined;
          setDisconnecting(false);
        }
      }
    },
    [t, workspaceId]
  );

  const loadError = loadFailure ? getErrorMessage(loadFailure.error, t('settings.connections.loadFailed')) : undefined;
  const connectionError = connectionFailure
    ? connectionFailure.error instanceof IntegrationOAuthError && connectionFailure.error.code !== 'cancelled'
      ? t(`settings.connections.${connectionFailure.error.code}`)
      : getErrorMessage(connectionFailure.error, t('settings.connections.connectionFailed'))
    : undefined;

  return {
    connections,
    refreshVersion,
    configuredProviders,
    loading,
    loadError,
    connectionError,
    pending,
    disconnecting,
    reload,
    connect,
    cancel,
    disconnect,
  };
}
