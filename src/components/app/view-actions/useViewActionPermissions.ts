import { useEffect, useRef, useState } from 'react';

import { AccessService, ViewService } from '@/application/services/domains';
import { type CollabObjectPermission, View } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewObjectPermission } from '@/components/app/hooks/useViewObjectPermission';
import {
  isCollabObjectPermissionForTarget,
  findPermissionProbeView,
  type PermissionProbeTarget,
  resolvePermissionProbeTarget,
} from '@/components/app/layers/permissionProbe';
import {
  canUseChildViewCreationActions,
  canUsePageHistoryAction,
  canUseViewMutationActions,
} from '@/components/app/view-actions/viewActionPermission';

export function useViewActionPermissions(
  view: View | null | undefined,
  opened: boolean,
  fallbackViewId?: string,
  explicitTarget?: PermissionProbeTarget
) {
  const workspaceId = useCurrentWorkspaceId();
  const viewId = view?.view_id ?? fallbackViewId;
  const activeObjectPermission = useViewObjectPermission(viewId);
  const resolvedTarget =
    explicitTarget ?? (viewId && view ? resolvePermissionProbeTarget(viewId, view) : undefined);
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
    if (!opened || !workspaceId || !viewId) {
      setIsLoadingViewActionPermissions(false);
      return;
    }

    const seq = ++requestSeq.current;
    const knownTarget =
      collabObjectId !== undefined && collabType !== undefined ? { collabObjectId, collabType } : undefined;

    // AppBusinessLayer indexes canonical permissions by folder view id after
    // validating their collab identity. This is also the best source when an
    // off-outline database view has no local metadata yet.
    if (
      activeObjectPermission &&
      (!knownTarget || isCollabObjectPermissionForTarget(activeObjectPermission, knownTarget))
    ) {
      setObjectPermission(activeObjectPermission);
      setLoadedViewId(viewId);
      setIsLoadingViewActionPermissions(false);

      return;
    }

    let cancelled = false;

    setLoadedViewId(null);
    setObjectPermission(null);
    setIsLoadingViewActionPermissions(true);

    void (async () => {
      let target = knownTarget;

      if (!target) {
        // A modal or fallback route can be valid without being materialized in
        // the outline. Resolve its database identity from direct metadata; if
        // that workspace-scoped read is unavailable to a guest, fall back to
        // the document identity and let the permission endpoint decide.
        const responseRoot = await ViewService.get(workspaceId, viewId).catch(() => undefined);
        const fallbackView = findPermissionProbeView(viewId, responseRoot);

        target = resolvePermissionProbeTarget(viewId, fallbackView);
      }

      return {
        permission: await AccessService.getObjectPermission(workspaceId, target.collabObjectId, target.collabType),
        target,
      };
    })()
      .then(({ permission, target }) => {
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

  const canLoadViewActionPermissions = Boolean(opened && workspaceId && viewId);
  const hasLoadedViewActionPermissions = !canLoadViewActionPermissions || loadedViewId === viewId;
  const permissionForCurrentView = loadedViewId === viewId ? objectPermission : null;
  const canRead = hasLoadedViewActionPermissions && permissionForCurrentView?.can_read === true;
  const canWrite = canRead && permissionForCurrentView.can_write;
  const canShare = canRead && permissionForCurrentView.can_share;
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
    canRead,
    canShare,
    canWrite,
    canCreateViewActions,
    canManageViewActions,
    canUsePageHistory,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  };
}
