import { CollabObjectPermission } from '@/application/types';

type ViewActionCapabilities = Pick<CollabObjectPermission, 'can_read' | 'can_write' | 'can_share'>;

export function canUseViewMutationActions({
  objectPermission,
}: {
  objectPermission?: ViewActionCapabilities | null;
}) {
  return objectPermission?.can_read === true && objectPermission.can_share;
}

export function canUsePageHistoryAction({
  objectPermission,
}: {
  objectPermission?: ViewActionCapabilities | null;
}) {
  return objectPermission?.can_read === true && objectPermission.can_write;
}

export function canUseChildViewCreationActions({
  objectPermission,
  spaceSidebar,
}: {
  objectPermission?: ViewActionCapabilities | null;
  /** Only direct space children use this policy. Ordinary nested pages keep their own Write check. */
  spaceSidebar?: { canEdit: boolean };
}) {
  return objectPermission?.can_read === true && objectPermission.can_write && (!spaceSidebar || spaceSidebar.canEdit);
}
