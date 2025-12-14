import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { TextCount, Types, View } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';

import { AppContextConsumer } from '../components/AppContextConsumer';
import { useAuthInternal } from '../contexts/AuthInternalContext';
import { BusinessInternalContext, BusinessInternalContextType } from '../contexts/BusinessInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';
import { useDatabaseOperations } from '../hooks/useDatabaseOperations';
import { usePageOperations } from '../hooks/usePageOperations';
import { useViewOperations } from '../hooks/useViewOperations';
import { useWorkspaceData } from '../hooks/useWorkspaceData';

interface AppBusinessLayerProps {
  children: React.ReactNode;
}

const FOLDER_OUTLINE_REFRESH_DEBOUNCE_MS = 1000;
const SKIP_NEXT_FOLDER_OUTLINE_REFRESH_BUFFER_MS = 5000;
const SKIP_NEXT_FOLDER_OUTLINE_REFRESH_TTL_MS =
  FOLDER_OUTLINE_REFRESH_DEBOUNCE_MS + SKIP_NEXT_FOLDER_OUTLINE_REFRESH_BUFFER_MS;

// Third layer: Business logic operations
// Handles all business operations like outline management, page operations, database operations
// Depends on workspace ID and sync context from previous layers
export const AppBusinessLayer: React.FC<AppBusinessLayerProps> = ({ children }) => {
  const { currentWorkspaceId } = useAuthInternal();
  const { lastUpdatedCollab } = useSyncInternal();
  const params = useParams();

  // UI state
  const [rendered, setRendered] = useState(false);
  const [openModalViewId, setOpenModalViewId] = useState<string | undefined>(undefined);
  const wordCountRef = useRef<Record<string, TextCount>>({});
  const skipNextFolderOutlineRefreshRef = useRef(false);
  const skipNextFolderOutlineRefreshUntilRef = useRef<number>(0);

  // Calculate view ID from params
  const viewId = useMemo(() => {
    const id = params.viewId;

    if (id && !uuidValidate(id)) return;
    return id;
  }, [params.viewId]);

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
  } = useWorkspaceData();

  // Initialize view operations
  const { loadView, createRowDoc, toView, awarenessMap, getViewIdFromDatabaseId } = useViewOperations();

  // Initialize page operations
  const loadOutlineAfterLocalMutation = useCallback(
    async (workspaceId: string, force?: boolean) => {
      // Local mutations typically trigger a folder-collab update echo shortly after we already
      // refetched the outline. Skip the next folder-collab-driven refresh once to avoid a
      // second, visually noticeable "refresh" of database UI derived from the outline.
      skipNextFolderOutlineRefreshRef.current = true;
      skipNextFolderOutlineRefreshUntilRef.current = Date.now() + SKIP_NEXT_FOLDER_OUTLINE_REFRESH_TTL_MS;

      try {
        return await loadOutline(workspaceId, force);
      } catch (e) {
        // If our local outline reload failed, allow the next folder refresh to proceed so
        // we can still recover when the folder-collab update arrives.
        skipNextFolderOutlineRefreshRef.current = false;
        skipNextFolderOutlineRefreshUntilRef.current = 0;
        throw e;
      }
    },
    [loadOutline]
  );

  const pageOperations = usePageOperations({ outline, loadOutline: loadOutlineAfterLocalMutation });

  // Check if current view has been deleted
  const viewHasBeenDeleted = useMemo(() => {
    if (!viewId) return false;
    return trashList?.some((v) => v.view_id === viewId);
  }, [trashList, viewId]);

  // Check if current view is not found
  const viewNotFound = useMemo(() => {
    if (!viewId || !outline || !outline.length) return false;
    return !findView(outline, viewId);
  }, [outline, viewId]);

  // Calculate breadcrumbs based on current view
  const originalCrumbs = useMemo(() => {
    if (!outline || !viewId) return [];
    return findAncestors(outline, viewId) || [];
  }, [outline, viewId]);

  const [breadcrumbs, setBreadcrumbs] = useState<View[]>(originalCrumbs);

  // Update breadcrumbs when original crumbs change
  useEffect(() => {
    setBreadcrumbs(originalCrumbs);
  }, [originalCrumbs]);

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

  // Load view metadata
  const loadViewMeta = useCallback(
    async (viewId: string, callback?: (meta: View) => void) => {
      const view = findView(stableOutlineRef.current || [], viewId);
      const deletedView = trashList?.find((v) => v.view_id === viewId);

      if (deletedView) {
        return Promise.reject(deletedView);
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
    [stableOutlineRef, trashList, workspaceDatabases]
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

  // Debounced outline refresh for folder updates
  const debouncedRefreshOutline = useMemo(
    () =>
      debounce(() => {
        // Avoid an extra outline refetch right after a local mutation already requested one.
        // This prevents a visible "refresh" of database UI state derived from the outline.
        if (
          skipNextFolderOutlineRefreshRef.current &&
          Date.now() < skipNextFolderOutlineRefreshUntilRef.current
        ) {
          skipNextFolderOutlineRefreshRef.current = false;
          return;
        }

        void refreshOutline();
      }, FOLDER_OUTLINE_REFRESH_DEBOUNCE_MS),
    [refreshOutline]
  );

  useEffect(() => {
    return () => {
      debouncedRefreshOutline.cancel();
    };
  }, [debouncedRefreshOutline]);

  // Refresh outline when a folder collab update is detected
  useEffect(() => {
    if (lastUpdatedCollab?.collabType === Types.Folder) {
      return debouncedRefreshOutline();
    }
  }, [debouncedRefreshOutline, lastUpdatedCollab]);

  // Load mentionable users on mount
  useEffect(() => {
    void loadMentionableUsers();
  }, [loadMentionableUsers]);

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
  const databaseOperations = useDatabaseOperations(enhancedLoadView, createRowDoc);

  // Business context value
  const businessContextValue: BusinessInternalContextType = useMemo(
    () => ({
      // View and navigation
      viewId,
      toView: enhancedToView,
      loadViewMeta,
      loadView: enhancedLoadView,
      createRowDoc,

      // Outline and hierarchy
      outline,
      breadcrumbs,
      appendBreadcrumb,
      refreshOutline,

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
      createRowDoc,
      outline,
      breadcrumbs,
      appendBreadcrumb,
      refreshOutline,
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
