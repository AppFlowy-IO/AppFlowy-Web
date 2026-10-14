import { t } from 'i18next';

import {
  AccessLevel,
  SpaceAccessDetails,
  SpaceMemberAccessOverride,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceVisibility,
  WorkspaceGroup,
  WorkspaceGroupSpacePermission,
} from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';

import { captureApiContext } from './http/request-context';
import {
  getSpaceAccessDetails,
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

/** Where the signed-in user gets more access to a space than their own row gives them. */
export type ExtraSpaceAccessSource =
  /** A group of this space they belong to; named when only one group of the space fits. */
  | { kind: 'group'; groupName?: string }
  /** "Access to all spaces" through their groups; named when only one group fits. */
  | { kind: 'allSpaces'; groupName?: string }
  /** A share of the space page itself. */
  | { kind: 'pageShare' };

export interface ExtraSpaceAccess {
  level: AccessLevel;
  source: ExtraSpaceAccessSource;
}

const KNOWN_ACCESS_LEVELS = new Set<unknown>([
  AccessLevel.ReadOnly,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadAndWrite,
  AccessLevel.FullAccess,
]);

function knownAccessLevel(level: unknown): AccessLevel | null {
  return KNOWN_ACCESS_LEVELS.has(level) ? (level as AccessLevel) : null;
}

// What a space's group row gives; servers without per-person access only report the stored level.
function assignmentAccessLevel(group: WorkspaceGroupSpacePermission): AccessLevel | null {
  return group.effective_access_level !== undefined ? group.effective_access_level : group.access_level;
}

function onlyName<T>(candidates: readonly T[], name: (candidate: T) => string): string | undefined {
  return candidates.length === 1 ? name(candidates[0]) || undefined : undefined;
}

/**
 * Explain why the signed-in user can do more in a space than `configuredLevel`, the level their
 * own row in Manage Space gives them (`null` is No access). The strongest other source wins, in
 * the order group, Access to all spaces, page share; it is never reported above the final
 * decision, which already applies page restrictions.
 *
 * A group is named only when it is the only candidate: the only group of this space at that
 * level, or the only group with Access to all spaces at that level. The user must belong to it,
 * because the server reports their strongest group. Otherwise the copy says "a group".
 */
export function extraSpaceAccess(
  details: SpaceAccessDetails,
  configuredLevel: AccessLevel | null,
  groups: {
    spaceGroups: readonly WorkspaceGroupSpacePermission[];
    workspaceGroups: readonly WorkspaceGroup[];
  }
): ExtraSpaceAccess | null {
  const finalLevel = knownAccessLevel(details.access_level);

  if (finalLevel === null || (configuredLevel !== null && finalLevel <= configuredLevel)) return null;
  const groupLevel = knownAccessLevel(details.group_member_access_level);
  const allSpacesLevel = knownAccessLevel(details.group_space_coverage_access_level);
  const candidates: Array<[AccessLevel | null, () => ExtraSpaceAccessSource]> = [
    [
      groupLevel,
      () => ({
        kind: 'group',
        groupName: onlyName(
          groups.spaceGroups.filter((group) => assignmentAccessLevel(group) === groupLevel),
          (group) => group.name
        ),
      }),
    ],
    [
      allSpacesLevel,
      () => ({
        kind: 'allSpaces',
        groupName: onlyName(
          groups.workspaceGroups.filter((group) => group.space_coverage_access_level === allSpacesLevel),
          (group) => group.name
        ),
      }),
    ],
    [knownAccessLevel(details.explicit_page_access_level), () => ({ kind: 'pageShare' })],
  ];
  let best: { level: AccessLevel; source: () => ExtraSpaceAccessSource } | null = null;

  for (const [sourceLevel, source] of candidates) {
    if (sourceLevel === null) continue;
    const level = Math.min(sourceLevel, finalLevel) as AccessLevel;

    if (configuredLevel !== null && level <= configuredLevel) continue;
    if (!best || level > best.level) best = { level, source };
  }

  return best ? { level: best.level, source: best.source() } : null;
}

/**
 * Read why the signed-in user has their access to a space, for the explanation in their own
 * row's access menu. Resolves `null` instead of failing: an older server without the route, a lost
 * right or a network error just leaves the row with its own level. Details that describe another
 * account or space, or arrive after the account, server or workspace changed, are dropped.
 */
export async function fetchOwnSpaceAccessDetails(
  workspaceId: string,
  spaceId: string,
  ownUid: string | undefined
): Promise<SpaceAccessDetails | null> {
  if (!ownUid) return null;
  const context = captureApiContext();

  try {
    const details = await getSpaceAccessDetails(workspaceId, spaceId);

    context.assertCurrent();
    return details && details.space_id === spaceId && isSameUserUid(details.uid, ownUid) ? details : null;
  } catch {
    return null;
  }
}
