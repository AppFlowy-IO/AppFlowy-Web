import { AccessLevel, IPeopleWithAccessType, ObjectPermission } from '@/application/types';

export function canUseViewMutationActions({
  currentUserPermission,
}: {
  currentUserPermission?: ObjectPermission | null;
}) {
  if (currentUserPermission?.object_creator || currentUserPermission?.ancestor_creator) {
    return true;
  }

  if (currentUserPermission?.access_level !== undefined) {
    return currentUserPermission.access_level >= AccessLevel.FullAccess;
  }

  return false;
}

export function canUsePageHistoryAction({ currentUserPermission }: { currentUserPermission?: ObjectPermission | null }) {
  if (currentUserPermission?.access_level !== undefined) {
    return currentUserPermission.access_level >= AccessLevel.ReadAndWrite;
  }

  return false;
}

export function resolveCurrentUserActionAccessLevel({
  currentUserEmail,
  currentUserPermission,
  outlineAccessLevel,
  sharedPeople,
}: {
  currentUserEmail?: string | null;
  currentUserPermission?: ObjectPermission | null;
  outlineAccessLevel?: AccessLevel;
  sharedPeople: IPeopleWithAccessType[];
}) {
  return (
    currentUserPermission?.access_level ??
    sharedPeople.find((person) => person.email === currentUserEmail)?.access_level ??
    outlineAccessLevel
  );
}
