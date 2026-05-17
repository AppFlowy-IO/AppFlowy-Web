import axios from 'axios';
import dayjs from 'dayjs';

import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { getAxios } from './core';
import { refreshToken } from './gotrue';

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

export interface McpClientInfo {
  client_name?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
}

export interface CreateMcpAuthorizationCodeRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  workspace_id: string;
  state?: string;
  scope?: string;
}

export class McpOAuthError extends Error {
  oauthError?: string;
  constructor(message: string, oauthError?: string) {
    super(message);
    this.name = 'McpOAuthError';
    this.oauthError = oauthError;
  }
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

/**
 * Public client metadata lookup. Uses raw `fetch` instead of the shared axios
 * instance: this endpoint is public and best-effort, and we do not want a
 * spurious 401 (or pre-emptive token refresh on an expired access token) to
 * trigger the global auth interceptor and sign the user out before they've
 * even seen the consent page. Returns null on any error — the consent UI
 * falls back to the truncated client id.
 */
export async function getMcpClientInfo(clientId: string): Promise<McpClientInfo | null> {
  try {
    const resp = await fetch(mcpUrl(`/api/mcp/clients/${encodeURIComponent(clientId)}`));

    if (!resp.ok) return null;

    return (await resp.json()) as McpClientInfo;
  } catch {
    return null;
  }
}

/**
 * POST /api/mcp/authorize/code — exchanges the consent grant + AppFlowy JWT
 * for an OAuth authorization code, returning the redirect URL the browser
 * should hand off to. Throws {@link McpOAuthError} so callers can branch on
 * `oauthError === 'invalid_client'` for the workspace-owner approval path.
 */
export async function createMcpAuthorizationCode(
  req: CreateMcpAuthorizationCodeRequest
): Promise<string> {
  // Refresh proactively so the refresh_token / expires_at we forward to the
  // MCP server match the access token that will be on the request. The shared
  // request interceptor refreshes on expiry too, but it runs *after* the
  // request body is constructed — leaving the body holding a rotated refresh
  // token and stale `expires_at` from the previous session.
  const initial = getTokenParsed();

  if (initial && dayjs().isAfter(dayjs.unix(initial.expires_at))) {
    try {
      await refreshToken(initial.refresh_token);
    } catch {
      // Fall through — the request interceptor will surface the auth error.
    }
  }

  const token = getTokenParsed();

  try {
    const resp = await requireAxios().post<{ redirect_url?: string }>(
      mcpUrl('/api/mcp/authorize/code'),
      {
        ...req,
        appflowy_refresh_token: token?.refresh_token,
        appflowy_expires_at: token?.expires_at,
      }
    );
    const redirectUrl = resp.data?.redirect_url;

    if (typeof redirectUrl !== 'string') {
      throw new McpOAuthError('Authorization server did not return a redirect URL.');
    }

    return redirectUrl;
  } catch (e) {
    if (e instanceof McpOAuthError) throw e;
    if (axios.isAxiosError(e)) {
      const data = e.response?.data as { error?: unknown; error_description?: unknown } | undefined;
      const oauthError = typeof data?.error === 'string' ? data.error : undefined;
      const message =
        (typeof data?.error_description === 'string' && data.error_description) ||
        oauthError ||
        (e.response ? `HTTP ${e.response.status}` : e.message);

      throw new McpOAuthError(message, oauthError);
    }

    throw e;
  }
}
