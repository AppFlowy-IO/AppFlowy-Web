import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { WorkspaceService } from '@/application/services/domains';
import { Workspace } from '@/application/types';
import { WorkspaceItem } from '@/components/app/workspaces/WorkspaceItem';
import { Log } from '@/utils/log';

type ScrollContainerRef = {
  current: HTMLElement | null;
};

function WorkspaceList({
  defaultWorkspaces,
  currentWorkspaceId,
  onChange,
  changeLoading,
  showActions = true,
  onUpdate,
  onDelete,
  onLeave,
  useDropdownItem = true,
  autoScrollContainerRef,
}: {
  currentWorkspaceId?: string;
  changeLoading?: string;
  onChange: (selectedId: string) => void;
  defaultWorkspaces?: Workspace[];
  showActions?: boolean;

  onUpdate?: (workspace: Workspace) => void;
  onDelete?: (workspace: Workspace) => void;
  onLeave?: (workspace: Workspace) => void;
  useDropdownItem?: boolean;
  autoScrollContainerRef?: ScrollContainerRef;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces || []);
  const fetchWorkspaces = useCallback(async () => {
    try {
      const workspaces = await WorkspaceService.getAll();

      setWorkspaces(workspaces);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // The server returns workspaces in the user's preferred order
  // (af_workspace_member.position), so we render them as received.
  const [optimisticWorkspaceIds, setOptimisticWorkspaceIds] = useState<string[] | null>(null);
  const orderedWorkspaces = useMemo(() => {
    if (!optimisticWorkspaceIds) return workspaces;

    const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const ordered = optimisticWorkspaceIds
      .map((id) => byId.get(id))
      .filter((workspace): workspace is Workspace => Boolean(workspace));
    const seenIds = new Set(ordered.map((workspace) => workspace.id));

    return [
      ...ordered,
      ...workspaces.filter((workspace) => !seenIds.has(workspace.id)),
    ];
  }, [optimisticWorkspaceIds, workspaces]);

  // Latest ordered list, read by the async reorder callback. Kept in a ref so
  // `reorderWorkspaces` (and therefore the monitor effect) doesn't need to
  // depend on `orderedWorkspaces` — depending on it would tear down and
  // re-register the drag monitor on every order change.
  const orderedWorkspacesRef = useRef<Workspace[]>(orderedWorkspaces);
  const pendingReorderIdsRef = useRef<string[] | null>(null);
  const isSavingReorderRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragInstanceId] = useState(() => Symbol('workspace-drag-instance'));
  const canReorder = orderedWorkspaces.length > 1;

  useEffect(() => {
    orderedWorkspacesRef.current = orderedWorkspaces;
  }, [orderedWorkspaces]);

  const flushPendingReorders = useCallback(async () => {
    if (isSavingReorderRef.current) return;

    isSavingReorderRef.current = true;

    try {
      while (pendingReorderIdsRef.current) {
        const nextIds = pendingReorderIdsRef.current;

        pendingReorderIdsRef.current = null;
        await WorkspaceService.reorder(nextIds);

        if (pendingReorderIdsRef.current) continue;

        await fetchWorkspaces();

        if (!pendingReorderIdsRef.current) {
          setOptimisticWorkspaceIds(null);
        }
      }
    } catch (error) {
      pendingReorderIdsRef.current = null;
      setOptimisticWorkspaceIds(null);
      await fetchWorkspaces();
      toast.error('Failed to reorder workspaces');
      Log.error('[WorkspaceList] Failed to reorder workspaces', error);
    } finally {
      isSavingReorderRef.current = false;
    }
  }, [fetchWorkspaces]);

  const reorderWorkspaces = useCallback(
    (sourceId: string, targetId: string, closestEdgeOfTarget: Edge | null) => {
      const current = orderedWorkspacesRef.current;
      const startIndex = current.findIndex((workspace) => workspace.id === sourceId);
      const indexOfTarget = current.findIndex((workspace) => workspace.id === targetId);

      if (startIndex < 0 || indexOfTarget < 0) return;

      const finishIndex = getReorderDestinationIndex({
        startIndex,
        indexOfTarget,
        closestEdgeOfTarget,
        axis: 'vertical',
      });

      if (finishIndex === startIndex) return;

      const next = reorder({
        list: current,
        startIndex,
        finishIndex,
      });
      const nextIds = next.map((workspace) => workspace.id);

      orderedWorkspacesRef.current = next;
      pendingReorderIdsRef.current = nextIds;
      setOptimisticWorkspaceIds(nextIds);
      void flushPendingReorders();
    },
    [flushPendingReorders]
  );

  useEffect(() => {
    const element = autoScrollContainerRef?.current ?? listRef.current;

    if (!canReorder || !element) return;

    function canRespond({ source }: { source: { data: Record<string, unknown> } }) {
      return source.data.type === 'workspace' && source.data.instanceId === dragInstanceId;
    }

    return combine(
      monitorForElements({
        canMonitor: canRespond,
        onDrop({ location, source }) {
          const target = location.current.dropTargets[0];

          if (!target) return;

          const sourceId = String(source.data.id ?? '');
          const targetId = String(target.data.id ?? '');

          if (!sourceId || !targetId || sourceId === targetId) return;

          const closestEdgeOfTarget = extractClosestEdge(target.data);

          void reorderWorkspaces(sourceId, targetId, closestEdgeOfTarget);
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element,
      })
    );
  }, [autoScrollContainerRef, canReorder, dragInstanceId, reorderWorkspaces]);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  return (
    <div ref={listRef}>
      {orderedWorkspaces.map((workspace) => {
        return (
          <WorkspaceItem
            key={workspace.id}
            workspace={workspace}
            onChange={onChange}
            currentWorkspaceId={currentWorkspaceId}
            changeLoading={changeLoading}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLeave={onLeave}
            showActions={showActions}
            useDropdownItem={useDropdownItem}
            workspaceCount={orderedWorkspaces.length}
            canReorder={canReorder}
            dragInstanceId={dragInstanceId}
          />
        );
      })}
    </div>
  );
}

export default WorkspaceList;
