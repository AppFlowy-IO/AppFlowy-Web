import { t } from 'i18next';

import {
  AccessLevel,
  SpaceMemberAccessOverride,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceVisibility,
} from '@/application/types';

import { captureApiContext } from './http/request-context';
import {
  getSpaceMembers,
  getSpacePermission,
  updateSpaceGroupPermission,
  updateSpaceMemberByUuid,
} from './http/workspace-api';

export type SpaceAssignmentPrincipal = { type: 'user'; uuid: string } | { type: 'group'; uuid: string };

const SYNTHETIC_MEMBER_SOURCES = new Set(['workspace_default', 'page_share', 'legacy_private_owner']);

/**
 * Body for adding a person (`POST .../members/users/{uuid}`) or a group (`POST .../group/{id}`)
 * to a space on a server with per-person access.
 *
 * - Owners always get the space's owner access, so no level is sent.
 * - An ordinary member of a Custom space keeps the space default until a level is chosen for them
 *   in Manage Space: nothing is sent and the server ignores any level for Custom spaces.
 * - Public, Private and unknown space types store the level sent with the add. Leaving it out
 *   would store the server's own default (Can edit) instead of the space's member level, so the
 *   member level is always sent. A missing member level reads as Can view, like the server.
 */
export function spaceMemberAddPayload(
  role: SpaceMemberRole,
  permission: Pick<SpacePermissionSettings, 'visibility' | 'member_default_access_level'>
): { role: SpaceMemberRole; access_level?: AccessLevel } {
  if (role !== SpaceMemberRole.Member || permission.visibility === SpaceVisibility.Custom) return { role };
  return { role, access_level: permission.member_default_access_level ?? AccessLevel.ReadOnly };
}

/** Revalidate assignment editing independently from invitation and space ownership controls. */
export async function setSpaceMemberAccessOverride(
  workspaceId: string,
  spaceId: string,
  principal: SpaceAssignmentPrincipal,
  override: SpaceMemberAccessOverride,
  isCurrent: () => boolean = () => true
) {
  const context = captureApiContext();
  const assertCurrent = () => {
    context.assertCurrent();
    if (!isCurrent()) throw new Error(t('space.memberOverride.contextChanged'));
  };

  if (override !== null && override !== 10 && override !== 20 && override !== 30) {
    throw new Error(t('space.memberOverride.unavailable'));
  }

  assertCurrent();
  // Both reads are independent, so they run together; the capability result is
  // still checked first so a lost right reports the clearer error.
  const [permissionResult, rosterResult] = await Promise.allSettled([
    getSpacePermission(workspaceId, spaceId),
    getSpaceMembers(workspaceId, spaceId),
  ]);

  assertCurrent();
  if (permissionResult.status === 'rejected') throw permissionResult.reason;
  const permission = permissionResult.value;

  if (
    permission.space_id !== spaceId ||
    permission.member_access_overrides_supported !== true ||
    !permission.can_manage_members ||
    permission.permission.visibility !== SpaceVisibility.Custom
  ) {
    throw new Error(t('space.memberOverride.unavailable'));
  }

  if (rosterResult.status === 'rejected') throw rosterResult.reason;
  const roster = rosterResult.value;
  const assignment =
    principal.type === 'user'
      ? roster.members.find(
          (member) => member.user_uuid === principal.uuid && !SYNTHETIC_MEMBER_SOURCES.has(member.source)
        )
      : roster.groups.find((group) => group.group_id === principal.uuid);

  if (!assignment || assignment.role !== SpaceMemberRole.Member || assignment.access_level_override === undefined) {
    throw new Error(t('space.memberOverride.unavailable'));
  }

  // A focused PATCH never carries role or the legacy materialized access_level.
  // Explicit null resets to inheritance; equal-to-default values remain explicit.
  const payload = { access_level_override: override };
  const updated =
    principal.type === 'user'
      ? await updateSpaceMemberByUuid(workspaceId, spaceId, principal.uuid, payload)
      : await updateSpaceGroupPermission(workspaceId, spaceId, principal.uuid, payload);

  assertCurrent();
  return updated;
}
