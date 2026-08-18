import { useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import { DatabaseRelations, View } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';

/**
 * A database that a relation field can point at.
 *
 * `displayView` is the user-facing database container rather than the
 * registered inner view, which is usually just named "Grid"; `path` holds the
 * container's ancestors so the picker can show where it lives, mirroring
 * desktop's `_DatabaseListItem` subtitle.
 */
export interface RelationDatabaseCandidate {
  databaseId: string;
  viewId: string;
  displayView: View;
  path: string[];
}

// Workspace-scoped cache for views to enable instant display
// Only cache the current workspace to prevent memory leaks
let currentCachedWorkspaceId: string | null = null;
let cachedViews: View[] | null = null;

// Helper to get cached views for a workspace
function getCachedViews(workspaceId: string): View[] | null {
  // Only return cache if it's for the same workspace
  if (currentCachedWorkspaceId === workspaceId) {
    return cachedViews;
  }

  return null;
}

// Helper to set cached views for a workspace
function setCachedViews(workspaceId: string, views: View[]): void {
  // Clear old cache when workspace changes
  if (currentCachedWorkspaceId !== workspaceId) {
    cachedViews = null;
  }

  currentCachedWorkspaceId = workspaceId;
  cachedViews = views;
}

// Export function to clear cache (can be called on logout or workspace switch)
export function clearRelationViewsCache(): void {
  currentCachedWorkspaceId = null;
  cachedViews = null;
}

export interface UseRelationDataOptions {
  enabled?: boolean;
}

export function useRelationData (fieldId: string, options: UseRelationDataOptions = {}) {
  const { enabled = true } = options;
  const { eventEmitter, getViewIdFromDatabaseId, loadDatabaseRelations, loadViewMeta, loadViews, workspaceId } = useDatabaseContext();

  const { field } = useFieldSelector(fieldId);
  const [relations, setRelations] = useState<DatabaseRelations | undefined>(undefined);
  const relationOption: RelationTypeOption | null = field ? parseRelationTypeOption(field) : null;
  const relatedDatabaseId = relationOption?.database_id || null;
  const [fallbackRelatedViewId, setFallbackRelatedViewId] = useState<string | null>(null);
  const relatedViewId = relatedDatabaseId ? relations?.[relatedDatabaseId] || fallbackRelatedViewId : null;
  const [selectedView, setSelectedView] = useState<View | undefined>(undefined);
  // Initialize views with cached data if available for this workspace
  const [views, setViews] = useState<View[]>(() => getCachedViews(workspaceId) || []);
  // The full folder outline, kept in state so candidate resolution re-runs when
  // it arrives (the module cache alone would not retrigger the memo).
  const [outline, setOutline] = useState<View[]>(() => getCachedViews(workspaceId) || []);
  const onUpdateTypeOption = useUpdateRelationTypeOption(fieldId);
  const onUpdateDatabaseId = (databaseId: string) => onUpdateTypeOption({ database_id: databaseId });
  const [loadingRelations, setLoadingRelations] = useState<boolean>(false);
  const [loadingViews, setLoadingViews] = useState<boolean>(false);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Skip if disabled or no fieldId
    if (!enabled || !loadDatabaseRelations || !fieldId) return;

    // Skip if already fetched (avoid re-fetching on re-renders)
    if (hasInitializedRef.current) return;

    hasInitializedRef.current = true;

    // Defer loading to prevent immediate state updates that could cause re-virtualization
    const timeoutId = setTimeout(() => {
      void (async () => {
        setLoadingRelations(true);

        try {
          const result = await loadDatabaseRelations();

          setRelations(result);
        } catch (e) {
          //
        } finally {
          setLoadingRelations(false);
        }
      })();
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [enabled, loadDatabaseRelations, fieldId]);

  useEffect(() => {
    void (async () => {
      if (!enabled || !loadViews) return;

      const viewIds = Array.from(new Set([
        ...Object.values(relations || {}),
        ...(relatedViewId ? [relatedViewId] : []),
      ]));

      if (viewIds.length === 0) return;

      // Only show loading if we don't have cached views for this workspace
      const cachedViews = getCachedViews(workspaceId);
      const shouldShowLoading = !cachedViews || cachedViews.length === 0;

      if (shouldShowLoading) {
        setLoadingViews(true);
      }

      try {
        const allViews = await loadViews?.();

        // Cache the views for this workspace
        setCachedViews(workspaceId, allViews);
        setOutline(allViews);

        const filteredViews = viewIds.map((viewId: string) => {
          return findView(allViews, viewId);
        }).filter((view) => !!view) as View[];

        setViews(filteredViews);
      } catch (e) {
        //
      } finally {
        if (shouldShowLoading) {
          setLoadingViews(false);
        }
      }
    })();
  }, [enabled, loadViews, relations, relatedViewId, workspaceId]);

  useEffect(() => {
    if (!enabled || !eventEmitter) return;

    const handleOutlineLoaded = (outline?: View[]) => {
      if (!Array.isArray(outline)) return;

      setCachedViews(workspaceId, outline);
      setOutline(outline);

      const viewIds = Array.from(new Set([
        ...Object.values(relations || {}),
        ...(relatedViewId ? [relatedViewId] : []),
      ]));

      if (viewIds.length === 0) return;

      const filteredViews = viewIds.map((viewId: string) => {
        return findView(outline, viewId);
      }).filter((view) => !!view) as View[];

      setViews(filteredViews);
    };

    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);

    return () => {
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    };
  }, [enabled, eventEmitter, relations, relatedViewId, workspaceId]);

  useEffect(() => {
    if (!enabled || !relatedDatabaseId || relations?.[relatedDatabaseId] || !getViewIdFromDatabaseId) {
      setFallbackRelatedViewId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const viewId = await getViewIdFromDatabaseId(relatedDatabaseId);

      if (!cancelled) {
        setFallbackRelatedViewId(viewId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, getViewIdFromDatabaseId, relatedDatabaseId, relations]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!relatedViewId) {
        setSelectedView(undefined);
        return;
      }

      const resolveDisplayView = async (view: View): Promise<View> => {
        if (!view.parent_view_id || !loadViewMeta) return view;

        try {
          const parentView = await loadViewMeta(view.parent_view_id);

          if (parentView?.name) {
            return {
              ...view,
              icon: parentView.icon ?? view.icon,
              name: parentView.name,
            };
          }
        } catch (e) {
          //
        }

        return view;
      };

      const view = findView(views, relatedViewId);

      if (view) {
        const displayView = await resolveDisplayView(view);

        if (!cancelled) {
          setSelectedView(displayView);
        }

        return;
      }

      try {
        const viewMeta = await loadViewMeta?.(relatedViewId);

        if (!cancelled && viewMeta) {
          const displayView = await resolveDisplayView(viewMeta);

          if (!cancelled) {
            setSelectedView(displayView);
          }
        }
      } catch (e) {
        //
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadViewMeta, relatedViewId, views]);

  /**
   * Ancestry for each registered database view, resolved in a single walk.
   *
   * `findAncestors` restarts from the root on every call, so calling it once
   * per database re-walked the whole outline N times. Collect the targets up
   * front and record paths during one traversal instead, copying the path only
   * for the handful of nodes we actually care about.
   */
  const ancestryByViewId = useMemo(() => {
    const targets = new Set(Object.values(relations ?? {}).filter(Boolean));
    const index = new Map<string, View[]>();

    if (targets.size === 0) return index;

    const path: View[] = [];
    const walk = (nodes: View[]) => {
      for (const node of nodes) {
        path.push(node);

        if (targets.has(node.view_id)) index.set(node.view_id, path.slice());
        if (node.children?.length) walk(node.children);

        path.pop();
      }
    };

    walk(outline);

    return index;
  }, [outline, relations]);

  const databaseCandidates = useMemo<RelationDatabaseCandidate[]>(() => {
    if (!relations) return [];

    return Object.entries(relations)
      .flatMap(([databaseId, viewId]) => {
        if (!viewId) return [];

        const ancestry = ancestryByViewId.get(viewId);
        const registeredView = ancestry?.[ancestry.length - 1] ?? findView(views, viewId);

        if (!registeredView) return [];

        // The workspace registers the first inner view (usually "Grid"); the
        // database name lives on its container parent.
        const parent = ancestry && ancestry.length >= 2 ? ancestry[ancestry.length - 2] : undefined;
        const displayView = isDatabaseContainer(parent) ? parent : registeredView;

        return [
          {
            databaseId,
            viewId,
            displayView,
            // Desktop lists the registered view's ancestors, which already
            // include the container itself.
            path: (ancestry ?? []).slice(0, -1).map((view) => view.name).filter(Boolean),
          },
        ];
      });
  }, [ancestryByViewId, relations, views]);

  // Consider loading true if:
  // 1. Explicitly loading relations or views
  // 2. Or enabled but relations haven't been fetched yet (initial load state)
  // 3. Or enabled and relations loaded but views haven't been fetched yet
  const isLoading = loadingRelations || loadingViews ||
    (enabled && !relations && !relatedViewId) ||
    Boolean(enabled && (relations || relatedViewId) && !selectedView && views.length === 0 && !getCachedViews(workspaceId));

  return {
    loading: isLoading,
    relations,
    relatedViewId,
    selectedView,
    views,
    databaseCandidates,
    onUpdateDatabaseId,
    onUpdateTypeOption,
    setSelectedView,
    relatedDatabaseId,
    relationOption,
  };
}
