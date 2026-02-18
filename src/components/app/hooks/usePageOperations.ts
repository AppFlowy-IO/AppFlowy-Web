import { useCallback } from 'react';
import { toast } from 'sonner';

import {
  CreateDatabaseViewPayload,
  CreatePagePayload,
  CreateSpacePayload,
  Role,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
} from '@/application/types';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';

import { useAuthInternal } from '../contexts/AuthInternalContext';

// Hook for managing page and space operations
export function usePageOperations({
  outline,
  loadOutline,
}: {
  outline?: View[];
  loadOutline?: (workspaceId: string, force?: boolean) => Promise<void>;
}) {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const role = userWorkspaceInfo?.selectedWorkspace.role;

  // Add a new page
  const addPage = useCallback(
    async (parentViewId: string, payload: CreatePagePayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      const shareWithMeView = findViewInShareWithMe(outline || [], parentViewId);

      if (role === Role.Guest || shareWithMeView) {
        toast.error('No permission to create pages');
        throw new Error('No permission to create pages');
      }

      try {
        const response = await service?.addAppPage(currentWorkspaceId, parentViewId, payload);

        // Keep a resilient fallback when realtime delivery is unavailable.
        // This guarantees sidebar eventual consistency after creation.
        void loadOutline?.(currentWorkspaceId, false);
        return response;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, outline, role, loadOutline]
  );

  // Delete a page (move to trash)
  const deletePage = useCallback(
    async (id: string, loadTrash?: (workspaceId: string) => Promise<void>) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      const shareWithMeView = findViewInShareWithMe(outline || [], id);

      if (role === Role.Guest || shareWithMeView) {
        throw new Error('Guest cannot delete pages');
      }

      try {
        await service?.moveToTrash(currentWorkspaceId, id);
        void loadTrash?.(currentWorkspaceId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, outline, role, loadOutline]
  );

  // Update page (rename) - uses WebSocket notification for sidebar refresh
  const updatePage = useCallback(
    async (viewId: string, payload: UpdatePagePayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        await service?.updateAppPage(currentWorkspaceId, viewId, payload);
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Update page icon
  const updatePageIcon = useCallback(
    async (viewId: string, icon: { ty: ViewIconType; value: string }) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        await service?.updateAppPageIcon(currentWorkspaceId, viewId, icon);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Update page name (rename) - uses WebSocket notification for sidebar refresh
  const updatePageName = useCallback(
    async (viewId: string, name: string) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        await service?.updateAppPageName(currentWorkspaceId, viewId, name);
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Move page
  const movePage = useCallback(
    async (viewId: string, parentId: string, prevViewId?: string) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      if (role === Role.Guest) {
        throw new Error('Guest cannot move pages');
      }

      try {
        const lastChild = findView(outline || [], parentId)?.children?.slice(-1)[0];
        const prevId = prevViewId || lastChild?.view_id;

        await service?.movePage(currentWorkspaceId, viewId, parentId, prevId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, outline, loadOutline, role]
  );

  // Delete from trash permanently
  const deleteTrash = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        await service?.deleteTrash(currentWorkspaceId, viewId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, loadOutline]
  );

  // Restore page from trash
  const restorePage = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        await service?.restoreFromTrash(currentWorkspaceId, viewId);
        void loadOutline?.(currentWorkspaceId, false);
        return;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, loadOutline]
  );

  // Create space
  const createSpace = useCallback(
    async (payload: CreateSpacePayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.createSpace(currentWorkspaceId, payload);

        void loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, loadOutline]
  );

  // Update space
  const updateSpace = useCallback(
    async (payload: UpdateSpacePayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.updateSpace(currentWorkspaceId, payload);

        void loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, loadOutline]
  );

  // Create database view (linked view using new endpoint)
  const createDatabaseView = useCallback(
    async (viewId: string, payload: CreateDatabaseViewPayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.createDatabaseView(currentWorkspaceId, viewId, payload);

        await loadOutline?.(currentWorkspaceId, false);
        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, loadOutline]
  );

  // Upload file
  const uploadFile = useCallback(
    async (viewId: string, file: File, onProgress?: (n: number) => void) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.uploadFile(currentWorkspaceId, viewId, file, onProgress);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Get subscriptions
  const getSubscriptions = useCallback(async () => {
    if (!service || !currentWorkspaceId) {
      throw new Error('No service found');
    }

    try {
      const res = await service?.getWorkspaceSubscriptions(currentWorkspaceId);

      return res;
    } catch (e) {
      return Promise.reject(e);
    }
  }, [currentWorkspaceId, service]);

  // Publish view
  const publish = useCallback(
    async (view: View, publishName?: string, visibleViewIds?: string[]) => {
      if (!service || !currentWorkspaceId) return;
      const viewId = view.view_id;

      await service?.publishView(currentWorkspaceId, viewId, {
        publish_name: publishName,
        visible_database_view_ids: visibleViewIds,
      });
      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline, service]
  );

  // Unpublish view
  const unpublish = useCallback(
    async (viewId: string) => {
      if (!service || !currentWorkspaceId) return;
      await service?.unpublishView(currentWorkspaceId, viewId);
      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline, service]
  );

  // Create orphaned view
  const createOrphanedView = useCallback(
    async (payload: { document_id: string }) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.createOrphanedView(currentWorkspaceId, payload);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  return {
    addPage,
    deletePage,
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
    createOrphanedView,
  };
}
