import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewIconType, ViewLayout } from '@/application/types';
import {
  canReorderWithinParent,
  getFirstChildView,
  isDatabaseContainer,
  isDatabaseLayout,
  isReferencedDatabaseView as isRefDbView,
} from '@/application/view-utils';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import {
  useAIEnabled,
  useAppOperations,
  useCurrentWorkspaceIdOptional,
  useSidebarHighlightedViewIds,
  useSidebarSelectedViewId,
} from '@/components/app/app.hooks';
import { useReorderableItem } from '@/components/_shared/reorder/useReorderableItem';
import AnimatedCollapse from '@/components/app/outline/AnimatedCollapse';
import { useReorderableSidebarList } from '@/components/app/outline/reorder/useReorderableSidebarList';
import DropRowLine from '@/components/database/components/drag-and-drop/DropRowLine';
import { cn } from '@/lib/utils';

function ViewItem({
  view,
  width,
  level = 0,
  renderExtra,
  expandIds,
  toggleExpand,
  onClickView,
  parentView,
  loadingViewIds,
  loadedViewIds,
  reorderInstanceId,
  canReorder,
  reorderChildren,
}: {
  view: View;
  width: number;
  level?: number;
  renderExtra?: ({ hovered, view }: { hovered: boolean; view: View }) => React.ReactNode;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  onClickView?: (viewId: string) => void;
  parentView?: View;
  loadingViewIds?: Set<string>;
  loadedViewIds?: Set<string>;
  /** Drag instance of the sibling group this row belongs to (from the parent owner). */
  reorderInstanceId?: symbol;
  /** Whether this row can be picked up to reorder within its parent. */
  canReorder?: boolean;
  /**
   * Whether this view lives in a reorderable outline tree (the workspace
   * sidebar). When true, this view enables drag-to-reorder for its own children
   * and propagates the flag down. Left false for trees that should not be
   * reordered (e.g. the Shared-with-me section).
   */
  reorderChildren?: boolean;
}) {
  const { t } = useTranslation();
  const selectedViewId = useSidebarSelectedViewId();
  const highlightedViewIds = useSidebarHighlightedViewIds();
  const aiEnabled = useAIEnabled();
  const viewId = view.view_id;
  const selected =
    highlightedViewIds.includes(viewId) ||
    (isDatabaseContainer(view) && Boolean(view.children?.some((child) => child.view_id === selectedViewId)));
  const { updatePage, uploadFile } = useAppOperations();

  const isExpanded = expandIds.includes(viewId);
  const [hovered, setHovered] = React.useState<boolean>(false);
  const visibleChildren = useMemo(() => {
    if (aiEnabled) return view.children;
    return view.children?.filter((child) => child.layout !== ViewLayout.AIChat);
  }, [aiEnabled, view.children]);

  const rowRef = useRef<HTMLDivElement>(null);
  const workspaceId = useCurrentWorkspaceIdOptional();

  // This row can be dragged to reorder within the group its parent owns.
  const { dragState, shouldSuppressClick } = useReorderableItem({
    elementRef: rowRef,
    id: viewId,
    dragType: 'sidebar-view',
    instanceId: reorderInstanceId,
    canDrag: Boolean(canReorder),
  });

  // This view's own children form a reorderable sibling group (database-container
  // views or nested pages), reordered within this view as their parent.
  const { orderedItems: orderedChildren, instanceId: childReorderInstanceId } = useReorderableSidebarList({
    items: visibleChildren ?? [],
    parentId: viewId,
    workspaceId,
    dragType: 'sidebar-view',
    enabled: Boolean(reorderChildren) && (visibleChildren?.length ?? 0) > 1,
    errorMessage: 'Failed to reorder pages',
  });
  const isLoaded = loadedViewIds?.has(viewId) ?? false;
  const isLoading = loadingViewIds?.has(viewId) ?? false;
  // If a previous lazy-load failed, the row can remain expanded with no
  // children. Keep the toggle in "expand" mode so clicking it retries.
  const childrenPresent = orderedChildren.length > 0;
  const showExpandedToggle = isExpanded && (childrenPresent || isLoaded || isLoading);

  const handleChangeIcon = useCallback(
    async (icon: { ty: ViewIconType; value: string }) => {
      try {
        await updatePage?.(view.view_id, {
          icon: icon,
          name: view.name,
          extra: view.extra || {},
        });

        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e);
      }
    },
    [updatePage, view.extra, view.name, view.view_id]
  );

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  const getIcon = useCallback(() => {
    return (
      <span className={'flex h-full w-5 items-center justify-end text-sm'}>
        <OutlineIcon
          level={level}
          isExpanded={showExpandedToggle}
          setIsExpanded={(status) => {
            toggleExpand(viewId, status);
          }}
        />
      </span>
    );
  }, [level, showExpandedToggle, toggleExpand, viewId]);

  // Dot icon for referenced database views (like desktop)
  const getDotIcon = useCallback(() => {
    return (
      <span className={'flex h-full w-5 items-center justify-end'}>
        <span className={'p-1.5'}>
          <span className={'block h-1 w-1 rounded-full bg-text-secondary'} />
        </span>
      </span>
    );
  }, []);

  const onUploadFile = useCallback(
    async (file: File) => {
      if (!uploadFile) return Promise.reject();
      return uploadFile(viewId, file);
    },
    [uploadFile, viewId]
  );

  const renderItem = useMemo(() => {
    if (!view) return null;
    if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;

    // Determine which left icon to show
    // Use the utility function which properly handles database containers
    const isRefDatabaseView = isRefDbView(view, parentView);
    const hasConfirmedChildren = Boolean(visibleChildren?.length);
    // Use server-provided has_children when available; fall back to heuristic for old servers
    const hasChildren =
      hasConfirmedChildren || (view.has_children ?? (!isLoaded && view.layout === ViewLayout.Document));

    // Calculate left padding based on icon presence
    const showLeftIcon = isRefDatabaseView || hasChildren;
    const leftPadding = showLeftIcon ? level * 16 : level * 16 + 24;
    const showPageIcon = !isRefDatabaseView;

    // Render left icon: dot for referenced database views, expand icon for views with children
    const renderLeftIcon = () => {
      if (isRefDatabaseView) {
        return getDotIcon();
      }

      if (hasChildren) {
        return getIcon();
      }

      return null;
    };

    return (
      <div
        ref={rowRef}
        data-testid={`page-${view.view_id}`}
        data-selected={selected}
        style={{
          backgroundColor: selected ? 'var(--fill-content-hover)' : undefined,
          cursor: 'pointer',
          paddingLeft: leftPadding + 'px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onClick={() => {
          if (shouldSuppressClick()) return;

          const firstChild = getFirstChildView(view);

          onClickView?.(firstChild?.view_id ?? viewId);
        }}
        className={cn(
          'relative my-[1px] flex min-h-[30px] w-full cursor-pointer select-none items-center gap-1 rounded-[8px] px-0.5 py-0.5 text-sm hover:bg-fill-content-hover focus:outline-none',
          dragState.type === 'dragging' && 'opacity-40'
        )}
      >
        {renderLeftIcon()}

        {showPageIcon ? (
          <CustomIconPopover
            defaultActiveTab={view.icon?.ty === 1 ? 'upload' : view.icon?.ty === 2 ? 'icon' : 'emoji'}
            tabs={['emoji', 'icon', 'upload']}
            onUploadFile={onUploadFile}
            onSelectIcon={(icon) => {
              if (icon.ty === ViewIconType.Icon) {
                void handleChangeIcon({
                  ty: ViewIconType.Icon,
                  value: JSON.stringify({
                    color: icon.color,
                    groupName: icon.value.split('/')[0],
                    iconName: icon.value.split('/')[1],
                  }),
                });
                return;
              }

              void handleChangeIcon(icon);
            }}
            removeIcon={handleRemoveIcon}
          >
            <div
              data-testid='page-icon'
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <PageIcon
                view={view}
                className={'mr-1 flex h-5 w-5 items-center justify-center text-base text-text-secondary'}
              />
            </div>
          </CustomIconPopover>
        ) : null}

        <div className={'flex flex-1 items-center gap-1 overflow-hidden text-sm'}>
          <div data-testid='page-name' className={'w-full truncate'}>
            {view.name.trim() || t('menuAppHeader.defaultNewPageName')}
          </div>
        </div>
        {renderExtra && renderExtra({ hovered, view })}
        {dragState.type === 'over' ? (
          <DropRowLine edge={dragState.closestEdge} style={{ left: `${leftPadding}px` }} />
        ) : null}
      </div>
    );
  }, [
    aiEnabled,
    view,
    visibleChildren,
    isLoaded,
    selected,
    level,
    getIcon,
    getDotIcon,
    parentView,
    onUploadFile,
    handleRemoveIcon,
    t,
    renderExtra,
    hovered,
    onClickView,
    viewId,
    handleChangeIcon,
    dragState,
    shouldSuppressClick,
  ]);

  // Children are present in the DOM only once the lazy load has populated them.
  // Gate the open animation on actual presence (not a loading flag) so the
  // Collapse opens against real content and animates on the first expand.
  const renderChildren = useMemo(() => {
    if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;

    // Don't pass renderExtra (more button) to children when parent is a database layout
    // or when parent is a database container
    const parentIsDatabaseLayout = isDatabaseLayout(view.layout);
    const parentIsContainer = isDatabaseContainer(view);
    const childRenderExtra = parentIsDatabaseLayout || parentIsContainer ? undefined : renderExtra;

    // No loading shimmer here: lazy child loads are fast, and a fixed-height
    // placeholder spikes then collapses (a visible flicker). The content just
    // slides in via AnimatedCollapse once it's ready.
    return (
      <AnimatedCollapse expanded={isExpanded && childrenPresent} className={'w-full'}>
        <div className={'flex w-full flex-col'}>
          {orderedChildren.map((child) => (
            <ViewItem
              level={level + 1}
              key={child.view_id}
              view={child}
              width={width}
              renderExtra={childRenderExtra}
              expandIds={expandIds}
              toggleExpand={toggleExpand}
              onClickView={onClickView}
              parentView={view}
              loadingViewIds={loadingViewIds}
              loadedViewIds={loadedViewIds}
              reorderChildren={reorderChildren}
              reorderInstanceId={childReorderInstanceId}
              canReorder={canReorderWithinParent(child, view)}
            />
          ))}
        </div>
      </AnimatedCollapse>
    );
  }, [
    aiEnabled,
    toggleExpand,
    onClickView,
    isExpanded,
    childrenPresent,
    expandIds,
    level,
    renderExtra,
    view,
    orderedChildren,
    reorderChildren,
    childReorderInstanceId,
    width,
    loadingViewIds,
    loadedViewIds,
  ]);

  if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;

  return (
    <div
      style={{
        width,
      }}
      className={'flex h-fit flex-col overflow-hidden'}
      data-testid='page-item'
    >
      {renderItem}
      {renderChildren}
    </div>
  );
}

export default ViewItem;
