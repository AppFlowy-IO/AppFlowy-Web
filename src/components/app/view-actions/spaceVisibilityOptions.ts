import { SpaceVisibility } from '@/application/types';

import type { TFunction } from 'i18next';

// The server emits exactly these two values today. A future value (for example
// `custom`) must still round-trip unchanged, so callers never coerce an unknown
// visibility: it is displayed as public-like and saved as received.
export const SELECTABLE_SPACE_VISIBILITIES = [SpaceVisibility.Public, SpaceVisibility.Private] as const;

export function isPrivateSpaceVisibility(visibility: SpaceVisibility): boolean {
  return visibility === SpaceVisibility.Private;
}

export function spaceVisibilityLabel(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Private:
      return t('space.privatePermission');
    case SpaceVisibility.Public:
    default:
      return t('space.publicPermission');
  }
}

export function spaceVisibilityDescription(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Private:
      return t('space.permissionManager.privateVisibilityDescription');
    case SpaceVisibility.Public:
    default:
      return t('space.publicPermissionDescription');
  }
}
