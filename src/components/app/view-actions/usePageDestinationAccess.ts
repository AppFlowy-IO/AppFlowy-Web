import { useEffect, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { AccessService, WorkspaceService } from '@/application/services/domains';
import { AccessLevel, Types, View } from '@/application/types';
import { isSpaceView } from '@/application/view-utils';
import { useAppView, useCurrentWorkspaceId, useEventEmitter } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { isPermissionDeniedError } from '@/components/app/view-actions/viewActionPermission';
import { isUnsupportedRouteError } from '@/utils/errors';

export type PageDestinationDeniedReason = 'noEdit' | 'ownersOnly';

export type PageDestinationAccess =
  | { state: 'none' }
  | { state: 'checking' }
  | { state: 'allowed' }
  /** Could not be checked (offline, server error); the server decides when the page is added. */
  | { state: 'unverified' }
  | { state: 'denied'; reason: PageDestinationDeniedReason };

/** Translation key explaining why pages cannot be added to a destination. */
export function pageDestinationReasonKey(reason: PageDestinationDeniedReason) {
  return reason === 'ownersOnly'
    ? ('spaceCreation.pageDestination.ownersOnly' as const)
    : ('spaceCreation.pageDestination.noEdit' as const);
}

/**
 * Whether the current user may add a page directly under `viewId` (move or duplicate target):
 * destination Write, plus the space's sidebar authority when the destination is a space (P).
 * Only a hint for the UI; the server rechecks the destination when the page is added.
 */
export function usePageDestinationAccess(viewId: string | undefined, enabled: boolean): PageDestinationAccess {
  const view = useAppView(viewId);
  const active = Boolean(enabled && viewId);
  const permissions = useViewActionPermissions(view, active, viewId);

  if (!active) return { state: 'none' };
  if (permissions.isLoadingViewActionPermissions || !permissions.hasLoadedViewActionPermissions) {
    return { state: 'checking' };
  }

  if (permissions.canCreateViewActions) return { state: 'allowed' };
  // A check that could not run is not a denial: as in New Page, the server decides.
  if (permissions.objectPermissionUnavailable) return { state: 'unverified' };
  if (!permissions.canWrite) return { state: 'denied', reason: 'noEdit' };
  if (!isSpaceView(view)) return { state: 'denied', reason: 'noEdit' };
  return permissions.spacePermissionUnavailable ? { state: 'unverified' } : { state: 'denied', reason: 'ownersOnly' };
}

/**
 * Duplicate adds the copy beside its source, so the source's parent must accept a new child.
 * A top-level view has no parent requirement ('none').
 */
export function useDuplicateDestinationAccess(view: View | null | undefined, enabled: boolean) {
  const workspaceId = useCurrentWorkspaceId();
  const parentViewId = view?.parent_view_id && view.parent_view_id !== workspaceId ? view.parent_view_id : undefined;

  return usePageDestinationAccess(parentViewId, enabled);
}

/** A destination the UI may add a page to: confirmed, or unchecked so the server decides. */
export function acceptsPageDestination(access: PageDestinationAccess) {
  return access.state === 'allowed' || access.state === 'unverified';
}

/** Like acceptsPageDestination, but a view without a destination requirement ('none') is allowed. */
export function allowsPageDestination(access: PageDestinationAccess) {
  return access.state === 'none' || acceptsPageDestination(access);
}

export type SpaceDestinationAccess =
  | { state: 'checking' }
  | { state: 'allowed' }
  /** Could not be checked; the server decides when the page is added. */
  | { state: 'unverified' }
  | { state: 'denied'; reason: PageDestinationDeniedReason };

const SPACE_PROBE_CONCURRENCY = 4;
const NO_SPACE_ACCESS: Readonly<Record<string, SpaceDestinationAccess>> = Object.freeze({});

async function canWriteSpace(workspaceId: string, spaceId: string) {
  const permission = await AccessService.getObjectPermission(workspaceId, spaceId, Types.Document);

  return permission.can_read && permission.can_write;
}

/** One request for current servers: the space permission carries both Write and sidebar authority. */
async function probeSpaceDestination(workspaceId: string, spaceId: string): Promise<SpaceDestinationAccess> {
  try {
    const permission = await WorkspaceService.getSpacePermission(workspaceId, spaceId);
    const level = permission.current_user_access_level;
    // Older servers omit the caller's level; read the canonical object permission instead.
    const canWrite =
      level === undefined
        ? await canWriteSpace(workspaceId, spaceId)
        : level !== null && level >= AccessLevel.ReadAndWrite;

    if (!canWrite) return { state: 'denied', reason: 'noEdit' };
    return permission.can_edit_sidebar ? { state: 'allowed' } : { state: 'denied', reason: 'ownersOnly' };
  } catch (error) {
    if (isUnsupportedRouteError(error)) {
      // No structured spaces, so no sidebar policy: Write alone decides, as before.
      try {
        return (await canWriteSpace(workspaceId, spaceId))
          ? { state: 'allowed' }
          : { state: 'denied', reason: 'noEdit' };
      } catch {
        return { state: 'unverified' };
      }
    }

    return isPermissionDeniedError(error) ? { state: 'denied', reason: 'noEdit' } : { state: 'unverified' };
  }
}

/**
 * Where New Page may add a page directly: each space needs Write plus sidebar authority.
 *
 * Each time the dialog opens every space starts as 'checking'. While it stays open, permission
 * notifications re-check in the background and keep the last result until the new one arrives.
 */
export function useSpaceDestinationAccess(
  spaceIds: readonly string[],
  enabled: boolean
): Readonly<Record<string, SpaceDestinationAccess>> {
  const workspaceId = useCurrentWorkspaceId();
  const eventEmitter = useEventEmitter();
  const [state, setState] = useState<{ workspaceId?: string; access: Record<string, SpaceDestinationAccess> }>({
    access: {},
  });
  const [revision, setRevision] = useState(0);
  const idsKey = spaceIds.join('\n');

  useEffect(() => {
    if (!enabled) {
      setState({ access: {} });
      return;
    }

    const recheck = () => setRevision((value) => value + 1);

    eventEmitter?.on(APP_EVENTS.PERMISSION_CHANGED, recheck);
    eventEmitter?.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, recheck);
    return () => {
      eventEmitter?.off(APP_EVENTS.PERMISSION_CHANGED, recheck);
      eventEmitter?.off(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, recheck);
    };
  }, [enabled, eventEmitter]);

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const ids = idsKey ? idsKey.split('\n') : [];
    const queue = [...ids];
    let cancelled = false;
    const work = async () => {
      for (let spaceId = queue.shift(); spaceId !== undefined; spaceId = queue.shift()) {
        const id = spaceId;
        const result = await probeSpaceDestination(workspaceId, id);

        if (cancelled) return;
        setState((current) => ({
          workspaceId,
          access: { ...(current.workspaceId === workspaceId ? current.access : {}), [id]: result },
        }));
      }
    };

    void Promise.all(Array.from({ length: Math.min(SPACE_PROBE_CONCURRENCY, ids.length) }, work));
    return () => {
      cancelled = true;
    };
  }, [enabled, idsKey, revision, workspaceId]);

  return enabled && state.workspaceId === workspaceId ? state.access : NO_SPACE_ACCESS;
}
