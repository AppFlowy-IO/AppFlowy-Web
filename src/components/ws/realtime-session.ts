import { getTokenParsed } from '@/application/session/token-storage';
import { getConfigValue } from '@/utils/runtime-config';

/** All browser coordination must use the same identity as private collab storage. */
export function realtimeSessionKey(workspaceId?: string): string {
  return JSON.stringify([
    getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'),
    getTokenParsed()?.user.id ?? null,
    workspaceId ?? null,
  ]);
}
