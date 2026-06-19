import { AccessLevel, IPeopleWithAccessType, Role, View } from '@/application/types';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';

export enum ShareSectionType {
  Public = 'public',
  Shared = 'shared',
  Private = 'private',
  Unknown = 'unknown',
}

export function isInheritedWorkspaceAccess(sectionType: ShareSectionType, person: IPeopleWithAccessType) {
  return sectionType === ShareSectionType.Public && !person.pending_invitation && person.role !== Role.Guest;
}

export function resolveShareSectionType({
  outline,
  viewId,
  sharedPeople,
  workspaceMemberCount,
}: {
  outline: View[];
  viewId: string;
  sharedPeople: IPeopleWithAccessType[];
  workspaceMemberCount?: number;
}): ShareSectionType {
  if (findViewInShareWithMe(outline, viewId)) {
    return ShareSectionType.Shared;
  }

  const view = findView(outline, viewId);
  const hasKnownWorkspaceMemberCount = workspaceMemberCount !== undefined && workspaceMemberCount > 0;
  const hasWorkspaceWideAccess =
    hasKnownWorkspaceMemberCount &&
    sharedPeople.filter(
      (person) =>
        !person.pending_invitation && person.access_level === AccessLevel.FullAccess && person.role !== Role.Guest
    ).length >= workspaceMemberCount;

  if (view) {
    if (!view.is_private && (hasWorkspaceWideAccess || !hasKnownWorkspaceMemberCount)) {
      return ShareSectionType.Public;
    }

    return sharedPeople.length > 1 ? ShareSectionType.Shared : ShareSectionType.Private;
  }

  if (sharedPeople.length > 1) {
    return ShareSectionType.Shared;
  }

  return ShareSectionType.Unknown;
}
