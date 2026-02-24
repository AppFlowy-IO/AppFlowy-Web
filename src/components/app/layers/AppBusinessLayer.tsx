import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { TextCount, View } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM, resolveSidebarSelectedViewId } from '@/components/app/hooks/resolveSidebarSelectedViewId';

import { AppContextConsumer } from '../components/AppContextConsumer';
import { useAuthInternal } from '../contexts/AuthInternalContext';
import { BusinessInternalContext, BusinessInternalContextType } from '../contexts/BusinessInternalContext';
import { useDatabaseOperations } from '../hooks/useDatabaseOperations';
import { usePageOperations } from '../hooks/usePageOperations';
import { useViewOperations } from '../hooks/useViewOperations';
import { useWorkspaceData } from '../hooks/useWorkspaceData';

interface AppBusinessLayerProps {
  children: React.ReactNode;
}

const ROUTE_VIEW_EXISTS_CACHE_MAX = 200;
const ROUTE_VIEW_EXISTS_REVALIDATE_MS = 10000;
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

// Third layer: Business logic operations
// Handles all business operations like outline management, page operations, database operations
// Depends on workspace ID and sync context from previous layers
export const AppBusinessLayer: React.FC<AppBusinessLayerProps> = ({ children }) => {
  const { currentWorkspaceId, service } = useAuthInternal();
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
  } = useWorkspaceData();

  const breadcrumbViewId = useMemo(() => {
    return resolveSidebarSelectedViewId({
      routeViewId: viewId,
      tabViewId,
      outline,
    });
  }, [outline, tabViewId, viewId]);

  // Initialize view operations
  const { loadView, createRow, toView, awarenessMap, getViewIdFromDatabaseId, bindViewSync } = useViewOperations();

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
  const pageOperations = usePageOperations({ outline, loadOutline });

  // Check if current view has been deleted
  const viewHasBeenDeleted = useMemo(() => {
    if (!viewId) return false;
    return trashList?.some((v) => v.view_id === viewId);
  }, [trashList, viewId]);

  const [routeViewExists, setRouteViewExists] = useState<boolean | null>(null);

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

    if (!service || !currentWorkspaceId) {
      setRouteViewExists(null);
      return;
    }

    const cacheKey = `${currentWorkspaceId}:${viewId}`;
    const cached = routeViewExistsCacheRef.current.get(cacheKey);
    const cacheExpired = cached
      ? Date.now() - cached.checkedAt >= ROUTE_VIEW_EXISTS_REVALIDATE_MS
      : true;

    // Cache policy:
    // - false can be trusted (confirmed not-found)
    // - true is reused, but periodically revalidated while route view is
    //   outside the currently loaded shallow tree to avoid stale positives.
    if (cached?.exists === false) {
      setRouteViewExists(false);
      return;
    }

    if (cached?.exists === true && !cacheExpired) {
      setRouteViewExists(true);
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
      inFlight = service
        .getAppView(currentWorkspaceId, viewId)
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
  }, [viewId, viewHasBeenDeleted, outline, service, currentWorkspaceId, setRouteViewExistsCache]);

  const viewNotFound = Boolean(viewId && !viewHasBeenDeleted && routeViewExists === false);

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

    if (!service || !currentWorkspaceId) {
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
            currentView = await service.getAppView(currentWorkspaceId, cursorId);
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
  }, [breadcrumbViewId, originalCrumbs, service, currentWorkspaceId, stableOutlineRef]);

  const sourceCrumbs = originalCrumbs.length > 0 ? originalCrumbs : fallbackCrumbs;

  const [breadcrumbs, setBreadcrumbs] = useState<View[]>(sourceCrumbs);

  // Update breadcrumbs when original crumbs change
  useEffect(() => {
    setBreadcrumbs(sourceCrumbs);
  }, [sourceCrumbs]);

  // Handle breadcrumb manipulation
  const appendBreadcrumb = useCallback((view?: View) => {
    setBreadcrumbs((prev) => {
      if (!view) {
        return prev.slice(0, -1);
      }

      const index = prev.findIndex((v) => v.view_id === view.view_id);

      if (index === -1) {
        return [...prev, view];
      }

      const rest = prev.slice(0, index);

      return [...rest, view];
    });
  }, []);

  // Load view metadata — with server fallback for lazy-loaded outline
  const loadViewMeta = useCallback(
    async (viewId: string, callback?: (meta: View) => void) => {
      const deletedView = trashList?.find((v) => v.view_id === viewId);

      if (deletedView) {
        return Promise.reject(deletedView);
      }

      let view = findView(stableOutlineRef.current || [], viewId);

      // Server fallback: view not in shallow outline tree
      if (!view && service && currentWorkspaceId) {
        try {
          view = await service.getAppView(currentWorkspaceId, viewId);
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
    [stableOutlineRef, trashList, workspaceDatabases, service, currentWorkspaceId]
  );

  // Word count management
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
    async (id: string, isSubDocument = false, loadAwareness = false) => {
      return loadView(id, isSubDocument, loadAwareness, stableOutlineRef.current);
    },
    [loadView, stableOutlineRef]
  );

  // Enhanced deletePage with loadTrash
  const enhancedDeletePage = useCallback(
    async (viewId: string) => {
      return pageOperations.deletePage(viewId, loadTrash);
    },
    [pageOperations, loadTrash]
  );

  // Initialize database operations
  const databaseOperations = useDatabaseOperations(enhancedLoadView, createRow);

  // Business context value
  const businessContextValue: BusinessInternalContextType = useMemo(
    () => ({
      // View and navigation
      viewId,
      toView: enhancedToView,
      loadViewMeta,
      loadView: enhancedLoadView,
      createRow,
      bindViewSync,

      // Outline and hierarchy
      outline,
      breadcrumbs,
      appendBreadcrumb,
      refreshOutline,
      loadedViewIds,
      loadViewChildren,
      loadViewChildrenBatch,
      markViewChildrenStale,

      // Data views
      favoriteViews,
      recentViews,
      trashList,
      loadFavoriteViews,
      loadRecentViews,
      loadTrash,
      loadViews,

      // Page operations
      ...pageOperations,
      deletePage: enhancedDeletePage,

      // Database operations
      loadDatabaseRelations,
      ...databaseOperations,
      getViewIdFromDatabaseId,

      // User operations
      getMentionUser,

      // UI state
      rendered,
      onRendered,
      notFound: viewNotFound,
      viewHasBeenDeleted,
      openPageModal,
      openPageModalViewId: openModalViewId,

      // Word count
      wordCount: wordCountRef.current,
      setWordCount,

      loadMentionableUsers,
    }),
    [
      viewId,
      enhancedToView,
      loadViewMeta,
      enhancedLoadView,
      createRow,
      bindViewSync,
      outline,
      breadcrumbs,
      appendBreadcrumb,
      refreshOutline,
      loadedViewIds,
      loadViewChildren,
      loadViewChildrenBatch,
      markViewChildrenStale,
      favoriteViews,
      recentViews,
      trashList,
      loadFavoriteViews,
      loadRecentViews,
      loadTrash,
      loadViews,
      pageOperations,
      enhancedDeletePage,
      loadDatabaseRelations,
      databaseOperations,
      getViewIdFromDatabaseId,
      getMentionUser,
      rendered,
      onRendered,
      viewNotFound,
      viewHasBeenDeleted,
      openPageModal,
      openModalViewId,
      setWordCount,
      loadMentionableUsers,
    ]
  );

  return (
    <BusinessInternalContext.Provider value={businessContextValue}>
      <AppContextConsumer
        requestAccessError={requestAccessError}
        openModalViewId={openModalViewId}
        setOpenModalViewId={setOpenModalViewId}
        awarenessMap={awarenessMap}
      >
        {children}
      </AppContextConsumer>
    </BusinessInternalContext.Provider>
  );
};
