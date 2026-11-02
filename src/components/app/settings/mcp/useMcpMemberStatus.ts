import { useCallback } from 'react';

import * as McpService from '@/application/services/domains/mcp';
import type { McpMemberStatus } from '@/application/services/domains/mcp';

import { useMcpResource } from './useMcpRequest';

export interface McpMemberStatusState {
  /** The caller's role, eligibility and the workspace's approval requirement; undefined until loaded. */
  status: McpMemberStatus | undefined;
  loading: boolean;
  failed: boolean;
  error: unknown;
  /** The MCP service is unreachable, failing or too old to answer (`isMcpServiceUnavailable`). */
  unavailable: boolean;
  /**
   * AI app connections are turned off for the server: the status says
   * `enabled: false`, or the last load failed with `mcp_disabled`. Only
   * disconnecting works then.
   */
  disabled: boolean;
  reload: () => Promise<void>;
}

/** Loads `GET /api/mcp/me/workspaces/{workspaceId}`, which gates everything else in Settings > MCP. */
export function useMcpMemberStatus(workspaceId: string): McpMemberStatusState {
  const load = useCallback(
    (signal: AbortSignal) => McpService.getMcpMemberStatus(workspaceId, undefined, { signal }),
    [workspaceId]
  );
  const { data, loading, failed, error, reload } = useMcpResource(load);

  return {
    status: data,
    loading,
    failed,
    error,
    unavailable: failed && McpService.isMcpServiceUnavailable(error),
    // A failed load says more than the status it kept from before.
    disabled: failed ? McpService.isMcpDisabledError(error) : data?.enabled === false,
    reload,
  };
}
