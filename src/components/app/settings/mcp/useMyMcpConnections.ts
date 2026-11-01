import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import * as McpService from '@/application/services/domains/mcp';
import type { McpMyConnection } from '@/application/services/domains/mcp';
import { notify } from '@/components/_shared/notify';

import { mcpConnectionKey } from './format';
import { useMcpAction, useMcpResource } from './useMcpRequest';

const NO_CONNECTIONS: McpMyConnection[] = [];

export interface MyMcpConnectionsState {
  /** One per device (token family). */
  connections: McpMyConnection[];
  /** The list loaded at least once. */
  loaded: boolean;
  loading: boolean;
  failed: boolean;
  error: unknown;
  reload: () => Promise<void>;
  /**
   * Revokes one of the caller's connections (no confirmation): that device's
   * token family, or every connection with the client for a record without a
   * family. Resolves true on success.
   */
  disconnect: (connection: McpMyConnection) => Promise<boolean>;
  /** The `mcpConnectionKey` of the connection being disconnected. */
  disconnecting: string | undefined;
}

/** Whether `connection` goes when `target` is disconnected. */
function removedWith(target: McpMyConnection, connection: McpMyConnection): boolean {
  if (connection.client_id !== target.client_id) return false;
  // Without a family, the server disconnects every connection with the client.
  return !target.family_id || mcpConnectionKey(connection) === mcpConnectionKey(target);
}

/** The caller's own AI app connections in a workspace, loaded once `enabled`. */
export function useMyMcpConnections(workspaceId: string, enabled = true): MyMcpConnectionsState {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => McpService.listMyMcpConnections(workspaceId, { signal }),
    [workspaceId]
  );
  const { data, loading, failed, error, reload, update } = useMcpResource(load, enabled);
  const { pending, run } = useMcpAction<string>();

  const disconnect = useCallback(
    (target: McpMyConnection) =>
      run(
        mcpConnectionKey(target),
        (signal) =>
          McpService.disconnectMyMcpConnection(workspaceId, target.client_id, {
            familyId: target.family_id,
            signal,
          }),
        () => {
          update((current) => current?.filter((connection) => !removedWith(target, connection)));
          notify.success(t('settings.mcp.disconnected'));
          void reload();
        }
      ),
    [run, workspaceId, update, reload, t]
  );

  return {
    connections: data ?? NO_CONNECTIONS,
    loaded: data !== undefined,
    loading,
    failed,
    error,
    reload,
    disconnect,
    disconnecting: pending,
  };
}
