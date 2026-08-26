import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { PageService, ViewService } from '@/application/services/domains';
import { extractReorderableTreeItemData, resolveTreeMoveDestination } from '@/components/_shared/reorder/treeItem';
import { useRefreshOutline } from '@/components/app/app.hooks';
import { Log } from '@/utils/log';

const SIDEBAR_VIEW_DRAG_TYPE = 'sidebar-view';

/**
 * Persists the tree-level part of sidebar drag-and-drop exactly once.
 *
 * Individual sibling lists retain their existing monitors for optimistic
 * top/bottom reordering. This root monitor handles only make-child and
 * cross-parent drops, avoiding one global cross-tree listener per nested list.
 */
export function useSidebarTreeMonitor({
  scopeId,
  workspaceId,
}: {
  scopeId: symbol;
  workspaceId: string | undefined;
}): void {
  const refreshOutline = useRefreshOutline();
  const refreshOutlineRef = useRef(refreshOutline);

  useEffect(() => {
    refreshOutlineRef.current = refreshOutline;
  }, [refreshOutline]);

  useEffect(() => {
    if (!workspaceId) return;

    return monitorForElements({
      canMonitor({ source }) {
        const sourceTreeItem = extractReorderableTreeItemData(source.data);

        return source.data.type === SIDEBAR_VIEW_DRAG_TYPE && sourceTreeItem?.scopeId === scopeId;
      },
      onDrop({ location, source }) {
        const target = location.current.dropTargets[0];

        if (!target) return;

        const sourceId = String(source.data.id ?? '');
        const targetId = String(target.data.id ?? '');
        const sourceTreeItem = extractReorderableTreeItemData(source.data);
        const targetTreeItem = extractReorderableTreeItemData(target.data);

        if (
          !sourceId ||
          !targetId ||
          sourceId === targetId ||
          sourceTreeItem?.scopeId !== scopeId ||
          targetTreeItem?.scopeId !== scopeId
        ) {
          return;
        }

        const instruction = extractInstruction(target.data);

        if (!instruction || instruction.type === 'instruction-blocked' || instruction.type === 'reparent') return;

        const destination = resolveTreeMoveDestination({
          instruction,
          sourceId,
          targetId,
          targetParentId: targetTreeItem.parentId,
          targetSiblingIds: targetTreeItem.siblingIds,
          targetChildIds: targetTreeItem.childIds,
        });

        if (!destination) return;

        // Same-parent edge drops are owned by the list monitor so they retain
        // its optimistic ordering and cannot be persisted twice.
        if (instruction.type !== 'make-child' && destination.parentId === sourceTreeItem.parentId) return;

        void (async () => {
          try {
            await PageService.moveTo(workspaceId, sourceId, destination.parentId, destination.prevId);

            ViewService.invalidateCache(workspaceId, sourceTreeItem.parentId);
            if (destination.parentId !== sourceTreeItem.parentId) {
              ViewService.invalidateCache(workspaceId, destination.parentId);
            }

            await refreshOutlineRef.current?.();
          } catch (error) {
            toast.error('Failed to move page');
            Log.error('[Sidebar tree] Failed to move page', error);
          }
        })();
      },
    });
  }, [scopeId, workspaceId]);
}
