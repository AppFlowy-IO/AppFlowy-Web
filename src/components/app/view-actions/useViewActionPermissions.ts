import { useEffect, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { AccessService, ViewService } from '@/application/services/domains';
import { type CollabObjectPermission, View } from '@/application/types';
import { isSpaceView } from '@/application/view-utils';
import { useCurrentWorkspaceId, useEventEmitter } from '@/components/app/app.hooks';
import { useViewObjectPermission } from '@/components/app/hooks/useViewObjectPermission';
import {
  isCollabObjectPermissionForTarget,
  findPermissionProbeView,
  type PermissionProbeTarget,
  resolvePermissionProbeTarget,
} from '@/components/app/layers/permissionProbe';
import { useSpaceActionPermissions } from '@/components/app/view-actions/useSpaceActionPermissions';
import {
  canUseChildViewCreationActions,
  canUsePageHistoryAction,
  canUseViewMutationActions,
  isPermissionDeniedError,
} from '@/components/app/view-actions/viewActionPermission';

/** A window focus re-reads an answer only once it was last read this long ago. */
const FOCUS_REVALIDATE_MIN_AGE_MS = 30_000;

async function readObjectPermission(workspaceId: string, viewId: string, knownTarget?: PermissionProbeTarget) {
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
}

export function useViewActionPermissions(
  view: View | null | undefined,
  opened: boolean,
  fallbackViewId?: string,
  explicitTarget?: PermissionProbeTarget
) {
  const workspaceId = useCurrentWorkspaceId();
  const eventEmitter = useEventEmitter();
  const spaceSidebar = useSpaceActionPermissions(view, opened && isSpaceView(view));
  const viewId = view?.view_id ?? fallbackViewId;
  const activeObjectPermission = useViewObjectPermission(viewId);
  const resolvedTarget =
    explicitTarget ?? (viewId && view ? resolvePermissionProbeTarget(viewId, view) : undefined);
  const collabObjectId = resolvedTarget?.collabObjectId;
  const collabType = resolvedTarget?.collabType;
  const requestSeq = useRef(0);
  // The view whose shown answer this hook read from the server itself, and when it last asked.
  const lastReadRef = useRef<{ viewId: string; at: number } | null>(null);
  const [loadedViewId, setLoadedViewId] = useState<string | null>(null);
  const [objectPermission, setObjectPermission] = useState<CollabObjectPermission | null>(null);
  // The view whose object permission read failed without a decision (offline, server error).
  const [unavailableViewId, setUnavailableViewId] = useState<string | null>(null);
  const [isLoadingViewActionPermissions, setIsLoadingViewActionPermissions] = useState(false);
  const [permissionRefreshRevision, setPermissionRefreshRevision] = useState(0);

  useEffect(() => {
    if (!opened) return;
    const invalidate = () => {
      // Menus may target an off-outline view that AppBusinessLayer does not currently render.
      // Fence its in-flight response and bypass any earlier positive context snapshot as well.
      requestSeq.current += 1;
      lastReadRef.current = null;
      setLoadedViewId(null);
      setObjectPermission(null);
      setIsLoadingViewActionPermissions(true);
      setPermissionRefreshRevision((revision) => revision + 1);
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, invalidate);
    window.addEventListener('online', invalidate);
    return () => {
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, invalidate);
      window.removeEventListener('online', invalidate);
    };
  }, [eventEmitter, opened]);

  // Focus fires on every alt-tab and closed file picker, and long-lived callers (embedded
  // databases, sidebar rows) would flip read-only if it cleared the answer. Re-read this hook's
  // own answer in the background once it is stale and replace it when the read lands. An answer
  // taken from the active page is re-probed by AppBusinessLayer instead.
  useEffect(() => {
    if (!opened || !workspaceId || !viewId) return;
    let cancelled = false;
    const knownTarget =
      collabObjectId !== undefined && collabType !== undefined ? { collabObjectId, collabType } : undefined;

    const revalidate = () => {
      const lastRead = lastReadRef.current;

      if (!lastRead || lastRead.viewId !== viewId || Date.now() - lastRead.at < FOCUS_REVALIDATE_MIN_AGE_MS) return;
      const seq = ++requestSeq.current;

      lastReadRef.current = { viewId, at: Date.now() };
      void readObjectPermission(workspaceId, viewId, knownTarget)
        .then(({ permission, target }) => {
          if (cancelled || seq !== requestSeq.current) return;
          setObjectPermission(isCollabObjectPermissionForTarget(permission, target) ? permission : null);
          setUnavailableViewId(null);
        })
        .catch((error) => {
          if (cancelled || seq !== requestSeq.current) return;
          console.error(error);
          // A read that could not run keeps the last answer; the server checks every action anyway.
          if (!isPermissionDeniedError(error)) return;
          setObjectPermission(null);
          setUnavailableViewId(null);
        });
    };

    window.addEventListener('focus', revalidate);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', revalidate);
    };
  }, [collabObjectId, collabType, opened, viewId, workspaceId]);

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
      permissionRefreshRevision === 0 &&
      (!knownTarget || isCollabObjectPermissionForTarget(activeObjectPermission, knownTarget))
    ) {
      lastReadRef.current = null;
      setObjectPermission(activeObjectPermission);
      setUnavailableViewId(null);
      setLoadedViewId(viewId);
      setIsLoadingViewActionPermissions(false);

      return;
    }

    let cancelled = false;

    lastReadRef.current = null;
    setLoadedViewId(null);
    setObjectPermission(null);
    setIsLoadingViewActionPermissions(true);

    void readObjectPermission(workspaceId, viewId, knownTarget)
      .then(({ permission, target }) => {
        if (cancelled || seq !== requestSeq.current) return;

        lastReadRef.current = { viewId, at: Date.now() };
        setObjectPermission(isCollabObjectPermissionForTarget(permission, target) ? permission : null);
        setUnavailableViewId(null);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      })
      .catch((error) => {
        if (cancelled || seq !== requestSeq.current) return;
        console.error(error);
        lastReadRef.current = { viewId, at: Date.now() };
        setObjectPermission(null);
        setUnavailableViewId(isPermissionDeniedError(error) ? null : viewId);
        setLoadedViewId(viewId);
        setIsLoadingViewActionPermissions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeObjectPermission, collabObjectId, collabType, opened, permissionRefreshRevision, viewId, workspaceId]);

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
    ? canUseChildViewCreationActions({
        objectPermission: permissionForCurrentView,
        spaceSidebar: isSpaceView(view) ? { canEdit: spaceSidebar.canEditSidebar } : undefined,
      })
    : false;

  return {
    canRead,
    canShare,
    canWrite,
    canCreateViewActions,
    canManageViewActions,
    canUsePageHistory,
    // Space-only authority from the same read, so callers never probe the space a second time.
    canOpenManageSpace: spaceSidebar.canOpenManageSpace,
    canEditSidebar: spaceSidebar.canEditSidebar,
    /**
     * The checks could not run (offline, server error): the gates above stay closed, but this is
     * not a denial, so callers may let the server decide instead of showing a denial reason.
     */
    objectPermissionUnavailable: loadedViewId === viewId && unavailableViewId === viewId,
    spacePermissionUnavailable: spaceSidebar.spacePermissionUnavailable,
    hasLoadedViewActionPermissions: hasLoadedViewActionPermissions && spaceSidebar.hasLoadedSpaceActionPermissions,
    isLoadingViewActionPermissions: isLoadingViewActionPermissions || spaceSidebar.isLoadingSpaceActionPermissions,
  };
}
