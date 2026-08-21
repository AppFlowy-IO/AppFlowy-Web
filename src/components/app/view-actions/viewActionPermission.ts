import { AccessLevel, ObjectPermission } from '@/application/types';

export function canUseViewMutationActions({
  currentUserPermission,
}: {
  currentUserPermission?: ObjectPermission | null;
}) {
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

export function canUseChildViewCreationActions({
  currentUserPermission,
}: {
  currentUserPermission?: ObjectPermission | null;
}) {
  if (currentUserPermission?.access_level !== undefined) {
    return currentUserPermission.access_level >= AccessLevel.ReadAndWrite;
  }

  return false;
}
