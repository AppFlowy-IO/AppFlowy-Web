import { t } from 'i18next';

import { SpaceMemberAccessOverride, SpaceMemberRole, SpaceVisibility } from '@/application/types';

import { captureApiContext } from './http/request-context';
import {
  getSpaceMembers,
  getSpacePermission,
  updateSpaceGroupPermission,
  updateSpaceMemberByUuid,
} from './http/workspace-api';

export type SpaceAssignmentPrincipal = { type: 'user'; uuid: string } | { type: 'group'; uuid: string };

const SYNTHETIC_MEMBER_SOURCES = new Set(['workspace_default', 'page_share', 'legacy_private_owner']);

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
