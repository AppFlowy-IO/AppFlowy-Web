import { MutableRefObject, useCallback } from 'react';
import { toast } from 'sonner';

import { BillingService, FileService, PageService, PublishService, ViewService } from '@/application/services/domains';
import { deleteView as clearViewCache } from '@/application/services/js-services/cache';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { publishCollabs, PublishCollabMetadata } from '@/application/services/js-services/http/publish-api';
import { gatherDatabasePublishData } from '@/application/services/js-services/publish-database-data';
import {
  CreateDatabaseViewPayload,
  CreateOrphanedViewPayload,
  DuplicatePageOperationOptions,
  CreatePagePayload,
  CreateSpacePayload,
  CreateSpaceWithInitialPagePayload,
  PublishViewPayload,
  Role,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
} from '@/application/types';
import { isDatabaseLayout } from '@/application/view-utils';
import { findParentView, findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { Log } from '@/utils/log';

import { useAuthInternal } from '../contexts/AuthInternalContext';

// Hook for managing page and space operations
const DUPLICATE_PRE_SYNC_TIMEOUT_MS = 8000;
const DOCUMENT_PUBLISH_SERVER_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 6000] as const;

function waitForDocumentPublishRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function refreshDatabaseCatalogAfterMutation(workspaceId: string): void {
  // Supersede any warm/read request that began before the mutation. The new
  // authoritative request runs in the background so page creation is not held
  // behind a workspace-wide catalog response.
  ViewService.invalidateDatabaseCatalog?.(workspaceId);
  void ViewService.refreshWorkspaceDatabaseCatalog?.(workspaceId).catch((error) => {
    Log.warn('[WorkspaceDatabaseCatalog] failed to refresh after a database mutation', error);
  });
}

function isDatabaseCatalogView(view: View | null | undefined): boolean {
  return Boolean(
    view &&
      (isDatabaseLayout(view.layout) || view.extra?.is_database_container || typeof view.extra?.database_id === 'string')
  );
}

function isPendingDocumentPublishData(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const { code, message } = error as { code?: unknown; message?: unknown };

  return code === -2 && typeof message === 'string' && /record not (?:found|exist)|view .* not found/i.test(message);
}

async function publishDocumentWhenServerStateIsReady(
  workspaceId: string,
  viewId: string,
  payload: PublishViewPayload,
  syncServerState?: () => Promise<void>
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await PublishService.publish(workspaceId, viewId, payload);
      return;
    } catch (error) {
      const retryDelay = DOCUMENT_PUBLISH_SERVER_RETRY_DELAYS_MS[attempt];

      if (retryDelay === undefined || !isPendingDocumentPublishData(error)) throw error;
      await syncServerState?.();
      await waitForDocumentPublishRetry(retryDelay);
    }
  }
}

export function usePageOperations({
  outlineRef,
  loadOutline,
  flushAllSync,
  syncAllToServer,
  loadViewChildren,
  getDatabaseIdForViewId,
  loadTrash,
}: {
  outlineRef: MutableRefObject<View[] | undefined>;
  loadOutline?: (workspaceId: string, force?: boolean) => Promise<void>;
  flushAllSync?: () => Promise<boolean>;
  syncAllToServer?: (workspaceId: string) => Promise<void>;
  loadViewChildren?: (viewId: string) => Promise<View[]>;
  getDatabaseIdForViewId?: (viewId: string) => Promise<string | null | undefined>;
  loadTrash?: (workspaceId: string, options?: { ensureFreshAfterInFlight?: boolean }) => Promise<void>;
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

        ViewService.invalidateCache(currentWorkspaceId, parentViewId);
        if (isDatabaseLayout(payload.layout)) {
          refreshDatabaseCatalogAfterMutation(currentWorkspaceId);
        }

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
    async (id: string) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      const shareWithMeView = findViewInShareWithMe(outlineRef.current || [], id);

      if (role === Role.Guest || shareWithMeView) {
        throw new Error('Guest cannot delete pages');
      }

      try {
        const parentView = findParentView(outlineRef.current || [], id);
        const deletedView = findView(outlineRef.current || [], id);

        await PageService.moveToTrash(currentWorkspaceId, id);
        if (isDatabaseCatalogView(deletedView)) {
          refreshDatabaseCatalogAfterMutation(currentWorkspaceId);
        }

        ViewService.invalidateCache(currentWorkspaceId, id);
        if (parentView) {
          ViewService.invalidateCache(currentWorkspaceId, parentView.view_id);
        }

        void loadTrash?.(currentWorkspaceId, { ensureFreshAfterInFlight: true }).catch((error) => {
          Log.warn('[Trash] Failed to refresh after moving a page to trash', error);
        });
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, outlineRef, role, loadOutline, loadTrash]
  );

  // Update page (rename) - uses WebSocket notification for sidebar refresh
  const updatePage = useCallback(
    async (viewId: string, payload: UpdatePagePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        await PageService.update(currentWorkspaceId, viewId, payload);
        // Drop the cached view metadata (memory + disk) so a stale name/icon
        // can't be re-served if the WebSocket notification is dropped.
        ViewService.invalidateCache(currentWorkspaceId, viewId);
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
        ViewService.invalidateCache(currentWorkspaceId, viewId);
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
        ViewService.invalidateCache(currentWorkspaceId, viewId);
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  const duplicatePage = useCallback(
    async (viewId: string, options: DuplicatePageOperationOptions = {}) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      const { afterPreSync, ...duplicateOptions } = options;

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
          await flushAllSync?.();
        }

        await afterPreSync?.();

        await PageService.duplicate(currentWorkspaceId, viewId, duplicateOptions);
        refreshDatabaseCatalogAfterMutation(currentWorkspaceId);
        await loadOutline?.(currentWorkspaceId, false);

        if (duplicateOptions.parentViewId) {
          ViewService.invalidateCache(currentWorkspaceId, duplicateOptions.parentViewId);
          await loadViewChildren?.(duplicateOptions.parentViewId);
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
        const oldParentView = findParentView(outlineRef.current || [], viewId);

        await PageService.moveTo(currentWorkspaceId, viewId, parentId, prevId);
        // Both the old and new parents' cached subtrees changed.
        if (oldParentView) {
          ViewService.invalidateCache(currentWorkspaceId, oldParentView.view_id);
        }

        ViewService.invalidateCache(currentWorkspaceId, parentId);
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
            const trashItems = await ViewService.refreshTrash(currentWorkspaceId, 'delete-all-snapshot');

            viewIdsToClear = trashItems?.map((item) => item.view_id) || [];
          } catch {
            // If we can't fetch trash list, proceed with deletion anyway
          }
        }

        await PageService.deleteTrash(currentWorkspaceId, viewId);
        refreshDatabaseCatalogAfterMutation(currentWorkspaceId);

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
        refreshDatabaseCatalogAfterMutation(currentWorkspaceId);
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

  const createSpaceWithInitialPage = useCallback(
    async (payload: CreateSpaceWithInitialPagePayload) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await PageService.createSpaceWithInitialPage(currentWorkspaceId, payload);

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

        refreshDatabaseCatalogAfterMutation(currentWorkspaceId);
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
    async (view: View, publishName?: string, visibleViewIds?: string[], commentsEnabled?: boolean) => {
      if (!currentWorkspaceId) return;
      const viewId = view.view_id;
      const isDatabaseView = isDatabaseLayout(view.layout);

      if (isDatabaseView) {
        // Database views: gather data client-side and send via binary publish endpoint
        // (same approach as the desktop client — fixes #8464). Kick the WS
        // drain in the background — the binary publish below carries the
        // authoritative local state, so we don't need to block the publish
        // on WS quiescence (which can stall up to 5s if the socket is
        // reconnecting).
        void flushAllSync?.();

        const slug =
          view.name
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40) || 'untitled';

        const name = publishName || `${slug}-${viewId.slice(0, 8)}`;

        Log.debug('[publish] gathering database data client-side', { viewId, name });

        // Always resolve all sibling views from the database container so every
        // tab (Grid, Board, Calendar, etc.) appears on the published page.
        let resolvedVisibleViewIds = visibleViewIds;

        if (view.extra?.is_database_container) {
          resolvedVisibleViewIds = [viewId, ...view.children.map((child) => child.view_id)];
        } else if (outlineRef.current) {
          const parentView = findParentView(outlineRef.current, viewId);

          if (parentView?.extra?.is_database_container && parentView.children?.length > 0) {
            resolvedVisibleViewIds = parentView.children.map((c) => c.view_id);
          }
        }

        const databaseId = view.extra?.database_id ?? (await getDatabaseIdForViewId?.(viewId));
        const data = await gatherDatabasePublishData(viewId, resolvedVisibleViewIds, databaseId);

        const toTimestamp = (s?: string) => {
          if (!s) return 0;
          const t = new Date(s).getTime();

          return isNaN(t) ? 0 : Math.floor(t / 1000);
        };

        const toPublishViewInfo = (publishView: View): PublishCollabMetadata['metadata']['view'] => ({
          view_id: publishView.view_id,
          name: publishView.name,
          icon: publishView.icon,
          layout: publishView.layout,
          extra: publishView.extra
            ? typeof publishView.extra === 'string'
              ? publishView.extra
              : JSON.stringify(publishView.extra)
            : null,
          created_by: null,
          last_edited_by: null,
          last_edited_time: toTimestamp(publishView.last_edited_time),
          created_at: toTimestamp(publishView.created_at),
          child_views: null,
        });
        const visibleViewIdSet = new Set(resolvedVisibleViewIds ?? []);

        const meta: PublishCollabMetadata = {
          view_id: viewId,
          publish_name: name,
          metadata: {
            view: toPublishViewInfo(view),
            child_views: view.children.filter((child) => visibleViewIdSet.has(child.view_id)).map(toPublishViewInfo),
            ancestor_views: [],
          },
        };

        await publishCollabs(currentWorkspaceId, [{ meta, data }]);
        clearPublishViewInfoCache(viewId);

        // The binary database-publish endpoint does not accept publish config.
        // Apply an explicit comments setting immediately after publishing.
        if (commentsEnabled !== undefined) {
          await PublishService.updateConfig(currentWorkspaceId, {
            view_id: viewId,
            comments_enabled: commentsEnabled,
          });
        }
      } else {
        // Document publishing gathers the folder, document, and referenced
        // dependencies on the server. Push the browser's current state first,
        // then tolerate the provisioning/projection interval under load.
        const outboxDrained = await flushAllSync?.();
        let fullSyncPromise: Promise<void> | undefined;
        const ensureServerState = syncAllToServer
          ? () => {
              fullSyncPromise ??= syncAllToServer(currentWorkspaceId);
              return fullSyncPromise;
            }
          : undefined;

        if (outboxDrained !== true) {
          await ensureServerState?.();
        }

        await publishDocumentWhenServerStateIsReady(
          currentWorkspaceId,
          viewId,
          {
            publish_name: publishName,
            visible_database_view_ids: visibleViewIds,
            comments_enabled: commentsEnabled,
          },
          ensureServerState
        );
      }

      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline, flushAllSync, syncAllToServer, outlineRef, getDatabaseIdForViewId]
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
    async (payload: CreateOrphanedViewPayload) => {
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
    createSpaceWithInitialPage,
    updateSpace,
    createDatabaseView,
    uploadFile,
    getSubscriptions,
    publish,
    unpublish,
    createOrphanedView: createOrphanedViewOp,
  };
}
