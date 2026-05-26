import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { CircularProgress } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Role, Workspace } from '@/application/types';
import MoreActions from '@/components/app/workspaces/MoreActions';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenuItem, DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type WorkspaceDragState =
  | { type: 'idle' }
  | { type: 'dragging' }
  | { type: 'over'; closestEdge: Edge | null };

const idleState: WorkspaceDragState = { type: 'idle' };

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
  workspaceCount,
  canReorder,
  dragInstanceId,
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
  workspaceCount?: number;
  canReorder?: boolean;
  dragInstanceId?: symbol;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [dragState, setDragState] = useState<WorkspaceDragState>(idleState);
  const rowRef = useRef<HTMLDivElement | HTMLButtonElement>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number>();
  const isGuest = workspace.role === Role.Guest;

  useEffect(() => {
    return () => {
      if (suppressClickTimeoutRef.current !== undefined) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const element = rowRef.current;

    if (!canReorder || !dragInstanceId || !element) return;

    const data = {
      type: 'workspace',
      instanceId: dragInstanceId,
      id: workspace.id,
    };

    return combine(
      draggable({
        element,
        getInitialData: () => data,
        onDragStart() {
          suppressClickRef.current = true;
          if (suppressClickTimeoutRef.current !== undefined) {
            window.clearTimeout(suppressClickTimeoutRef.current);
            suppressClickTimeoutRef.current = undefined;
          }

          setDragState({ type: 'dragging' });
        },
        onDrop() {
          suppressClickTimeoutRef.current = window.setTimeout(() => {
            suppressClickRef.current = false;
            suppressClickTimeoutRef.current = undefined;
          }, 0);

          setDragState(idleState);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === 'workspace' &&
          source.data.instanceId === dragInstanceId &&
          source.data.id !== workspace.id,
        getIsSticky: () => true,
        getData({ input }) {
          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: ['top', 'bottom'],
          });
        },
        onDrag({ self }) {
          const closestEdge = extractClosestEdge(self.data);

          setDragState((current) => {
            if (current.type === 'over' && current.closestEdge === closestEdge) return current;
            return { type: 'over', closestEdge };
          });
        },
        onDragLeave() {
          setDragState(idleState);
        },
        onDrop() {
          setDragState(idleState);
        },
      })
    );
  }, [canReorder, dragInstanceId, workspace.id]);

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
            workspaceCount={workspaceCount}
          />
        </div>
      </div>
    );
  }, [changeLoading, currentWorkspaceId, hovered, onDelete, onLeave, onUpdate, showActions, workspace, workspaceCount]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;

    suppressClickRef.current = false;
    if (suppressClickTimeoutRef.current !== undefined) {
      window.clearTimeout(suppressClickTimeoutRef.current);
      suppressClickTimeoutRef.current = undefined;
    }

    return true;
  }, []);

  // Shared activation handler for both Radix `onSelect` (Event) and native
  // button `onClick` (MouseEvent). preventDefault on the Radix event keeps the
  // dropdown open after a drag; on the button it's harmless.
  const handleActivate = useCallback(
    (event?: { preventDefault(): void }) => {
      if (consumeSuppressedClick()) {
        event?.preventDefault();
        return;
      }

      if (workspace.id === currentWorkspaceId) return;
      void onChange(workspace.id);
    },
    [consumeSuppressedClick, currentWorkspaceId, onChange, workspace.id]
  );

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
      {dragState.type === 'over' ? <DropRowIndicator edge={dragState.closestEdge} /> : null}
    </>
  );

  if (useDropdownItem) {
    return (
      <DropdownMenuItem
        ref={rowRef as React.RefObject<HTMLDivElement>}
        data-testid='workspace-item'
        className={cn('relative', dragState.type === 'dragging' && 'opacity-40')}
        onSelect={handleActivate}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {content}
      </DropdownMenuItem>
    );
  }

  return (
    <button
      ref={rowRef as React.RefObject<HTMLButtonElement>}
      type='button'
      data-testid='workspace-item'
      className={dropdownMenuItemVariants({
        variant: 'default',
        className: cn('relative w-full text-left', dragState.type === 'dragging' && 'opacity-40'),
      })}
      onClick={() => handleActivate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {content}
    </button>
  );
}
