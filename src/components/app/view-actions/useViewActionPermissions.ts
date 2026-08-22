import { useEffect, useRef, useState } from 'react';

import { AccessService } from '@/application/services/domains';
import { type CollabObjectPermission, View } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewObjectPermission } from '@/components/app/hooks/useViewObjectPermission';
import {
  isCollabObjectPermissionForTarget,
  resolvePermissionProbeTarget,
} from '@/components/app/layers/permissionProbe';
import {
  canUseChildViewCreationActions,
  canUsePageHistoryAction,
  canUseViewMutationActions,
} from '@/components/app/view-actions/viewActionPermission';

export function useViewActionPermissions(view: View | null | undefined, opened: boolean) {
  const workspaceId = useCurrentWorkspaceId();
  const viewId = view?.view_id;
  const activeObjectPermission = useViewObjectPermission(viewId);
  const resolvedTarget = viewId ? resolvePermissionProbeTarget(viewId, view) : undefined;
  const collabObjectId = resolvedTarget?.collabObjectId;
  const collabType = resolvedTarget?.collabType;
  const requestSeq = useRef(0);
  const [loadedViewId, setLoadedViewId] = useState<string | null>(null);
  const [objectPermission, setObjectPermission] = useState<CollabObjectPermission | null>(null);
  const [isLoadingViewActionPermissions, setIsLoadingViewActionPermissions] = useState(false);

  useEffect(() => {
    setLoadedViewId(null);
    setObjectPermission(null);
    setIsLoadingViewActionPermissions(false);
  }, [viewId]);

  useEffect(() => {
    if (!opened || !workspaceId || !viewId || collabObjectId === undefined || collabType === undefined) {
      setIsLoadingViewActionPermissions(false);
      return;
    }

    const seq = ++requestSeq.current;
    const target = { collabObjectId, collabType };

    if (activeObjectPermission && isCollabObjectPermissionForTarget(activeObjectPermission, target)) {
      setObjectPermission(activeObjectPermission);
      setLoadedViewId(viewId);
      setIsLoadingViewActionPermissions(false);

      return;
    }

    let cancelled = false;

    setLoadedViewId(null);
    setObjectPermission(null);
    setIsLoadingViewActionPermissions(true);

    void AccessService.getObjectPermission(workspaceId, target.collabObjectId, target.collabType)
      .then((permission) => {
        if (cancelled || seq !== requestSeq.current) return;

        setObjectPermission(isCollabObjectPermissionForTarget(permission, target) ? permission : null);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      })
      .catch((error) => {
        if (cancelled || seq !== requestSeq.current) return;
        console.error(error);
        setObjectPermission(null);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeObjectPermission, collabObjectId, collabType, opened, viewId, workspaceId]);

  const canLoadViewActionPermissions = Boolean(
    opened && workspaceId && viewId && collabObjectId !== undefined && collabType !== undefined
  );
  const hasLoadedViewActionPermissions = !canLoadViewActionPermissions || loadedViewId === viewId;
  const permissionForCurrentView = loadedViewId === viewId ? objectPermission : null;
  const canManageViewActions = hasLoadedViewActionPermissions
    ? canUseViewMutationActions({ objectPermission: permissionForCurrentView })
    : false;
  const canUsePageHistory = hasLoadedViewActionPermissions
    ? canUsePageHistoryAction({ objectPermission: permissionForCurrentView })
    : false;
  const canCreateViewActions = hasLoadedViewActionPermissions
    ? canUseChildViewCreationActions({ objectPermission: permissionForCurrentView })
    : false;

  return {
    canCreateViewActions,
    canManageViewActions,
    canUsePageHistory,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  };
}
