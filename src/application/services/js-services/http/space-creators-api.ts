import { t } from 'i18next';
import { validate as isUuid } from 'uuid';

import {
  isWorkspacePermissionRevision,
  isWorkspaceSpaceCreationCapabilities,
  isWorkspaceSpaceCreationPolicy,
  SpaceCreatorKind,
  SpaceCreatorMutationResult,
  SpaceCreatorPrincipal,
  SpaceCreatorSelection,
  SpaceCreatorSelections,
  WorkspaceSpaceCreationCapabilities,
  WorkspaceSpaceCreationPolicy,
} from '@/application/workspace-permissions';

import { APIResponse, executeAPIRequest, getAxios } from './core';

export async function getWorkspaceSpaceCreationCapabilities(
  workspaceId: string
): Promise<WorkspaceSpaceCreationCapabilities> {
  const capability = await executeAPIRequest<unknown>(() =>
    getAxios()?.get<APIResponse>(`/api/workspace/${workspaceId}/space-creation-capabilities`)
  );

  // Missing/older endpoints and unknown modes stay unavailable. Never infer a grant from role alone.
  if (!isWorkspaceSpaceCreationCapabilities(capability, workspaceId)) {
    throw new Error(t('workspacePermissions.invalidResponse'));
  }

  return capability;
}

/**
 * Settings report selected creators as `owners_only` in `space_creation_policy` so clients that know
 * only two modes keep working; `exact_space_creation_policy` carries the exact policy. Servers that
 * predate the exact field report their exact policy in `space_creation_policy`.
 */
interface SpaceCreationPolicySettings {
  space_creation_policy?: unknown;
  exact_space_creation_policy?: unknown;
}

export async function setWorkspaceSpaceCreationPolicy(workspaceId: string, policy: WorkspaceSpaceCreationPolicy) {
  if (!isWorkspaceSpaceCreationPolicy(policy)) throw new Error(t('workspacePermissions.invalidRequest'));

  const settings = await executeAPIRequest<SpaceCreationPolicySettings | undefined>(() =>
    getAxios()?.post<APIResponse<SpaceCreationPolicySettings>>(`/api/workspace/${workspaceId}/settings`, {
      // Current servers apply the exact field. Two-mode servers apply the original modes and reject
      // selected creators instead of ignoring them.
      space_creation_policy: policy,
      exact_space_creation_policy: policy,
    })
  );
  const confirmed = settings?.exact_space_creation_policy ?? settings?.space_creation_policy;

  // A mixed-version server may ignore an unknown field. Success must confirm the requested policy.
  if (confirmed !== policy) throw new Error(t('workspacePermissions.changeNotConfirmed'));
}

function isPrincipal(value: unknown): value is SpaceCreatorPrincipal {
  if (!value || typeof value !== 'object') return false;
  const principal = value as Partial<SpaceCreatorPrincipal>;

  return (
    (principal.type === 'user' || principal.type === 'group') && typeof principal.id === 'string' && isUuid(principal.id)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSelection(value: unknown, kind: SpaceCreatorKind): value is SpaceCreatorSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Partial<SpaceCreatorSelection>;

  return (
    isPrincipal(selection.principal) &&
    selection.principal.type === kind &&
    (selection.name === null || typeof selection.name === 'string') &&
    (selection.granted_by === null || (typeof selection.granted_by === 'string' && isUuid(selection.granted_by))) &&
    isTimestamp(selection.granted_at) &&
    (selection.revoked_at === null || isTimestamp(selection.revoked_at)) &&
    typeof selection.eligible === 'boolean'
  );
}

/** Each principal kind has its own opaque keyset cursor; inactive selections remain visible. */
export async function listWorkspaceSpaceCreators(
  workspaceId: string,
  query: { kind: SpaceCreatorKind; after?: string; limit?: number }
): Promise<SpaceCreatorSelections> {
  const limit = query.limit ?? 50;

  if ((query.kind !== 'user' && query.kind !== 'group') || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error(t('workspacePermissions.invalidRequest'));
  }

  const result = await executeAPIRequest<Partial<SpaceCreatorSelections>>(() =>
    getAxios()?.get<APIResponse<SpaceCreatorSelections>>(`/api/workspace/${workspaceId}/space-creators`, {
      params: { kind: query.kind, after: query.after, limit },
    })
  );

  if (
    !result ||
    !Array.isArray(result.selections) ||
    result.selections.length > limit ||
    !result.selections.every((selection) => isSelection(selection, query.kind)) ||
    !(result.next_cursor === null || (typeof result.next_cursor === 'string' && result.next_cursor.length > 0))
  ) {
    throw new Error(t('workspacePermissions.invalidResponse'));
  }

  return result as SpaceCreatorSelections;
}

/** The authenticated session supplies the actor. Only a target UUID is sent. */
export async function setWorkspaceSpaceCreator(
  workspaceId: string,
  principal: SpaceCreatorPrincipal,
  granted: boolean
): Promise<SpaceCreatorMutationResult> {
  if (!isPrincipal(principal)) throw new Error(t('workspacePermissions.invalidRequest'));
  const kind = principal.type === 'user' ? 'users' : 'groups';
  const url = `/api/workspace/${workspaceId}/space-creators/${kind}/${principal.id}`;
  const result = await executeAPIRequest<SpaceCreatorMutationResult>(() =>
    granted
      ? getAxios()?.put<APIResponse<SpaceCreatorMutationResult>>(url)
      : getAxios()?.delete<APIResponse<SpaceCreatorMutationResult>>(url)
  );

  if (!result || typeof result.changed !== 'boolean' || !isWorkspacePermissionRevision(result.revision)) {
    throw new Error(t('workspacePermissions.changeNotConfirmed'));
  }

  return result;
}
