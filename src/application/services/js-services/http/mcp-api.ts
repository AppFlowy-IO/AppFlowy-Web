import { getConfigValue } from '@/utils/runtime-config';

import { getAxios } from './core';

export interface McpApprovedClient {
  client_id: string;
  client_name?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
  approved_by: string;
  approved_at: string;
}

export interface McpWorkspaceAdminSettings {
  workspace_id: string;
  allow_unapproved_clients: boolean;
  updated_by?: string | null;
  updated_at?: string | null;
  approved_clients: McpApprovedClient[];
}

export interface McpConnectionSummary {
  client_id: string;
  user_uuid: string;
  workspace_id: string;
  connected_at: number;
}

export interface McpConnectionsResponse {
  connections: McpConnectionSummary[];
}

export interface McpDisconnectResponse {
  disconnected: number;
}

export function getMcpBaseUrl(): string {
  const appBase = getConfigValue('APPFLOWY_BASE_URL', '');

  return getConfigValue('APPFLOWY_MCP_BASE_URL', appBase).trim().replace(/\/$/, '');
}

function mcpUrl(path: string): string {
  return `${getMcpBaseUrl()}${path}`;
}

function requireAxios() {
  const axios = getAxios();

  if (!axios) {
    throw new Error('API service not initialized');
  }

  return axios;
}

export async function getMcpWorkspaceSettings(workspaceId: string): Promise<McpWorkspaceAdminSettings> {
  const resp = await requireAxios().get<McpWorkspaceAdminSettings>(
    mcpUrl(`/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/settings`)
  );

  return resp.data;
}

export async function updateMcpWorkspaceSettings(
  workspaceId: string,
  allowUnapprovedClients: boolean
): Promise<McpWorkspaceAdminSettings> {
  const resp = await requireAxios().put<McpWorkspaceAdminSettings>(
    mcpUrl(`/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/settings`),
    {
      allow_unapproved_clients: allowUnapprovedClients,
    }
  );

  return resp.data;
}

export async function approveMcpClient(workspaceId: string, clientId: string): Promise<void> {
  await requireAxios().put(
    mcpUrl(
      `/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/clients/${encodeURIComponent(clientId)}/approval`
    )
  );
}

export async function revokeMcpClientApproval(
  workspaceId: string,
  clientId: string
): Promise<McpDisconnectResponse> {
  const resp = await requireAxios().delete<McpDisconnectResponse>(
    mcpUrl(
      `/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/clients/${encodeURIComponent(clientId)}/approval`
    )
  );

  return resp.data;
}

export async function listMcpConnections(workspaceId: string): Promise<McpConnectionsResponse> {
  const resp = await requireAxios().get<McpConnectionsResponse>(
    mcpUrl(`/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/connections`)
  );

  return resp.data;
}

export async function disconnectMcpConnections(
  workspaceId: string,
  filter: { client_id?: string; user_uuid?: string } = {}
): Promise<McpDisconnectResponse> {
  const resp = await requireAxios().delete<McpDisconnectResponse>(
    mcpUrl(`/api/mcp/admin/workspaces/${encodeURIComponent(workspaceId)}/connections`),
    { data: filter }
  );

  return resp.data;
}
