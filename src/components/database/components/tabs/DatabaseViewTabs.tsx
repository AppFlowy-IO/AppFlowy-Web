import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { YDatabaseView } from '@/application/types';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';
import { DatabaseTabItem } from '@/components/database/components/tabs/DatabaseTabItem';
import { useTabScroller } from '@/components/database/components/tabs/useTabScroller';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList } from '@/components/ui/tabs';


export interface DatabaseViewTabsProps {
  viewIds: string[];
  selectedViewId?: string;
  setSelectedViewId?: (viewId: string) => void;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  views: Y.Map<YDatabaseView> | undefined;
  readOnly: boolean;
  visibleViewIds: string[];
  menuViewId: string | null;
  setMenuViewId: (id: string | null) => void;
  setDeleteConfirmOpen: (id: string | null) => void;
  setRenameViewId: (id: string | null) => void;
  pendingScrollToViewId?: string | null;
  setPendingScrollToViewId?: (id: string | null) => void;
  onViewAdded?: (viewId: string) => void;
}

export function DatabaseViewTabs({
  viewIds,
  selectedViewId,
  setSelectedViewId,
  databasePageId,
  views,
  readOnly,
  visibleViewIds,
  menuViewId,
  setMenuViewId,
  setDeleteConfirmOpen,
  setRenameViewId,
  pendingScrollToViewId,
  setPendingScrollToViewId,
  onViewAdded
}: DatabaseViewTabsProps) {
  const [tabsWidth, setTabsWidth] = useState<number | null>(null);
  const [tabsContainer, setTabsContainer] = useState<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());


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
          className={
            'absolute left-0 top-0 z-10 bg-surface-primary text-icon-secondary hover:bg-surface-primary-hover '
          }
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
            value={selectedViewId || viewIds[0] || databasePageId}
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
                    menuViewId={menuViewId}
                    readOnly={!!readOnly}
                    visibleViewIds={visibleViewIds}
                    onSetMenuViewId={setMenuViewId}
                    onOpenDeleteModal={setDeleteConfirmOpen}
                    onOpenRenameModal={setRenameViewId}
                    setTabRef={setTabRef}
                  />
                );
              })}
            </TabsList>
          </Tabs>
        </div>
      </AFScroller>

      {!readOnly && onViewAdded && (
        <AddViewButton onViewAdded={onViewAdded} />
      )}
    </div>
  );
}
