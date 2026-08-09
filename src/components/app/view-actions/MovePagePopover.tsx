import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { PageService, ViewService } from '@/application/services/domains';
import { View, ViewLayout, Workspace } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as SelectedIcon } from '@/assets/icons/tick.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { filterOutByCondition } from '@/components/_shared/outline/utils';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import {
  useAppOperations,
  useAppOutline,
  useAppView,
  useCurrentWorkspaceId,
  useRefreshOutline,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import SpaceItem from '@/components/app/outline/SpaceItem';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';

/**
 * Rows of the destination tree when another workspace is selected: spaces and
 * document pages of the target workspace. Deliberately NOT SpaceItem/ViewItem —
 * those are wired to the current workspace's drag-reorder machinery, which must
 * stay inert against a foreign workspace's outline.
 */
function TargetViewRow({
  view,
  depth,
  expandedViewIds,
  toggleExpandView,
  selectedViewId,
  onSelect,
}: {
  view: View;
  depth: number;
  expandedViewIds: ReadonlySet<string>;
  toggleExpandView: (id: string, isExpanded: boolean) => void;
  selectedViewId: string | null;
  onSelect: (viewId: string) => void;
}) {
  const isExpanded = expandedViewIds.has(view.view_id);
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
            expandedViewIds={expandedViewIds}
            toggleExpandView={toggleExpandView}
            selectedViewId={selectedViewId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

/**
 * "Move to" picker. The workspace selector at the right of the search input
 * switches the destination tree between the current workspace's outline and
 * another workspace's outline.
 *
 * Within the current workspace the move is the plain reorder operation; into
 * another workspace it runs as an async server task (deep copy into the
 * destination, then the source page is trashed) — progress is covered by the
 * blocking loader and the result is surfaced via toasts.
 */
function MovePagePopover({
  viewId,
  onMoved,
  children,
  popoverContentProps,
  open: openProp,
  onOpenChange,
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
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const outline = useAppOutline();
  const view = useAppView(viewId);
  const { movePage } = useAppOperations();
  const refreshOutline = useRefreshOutline();
  const { showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();

  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const [search, setSearch] = useState('');
  const [expandViewIds, setExpandViewIds] = useState<string[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);

  // null = the current workspace (plain in-workspace move).
  const [targetWorkspace, setTargetWorkspace] = useState<Workspace | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [foreignOutline, setForeignOutline] = useState<View[] | null>(null);
  const isCrossWorkspace = Boolean(targetWorkspace && targetWorkspace.id !== currentWorkspaceId);

  const workspaces = userWorkspaceInfo?.workspaces ?? [];
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;
  const displayedWorkspace = targetWorkspace ?? currentWorkspace;
  // AI chat pages cannot be deep-copied into another workspace.
  const showWorkspaceSelector = workspaces.length > 1 && view?.layout !== ViewLayout.AIChat;

  // Guards against a stale outline landing after the user switched to yet
  // another workspace: only the latest request may render.
  const outlineRequestRef = useRef<string | null>(null);
  // Outlines already fetched while this popover is open, so switching back to
  // a workspace doesn't refetch its full tree. Cleared on close to avoid
  // showing a stale tree next time.
  const outlineCacheRef = useRef<Map<string, View[]>>(new Map());

  useEffect(() => {
    if (open) return;
    outlineRequestRef.current = null;
    outlineCacheRef.current.clear();
    setSearch('');
    setExpandViewIds([]);
    setSelectedViewId(null);
    setTargetWorkspace(null);
    setForeignOutline(null);
    setSelectorOpen(false);
  }, [open]);

  const handleSelectWorkspace = useCallback(
    async (workspace: Workspace) => {
      setSelectorOpen(false);
      setSearch('');
      setExpandViewIds([]);
      setSelectedViewId(null);

      if (workspace.id === currentWorkspaceId) {
        outlineRequestRef.current = null;
        setTargetWorkspace(null);
        setForeignOutline(null);
        return;
      }

      setTargetWorkspace(workspace);
      const cached = outlineCacheRef.current.get(workspace.id);

      if (cached) {
        outlineRequestRef.current = null;
        setForeignOutline(cached);
        return;
      }

      outlineRequestRef.current = workspace.id;
      setForeignOutline(null);
      try {
        const response = await ViewService.getOutline(workspace.id);

        outlineCacheRef.current.set(workspace.id, response.outline);
        if (outlineRequestRef.current !== workspace.id) return;
        setForeignOutline(response.outline);
      } catch (e) {
        if (outlineRequestRef.current !== workspace.id) return;
        setForeignOutline([]);
        toast.error((e as { message?: string }).message || 'Failed to load workspace pages');
      }
    },
    [currentWorkspaceId]
  );

  const views = useMemo(() => {
    const source = isCrossWorkspace ? foreignOutline : outline;

    if (!source) return [];
    const query = search.toLowerCase();

    return filterOutByCondition(source, (view) => ({
      remove:
        view.view_id === viewId ||
        view.layout !== ViewLayout.Document ||
        Boolean(query && !view.name.toLowerCase().includes(query)),
    }));
  }, [isCrossWorkspace, foreignOutline, outline, search, viewId]);

  const toggleExpandView = useCallback((id: string, isExpanded: boolean) => {
    setExpandViewIds((prev) => {
      return isExpanded ? [...prev, id] : prev.filter((v) => v !== id);
    });
  }, []);

  // SpaceItem's API wants the array; the cross-workspace tree probes per row,
  // so give it O(1) lookups instead.
  const expandedViewIdSet = useMemo(() => new Set(expandViewIds), [expandViewIds]);

  const handleMoveInWorkspace = useCallback(async () => {
    if (!selectedViewId) return;
    try {
      await movePage?.(viewId, selectedViewId);
      onMoved?.();
      setSelectedViewId(null);
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [movePage, onMoved, selectedViewId, viewId]);

  const handleMoveToWorkspace = useCallback(async () => {
    if (!targetWorkspace || !selectedViewId || !currentWorkspaceId) return;
    const destWorkspace = targetWorkspace;
    const destParentViewId = selectedViewId;

    handleOpenChange(false);
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
    targetWorkspace,
    selectedViewId,
    currentWorkspaceId,
    handleOpenChange,
    onMoved,
    showBlockingLoader,
    hideBlockingLoader,
    refreshOutline,
    navigate,
    t,
    viewId,
  ]);

  const renderExtra = useCallback(
    ({ view }: { view: View }) => {
      if (view.view_id !== selectedViewId) return null;
      return <SelectedIcon className={'mx-2 text-text-action'} />;
    },
    [selectedViewId]
  );

  // The workspace list portals into a node inside the popover content so the
  // outer (modal) popover doesn't treat clicks on it as outside interactions.
  const [selectorContainer, setSelectorContainer] = useState<HTMLDivElement | null>(null);

  const workspaceSelector = displayedWorkspace ? (
    <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
      <PopoverTrigger asChild>
        <button
          type={'button'}
          data-testid={'move-page-workspace-selector'}
          aria-label={t('disclosureAction.moveToWorkspaceSelect')}
          className={'flex items-center gap-0.5 rounded-[6px] p-0.5 hover:bg-fill-content-hover'}
        >
          <Avatar shape={'square'} size={'xs'}>
            <AvatarFallback name={displayedWorkspace.name}>
              {displayedWorkspace.icon ? (
                <span className={'text-sm'}>{displayedWorkspace.icon}</span>
              ) : (
                displayedWorkspace.name
              )}
            </AvatarFallback>
          </Avatar>
          <ArrowDownIcon className={'h-4 w-4 text-icon-secondary'} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={selectorContainer}
        align={'end'}
        className={'w-[260px] p-2'}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        <div className={'appflowy-custom-scroller flex max-h-[320px] flex-col gap-0.5 overflow-y-auto'}>
          {workspaces.map((workspace) => {
            const isSelected = workspace.id === (targetWorkspace?.id ?? currentWorkspaceId);

            return (
              <button
                key={workspace.id}
                type={'button'}
                data-testid={`move-to-workspace-option-${workspace.id}`}
                className={'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-content-hover'}
                onClick={() => void handleSelectWorkspace(workspace)}
              >
                <Avatar shape={'square'} size={'xs'}>
                  <AvatarFallback name={workspace.name}>
                    {workspace.icon ? <span className={'text-sm'}>{workspace.icon}</span> : workspace.name}
                  </AvatarFallback>
                </Avatar>
                <span className={'flex-1 truncate text-left'}>{workspace.name}</span>
                {isSelected && <SelectedIcon className={'h-5 w-5 min-w-5 text-text-action'} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  return (
    <Popover modal open={open} onOpenChange={handleOpenChange} {...props}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        {...popoverContentProps}
      >
        {/* Fixed size so the dialog doesn't jump when switching the destination
            workspace swaps the tree (or shows the loading state). */}
        <div className={'folder-views flex w-[320px] flex-col gap-2 p-2'}>
          <div ref={setSelectorContainer} />
          <SearchInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            autoFocus={true}
            placeholder={t('disclosureAction.movePageTo')}
            endAdornment={showWorkspaceSelector ? workspaceSelector : undefined}
          />
          <div className={'appflowy-custom-scroller h-[360px] overflow-y-auto overflow-x-hidden'}>
            {isCrossWorkspace ? (
              foreignOutline === null ? (
                <div className={'flex items-center justify-center p-4'}>
                  <Progress variant={'primary'} />
                </div>
              ) : (
                views.map((view) => (
                  <TargetViewRow
                    key={view.view_id}
                    view={view}
                    depth={0}
                    expandedViewIds={expandedViewIdSet}
                    toggleExpandView={toggleExpandView}
                    selectedViewId={selectedViewId}
                    onSelect={setSelectedViewId}
                  />
                ))
              )
            ) : (
              views.map((view) => {
                const isExpanded = expandViewIds.includes(view.view_id);

                return (
                  <div key={view.view_id} className={'flex items-start gap-1'}>
                    <div className={'flex h-[30px] items-center'}>
                      <OutlineIcon
                        isExpanded={isExpanded}
                        setIsExpanded={(status) => {
                          toggleExpandView(view.view_id, status);
                        }}
                        level={0}
                      />
                    </div>

                    <SpaceItem
                      view={view}
                      key={view.view_id}
                      width={268}
                      expandIds={expandViewIds}
                      toggleExpand={toggleExpandView}
                      onClickView={(viewId) => {
                        toggleExpandView(viewId, !expandViewIds.includes(viewId));
                        setSelectedViewId(viewId);
                      }}
                      onClickSpace={setSelectedViewId}
                      renderExtra={renderExtra}
                    />
                  </div>
                );
              })
            )}
          </div>

          <Separator className={'mb-1'} />
          <div className={'flex items-center justify-end'}>
            <Button
              data-testid={'move-page-confirm'}
              disabled={!selectedViewId}
              onClick={() => void (isCrossWorkspace ? handleMoveToWorkspace() : handleMoveInWorkspace())}
            >
              {t('disclosureAction.move')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MovePagePopover;
