import { AccessLevel, IPeopleWithAccessType, ObjectPermission } from '@/application/types';

export function resolveCurrentUserAccessLevel({
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
