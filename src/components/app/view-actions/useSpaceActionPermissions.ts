import { useEffect, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { View } from '@/application/types';
import { useCurrentWorkspaceId, useEventEmitter } from '@/components/app/app.hooks';
import { isUnsupportedRouteError } from '@/utils/errors';

interface LoadedSpaceActionPermissions {
  workspaceId: string;
  viewId: string;
  canOpenManageSpace: boolean;
  usesLegacyManagement: boolean;
}

function isSpaceView(view: View | null | undefined): boolean {
  return view?.is_space === true || view?.extra?.is_space === true;
}

export function useSpaceActionPermissions(
  view: View | null | undefined,
  opened: boolean,
  legacyCanOpenManageSpace = false
) {
  const workspaceId = useCurrentWorkspaceId();
  const eventEmitter = useEventEmitter();
  const viewId = view?.view_id;
  const shouldLoad = Boolean(opened && workspaceId && viewId && isSpaceView(view));
  const [loadedPermissions, setLoadedPermissions] = useState<LoadedSpaceActionPermissions | null>(null);
  const [isLoadingSpaceActionPermissions, setIsLoadingSpaceActionPermissions] = useState(false);
  const [permissionRefreshRevision, setPermissionRefreshRevision] = useState(0);
  const permissionRequestSequenceRef = useRef(0);

  useEffect(() => {
    if (!shouldLoad) return;

    const handlePermissionChanged = () => {
      permissionRequestSequenceRef.current += 1;
      setLoadedPermissions(null);
      setIsLoadingSpaceActionPermissions(true);
      setPermissionRefreshRevision((revision) => revision + 1);
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    return () => {
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    };
  }, [eventEmitter, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || !workspaceId || !viewId) {
      permissionRequestSequenceRef.current += 1;
      setLoadedPermissions(null);
      setIsLoadingSpaceActionPermissions(false);
      return;
    }

    let cancelled = false;
    const requestSequence = ++permissionRequestSequenceRef.current;
    const isCurrentRequest = () => !cancelled && permissionRequestSequenceRef.current === requestSequence;

    setLoadedPermissions(null);
    setIsLoadingSpaceActionPermissions(true);
    void WorkspaceService.getSpacePermission(workspaceId, viewId)
      .then((permission) => {
        if (!isCurrentRequest()) return;
        setLoadedPermissions({
          workspaceId,
          viewId,
          canOpenManageSpace:
            permission.can_edit_sidebar === true ||
            permission.can_invite_members === true ||
            permission.can_manage_members === true ||
            permission.can_manage_space === true,
          usesLegacyManagement: false,
        });
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        const useLegacyManagement = isUnsupportedRouteError(error);

        if (!useLegacyManagement) console.error(error);
        setLoadedPermissions({
          workspaceId,
          viewId,
          // Old servers expose only the legacy /space/:id mutation. Reuse the
          // already-loaded legacy Full Access gate only when the structured
          // route itself is unavailable; all other failures stay fail-closed.
          canOpenManageSpace: false,
          usesLegacyManagement: useLegacyManagement,
        });
      })
      .finally(() => {
        if (isCurrentRequest()) setIsLoadingSpaceActionPermissions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [permissionRefreshRevision, shouldLoad, viewId, workspaceId]);

  const hasLoadedSpaceActionPermissions =
    !shouldLoad || (loadedPermissions?.workspaceId === workspaceId && loadedPermissions?.viewId === viewId);

  return {
    canOpenManageSpace: hasLoadedSpaceActionPermissions
      ? loadedPermissions?.usesLegacyManagement
        ? legacyCanOpenManageSpace
        : loadedPermissions?.canOpenManageSpace === true
      : false,
    hasLoadedSpaceActionPermissions,
    isLoadingSpaceActionPermissions,
  };
}
