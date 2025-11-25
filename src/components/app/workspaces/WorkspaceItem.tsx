import { CircularProgress } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Role, Workspace } from '@/application/types';
import MoreActions from '@/components/app/workspaces/MoreActions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenuItem, DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function WorkspaceItem({
  workspace,
  showActions = true,
  onChange,
  currentWorkspaceId,
  changeLoading,
  onUpdate,
  onDelete,
  onLeave,
  useDropdownItem = true,
}: {
  showActions?: boolean;
  workspace: Workspace;
  onChange: (id: string) => void;
  currentWorkspaceId?: string;
  changeLoading?: string;
  onUpdate?: (workspace: Workspace) => void;
  onDelete?: (workspace: Workspace) => void;
  onLeave?: (workspace: Workspace) => void;
  useDropdownItem?: boolean;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const isGuest = workspace.role === Role.Guest;
  const renderActions = useMemo(() => {
    if (changeLoading === workspace.id) return <CircularProgress size={16} />;

    if (!showActions) {
      if (currentWorkspaceId === workspace.id) {
        return <DropdownMenuItemTick />;
      }

      return null;
    }

    return (
      <div className='relative ml-auto flex h-7 w-7 items-center justify-center'>
        {currentWorkspaceId === workspace.id && (
          <DropdownMenuItemTick
            style={{
              opacity: hovered ? 0 : 1,
            }}
            className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          />
        )}

        <div
          className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          style={{
            opacity: hovered ? 1 : 0,
          }}
        >
          <MoreActions
            workspace={workspace}
            onUpdate={() => onUpdate?.(workspace)}
            onDelete={() => onDelete?.(workspace)}
            onLeave={() => onLeave?.(workspace)}
          />
        </div>
      </div>
    );
  }, [changeLoading, currentWorkspaceId, hovered, onDelete, onLeave, onUpdate, showActions, workspace]);

  const handleSelect = useCallback(() => {
    if (workspace.id === currentWorkspaceId) return;
    void onChange(workspace.id);
  }, [currentWorkspaceId, onChange, workspace.id]);

  const content = (
    <>
      <Avatar shape={'square'} size={'xs'}>
        <AvatarFallback name={workspace.name}>
          {workspace.icon ? <span className='text-lg'>{workspace.icon}</span> : workspace.name}
        </AvatarFallback>
      </Avatar>
      <div className={'flex flex-1 flex-col items-start overflow-hidden'}>
        <Tooltip delayDuration={1000}>
          <TooltipTrigger asChild>
            <div
              data-testid='workspace-item-name'
              className={'flex w-full items-center gap-2 overflow-hidden truncate text-left text-sm text-text-primary'}
            >
              <div className='truncate text-sm text-text-primary'>{workspace.name}</div>
              {isGuest && (
                <span className='rounded-full bg-fill-warning-light px-2 py-[1px] text-xs text-text-warning-on-fill'>
                  {t('shareAction.guest')}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{workspace.name}</p>
          </TooltipContent>
        </Tooltip>
        {!isGuest && (
          <div data-testid='workspace-member-count' className={'text-xs leading-[18px] text-text-secondary'}>
            {t('invitation.membersCount', { count: workspace.memberCount || 0 })}
          </div>
        )}
      </div>
      {renderActions}
    </>
  );

  if (useDropdownItem) {
    return (
      <DropdownMenuItem
        key={workspace.id}
        data-testid='workspace-item'
        className={'relative'}
        onSelect={handleSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {content}
      </DropdownMenuItem>
    );
  }

  return (
    <button
      type='button'
      key={workspace.id}
      data-testid='workspace-item'
      className={dropdownMenuItemVariants({ variant: 'default', className: 'relative w-full text-left' })}
      onClick={handleSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {content}
    </button>
  );
}
