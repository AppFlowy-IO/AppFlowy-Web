import { useCallback, useEffect, useState } from 'react';

import { Workspace } from '@/application/types';
import { WorkspaceItem } from '@/components/app/workspaces/WorkspaceItem';
import { useService } from '@/components/main/app.hooks';

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
}) {
  const service = useService();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces || []);
  const fetchWorkspaces = useCallback(async () => {
    if (!service) return;
    try {
      const workspaces = await service.getWorkspaces();

      setWorkspaces(workspaces);
    } catch (e) {
      console.error(e);
    }
  }, [service]);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  return (
    <>
      {workspaces.map((workspace) => {
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
          />
        );
      })}
    </>
  );
}

export default WorkspaceList;
