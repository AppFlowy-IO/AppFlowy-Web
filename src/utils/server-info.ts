import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import { getConfigValue } from '@/utils/runtime-config';

export type ServerInfoState =
  | { status: 'loading' | 'unavailable' | 'unsupported'; info?: undefined }
  | { status: 'available'; info: ServerInfo };

export const SERVER_INFO_LOADING: ServerInfoState = { status: 'loading' };
export type ServerHostingMode = 'unknown' | 'cloud' | 'self-hosted';

const listeners = new Set<() => void>();
let snapshot: { serverUrl: string; state: ServerInfoState } | undefined;

function configuredServerUrl(): string {
  return getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
}

/** The auth layer's refresh loop owns this snapshot; UI and error formatters share it. */
export function getServerInfoSnapshot(serverUrl = configuredServerUrl()): ServerInfoState {
  return snapshot?.serverUrl === serverUrl ? snapshot.state : SERVER_INFO_LOADING;
}

export function updateServerInfo(serverUrl: string, state: ServerInfoState): void {
  snapshot = { serverUrl, state };
  listeners.forEach((listener) => listener());
}

export function subscribeToServerInfo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The single hosting policy for billing, feature gates, and upgrade messages.
 * Explicit server flags are authoritative, including on localhost. Legacy web
 * responses lack this flag: only the two known cloud endpoints qualify then.
 * Loading/failed info never enables cloud billing or upgrade messages.
 */
export function getServerHostingMode(
  serverInfo: { status: ServerInfoState['status']; info?: { self_hosted?: boolean } } = getServerInfoSnapshot(),
  serverUrl = configuredServerUrl()
): ServerHostingMode {
  if (typeof window !== 'undefined' && window.localStorage?.getItem('__test_force_self_hosted') === 'true')
    return 'self-hosted';
  if (serverInfo.status !== 'available') return 'unknown';
  if (typeof serverInfo.info?.self_hosted === 'boolean') return serverInfo.info.self_hosted ? 'self-hosted' : 'cloud';

  try {
    const hostname = new URL(serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`).hostname;

    return hostname === 'beta.appflowy.cloud' || hostname === 'test.appflowy.cloud' ? 'cloud' : 'self-hosted';
  } catch {
    return 'unknown';
  }
}

export function isOfficialHostedServer(
  serverInfo?: Parameters<typeof getServerHostingMode>[0],
  serverUrl?: string
): boolean {
  return getServerHostingMode(serverInfo, serverUrl) === 'cloud';
}
