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

  // Permission notifications, a return online and focus re-read this hook's own answer in the
  // background: long-lived callers (embedded databases, sidebar rows, open menus) would flip
  // read-only or hide their actions if the answer were cleared, so it stays until the read lands
  // and replaces it. Focus fires on every alt-tab and closed file picker, so it re-reads only a
  // stale answer. An answer taken from the active page follows AppBusinessLayer, which re-probes
  // it on the same events.
  useEffect(() => {
    if (!opened || !workspaceId || !viewId) return;
    let cancelled = false;
    const knownTarget =
      collabObjectId !== undefined && collabType !== undefined ? { collabObjectId, collabType } : undefined;

    // Re-reads the answer this hook read itself while keeping it; returns whether there is one.
    const revalidate = (onlyIfStale: boolean) => {
      const lastRead = lastReadRef.current;

      if (!lastRead || lastRead.viewId !== viewId) return false;
      if (onlyIfStale && Date.now() - lastRead.at < FOCUS_REVALIDATE_MIN_AGE_MS) return true;
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
      return true;
    };

    const revalidateOnFocus = () => {
      revalidate(true);
    };

    let pendingRevalidation: ReturnType<typeof setTimeout> | undefined;

    const revalidateNow = () => {
      // Fence older reads at once, but read again only once the event's other listeners
      // (AppBusinessLayer, workspace data) have superseded the reads in flight; a read started before
      // them would spend its one superseded retry on this change and could keep the old answer.
      requestSeq.current += 1;
      if (pendingRevalidation !== undefined) return;
      pendingRevalidation = setTimeout(() => {
        pendingRevalidation = undefined;
        if (revalidate(false)) return;
        // A first read was in flight: restart it. An answer taken from the active page is kept
        // and follows AppBusinessLayer's re-probe.
        setPermissionRefreshRevision((revision) => revision + 1);
      }, 0);
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, revalidateNow);
    window.addEventListener('online', revalidateNow);
    window.addEventListener('focus', revalidateOnFocus);
    return () => {
      cancelled = true;
      clearTimeout(pendingRevalidation);
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, revalidateNow);
      window.removeEventListener('online', revalidateNow);
      window.removeEventListener('focus', revalidateOnFocus);
    };
  }, [collabObjectId, collabType, eventEmitter, opened, viewId, workspaceId]);

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
    // validating their collab identity, keeps them only for the views it
    // renders and re-probes those in the background after every permission
    // change, so its answer is followed rather than read again. This is also
    // the best source when an off-outline database view has no local metadata yet.
    if (
      activeObjectPermission &&
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

    // A permission change that fenced this first read bumps permissionRefreshRevision to restart it.
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
