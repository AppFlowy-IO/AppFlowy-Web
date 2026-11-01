import { useCallback, useMemo } from 'react';

import { summarizeConnectedApps } from '@/application/mcp/setupApps';
import * as McpService from '@/application/services/domains/mcp';

import { useMcpResource } from './useMcpRequest';

export interface McpConnectionsOverview {
  /**
   * Distinct apps the caller connected anywhere, grouped like the setup
   * guide's "Connected apps (N)" (`summarizeConnectedApps`), so the two counts
   * agree.
   */
  appCount: number;
  workspaceCount: number;
  connectionCount: number;
}

export interface McpConnectionsOverviewState {
  /** Undefined until loaded, and when the service cannot say (older servers lack the endpoint). */
  overview: McpConnectionsOverview | undefined;
  reload: () => Promise<void>;
}

/**
 * The caller's connections across every workspace (`GET /api/mcp/me/connections`),
 * for "N apps across M workspaces". A failure only hides the summary.
 */
export function useMcpConnectionsOverview(enabled: boolean): McpConnectionsOverviewState {
  const load = useCallback((signal: AbortSignal) => McpService.listMyMcpConnectionsAcrossWorkspaces({ signal }), []);
  const { data, failed, reload } = useMcpResource(load, enabled);
  const overview = useMemo(
    () =>
      data && !failed
        ? {
            appCount: summarizeConnectedApps(data.connections).length,
            workspaceCount: data.workspace_count,
            connectionCount: data.connection_count,
          }
        : undefined,
    [data, failed]
  );

  return { overview, reload };
}
