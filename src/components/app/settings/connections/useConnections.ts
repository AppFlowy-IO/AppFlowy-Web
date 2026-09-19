import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { authorizeIntegration, IntegrationOAuthError } from '@/application/integrations/oauth';
import { IntegrationConnection, IntegrationProvider, isIntegrationProvider } from '@/application/integrations/types';
import * as IntegrationService from '@/application/services/domains/integration';
import { getErrorMessage } from '@/utils/errors';

export function useConnections(workspaceId: string) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<{ error: unknown }>();
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
    try {
      const result = await IntegrationService.listConnections(workspaceId, controller.signal);

      if (!controller.signal.aborted)
        setConnections(result.filter((connection) => isIntegrationProvider(connection.provider)));
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
      if (operation.current) return;
      const controller = new AbortController();

      operation.current = controller;
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
        await reload();
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof IntegrationOAuthError) {
            if (error.code !== 'cancelled') toast.error(t(`settings.connections.${error.code}`));
          } else {
            toast.error(getErrorMessage(error, t('settings.connections.connectionFailed')));
          }
        }
      } finally {
        if (operation.current === controller) {
          operation.current = undefined;
          setPending(undefined);
        }
      }
    },
    [workspaceId, reload, t]
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
    [t]
  );

  const loadError = loadFailure ? getErrorMessage(loadFailure.error, t('settings.connections.loadFailed')) : undefined;

  return { connections, loading, loadError, pending, disconnecting, reload, connect, cancel, disconnect };
}
