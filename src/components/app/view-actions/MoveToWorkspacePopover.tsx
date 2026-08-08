import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { PageService, ViewService, WorkspaceService } from '@/application/services/domains';
import { View, ViewLayout, Workspace } from '@/application/types';
import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as SelectedIcon } from '@/assets/icons/tick.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { filterOutByCondition } from '@/components/_shared/outline/utils';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useCurrentWorkspaceId, useRefreshOutline } from '@/components/app/app.hooks';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';

/**
 * Rows of the destination tree: spaces and document pages of the target
 * workspace. Deliberately NOT SpaceItem/ViewItem — those are wired to the
 * current workspace's drag-reorder machinery, which must stay inert against
 * a foreign workspace's outline.
 */
function TargetViewRow({
  view,
  depth,
  expandViewIds,
  toggleExpandView,
  selectedViewId,
  onSelect,
}: {
  view: View;
  depth: number;
  expandViewIds: string[];
  toggleExpandView: (id: string, isExpanded: boolean) => void;
  selectedViewId: string | null;
  onSelect: (viewId: string) => void;
}) {
  const isExpanded = expandViewIds.includes(view.view_id);
  const hasChildren = view.children.length > 0;
  const isSpace = Boolean(view.is_space);

  return (
    <div className={'flex flex-col'}>
      <div
        data-testid={`move-to-workspace-target-${view.view_id}`}
        style={{ paddingLeft: depth * 16 }}
        className={
          'flex min-h-[30px] cursor-pointer select-none items-center gap-1 rounded-[8px] px-1 py-0.5 text-sm hover:bg-fill-content-hover'
        }
        onClick={() => {
          toggleExpandView(view.view_id, !isExpanded);
          onSelect(view.view_id);
        }}
      >
        <div className={hasChildren ? '' : 'pointer-events-none opacity-0'}>
          <OutlineIcon
            isExpanded={isExpanded}
            setIsExpanded={(status) => {
              toggleExpandView(view.view_id, status);
            }}
            level={0}
          />
        </div>
        {isSpace ? (
          <SpaceIcon
            className={'icon mr-1 !h-5 !w-5 !min-w-5'}
            bgColor={view.extra?.space_icon_color}
            value={view.extra?.space_icon || ''}
            char={view.extra?.space_icon ? undefined : (view.name || '').slice(0, 1)}
          />
        ) : (
          <PageIcon view={view} className={'mr-1 flex h-5 w-5 min-w-5 items-center justify-center'} />
        )}
        <div className={'flex-1 truncate'}>{view.name}</div>
        {view.view_id === selectedViewId && <SelectedIcon className={'mx-2 h-5 w-5 min-w-5 text-text-action'} />}
      </div>
      {isExpanded &&
        view.children.map((child) => (
          <TargetViewRow
            key={child.view_id}
            view={child}
            depth={depth + 1}
            expandViewIds={expandViewIds}
            toggleExpandView={toggleExpandView}
            selectedViewId={selectedViewId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

/**
 * Two-pane picker for moving a page into another workspace:
 * 1. choose one of the user's other workspaces,
 * 2. choose the destination space/page inside it, then confirm.
 *
 * The move runs as an async server task (deep copy into the destination,
 * then the source page is trashed); progress is covered by the blocking
 * loader and the result is surfaced via toasts.
 */
function MoveToWorkspacePopover({
  viewId,
  onMoved,
  children,
  popoverContentProps,
  ...props
}: React.ComponentProps<typeof Popover> & {
  viewId: string;
  onMoved?: () => void;
  children: React.ReactNode;
  popoverContentProps?: React.ComponentProps<typeof PopoverContent>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const refreshOutline = useRefreshOutline();
  const { showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();

  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [outline, setOutline] = useState<View[] | null>(null);
  const [search, setSearch] = useState('');
  const [expandViewIds, setExpandViewIds] = useState<string[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);

  const otherWorkspaces = useMemo(
    () => (workspaces ?? []).filter((workspace) => workspace.id !== currentWorkspaceId),
    [workspaces, currentWorkspaceId]
  );

  useEffect(() => {
    if (!open) {
      setSelectedWorkspace(null);
      setOutline(null);
      setSearch('');
      setExpandViewIds([]);
      setSelectedViewId(null);
      return;
    }

    setWorkspaces(null);
    void WorkspaceService.getAll()
      .then((list) => setWorkspaces(list ?? []))
      .catch((e: { message?: string }) => {
        setWorkspaces([]);
        toast.error(e.message || 'Failed to load workspaces');
      });
  }, [open]);

  // Guards against a stale outline landing after the user went back and
  // picked a different workspace: only the latest request may render.
  const outlineRequestRef = useRef<string | null>(null);

  const handleSelectWorkspace = useCallback(async (workspace: Workspace) => {
    outlineRequestRef.current = workspace.id;
    setSelectedWorkspace(workspace);
    setOutline(null);
    setSearch('');
    setExpandViewIds([]);
    setSelectedViewId(null);
    try {
      const response = await ViewService.getOutline(workspace.id);

      if (outlineRequestRef.current !== workspace.id) return;
      setOutline(response.outline);
    } catch (e) {
      if (outlineRequestRef.current !== workspace.id) return;
      setOutline([]);
      toast.error((e as { message?: string }).message || 'Failed to load workspace pages');
    }
  }, []);

  const targetViews = useMemo(() => {
    if (!outline) return [];
    return filterOutByCondition(outline, (view) => ({
      remove:
        view.view_id === viewId ||
        view.layout !== ViewLayout.Document ||
        Boolean(search && !view.name.toLowerCase().includes(search.toLowerCase())),
    }));
  }, [outline, search, viewId]);

  const toggleExpandView = useCallback((id: string, isExpanded: boolean) => {
    setExpandViewIds((prev) => {
      return isExpanded ? [...prev, id] : prev.filter((v) => v !== id);
    });
  }, []);

  const handleMove = useCallback(async () => {
    if (!selectedWorkspace || !selectedViewId || !currentWorkspaceId) return;
    const destWorkspace = selectedWorkspace;
    const destParentViewId = selectedViewId;

    setOpen(false);
    onMoved?.();
    showBlockingLoader(t('disclosureAction.movingToWorkspace', { workspace: destWorkspace.name }));
    try {
      const taskId = await PageService.moveToWorkspace(
        currentWorkspaceId,
        viewId,
        destWorkspace.id,
        destParentViewId
      );
      const result = await PageService.waitForDuplicateTask(currentWorkspaceId, viewId, taskId);

      void refreshOutline?.();
      if (result.source_removed === false) {
        toast.warning(t('disclosureAction.moveToWorkspaceSourceNotRemoved', { workspace: destWorkspace.name }));
      } else {
        toast.success(t('disclosureAction.moveToWorkspaceSuccess', { workspace: destWorkspace.name }));
      }

      // The page left this workspace; if it is the one currently open,
      // follow it to its new home.
      if (window.location.pathname.includes(viewId)) {
        navigate(`/app/${destWorkspace.id}/${result.duplicated_view_id}`);
      }
    } catch (e) {
      toast.error((e as { message?: string }).message || 'Failed to move the page');
    } finally {
      hideBlockingLoader();
    }
  }, [
    selectedWorkspace,
    selectedViewId,
    currentWorkspaceId,
    onMoved,
    showBlockingLoader,
    hideBlockingLoader,
    refreshOutline,
    navigate,
    t,
    viewId,
  ]);

  return (
    <Popover
      modal
      open={open}
      onOpenChange={setOpen}
      {...props}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        {...popoverContentProps}
      >
        {!selectedWorkspace ? (
          <div className={'flex w-full flex-1 flex-col gap-1 p-2'}>
            <div className={'px-1 py-1 text-xs font-medium text-text-secondary'}>
              {t('disclosureAction.moveToWorkspaceSelect')}
            </div>
            {workspaces === null ? (
              <div className={'flex items-center justify-center p-4'}>
                <Progress variant={'primary'} />
              </div>
            ) : otherWorkspaces.length === 0 ? (
              <div className={'p-2 text-sm text-text-secondary'}>
                {t('disclosureAction.noOtherWorkspaces')}
              </div>
            ) : (
              <div className={'appflowy-custom-scroller max-h-[320px] overflow-y-auto'}>
                {otherWorkspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    data-testid={`move-to-workspace-option-${workspace.id}`}
                    className={
                      'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-content-hover'
                    }
                    onClick={() => void handleSelectWorkspace(workspace)}
                  >
                    <Avatar className={'h-6 w-6 rounded-[8px] text-xs'}>
                      <AvatarFallback>{workspace.icon || (workspace.name || '?').slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <span className={'flex-1 truncate text-left'}>{workspace.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={'folder-views flex w-full flex-1 flex-col gap-2 p-2'}>
            <div className={'flex items-center gap-1'}>
              <Button
                variant={'ghost'}
                size={'icon'}
                data-testid={'move-to-workspace-back'}
                onClick={() => {
                  outlineRequestRef.current = null;
                  setSelectedWorkspace(null);
                  setOutline(null);
                  setSelectedViewId(null);
                }}
              >
                <BackIcon />
              </Button>
              <span className={'flex-1 truncate text-sm font-medium'}>{selectedWorkspace.name}</span>
            </div>
            <SearchInput
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              autoFocus={true}
              placeholder={t('disclosureAction.movePageTo')}
            />
            <div className={'appflowy-custom-scroller max-h-[360px] flex-1 overflow-y-auto overflow-x-hidden'}>
              {outline === null ? (
                <div className={'flex items-center justify-center p-4'}>
                  <Progress variant={'primary'} />
                </div>
              ) : (
                targetViews.map((view) => (
                  <TargetViewRow
                    key={view.view_id}
                    view={view}
                    depth={0}
                    expandViewIds={expandViewIds}
                    toggleExpandView={toggleExpandView}
                    selectedViewId={selectedViewId}
                    onSelect={setSelectedViewId}
                  />
                ))
              )}
            </div>
            <Separator className={'mb-1'} />
            <div className={'flex items-center justify-end'}>
              <Button
                data-testid={'move-to-workspace-confirm'}
                disabled={!selectedViewId}
                onClick={() => void handleMove()}
              >
                {t('disclosureAction.move')}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default MoveToWorkspacePopover;
