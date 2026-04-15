import { MutableRefObject, useCallback } from 'react';
import { toast } from 'sonner';

import { BillingService, FileService, PageService, PublishService, ViewService } from '@/application/services/domains';
import { deleteView as clearViewCache } from '@/application/services/js-services/cache';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { gatherDatabasePublishData } from '@/application/services/js-services/publish-database-data';
import {
  publishCollabs,
  PublishCollabMetadata,
} from '@/application/services/js-services/http/publish-api';
import {
  CreateDatabaseViewPayload,
  DuplicatePageOptions,
  CreatePagePayload,
  CreateSpacePayload,
  Role,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
  ViewLayout,
} from '@/application/types';
import { Log } from '@/utils/log';
import { findParentView, findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';

import { useAuthInternal } from '../contexts/AuthInternalContext';

// Hook for managing page and space operations
const DUPLICATE_PRE_SYNC_TIMEOUT_MS = 8000;

export function usePageOperations({
  outlineRef,
  loadOutline,
  flushAllSync,
  syncAllToServer,
  loadViewChildren,
}: {
  outlineRef: MutableRefObject<View[] | undefined>;
  loadOutline?: (workspaceId: string, force?: boolean) => Promise<void>;
  flushAllSync?: () => void;
  syncAllToServer?: (workspaceId: string) => Promise<void>;
  loadViewChildren?: (viewId: string) => Promise<View[]>;
}) {
  const { currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const role = userWorkspaceInfo?.selectedWorkspace.role;

  // Add a new page
  const addPage = useCallback(
    async (parentViewId: string, payload: CreatePagePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      const shareWithMeView = findViewInShareWithMe(outlineRef.current || [], parentViewId);

      if (role === Role.Guest || shareWithMeView) {
        toast.error('No permission to create pages');
        throw new Error('No permission to create pages');
      }

      try {
        const response = await PageService.add(currentWorkspaceId, parentViewId, payload);

        // Keep a resilient fallback when realtime delivery is unavailable.
        // This guarantees sidebar eventual consistency after creation.
        void loadOutline?.(currentWorkspaceId, false);
        return response;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, outlineRef, role, loadOutline]
  );

  // Delete a page (move to trash)
  const deletePage = useCallback(
    async (id: string, loadTrash?: (workspaceId: string) => Promise<void>) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      const shareWithMeView = findViewInShareWithMe(outlineRef.current || [], id);

      if (role === Role.Guest || shareWithMeView) {
        throw new Error('Guest cannot delete pages');
      }

      try {
        await PageService.moveToTrash(currentWorkspaceId, id);
        void loadTrash?.(currentWorkspaceId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, outlineRef, role, loadOutline]
  );

  // Update page (rename) - uses WebSocket notification for sidebar refresh
  const updatePage = useCallback(
    async (viewId: string, payload: UpdatePagePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        await PageService.update(currentWorkspaceId, viewId, payload);
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  // Update page icon
  const updatePageIcon = useCallback(
    async (viewId: string, icon: { ty: ViewIconType; value: string }) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        await PageService.updateIcon(currentWorkspaceId, viewId, icon);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  // Update page name (rename) - uses WebSocket notification for sidebar refresh
  const updatePageName = useCallback(
    async (viewId: string, name: string) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        await PageService.updateName(currentWorkspaceId, viewId, name);
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  const duplicatePage = useCallback(
    async (viewId: string, options: DuplicatePageOptions = {}) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        // Sync all collab documents to the server via HTTP API before duplicating.
        // This ensures the server has the latest data (including unregistered row
        // documents) before the duplicate operation, matching MoreActionsContent behavior.
        if (syncAllToServer) {
          await Promise.race([
            syncAllToServer(currentWorkspaceId),
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, DUPLICATE_PRE_SYNC_TIMEOUT_MS);
            }),
          ]);
        } else {
          flushAllSync?.();
        }

        await PageService.duplicate(currentWorkspaceId, viewId, options);
        await loadOutline?.(currentWorkspaceId, false);

        if (options.parentViewId) {
          ViewService.invalidateCache(currentWorkspaceId, options.parentViewId);
          await loadViewChildren?.(options.parentViewId);
        }
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, syncAllToServer, flushAllSync, loadOutline, loadViewChildren]
  );

  // Move page
  const movePage = useCallback(
    async (viewId: string, parentId: string, prevViewId?: string) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      if (role === Role.Guest) {
        throw new Error('Guest cannot move pages');
      }

      try {
        const lastChild = findView(outlineRef.current || [], parentId)?.children?.slice(-1)[0];
        const prevId = prevViewId || lastChild?.view_id;

        await PageService.moveTo(currentWorkspaceId, viewId, parentId, prevId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, outlineRef, loadOutline, role]
  );

  // Delete from trash permanently
  const deleteTrash = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        // Collect view IDs to clear from IndexedDB cache
        let viewIdsToClear: string[] = [];

        if (viewId) {
          viewIdsToClear = [viewId];
        } else {
          // Delete all — fetch trash list first to know which caches to clear
          try {
            const trashItems = await ViewService.getTrash(currentWorkspaceId);

            viewIdsToClear = trashItems?.map((item) => item.view_id) || [];
          } catch {
            // If we can't fetch trash list, proceed with deletion anyway
          }
        }

        await PageService.deleteTrash(currentWorkspaceId, viewId);

        // Clear IndexedDB cache for permanently deleted views (parallel)
        await Promise.allSettled(viewIdsToClear.map((id) => clearViewCache(id)));

        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, loadOutline]
  );

  // Restore page from trash
  const restorePage = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        await PageService.restore(currentWorkspaceId, viewId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, loadOutline]
  );

  // Create space
  const createSpace = useCallback(
    async (payload: CreateSpacePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await PageService.createSpace(currentWorkspaceId, payload);

        void loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, loadOutline]
  );

  // Update space
  const updateSpace = useCallback(
    async (payload: UpdateSpacePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await PageService.updateSpace(currentWorkspaceId, payload);

        void loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, loadOutline]
  );

  // Create database view (linked view using new endpoint)
  const createDatabaseView = useCallback(
    async (viewId: string, payload: CreateDatabaseViewPayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await PageService.createDatabaseView(currentWorkspaceId, viewId, payload);

        await loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, loadOutline]
  );

  // Upload file
  const uploadFile = useCallback(
    async (viewId: string, file: File, onProgress?: (n: number) => void) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await FileService.upload(currentWorkspaceId, viewId, file, onProgress);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  // Get subscriptions
  const getSubscriptions = useCallback(async () => {
    if (!currentWorkspaceId) {
      throw new Error('No service found');
    }

    try {
      const res = await BillingService.getWorkspaceSubscriptions(currentWorkspaceId);

      return res;
    } catch (e) {
      return Promise.reject(e);
    }
  }, [currentWorkspaceId]);

  // Publish view
  const publish = useCallback(
    async (view: View, publishName?: string, visibleViewIds?: string[]) => {
      if (!currentWorkspaceId) return;
      const viewId = view.view_id;
      const isDatabaseLayout =
        view.layout === ViewLayout.Grid ||
        view.layout === ViewLayout.Board ||
        view.layout === ViewLayout.Calendar;

      if (isDatabaseLayout) {
        // Database views: gather data client-side and send via binary publish endpoint
        // (same approach as the desktop client — fixes #8464)
        flushAllSync?.();

        const slug = view.name.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled';

        const name = publishName || `${slug}-${viewId.slice(0, 8)}`;

        Log.debug('[publish] gathering database data client-side', { viewId, name });

        // Always resolve all sibling views from the database container so every
        // tab (Grid, Board, Calendar, etc.) appears on the published page.
        let resolvedVisibleViewIds = visibleViewIds;

        if (outlineRef.current) {
          const parentView = findParentView(outlineRef.current, viewId);

          if (parentView?.extra?.is_database_container && parentView.children?.length > 0) {
            resolvedVisibleViewIds = parentView.children.map(c => c.view_id);
          }
        }

        const data = await gatherDatabasePublishData(viewId, resolvedVisibleViewIds);

        const toTimestamp = (s?: string) => {
          if (!s) return 0;
          const t = new Date(s).getTime();

          return isNaN(t) ? 0 : Math.floor(t / 1000);
        };

        const meta: PublishCollabMetadata = {
          view_id: viewId,
          publish_name: name,
          metadata: {
            view: {
              view_id: viewId,
              name: view.name,
              icon: view.icon,
              layout: view.layout,
              extra: view.extra ? (typeof view.extra === 'string' ? view.extra : JSON.stringify(view.extra)) : null,
              created_by: null,
              last_edited_by: null,
              last_edited_time: toTimestamp(view.last_edited_time),
              created_at: toTimestamp(view.created_at),
              child_views: null,
            },
            child_views: [],
            ancestor_views: [],
          },
        };

        await publishCollabs(currentWorkspaceId, [{ meta, data }]);
        clearPublishViewInfoCache(viewId);
      } else {
        // Document views: use existing server-side gathering
        await PublishService.publish(currentWorkspaceId, viewId, {
          publish_name: publishName,
          visible_database_view_ids: visibleViewIds,
        });
      }

      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline, flushAllSync, outlineRef]
  );

  // Unpublish view
  const unpublish = useCallback(
    async (viewId: string) => {
      if (!currentWorkspaceId) return;
      await PublishService.unpublish(currentWorkspaceId, viewId);
      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline]
  );

  // Create orphaned view
  const createOrphanedViewOp = useCallback(
    async (payload: { document_id: string }) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await ViewService.createOrphaned(currentWorkspaceId, payload);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  return {
    addPage,
    deletePage,
    duplicatePage,
    updatePage,
    updatePageIcon,
    updatePageName,
    movePage,
    deleteTrash,
    restorePage,
    createSpace,
    updateSpace,
    createDatabaseView,
    uploadFile,
    getSubscriptions,
    publish,
    unpublish,
    createOrphanedView: createOrphanedViewOp,
  };
}
