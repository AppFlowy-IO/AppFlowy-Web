import { t } from 'i18next';

import { PlainError } from '@/application/errors/plain-error';
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
 * - Every ordinary member gets a level: for a missing one the server stores its own default,
 *   Can edit, on any space that is not Custom.
 * - Public, Private and unknown space types store the level sent, so the space's member level is
 *   sent. A missing member level reads as Can view, like the server.
 * - A Custom space ignores the level: the member keeps the space default until a level is chosen
 *   for them in Manage Space, and no access is chosen here. The level only counts if the space
 *   stopped being Custom without the caller noticing, so the lowest one is sent: a Public space
 *   already gives every member its member level, so Can view adds nothing there.
 */
export function spaceMemberAddPayload(
  role: SpaceMemberRole,
  permission: Pick<SpacePermissionSettings, 'visibility' | 'member_default_access_level'>
): { role: SpaceMemberRole; access_level?: AccessLevel } {
  if (role !== SpaceMemberRole.Member) return { role };
  if (permission.visibility === SpaceVisibility.Custom) return { role, access_level: AccessLevel.ReadOnly };
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
    if (!isCurrent()) throw new PlainError(t('space.memberOverride.contextChanged'));
  };

  if (override !== null && override !== 10 && override !== 20 && override !== 30) {
    throw new PlainError(t('space.memberOverride.unavailable'));
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
    throw new PlainError(t('space.memberOverride.unavailable'));
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
    throw new PlainError(t('space.memberOverride.unavailable'));
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
  /** A share of the space page, with them or with one of their groups. */
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
 * own row in Manage Space gives them (`null` is No access). Only the server's decision is used:
 *
 * - A share of the space page, with them or with one of their groups, is the reason whenever it is
 *   the final decision. For anyone but a space owner the server lets that share replace what the
 *   space, its groups and Access to all spaces give, even when the share is lower, so a group that
 *   gives more is not the reason then.
 * - Otherwise the stronger of a group of this space and Access to all spaces is the reason, the
 *   group first on a tie. A source above the final decision explains nothing and is skipped.
 *
 * The per-source levels, not the server's `source`, decide the rest, because the row may show a
 * choice the server has not saved yet. A group is named only when it is the only candidate: the
 * only group of this space at that level, or the only group with Access to all spaces at that
 * level. The user must belong to it, because the server reports their strongest group. Otherwise
 * the copy says "a group".
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
  const pageShareLevel = knownAccessLevel(details.explicit_page_access_level);
  // Servers without per-source levels still say when a page share decided the access.
  const pageShareDecides =
    pageShareLevel !== null ? pageShareLevel === finalLevel : details.source === 'explicit_page_share';

  if (pageShareDecides) return { level: finalLevel, source: { kind: 'pageShare' } };
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
  ];
  let best: { level: AccessLevel; source: () => ExtraSpaceAccessSource } | null = null;

  for (const [level, source] of candidates) {
    if (level === null || level > finalLevel || (configuredLevel !== null && level <= configuredLevel)) continue;
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
