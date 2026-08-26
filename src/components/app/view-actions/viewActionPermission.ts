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
}: {
  objectPermission?: ViewActionCapabilities | null;
}) {
  return objectPermission?.can_read === true && objectPermission.can_write;
}
