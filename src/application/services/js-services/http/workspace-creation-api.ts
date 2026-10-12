import { t } from 'i18next';

import { isUnsupportedRouteError } from '@/utils/errors';
import { getServerHostingMode, getServerInfoSnapshot } from '@/utils/server-info';

import { getServerInfo } from './auth-api';
import { APIResponse, executeAPIRequest } from './core';
import { captureApiContext } from './request-context';

export interface WorkspaceCreationCapability {
  supported: boolean;
  mode: 'unrestricted' | 'selected_users';
  revision: string;
  can_create_workspace: boolean;
}

function isCapability(value: unknown): value is WorkspaceCreationCapability {
  if (!value || typeof value !== 'object') return false;
  const capability = value as Partial<WorkspaceCreationCapability>;

  return (
    typeof capability.supported === 'boolean' &&
    (capability.mode === 'unrestricted' || capability.mode === 'selected_users') &&
    typeof capability.revision === 'string' &&
    /^(0|[1-9]\d*)$/.test(capability.revision) &&
    BigInt(capability.revision) <= 9223372036854775807n &&
    typeof capability.can_create_workspace === 'boolean'
  );
}

/** A scope fence, not an authorization grant. */
export function captureWorkspaceCreationContext(): () => void {
  return captureApiContext().assertCurrent;
}

export async function getWorkspaceCreationCapability(): Promise<WorkspaceCreationCapability> {
  const scope = captureApiContext();
  const { assertCurrent } = scope;

  try {
    const capability = await executeAPIRequest<unknown>(() =>
      scope.client?.get<APIResponse>('/api/user/workspace-creation-capability')
    );

    assertCurrent();
    if (!isCapability(capability)) throw new Error(t('workspaceCreation.invalidResponse'));
    return capability;
  } catch (error) {
    assertCurrent();
    if (!isUnsupportedRouteError(error)) throw error;
    let info = getServerInfoSnapshot(scope.serverUrl);

    if (info.status !== 'available') {
      info = { status: 'available', info: await getServerInfo() };
      assertCurrent();
    }

    // Legacy hosted servers predate this self-host policy. An absent route on
    // an unknown/self-hosted server cannot prove unrestricted creation.
    if (getServerHostingMode(info, scope.serverUrl) !== 'cloud') throw error;
    return { supported: false, mode: 'unrestricted', revision: '0', can_create_workspace: true };
  }
}

/** Fresh admission at the final mutation helper, including callers outside the app shell. */
export async function ensureCanCreateWorkspace(): Promise<() => void> {
  const assertCurrent = captureWorkspaceCreationContext();

  if (!navigator.onLine) throw new Error(t('workspaceCreation.unavailable'));
  const capability = await getWorkspaceCreationCapability();

  if (!capability.can_create_workspace) throw new Error(t('workspaceCreation.denied'));
  assertCurrent();
  return assertCurrent;
}
