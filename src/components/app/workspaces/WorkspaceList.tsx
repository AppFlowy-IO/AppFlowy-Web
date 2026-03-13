import { useCallback, useEffect, useState } from 'react';

import { WorkspaceService } from '@/application/services/domains';
import { Workspace } from '@/application/types';
import { WorkspaceItem } from '@/components/app/workspaces/WorkspaceItem';

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
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces || []);
  const fetchWorkspaces = useCallback(async () => {
    try {
      const workspaces = await WorkspaceService.getAll();

      setWorkspaces(workspaces);
    } catch (e) {
      console.error(e);
    }
  }, []);

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
