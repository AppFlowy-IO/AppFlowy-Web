import { MutableRefObject, useCallback } from 'react';
import { toast } from 'sonner';

import { BillingService, FileService, PageService, PublishService, ViewService } from '@/application/services/domains';
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
  outlineRef,
  loadOutline,
}: {
  outlineRef: MutableRefObject<View[] | undefined>;
  loadOutline?: (workspaceId: string, force?: boolean) => Promise<void>;
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
        await PageService.deleteTrash(currentWorkspaceId, viewId);
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

      await PublishService.publish(currentWorkspaceId, viewId, {
        publish_name: publishName,
        visible_database_view_ids: visibleViewIds,
      });
      await loadOutline?.(currentWorkspaceId, false);
    },
    [currentWorkspaceId, loadOutline]
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
