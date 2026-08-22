import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';

import type { TFunction } from 'i18next';

// The server emits exactly these three values today. A future value must still
// round-trip unchanged, so callers never coerce an unknown visibility: it is
// displayed as public-like and saved as received.
export const SELECTABLE_SPACE_VISIBILITIES = [
  SpaceVisibility.Public,
  SpaceVisibility.Custom,
  SpaceVisibility.Private,
] as const;

// The binary `space_permission` routes can only express these two values, so a
// legacy-only editor must not offer anything else.
export const LEGACY_SPACE_VISIBILITIES = [SpaceVisibility.Public, SpaceVisibility.Private] as const;

export function isPrivateSpaceVisibility(visibility: SpaceVisibility): boolean {
  return visibility === SpaceVisibility.Private;
}

export function spaceVisibilityLabel(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Private:
      return t('space.privatePermission');
    case SpaceVisibility.Custom:
      return t('space.customPermission');
    case SpaceVisibility.Public:
    default:
      return t('space.publicPermission');
  }
}

export function spaceVisibilityDescription(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Private:
      return t('space.privatePermissionDescription');
    case SpaceVisibility.Custom:
      return t('space.customPermissionDescription');
    case SpaceVisibility.Public:
    default:
      return t('space.publicPermissionDescription');
  }
}

/**
 * The everyone-else level a space receives when it becomes custom: other
 * workspace members can view. Public and private spaces have no everyone-else
 * audience, which the server represents as `null`.
 */
export function defaultEveryoneElseAccessLevel(visibility: SpaceVisibility): AccessLevel | null {
  return visibility === SpaceVisibility.Custom ? AccessLevel.ReadOnly : null;
}

/**
 * The structured settings a freshly created space receives for `visibility`.
 * Mirrors the server defaults (owners Full access, members Can edit, everyone
 * else Can view on custom spaces); the create flow sends these verbatim when
 * the visibility cannot be expressed through the legacy `space_permission`.
 */
export function defaultSpacePermissionSettings(visibility: SpaceVisibility): SpacePermissionSettings {
  return {
    visibility,
    owner_access_level: AccessLevel.FullAccess,
    member_default_access_level: AccessLevel.ReadAndWrite,
    everyone_else_access_level: defaultEveryoneElseAccessLevel(visibility),
    invite_policy: SpaceInvitePolicy.OwnersOnly,
    sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
    invite_link_enabled: false,
    security: {
      disable_guests: false,
      disable_public_links: false,
      disable_export: false,
    },
  };
}
