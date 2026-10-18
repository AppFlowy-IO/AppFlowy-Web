import { t } from 'i18next';

import { PlainError } from '@/application/errors/plain-error';
import { isUnsupportedRouteError } from '@/utils/errors';

import { APIResponse, executeAPIRequest } from './core';
import { captureApiContext } from './request-context';

export interface WorkspaceCreationCapability {
  supported: boolean;
  mode: 'unrestricted' | 'selected_users';
  revision: string;
  can_create_workspace: boolean;
  /**
   * Set only by this client when the server predates the capability route. Such a server has no
   * workspace creation policy and no keyed creation route: creation stays available, uses the
   * original route, and the server's own checks decide.
   */
  legacy?: true;
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
    if (!isCapability(capability)) throw new PlainError(t('workspaceCreation.invalidResponse'));
    // Copy the known fields so a response can never claim the client-only legacy marker.
    return {
      supported: capability.supported,
      mode: capability.mode,
      revision: capability.revision,
      can_create_workspace: capability.can_create_workspace,
    };
  } catch (error) {
    assertCurrent();
    if (!isUnsupportedRouteError(error)) throw error;
    // The route and keyed creation shipped together, so an older server has neither. Keep it
    // usable: it has no creation policy, and its existing checks still decide every request.
    return { supported: false, mode: 'unrestricted', revision: '0', can_create_workspace: true, legacy: true };
  }
}

/**
 * Fresh admission at the final mutation helper, including callers outside the app shell. `legacy`
 * tells the caller to use the server's original, unkeyed creation route.
 */
export async function admitWorkspaceCreation(): Promise<{ assertCurrent: () => void; legacy: boolean }> {
  const assertCurrent = captureWorkspaceCreationContext();

  if (!navigator.onLine) throw new PlainError(t('workspaceCreation.unavailable'));
  const capability = await getWorkspaceCreationCapability();

  if (!capability.can_create_workspace) throw new PlainError(t('workspaceCreation.denied'));
  assertCurrent();
  return { assertCurrent, legacy: capability.legacy === true };
}

/** Fresh admission for new-workspace mutations that have no keyed variant, such as imports. */
export async function ensureCanCreateWorkspace(): Promise<() => void> {
  return (await admitWorkspaceCreation()).assertCurrent;
}
