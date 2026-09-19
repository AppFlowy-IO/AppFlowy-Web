import {
  IntegrationConnection,
  IntegrationProvider,
  integrationProviders,
  isIntegrationProvider,
} from '@/application/integrations/types';

import { APIResponse, executeAPIRequest, getAxios } from './core';

const REQUEST_TIMEOUT_MS = 45_000;

interface ConnectProviderResponse {
  oauth_url: string;
  connection_id: string;
}

export async function getConfiguredProviders(signal?: AbortSignal): Promise<IntegrationProvider[]> {
  // Existing servers expose integration availability only in the native projection.
  // Read just the provider keys; native feature flags must not configure the web app.
  const response = await executeAPIRequest<{ connections?: string[] }>(() =>
    getAxios()?.get('/api/server-info', {
      headers: { 'x-platform': 'app' },
      signal,
      timeout: REQUEST_TIMEOUT_MS,
    })
  );

  // An omitted capability is unknown on older servers; an empty list is authoritative.
  return response.connections?.filter(isIntegrationProvider) ?? [...integrationProviders];
}

export async function listConnections(workspaceId: string, signal?: AbortSignal): Promise<IntegrationConnection[]> {
  const response = await executeAPIRequest<{ connections: IntegrationConnection[] }>(
    () =>
      getAxios()?.get('/api/integrations/connections', {
        params: { workspace_id: workspaceId, include_metadata: true },
        signal,
        timeout: REQUEST_TIMEOUT_MS,
      }),
    { suppressResponseDataLogging: true }
  );

  return response.connections;
}

export function connectProvider(workspaceId: string, provider: IntegrationProvider, signal?: AbortSignal) {
  return executeAPIRequest<ConnectProviderResponse>(
    () =>
      getAxios()?.post<APIResponse<ConnectProviderResponse>>(
        `/api/integrations/connect/${provider}`,
        { workspace_id: workspaceId },
        { signal, timeout: REQUEST_TIMEOUT_MS }
      ),
    { suppressResponseDataLogging: true }
  );
}

export function confirmConnection(
  workspaceId: string,
  provider: IntegrationProvider,
  connectionId: string,
  oauthQuery: string,
  signal?: AbortSignal
) {
  return executeAPIRequest<{ success: boolean; connection?: IntegrationConnection }>(
    () =>
      getAxios()?.post(
        '/api/integrations/connections/callback',
        {
          workspace_id: workspaceId,
          provider,
          connection_id: connectionId,
          oauth_query: oauthQuery,
        },
        { signal, timeout: REQUEST_TIMEOUT_MS }
      ),
    { suppressResponseDataLogging: true }
  );
}

export function disconnectConnection(connectionId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ success: boolean }>(() =>
    getAxios()?.delete(`/api/integrations/connections/${encodeURIComponent(connectionId)}`, {
      signal,
      timeout: REQUEST_TIMEOUT_MS,
    })
  );
}

export async function getConnectionEmail(
  workspaceId: string,
  connection: Pick<IntegrationConnection, 'id' | 'provider'>,
  signal?: AbortSignal
): Promise<string | undefined> {
  const response = await executeAPIRequest<{ data: { user?: { emailAddress?: string }; email?: string } }>(
    () =>
      getAxios()?.post(
        '/api/integrations/proxy',
        {
          workspace_id: workspaceId,
          connection_id: connection.id,
          method: 'GET',
          endpoint: connection.provider === 'google-drive' ? '/drive/v3/about/?fields=user' : '/oauth2/v2/userinfo',
        },
        { signal, timeout: REQUEST_TIMEOUT_MS }
      ),
    { suppressResponseDataLogging: true }
  );
  const email = connection.provider === 'google-drive' ? response.data?.user?.emailAddress : response.data?.email;

  return typeof email === 'string' && email.trim() ? email : undefined;
}
