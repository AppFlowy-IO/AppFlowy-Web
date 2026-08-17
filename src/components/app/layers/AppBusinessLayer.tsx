import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService } from '@/application/services/domains';
import { getTokenParsed } from '@/application/session/token';
import { LoadViewOptions, TextCount, View } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AppNavigationContext, AppNavigationContextType } from '@/components/app/contexts/AppNavigationContext';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContext, AppOutlineContextType } from '@/components/app/contexts/AppOutlineContext';
import { AppSyncContext, AppSyncContextType } from '@/components/app/contexts/AppSyncContext';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import {
  DATABASE_TAB_VIEW_ID_QUERY_PARAM,
  resolveSidebarSelectedViewId,
} from '@/components/app/hooks/resolveSidebarSelectedViewId';

import { AppContextConsumer } from '../components/AppContextConsumer';
import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useDatabaseOperations } from '../hooks/useDatabaseOperations';
import { usePageOperations } from '../hooks/usePageOperations';
import { useRowOperations } from '../hooks/useRowOperations';
import { useViewOperations } from '../hooks/useViewOperations';
import { useWorkspaceData } from '../hooks/useWorkspaceData';

import {
  bumpPermissionProbeRevision,
  clearPermissionProbeCacheForScope,
  createPermissionProbeCacheKey,
  findPermissionProbeView,
  getPermissionProbePurgeObjectIds,
  resolvePermissionProbeTarget,
  type PermissionProbeTarget,
} from './permissionProbe';

interface AppBusinessLayerProps {
  children: ReactNode;
}

const ROUTE_VIEW_EXISTS_CACHE_MAX = 200;
const ROUTE_VIEW_EXISTS_REVALIDATE_MS = 10000;

// Open-time permission probes share one short-lived cache so rapid navigation
// between the same pages does not refire identical permission GETs.
const PERMISSION_PROBE_TTL_MS = 10000;
const PERMISSION_PROBE_CACHE_MAX = 200;

type PermissionProbeVerdict = 'allowed' | 'denied' | 'unknown';
type PermissionProbeResult = PermissionProbeTarget & { verdict: PermissionProbeVerdict };
const permissionProbeCache = new Map<string, { probedAt: number; promise: Promise<PermissionProbeResult> }>();
const ROUTE_NOT_FOUND_MESSAGE_PATTERN = /\b(not\s*found|record\s*not\s*found|view\s*not\s*found|page\s*not\s*found)\b/i;

type RouteViewExistsCacheEntry = {
  exists: boolean;
  checkedAt: number;
};

function isRouteNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const normalizedError = error as {
    code?: number;
    status?: number;
    message?: string;
    response?: {
      status?: number;
      data?: {
        code?: number;
        message?: string;
      };
    };
  };

  const statusCode = normalizedError.status ?? normalizedError.response?.status;
  const appCode = normalizedError.code ?? normalizedError.response?.data?.code;
  const message = normalizedError.message || normalizedError.response?.data?.message || '';

  if (statusCode === 404 || appCode === 404) return true;
  return ROUTE_NOT_FOUND_MESSAGE_PATTERN.test(message);
}

async function resolvePermissionProbeTargetFromMetadata(
  workspaceId: string,
  viewId: string,
  outline: View[]
): Promise<PermissionProbeTarget> {
  const memoryView =
    findView(outline, viewId) ?? findPermissionProbeView(viewId, ViewService.getCached(workspaceId, viewId));

  if (memoryView) return resolvePermissionProbeTarget(viewId, memoryView);

  const diskResponse = await ViewService.getCachedFromDisk(workspaceId, viewId).catch(() => undefined);
  const diskView = findPermissionProbeView(viewId, diskResponse);

  if (diskView) return resolvePermissionProbeTarget(viewId, diskView);

  const responseRoot = await ViewService.get(workspaceId, viewId);
  const routeView = findPermissionProbeView(viewId, responseRoot);

  return resolvePermissionProbeTarget(viewId, routeView);
}

function purgePermissionProbeTarget(workspaceId: string, routeViewId: string, target: PermissionProbeTarget) {
  ViewService.invalidateCache(workspaceId, routeViewId);

  // Current database caches use the canonical database id, while older web
  // releases may also have persisted a database under the folder view id.
  // Remove both identities so neither copy can keep revoked content readable.
  for (const collabObjectId of getPermissionProbePurgeObjectIds(routeViewId, target)) {
    void deleteCollabDB(collabObjectId, { destroyDoc: true });
  }
}

// Third layer: Business logic operations
// Handles all business operations like outline management, page operations, database operations
// Depends on workspace ID and sync context from previous layers
export const AppBusinessLayer: FC<AppBusinessLayerProps> = ({ children }) => {
  const authContext = useAuthInternal();
  const { currentWorkspaceId, isAuthenticated, userWorkspaceInfo } = authContext;
  const requesterId = isAuthenticated ? getTokenParsed()?.user?.id ?? userWorkspaceInfo?.userId : undefined;
  const currentRequesterIdRef = useRef(requesterId);
  const permissionProbeSessionRevisionRef = useRef(0);
  const permissionProbeRevisionRef = useRef<Map<string, number>>(new Map());
  const [permissionProbeRefreshRevision, setPermissionProbeRefreshRevision] = useState(0);

  currentRequesterIdRef.current = requesterId;
  const syncContext = useSyncInternal();
  const { revertCollabVersion } = syncContext;
  const params = useParams();
  const [searchParams] = useSearchParams();

  // UI state
  const [rendered, setRendered] = useState(false);
  const [openModalViewId, setOpenModalViewId] = useState<string | undefined>(undefined);
  const wordCountRef = useRef<Record<string, TextCount>>({});
  const routeViewExistsCacheRef = useRef<Map<string, RouteViewExistsCacheEntry>>(new Map());
  const routeViewExistsInFlightRef = useRef<Map<string, Promise<boolean | null>>>(new Map());

  // Calculate view ID from params
  const viewId = useMemo(() => {
    const id = params.viewId;

    if (id && !uuidValidate(id)) return;
    return id;
  }, [params.viewId]);
  const tabViewId = searchParams.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM) ?? undefined;

  // Initialize workspace data management
  const {
    outline,
    favoriteViews,
    recentViews,
    trashList,
    workspaceDatabases,
    requestAccessError,
    loadOutline,
    loadFavoriteViews,
    loadRecentViews,
    loadTrash,
    loadDatabaseRelations,
    loadViews,
    getMentionUser,
    loadMentionableUsers,
    stableOutlineRef,
    loadedViewIds,
    loadViewChildren,
    loadViewChildrenBatch,
    markViewChildrenStale,
    ensureViewVisibleInOutline,
    revalidateSidebarOutline,
  } = useWorkspaceData();

  const breadcrumbViewId = useMemo(() => {
    return resolveSidebarSelectedViewId({
      routeViewId: viewId,
      tabViewId,
      outline,
    });
  }, [outline, tabViewId, viewId]);

  // Initialize view operations
  const {
    loadView,
    toView,
    awarenessMap,
    getDatabaseIdForViewId,
    getViewIdFromDatabaseId,
    bindViewSync,
    getCollabHistory,
    previewCollabVersion,
  } = useViewOperations({ loadDatabaseRelations });

  // Initialize row operations
  const { createRow } = useRowOperations();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const globalWindow = window as typeof window & {
      Cypress?: unknown;
      __APPFLOWY_AWARENESS_MAP__?: Record<string, import('y-protocols/awareness').Awareness>;
    };

    if (globalWindow.Cypress) {
      globalWindow.__APPFLOWY_AWARENESS_MAP__ = awarenessMap;
    }
  }, [awarenessMap]);

  // Initialize page operations
  const {
    addPage,
    deletePage: rawDeletePage,
    duplicatePage,
    updatePage,
    updatePageIcon,
    updatePageName,
    movePage,
    deleteTrash,
    restorePage,
    createSpace,
    createSpaceWithInitialPage,
    updateSpace,
    createDatabaseView,
    uploadFile,
    getSubscriptions,
    publish,
    unpublish,
    createOrphanedView,
  } = usePageOperations({
    outlineRef: stableOutlineRef,
    loadOutline,
    flushAllSync: syncContext.flushAllSync,
    syncAllToServer: syncContext.syncAllToServer,
    loadViewChildren,
    getDatabaseIdForViewId,
  });

  // Check if current view has been deleted
  const viewHasBeenDeleted = useMemo(() => {
    if (!viewId) return false;
    return trashList?.some((v) => v.view_id === viewId);
  }, [trashList, viewId]);

  const [routeViewExists, setRouteViewExists] = useState<boolean | null>(null);

  // Reset when viewId changes so stale false from a previous page
  // doesn't flash "Page not found" for the new page.
  const prevViewIdRef = useRef(viewId);

  if (viewId !== prevViewIdRef.current) {
    prevViewIdRef.current = viewId;

    if (routeViewExists === false) {
      setRouteViewExists(null);
    }
  }

  const setRouteViewExistsCache = useCallback((key: string, exists: boolean) => {
    const cache = routeViewExistsCacheRef.current;

    if (cache.size >= ROUTE_VIEW_EXISTS_CACHE_MAX) {
      const oldestKey = cache.keys().next().value;

      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }

    cache.set(key, {
      exists,
      checkedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    routeViewExistsCacheRef.current.clear();
    routeViewExistsInFlightRef.current.clear();
  }, [currentWorkspaceId]);

  // Route-level not-found guard:
  // 1) If view is in current outline tree, it exists.
  // 2) Otherwise validate via server to support depth=1 lazy outlines.
  useEffect(() => {
    if (!viewId || viewHasBeenDeleted) {
      setRouteViewExists(null);
      return;
    }

    if (findView(outline ?? [], viewId)) {
      setRouteViewExists(true);
      return;
    }

    if (!currentWorkspaceId) {
      setRouteViewExists(null);
      return;
    }

    const cacheKey = `${currentWorkspaceId}:${viewId}`;
    const cached = routeViewExistsCacheRef.current.get(cacheKey);
    const cacheExpired = cached ? Date.now() - cached.checkedAt >= ROUTE_VIEW_EXISTS_REVALIDATE_MS : true;

    // Cache policy: both true and false are periodically revalidated.
    // A false entry may be stale if the view was created or synced after
    // the original check (e.g. sync lag, eventual consistency).
    if (cached && !cacheExpired) {
      setRouteViewExists(cached.exists);
      return;
    }

    let cancelled = false;
    const hasCachedTrue = cached?.exists === true;

    if (!hasCachedTrue) {
      setRouteViewExists(null);
    } else {
      // Keep UI stable while doing background revalidation for stale cached true.
      setRouteViewExists(true);
    }

    let inFlight = routeViewExistsInFlightRef.current.get(cacheKey);

    if (!inFlight) {
      inFlight = ViewService.get(currentWorkspaceId, viewId)
        .then(() => {
          setRouteViewExistsCache(cacheKey, true);
          return true;
        })
        .catch((error: unknown) => {
          // Only cache "missing" when server confirms not-found.
          // Network/transient/server errors should remain unknown (null).
          if (isRouteNotFoundError(error)) {
            setRouteViewExistsCache(cacheKey, false);
            return false;
          }

          return null;
        })
        .then((exists) => {
          routeViewExistsInFlightRef.current.delete(cacheKey);
          return exists;
        });
      routeViewExistsInFlightRef.current.set(cacheKey, inFlight);
    }

    void inFlight.then((exists) => {
      if (!cancelled) {
        if (exists === null && hasCachedTrue) {
          setRouteViewExists(true);
        } else {
          setRouteViewExists(exists);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [viewId, viewHasBeenDeleted, outline, currentWorkspaceId, setRouteViewExistsCache]);

  const viewNotFound = Boolean(viewId && !viewHasBeenDeleted && routeViewExists === false);

  // Open-time permission gate: local-first rendering serves cached pages
  // without consulting the server, so a user whose access was revoked could
  // otherwise keep reading a page from IndexedDB indefinitely. Probe the
  // object-permission API in the background on navigation; on a definitive
  // denial show the no-access page and purge the local copies.
  //
  // The denied view id (not a boolean) is stored so `viewNoAccess` derives
  // during render — navigating away never flashes the no-access screen on
  // the next page while waiting for an effect to reset a flag.
  const [noAccessViewId, setNoAccessViewId] = useState<string | null>(null);
  const viewNoAccess = Boolean(viewId && noAccessViewId === viewId);

  useEffect(() => {
    const invalidatePermissionProbeSession = () => {
      permissionProbeSessionRevisionRef.current += 1;

      if (requesterId && currentWorkspaceId) {
        clearPermissionProbeCacheForScope(permissionProbeCache, requesterId, currentWorkspaceId);
      }
    };

    // Module-level verdicts are reusable only within one authenticated layer
    // session. Clear this identity's scope on mount, auth/workspace changes,
    // and unmount so A -> logout -> A always performs a fresh probe.
    invalidatePermissionProbeSession();
    return invalidatePermissionProbeSession;
  }, [currentWorkspaceId, requesterId]);

  useEffect(() => {
    // A denial belongs to the requester/workspace that produced it. Clear the
    // rendered gate immediately when either identity changes; the probe below
    // then runs under the new requester-scoped cache key.
    setNoAccessViewId(null);
  }, [currentWorkspaceId, requesterId]);

  useEffect(() => {
    if (!currentWorkspaceId || !requesterId) return;

    // A page modal owns a separate collab from the route underneath it. Probe
    // both active targets so opening a cached modal never bypasses the
    // open-time permission gate. De-duplicate the common case where both ids
    // happen to be the same.
    const activeViewIds = Array.from(
      new Set(
        [viewHasBeenDeleted ? undefined : viewId, openModalViewId].filter((activeViewId): activeViewId is string =>
          Boolean(activeViewId)
        )
      )
    );

    if (activeViewIds.length === 0) return;

    let cancelled = false;
    const workspaceId = currentWorkspaceId;
    const sessionRevision = permissionProbeSessionRevisionRef.current;

    activeViewIds.forEach((activeViewId) => {
      const cacheKey = createPermissionProbeCacheKey(requesterId, workspaceId, activeViewId);
      const probeRevision = permissionProbeRevisionRef.current.get(cacheKey) ?? 0;
      const cached = permissionProbeCache.get(cacheKey);
      let probe = cached && Date.now() - cached.probedAt < PERMISSION_PROBE_TTL_MS ? cached.promise : undefined;

      if (!probe) {
        const outline = stableOutlineRef.current ?? [];
        const fallbackTarget = resolvePermissionProbeTarget(
          activeViewId,
          findView(outline, activeViewId) ??
            findPermissionProbeView(activeViewId, ViewService.getCached(workspaceId, activeViewId))
        );

        const probePermission = (target: PermissionProbeTarget) =>
          AccessService.getObjectPermission(workspaceId, target.collabObjectId, target.collabType)
            .then(
              (permission): PermissionProbeResult => ({
                ...target,
                verdict: permission?.can_read === false ? 'denied' : 'allowed',
              })
            )
            .catch((error: unknown): PermissionProbeResult => {
              // Only a definitive permission denial counts. Transient/network/404
              // errors must not evict local data (a brand-new page can briefly 404
              // here before the server projects its permission records).
              const code = (error as { code?: number } | null)?.code;

              return {
                ...target,
                verdict: code === ERROR_CODE.NOT_HAS_PERMISSION || code === 403 ? 'denied' : 'unknown',
              };
            });

        probe = resolvePermissionProbeTargetFromMetadata(workspaceId, activeViewId, outline)
          // Resolving the target reads folder metadata, which is not a permission
          // signal: the workspace-scoped view endpoint 403s for guests, who hold
          // view-level access without workspace membership. Treating that as a
          // denial gated legitimately shared pages and purged their local copy.
          // Fall back to the cached identity and let the object-permission API —
          // which guests can call — return the authoritative verdict.
          .catch(() => fallbackTarget)
          .then(probePermission);
        if (permissionProbeCache.size >= PERMISSION_PROBE_CACHE_MAX) {
          const oldestKey = permissionProbeCache.keys().next().value;

          if (oldestKey !== undefined) permissionProbeCache.delete(oldestKey);
        }

        permissionProbeCache.set(cacheKey, { probedAt: Date.now(), promise: probe });
      }

      void probe.then((result) => {
        // A denied verdict is a permission error and must not be served from the
        // probe cache for the rest of its TTL: the server can grant access at any
        // moment, and a retained denial keeps suppressing the re-probe. Evict it
        // as soon as it resolves (before any supersession guard), keyed on the
        // promise identity so a newer probe is never dropped by an older one.
        if (result.verdict === 'denied') {
          const retained = permissionProbeCache.get(cacheKey);

          if (retained && retained.promise === probe) permissionProbeCache.delete(cacheKey);
        }

        // Ignore a result superseded by an auth transition or an explicit
        // revoke/restore notification. Route-only navigation does not change
        // the revision, so a confirmed revoke still purges an off-screen page.
        if (currentRequesterIdRef.current !== requesterId) return;
        if (permissionProbeSessionRevisionRef.current !== sessionRevision) return;
        if ((permissionProbeRevisionRef.current.get(cacheKey) ?? 0) !== probeRevision) return;
        const latestProbe = permissionProbeCache.get(cacheKey);

        // A TTL refresh may replace an unresolved probe without a push event.
        // In that case only the newest promise is allowed to mutate access state.
        if (latestProbe && latestProbe.promise !== probe) return;

        if (result.verdict === 'denied') {
          // Evict even if this navigation was superseded — revoked content must
          // not stay readable from the local caches.
          purgePermissionProbeTarget(workspaceId, activeViewId, result);
          if (!cancelled) {
            if (activeViewId === viewId) setNoAccessViewId(activeViewId);
            // ViewModal owns its loaded Y.Doc and does not consume the route's
            // no-access state, so close it to stop rendering revoked content.
            setOpenModalViewId((currentModalViewId) =>
              currentModalViewId === activeViewId ? undefined : currentModalViewId
            );
          }
        } else if (result.verdict === 'allowed' && !cancelled && activeViewId === viewId) {
          setNoAccessViewId((prev) => (prev === activeViewId ? null : prev));
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    viewId,
    openModalViewId,
    currentWorkspaceId,
    requesterId,
    viewHasBeenDeleted,
    stableOutlineRef,
    permissionProbeRefreshRevision,
  ]);

  // Push path: targeted share notifications carry a view id, while broad
  // permission notifications can identify a workspace group. Keep the active
  // route and modal probes outside the outline layer so both rendered targets
  // are re-checked even when the notification cannot name an affected view.
  useEffect(() => {
    const invalidatePermissionProbe = (changedViewId: string) => {
      if (!currentWorkspaceId || !requesterId) return;

      const cacheKey = createPermissionProbeCacheKey(requesterId, currentWorkspaceId, changedViewId);

      permissionProbeCache.delete(cacheKey);
      bumpPermissionProbeRevision(permissionProbeRevisionRef.current, cacheKey);
    };

    const revalidateActiveViews = (excludedViewId?: string) => {
      // A targeted share notification does not name affected descendants, and
      // a broad permission notification may name a group instead of a view.
      // Conservatively re-probe the few currently rendered targets.
      const activeViewIds = Array.from(
        new Set(
          [viewHasBeenDeleted ? undefined : viewId, openModalViewId].filter(
            (activeViewId): activeViewId is string => Boolean(activeViewId)
          )
        )
      ).filter((activeViewId) => activeViewId !== excludedViewId);

      if (activeViewIds.length === 0) return;
      activeViewIds.forEach(invalidatePermissionProbe);
      setPermissionProbeRefreshRevision((revision) => revision + 1);
    };

    const handlePermissionChanged = () => {
      revalidateActiveViews();
    };

    const handleViewAccessRevoked = (payload?: { viewId?: string | null }) => {
      const revokedViewId = payload?.viewId;

      if (!revokedViewId) return;
      invalidatePermissionProbe(revokedViewId);
      setNoAccessViewId(revokedViewId);
      setOpenModalViewId((currentModalViewId) =>
        currentModalViewId === revokedViewId ? undefined : currentModalViewId
      );
      revalidateActiveViews(revokedViewId);
    };

    const handleViewAccessRestored = (payload?: { viewId?: string | null }) => {
      const restoredViewId = payload?.viewId;

      if (!restoredViewId) return;
      invalidatePermissionProbe(restoredViewId);
      setNoAccessViewId((prev) => (prev === restoredViewId ? null : prev));
      revalidateActiveViews(restoredViewId);
    };

    syncContext.eventEmitter?.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    syncContext.eventEmitter?.on(APP_EVENTS.VIEW_ACCESS_REVOKED, handleViewAccessRevoked);
    syncContext.eventEmitter?.on(APP_EVENTS.VIEW_ACCESS_RESTORED, handleViewAccessRestored);

    return () => {
      syncContext.eventEmitter?.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
      syncContext.eventEmitter?.off(APP_EVENTS.VIEW_ACCESS_REVOKED, handleViewAccessRevoked);
      syncContext.eventEmitter?.off(APP_EVENTS.VIEW_ACCESS_RESTORED, handleViewAccessRestored);
    };
  }, [syncContext.eventEmitter, currentWorkspaceId, requesterId, viewId, openModalViewId, viewHasBeenDeleted]);

  // Calculate breadcrumbs based on current view
  const originalCrumbs = useMemo(() => {
    if (!outline || !breadcrumbViewId) return [];
    return findAncestors(outline, breadcrumbViewId) || [];
  }, [outline, breadcrumbViewId]);
  const [fallbackCrumbs, setFallbackCrumbs] = useState<View[]>([]);

  useEffect(() => {
    if (!breadcrumbViewId) {
      setFallbackCrumbs([]);
      return;
    }

    if (originalCrumbs.length > 0) {
      setFallbackCrumbs([]);
      return;
    }

    if (!currentWorkspaceId) {
      setFallbackCrumbs([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const visited = new Set<string>();
      const chain: View[] = [];
      let cursorId: string | undefined = breadcrumbViewId;

      while (cursorId && cursorId !== currentWorkspaceId && !visited.has(cursorId)) {
        visited.add(cursorId);

        let currentView: View | null = findView(stableOutlineRef.current || [], cursorId);

        if (!currentView) {
          try {
            currentView = await ViewService.get(currentWorkspaceId, cursorId);
          } catch {
            break;
          }
        }

        if (!currentView) break;
        chain.unshift(currentView);
        cursorId = currentView.parent_view_id;
      }

      if (!cancelled) {
        setFallbackCrumbs(chain);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [breadcrumbViewId, originalCrumbs, currentWorkspaceId, stableOutlineRef]);

  const sourceCrumbs = originalCrumbs.length > 0 ? originalCrumbs : fallbackCrumbs;

  // Trailing crumb appended by pages without their own route ancestry (e.g. a
  // database row opened as a full page). Held separately from the ancestor
  // chain so outline refreshes, which rebuild sourceCrumbs, cannot erase it.
  const [appendedCrumb, setAppendedCrumb] = useState<View | undefined>(undefined);

  const appendBreadcrumb = useCallback((view?: View) => {
    setAppendedCrumb(view);
  }, []);

  const breadcrumbs = useMemo(() => {
    if (!appendedCrumb) return sourceCrumbs;
    const index = sourceCrumbs.findIndex((v) => v.view_id === appendedCrumb.view_id);

    if (index === -1) return [...sourceCrumbs, appendedCrumb];
    return [...sourceCrumbs.slice(0, index), appendedCrumb];
  }, [sourceCrumbs, appendedCrumb]);

  // Load view metadata — with server fallback for lazy-loaded outline
  const loadViewMeta = useCallback(
    async (viewId: string, callback?: (meta: View) => void) => {
      const deletedView = trashList?.find((v) => v.view_id === viewId);

      if (deletedView) {
        return Promise.reject(deletedView);
      }

      let view = findView(stableOutlineRef.current || [], viewId);

      // Server fallback: view not in shallow outline tree
      if (!view && currentWorkspaceId) {
        try {
          view = await ViewService.get(currentWorkspaceId, viewId);
        } catch {
          // fall through to rejection
        }
      }

      if (!view) {
        return Promise.reject('View not found');
      }

      if (callback) {
        callback({
          ...view,
          database_relations: workspaceDatabases,
        });
      }

      return {
        ...view,
        database_relations: workspaceDatabases,
      };
    },
    [stableOutlineRef, trashList, workspaceDatabases, currentWorkspaceId]
  );

  // Word count management
  const getWordCount = useCallback((viewId: string) => {
    return wordCountRef.current[viewId];
  }, []);

  const setWordCount = useCallback((viewId: string, count: TextCount) => {
    wordCountRef.current[viewId] = count;
  }, []);

  // UI callbacks
  const onRendered = useCallback(() => {
    setRendered(true);
  }, []);

  const openPageModal = useCallback((viewId: string) => {
    setOpenModalViewId(viewId);
  }, []);

  // Refresh outline
  const refreshOutline = useCallback(async () => {
    if (!currentWorkspaceId) return;
    await loadOutline(currentWorkspaceId, false);
  }, [currentWorkspaceId, loadOutline]);

  // Enhanced toView that uses loadViewMeta
  const enhancedToView = useCallback(
    async (viewId: string, blockId?: string, keepSearch?: boolean) => {
      return toView(viewId, blockId, keepSearch, loadViewMeta);
    },
    [toView, loadViewMeta]
  );

  // Enhanced loadView with outline context
  const enhancedLoadView = useCallback(
    async (viewId: string, isSubDocument = false, loadAwareness = false, options?: LoadViewOptions) => {
      return loadView(viewId, isSubDocument, loadAwareness, stableOutlineRef.current, options);
    },
    [loadView, stableOutlineRef]
  );

  // Enhanced deletePage with loadTrash
  const enhancedDeletePage = useCallback(
    async (viewId: string) => {
      return rawDeletePage(viewId, loadTrash);
    },
    [rawDeletePage, loadTrash]
  );

  // Initialize database operations
  const {
    generateAISummaryForRow,
    generateAITranslateForRow,
    loadDatabasePrompts,
    testDatabasePromptConfig,
    checkIfRowDocumentExists,
    loadRowDocument,
    createRowDocument,
    duplicateRowDocument,
  } = useDatabaseOperations(enhancedLoadView, createRow, syncContext.syncAllToServer);

  // ── Focused context values ──────────────────────────────────────────────────
  // Each useMemo has only its own deps, so unrelated changes don't propagate.

  // Navigation state — HIGH change frequency (viewId, breadcrumbs, rendered, notFound)
  const navigationValue: AppNavigationContextType = useMemo(
    () => ({
      viewId,
      breadcrumbs,
      appendBreadcrumb,
      rendered,
      onRendered,
      notFound: viewNotFound,
      viewNoAccess,
      viewHasBeenDeleted,
      openPageModalViewId: openModalViewId,
      openPageModal,
    }),
    [
      viewId,
      breadcrumbs,
      appendBreadcrumb,
      rendered,
      onRendered,
      viewNotFound,
      viewNoAccess,
      viewHasBeenDeleted,
      openModalViewId,
      openPageModal,
    ]
  );

  // Outline state — MEDIUM change frequency (outline, favorites, recent, trash)
  const outlineValue: AppOutlineContextType = useMemo(
    () => ({
      outline,
      favoriteViews,
      recentViews,
      trashList,
      loadedViewIds,
      loadViewChildren,
      loadViewChildrenBatch,
      markViewChildrenStale,
      ensureViewVisibleInOutline,
      revalidateSidebarOutline,
      loadFavoriteViews,
      loadRecentViews,
      loadTrash,
      loadViews,
      refreshOutline,
      loadDatabaseRelations,
      getMentionUser,
      loadMentionableUsers,
    }),
    [
      outline,
      favoriteViews,
      recentViews,
      trashList,
      loadedViewIds,
      loadViewChildren,
      loadViewChildrenBatch,
      markViewChildrenStale,
      ensureViewVisibleInOutline,
      revalidateSidebarOutline,
      loadFavoriteViews,
      loadRecentViews,
      loadTrash,
      loadViews,
      refreshOutline,
      loadDatabaseRelations,
      getMentionUser,
      loadMentionableUsers,
    ]
  );

  // Operations callbacks — LOW change frequency (stable callbacks)
  const operationsValue: AppOperationsContextType = useMemo(
    () => ({
      toView: enhancedToView,
      loadViewMeta,
      loadView: enhancedLoadView,
      createRow,
      bindViewSync,
      addPage,
      deletePage: enhancedDeletePage,
      duplicatePage,
      updatePage,
      updatePageIcon,
      updatePageName,
      movePage,
      deleteTrash,
      restorePage,
      createSpace,
      createSpaceWithInitialPage,
      updateSpace,
      createDatabaseView,
      uploadFile,
      getSubscriptions,
      publish,
      unpublish,
      createOrphanedView,
      generateAISummaryForRow,
      generateAITranslateForRow,
      loadDatabasePrompts,
      testDatabasePromptConfig,
      openPageModal,
      checkIfRowDocumentExists,
      loadRowDocument,
      createRowDocument,
      duplicateRowDocument,
      getViewIdFromDatabaseId,
      getWordCount,
      setWordCount,
      getCollabHistory,
      previewCollabVersion,
      revertCollabVersion,
      onChangeWorkspace: authContext.onChangeWorkspace,
    }),
    [
      enhancedToView,
      loadViewMeta,
      enhancedLoadView,
      createRow,
      bindViewSync,
      addPage,
      enhancedDeletePage,
      duplicatePage,
      updatePage,
      updatePageIcon,
      updatePageName,
      movePage,
      deleteTrash,
      restorePage,
      createSpace,
      createSpaceWithInitialPage,
      updateSpace,
      createDatabaseView,
      uploadFile,
      getSubscriptions,
      publish,
      unpublish,
      createOrphanedView,
      generateAISummaryForRow,
      generateAITranslateForRow,
      loadDatabasePrompts,
      testDatabasePromptConfig,
      openPageModal,
      checkIfRowDocumentExists,
      loadRowDocument,
      createRowDocument,
      duplicateRowDocument,
      getViewIdFromDatabaseId,
      getWordCount,
      setWordCount,
      getCollabHistory,
      previewCollabVersion,
      revertCollabVersion,
      authContext.onChangeWorkspace,
    ]
  );

  // Sync / realtime state — MUTABLE change frequency (awarenessMap changes per document)
  const syncValue: AppSyncContextType = useMemo(
    () => ({
      awarenessMap,
      scheduleDeferredCleanup: syncContext.scheduleDeferredCleanup,
    }),
    [awarenessMap, syncContext.scheduleDeferredCleanup]
  );

  return (
    <AppNavigationContext.Provider value={navigationValue}>
      <AppOutlineContext.Provider value={outlineValue}>
        <AppOperationsContext.Provider value={operationsValue}>
          <AppEventEmitterContext.Provider value={syncContext.eventEmitter}>
            <AppSyncContext.Provider value={syncValue}>
              <AppContextConsumer
                requestAccessError={requestAccessError}
                openModalViewId={openModalViewId}
                setOpenModalViewId={setOpenModalViewId}
              >
                {children}
              </AppContextConsumer>
            </AppSyncContext.Provider>
          </AppEventEmitterContext.Provider>
        </AppOperationsContext.Provider>
      </AppOutlineContext.Provider>
    </AppNavigationContext.Provider>
  );
};
