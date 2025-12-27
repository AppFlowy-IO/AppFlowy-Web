import { useEffect, useRef, useState } from 'react';

import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationDatabaseId } from '@/application/database-yjs/dispatch';
import { DatabaseRelations, View } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';

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
  const { loadDatabaseRelations, loadViews, workspaceId } = useDatabaseContext();

  const { field } = useFieldSelector(fieldId);
  const [relations, setRelations] = useState<DatabaseRelations | undefined>(undefined);
  const relatedDatabaseId = field ? parseRelationTypeOption(field)?.database_id : null;
  const relatedViewId = relatedDatabaseId ? relations?.[relatedDatabaseId] : null;
  const [selectedView, setSelectedView] = useState<View | undefined>(undefined);
  // Initialize views with cached data if available for this workspace
  const [views, setViews] = useState<View[]>(() => getCachedViews(workspaceId) || []);
  const onUpdateDatabaseId = useUpdateRelationDatabaseId(fieldId);
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
      if (!enabled || !loadViews || !relations) return;
      const viewIds = Object.values(relations);

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
  }, [enabled, loadViews, relations, workspaceId]);

  useEffect(() => {
    void (async () => {
      if (!relatedViewId) return;
      const view = findView(views, relatedViewId);

      if (view) {
        setSelectedView(view);
      }
    })();
  }, [relatedViewId, views]);

  // Consider loading true if:
  // 1. Explicitly loading relations or views
  // 2. Or enabled but relations haven't been fetched yet (initial load state)
  // 3. Or enabled and relations loaded but views haven't been fetched yet
  const isLoading = loadingRelations || loadingViews ||
    (enabled && !relations) ||
    Boolean(enabled && relations && views.length === 0 && !getCachedViews(workspaceId));

  return {
    loading: isLoading,
    relations,
    relatedViewId,
    selectedView,
    views,
    onUpdateDatabaseId,
    setSelectedView,
    relatedDatabaseId,
  };
}
