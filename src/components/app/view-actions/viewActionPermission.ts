import { ERROR_CODE } from '@/application/constants';
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

/**
 * Whether a failed permission read is the server refusing access (a decision), as opposed to a
 * read that could not complete (offline, server error), which decides nothing.
 */
export function isPermissionDeniedError(error: unknown) {
  const value = error as { code?: unknown; httpStatus?: unknown } | null;

  return value?.httpStatus === 403 || value?.code === ERROR_CODE.NOT_HAS_PERMISSION;
}
