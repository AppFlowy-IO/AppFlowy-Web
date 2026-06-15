import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { YDatabaseView } from '@/application/types';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { type ReorderResult, useReorderMonitor } from '@/components/_shared/reorder/useReorderMonitor';
import { AFScroller } from '@/components/_shared/scroller';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';
import { DatabaseTabItem } from '@/components/database/components/tabs/DatabaseTabItem';
import { useTabScroller } from '@/components/database/components/tabs/useTabScroller';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList } from '@/components/ui/tabs';

const TAB_DRAG_TYPE = 'database-view-tab';

export interface DatabaseViewTabsProps {
  viewIds: string[];
  selectedViewId?: string;
  setSelectedViewId?: (viewId: string) => void;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  /** Optional name overrides from outline/meta by view id. */
  viewNameById?: Record<string, string>;
  views: Y.Map<YDatabaseView> | undefined;
  readOnly: boolean;
  visibleViewIds: string[];
  menuViewId: string | null;
  setMenuViewId: (id: string | null) => void;
  setDeleteConfirmOpen: (id: string | null) => void;
  setRenameViewId: (id: string | null) => void;
  pendingScrollToViewId?: string | null;
  setPendingScrollToViewId?: (id: string | null) => void;
  onBeforeViewAdded?: () => void;
  onAfterViewAdded?: () => void;
  onViewAdded?: (viewId: string) => void;
  /** Persist a tab reorder (optimistic order + folder/localStorage). */
  onReorderTabs?: (result: ReorderResult) => void;
}

export function DatabaseViewTabs({
  viewIds,
  selectedViewId,
  setSelectedViewId,
  databasePageId,
  viewNameById,
  views,
  readOnly,
  visibleViewIds,
  menuViewId,
  setMenuViewId,
  setDeleteConfirmOpen,
  setRenameViewId,
  pendingScrollToViewId,
  setPendingScrollToViewId,
  onBeforeViewAdded,
  onAfterViewAdded,
  onViewAdded,
  onReorderTabs,
}: DatabaseViewTabsProps) {
  const [tabsWidth, setTabsWidth] = useState<number | null>(null);
  const [tabsContainer, setTabsContainer] = useState<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Drag-to-reorder for the tab bar (horizontal). The owning component
  // (DatabaseViews) applies the new order and persists it.
  const [reorderInstanceId] = useState(() => Symbol('database-tab-reorder-instance'));
  const reorderEnabled = !readOnly && Boolean(onReorderTabs) && viewIds.length > 1;
  const viewIdsRef = useRef<string[]>(viewIds);

  useEffect(() => {
    viewIdsRef.current = viewIds;
  }, [viewIds]);

  const getOrderedIds = useCallback(() => viewIdsRef.current, []);
  const handleReorder = useCallback(
    (result: ReorderResult) => {
      onReorderTabs?.(result);
    },
    [onReorderTabs]
  );

  useReorderMonitor({
    dragType: TAB_DRAG_TYPE,
    instanceId: reorderInstanceId,
    axis: 'horizontal',
    enabled: reorderEnabled,
    getOrderedIds,
    onReorder: handleReorder,
  });

  const {
    setScrollerContainer,
    showScrollLeftButton,
    showScrollRightButton,
    scrollLeft,
    scrollRight,
    handleObserverScroller,
  } = useTabScroller();

  const scrollToView = useCallback((viewId: string) => {
    const element = tabRefs.current.get(viewId);

    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
      return true;
    }

    return false;
  }, []);

  useEffect(() => {
    if (!pendingScrollToViewId) return;

    // Try to scroll immediately if element is already in DOM
    const element = tabRefs.current.get(pendingScrollToViewId);

    if (element) {
      scrollToView(pendingScrollToViewId);
      if (setPendingScrollToViewId) setPendingScrollToViewId(null);
      return;
    }

    // If element not found, wait for it to render with a short timeout
    // This handles the case where the tab is being added and ref hasn't been set yet
    const timeoutId = setTimeout(() => {
      const delayedElement = tabRefs.current.get(pendingScrollToViewId);

      if (delayedElement) {
        scrollToView(pendingScrollToViewId);
        if (setPendingScrollToViewId) setPendingScrollToViewId(null);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [pendingScrollToViewId, viewIds, setPendingScrollToViewId, scrollToView]);

  useEffect(() => {
    const onResize = () => {
      if (tabsContainer) {
        const clientWidth = tabsContainer.clientWidth;

        setTabsWidth(clientWidth);
      }
    };

    onResize();
    const observer = new ResizeObserver(onResize);

    if (tabsContainer) observer.observe(tabsContainer);

    return () => {
      if (tabsContainer) observer.disconnect();
    };
  }, [tabsContainer]);

  const setTabRef = (viewId: string, el: HTMLElement | null) => {
    if (el) {
      tabRefs.current.set(viewId, el);
    } else {
      tabRefs.current.delete(viewId);
    }
  };

  return (
    <div className='relative flex h-[34px] flex-1 items-center justify-start overflow-hidden'>
      {showScrollLeftButton && (
        <Button
          size={'icon'}
          style={{
            boxShadow: 'var(--surface-primary) 16px 0px 16px',
          }}
          className={'absolute left-0 top-0 z-10 bg-surface-primary text-icon-secondary hover:bg-surface-primary-hover '}
          variant={'ghost'}
          onClick={scrollLeft}
        >
          <ChevronLeft className={'h-5 w-5'} />
        </Button>
      )}
      {showScrollRightButton && (
        <div>
          <Button
            size={'icon'}
            style={{
              boxShadow: 'var(--surface-primary) -16px 0px 16px',
            }}
            className={
              'absolute right-9 top-0 z-10 bg-surface-primary text-icon-secondary hover:bg-surface-primary-hover'
            }
            variant={'ghost'}
            onClick={scrollRight}
          >
            <ChevronRight className={'h-5 w-5'} />
          </Button>
        </div>
      )}
      <AFScroller
        hideScrollbars
        style={{
          width: tabsWidth || undefined,
        }}
        className={'relative flex h-full flex-1'}
        overflowYHidden
        ref={setScrollerContainer}
        onScroll={handleObserverScroller}
      >
        <div
          ref={setTabsContainer}
          className={'w-fit'}
          onContextMenu={(e) => {
            e.preventDefault();
          }}
        >
          <Tabs
            value={viewIds.includes(selectedViewId || '') ? selectedViewId : viewIds[0] || databasePageId}
            onValueChange={(viewId) => {
              if (setSelectedViewId) {
                setSelectedViewId(viewId);
              }
            }}
            className='relative flex h-full overflow-hidden'
          >
            <TabsList className={'w-full'}>
              {viewIds.map((viewId) => {
                const view = views?.get(viewId) as YDatabaseView | null;

                if (!view) {
                  return null;
                }

                return (
                  <DatabaseTabItem
                    key={viewId}
                    viewId={viewId}
                    view={view}
                    databasePageId={databasePageId}
                    nameOverride={viewNameById?.[viewId]}
                    menuViewId={menuViewId}
                    readOnly={!!readOnly}
                    visibleViewIds={visibleViewIds}
                    onSetMenuViewId={setMenuViewId}
                    onOpenDeleteModal={setDeleteConfirmOpen}
                    onOpenRenameModal={setRenameViewId}
                    setTabRef={setTabRef}
                    reorderInstanceId={reorderEnabled ? reorderInstanceId : undefined}
                  />
                );
              })}
            </TabsList>
          </Tabs>
        </div>
      </AFScroller>

      {!readOnly && onViewAdded && (
        <AddViewButton onBeforeAddView={onBeforeViewAdded} onAfterAddView={onAfterViewAdded} onViewAdded={onViewAdded} />
      )}
    </div>
  );
}
