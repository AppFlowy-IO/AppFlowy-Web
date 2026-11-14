import { useSyncExternalStore } from 'react';

import {
  getMcpBaseUrlOverride,
  getMcpConfiguration,
  type McpConfiguration,
} from '@/application/services/domains/mcp';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';
import { useServerInfo } from '@/components/app/hooks/useServerInfo';
import { subscribeToServerInfo } from '@/utils/server-info';

export interface UseMcpConfigurationOptions {
  /**
   * Run the server-info refresh loop, unless `APPFLOWY_MCP_BASE_URL` already
   * names the service. The consent page needs it; inside `/app` the auth layer
   * already runs the one loop that owns the shared snapshot, and the setup page
   * runs it itself, also with the override, to learn whether the server is
   * self-hosted.
   */
  loadServerInfo?: boolean;
}

/**
 * Where the AppFlowy MCP service is: the `APPFLOWY_MCP_BASE_URL` override,
 * else the `mcp_url` AppFlowy Cloud advertises in server-info. `loading` until
 * server-info answers; re-renders when it does.
 */
export function useMcpConfiguration({ loadServerInfo = false }: UseMcpConfigurationOptions = {}): McpConfiguration {
  // The override needs no server round trip.
  useServerInfo(loadServerInfo && !getMcpBaseUrlOverride(), defaultConfig.baseURL);

  return useSyncExternalStore(subscribeToServerInfo, getMcpConfiguration, getMcpConfiguration);
}

export default useMcpConfiguration;
