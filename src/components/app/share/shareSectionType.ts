import { AccessLevel, IPeopleWithAccessType, Role, View, WorkspaceGroupViewPermission } from '@/application/types';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';

export enum ShareSectionType {
  Public = 'public',
  Shared = 'shared',
  Private = 'private',
  Unknown = 'unknown',
}

export function resolveShareSectionType({
  outline,
  viewId,
  sharedPeople,
  sharedGroups = [],
  workspaceMemberCount,
}: {
  outline: View[];
  viewId: string;
  sharedPeople: IPeopleWithAccessType[];
  sharedGroups?: WorkspaceGroupViewPermission[];
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

    return sharedPeople.length > 1 || sharedGroups.length > 0 ? ShareSectionType.Shared : ShareSectionType.Private;
  }

  if (sharedPeople.length > 1 || sharedGroups.length > 0) {
    return ShareSectionType.Shared;
  }

  return ShareSectionType.Unknown;
}
