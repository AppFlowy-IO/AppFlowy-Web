import { useEffect, useMemo, useRef, useState } from 'react';

import { AccessService } from '@/application/services/domains';
import { ObjectPermission, View } from '@/application/types';
import { findAncestors, findSharedAccessLevel } from '@/components/_shared/outline/utils';
import { useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { resolveCurrentUserAccessLevel } from '@/components/app/share/shareAccessLevel';
import {
  canUseChildViewCreationActions,
  canUsePageHistoryAction,
  canUseViewMutationActions,
} from '@/components/app/view-actions/viewActionPermission';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

export function useViewActionPermissions(view: View | null | undefined, opened: boolean) {
  const workspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUserOptional();
  const outline = useAppOutline();
  const viewId = view?.view_id;
  const requestSeq = useRef(0);
  const outlineRef = useRef(outline);
  const outlineAccessLevelRef = useRef<ReturnType<typeof findSharedAccessLevel> | undefined>(undefined);
  const [loadedViewId, setLoadedViewId] = useState<string | null>(null);
  const [currentUserPermission, setCurrentUserPermission] = useState<ObjectPermission | null>(null);
  const [isLoadingViewActionPermissions, setIsLoadingViewActionPermissions] = useState(false);
  const outlineAccessLevel = useMemo(() => {
    if (!viewId) return undefined;

    return findSharedAccessLevel(outline || [], viewId) ?? view?.access_level;
  }, [outline, view?.access_level, viewId]);

  useEffect(() => {
    outlineRef.current = outline;
    outlineAccessLevelRef.current = outlineAccessLevel;
  }, [outline, outlineAccessLevel]);

  useEffect(() => {
    setLoadedViewId(null);
    setCurrentUserPermission(null);
    setIsLoadingViewActionPermissions(false);
  }, [viewId]);

  useEffect(() => {
    if (!opened || !workspaceId || !viewId) {
      setIsLoadingViewActionPermissions(false);
      return;
    }

    const controller = new AbortController();
    const seq = ++requestSeq.current;
    const ancestorViewIds = findAncestors(outlineRef.current || [], viewId)?.map((item) => item.view_id) || [];

    setLoadedViewId(null);
    setCurrentUserPermission(null);
    setIsLoadingViewActionPermissions(true);

    void AccessService.getShareDetail(workspaceId, viewId, ancestorViewIds, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        const accessLevel = resolveCurrentUserAccessLevel({
          currentUserEmail: currentUser?.email,
          currentUserPermission: detail.current_user_permission ?? null,
          outlineAccessLevel: outlineAccessLevelRef.current,
          sharedPeople: detail.shared_with ?? [],
        });
        const permission =
          detail.current_user_permission || accessLevel !== undefined
            ? {
                ...(detail.current_user_permission ?? {}),
                access_level: accessLevel,
              }
            : null;

        setCurrentUserPermission(permission);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      })
      .catch((error) => {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        console.error(error);
        setCurrentUserPermission(null);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      });

    return () => {
      controller.abort();
    };
  }, [currentUser?.email, opened, viewId, workspaceId]);

  const canLoadViewActionPermissions = Boolean(opened && workspaceId && viewId);
  const hasLoadedViewActionPermissions = !canLoadViewActionPermissions || loadedViewId === viewId;
  const canManageViewActions = hasLoadedViewActionPermissions
    ? canUseViewMutationActions({
        currentUserPermission,
      })
    : false;
  const canUsePageHistory = hasLoadedViewActionPermissions
    ? canUsePageHistoryAction({
        currentUserPermission,
      })
    : false;
  const canCreateViewActions = hasLoadedViewActionPermissions
    ? canUseChildViewCreationActions({
        currentUserPermission,
      })
    : false;

  return {
    canCreateViewActions,
    canManageViewActions,
    canUsePageHistory,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  };
}
