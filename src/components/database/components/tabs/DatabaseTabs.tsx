import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useAddDatabaseView, useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { ViewIcon } from '@/components/_shared/view-icon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import RenameModal from '@/components/app/view-actions/RenameModal';
import { DatabaseActions } from '@/components/database/components/conditions';
import DeleteViewConfirm from '@/components/database/components/tabs/DeleteViewConfirm';
import { DatabaseViewActions } from '@/components/database/components/tabs/ViewActions';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { TabLabel, Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
// import { DatabaseActions } from '@/components/database/components/conditions';
// import DatabaseBlockActions from '@/components/database/components/conditions/DatabaseBlockActions';

export interface DatabaseTabBarProps {
  viewIds: string[];
  selectedViewId?: string;
  setSelectedViewId?: (viewId: string) => void;
  viewName?: string;
  iidIndex: string;
  hideConditions?: boolean;
}

export const DatabaseTabs = forwardRef<HTMLDivElement, DatabaseTabBarProps>(
  ({ viewIds, iidIndex, selectedViewId, setSelectedViewId }, ref) => {
    const { t } = useTranslation();
    const views = useDatabase().get(YjsDatabaseKey.views);
    const context = useDatabaseContext();
    const onAddView = useAddDatabaseView();
    const { loadViewMeta, readOnly } = context;
    const updatePage = useUpdateDatabaseView();
    const [meta, setMeta] = useState<View | null>(null);
    const scrollLeft = context.paddingStart;
    const [addLoading, setAddLoading] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>();
    const [renameViewId, setRenameViewId] = useState<string | null>();
    const [menuViewId, setMenuViewId] = useState<string | null>(null);

    const [tabsWidth, setTabsWidth] = useState<number | null>(null);
    const [tabsContainer, setTabsContainer] = useState<HTMLDivElement | null>(null);
    const [showScrollRightButton, setShowScrollRightButton] = useState(false);
    const [showScrollLeftButton, setShowScrollLeftButton] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const handleObserverScroller = useCallback(() => {
      const scrollContainer = scrollRef.current;

      if (scrollContainer) {
        const scrollWidth = scrollContainer.scrollWidth;
        const clientWidth = scrollContainer.clientWidth;

        setShowScrollRightButton(scrollWidth > clientWidth);
        setShowScrollLeftButton(scrollContainer.scrollLeft > 0);
      }
    }, []);

    const handleResize = useCallback(() => {
      if (tabsContainer) {
        const clientWidth = tabsContainer.clientWidth;

        setTabsWidth(clientWidth);
      }

    }, [tabsContainer]);

    useEffect(() => {
      handleResize();

      const observer = new MutationObserver(handleResize);

      if (tabsContainer) {
        observer.observe(tabsContainer, {
          attributes: true,
          childList: true,
          subtree: true,
        });
      }

      return () => {
        if (tabsContainer) {
          observer.disconnect();
        }
      };
    }, [handleResize, tabsContainer]);

    const reloadView = useCallback(async () => {
      if (loadViewMeta) {
        try {
          const meta = await loadViewMeta(iidIndex);

          setMeta(meta);
        } catch (e) {
          // do nothing
        }
      }
    }, [iidIndex, loadViewMeta]);

    const renameView = useMemo(() => {
      if (renameViewId === iidIndex) return meta;
      return meta?.children.find(v => v.view_id === renameViewId);
    }, [iidIndex, meta, renameViewId]);

    const menuView = useMemo(() => {
      if (menuViewId === iidIndex) return meta;
      return meta?.children.find(v => v.view_id === menuViewId);
    }, [iidIndex, menuViewId, meta]);

    const handleAddView = useCallback(async (layout: DatabaseViewLayout) => {
      setAddLoading(true);
      try {
        const viewId = await onAddView(layout);

        await reloadView();
        setSelectedViewId?.(viewId);

        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setAddLoading(false);
      }
    }, [onAddView, setSelectedViewId, reloadView]);

    const handleChange = (newValue: string) => {
      setSelectedViewId?.(newValue);
    };

    useEffect(() => {
      void reloadView();
    }, [reloadView]);

    const className = useMemo(() => {
      const classList = ['-mb-[0.5px] flex items-center  text-text-primary flex-col  max-sm:!px-6 min-w-0 overflow-hidden'];

      return classList.join(' ');
    }, []);

    // const showActions = useDatabaseContext().showActions;

    if (viewIds.length === 0) return null;
    return (
      <div
        ref={ref}
        className={className}
        style={{
          paddingLeft: scrollLeft === undefined ? 96 : scrollLeft,
          paddingRight: scrollLeft === undefined ? 96 : scrollLeft,
        }}
      >
        <div
          className={`flex items-center database-tabs overflow-hidden w-full gap-1.5`}
        >
          <div
            className="flex flex-1 overflow-hidden items-end h-[34px] justify-start"
          >
            {showScrollLeftButton && <Button
              size={'icon'}
              className={'text-icon-secondary mb-1.5 mx-1.5'}
              variant={'ghost'}
              tabIndex={-1}
              onClick={() => {
                if (scrollRef.current) {
                  scrollRef.current.scrollTo({
                    left: scrollRef.current.scrollLeft - 100,
                    behavior: 'smooth',
                  });
                }
              }}
            >
              <ChevronLeft className={'w-5 h-5'} />
            </Button>}
            <AFScroller
              style={{
                width: tabsWidth || undefined,
              }}
              className={'h-full flex-1 flex'}
              overflowYHidden
              ref={(el: HTMLDivElement | null) => {
                scrollRef.current = el;
                handleObserverScroller();
              }}
              onScroll={() => {
                handleObserverScroller();
              }}
            >
              <div
                ref={setTabsContainer}
                className={'w-fit'}
              >
                <Tabs
                  value={selectedViewId}
                  onValueChange={handleChange}
                  className="flex relative h-full overflow-hidden"
                >
                  <TabsList
                    className={'w-full'}
                  >

                    {viewIds.map((viewId) => {
                      const view = views?.get(viewId) as YDatabaseView | null;

                      if (!view) return null;
                      const databaseLayout = Number(view.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
                      const folderView = viewId === iidIndex ? meta : meta?.children?.find((v) => v.view_id === viewId);

                      const name = folderView?.name || view.get(YjsDatabaseKey.name) || t('untitled');

                      return <TabsTrigger
                        key={viewId}
                        value={viewId}
                        id={`view-tab-${viewId}`}
                        data-testid={`view-tab-${viewId}`}
                        className={'max-w-[120px] min-w-[80px]'}
                        onContextMenu={e => {
                          e.preventDefault();
                          setMenuViewId(viewId);
                        }}
                        onMouseDown={(e) => {
                          if (selectedViewId === viewId && !readOnly) {
                            e.preventDefault();
                            setMenuViewId(viewId);
                          }
                        }}
                      >
                        <TabLabel
                          className={'flex items-center gap-1.5 overflow-hidden'}
                        >
                          <PageIcon
                            iconSize={16}
                            view={folderView || {
                              layout: databaseLayout === DatabaseViewLayout.Board ? ViewLayout.Board : databaseLayout === DatabaseViewLayout.Calendar ? ViewLayout.Calendar : ViewLayout.Grid,
                            }}
                            className={'h-5 w-5'}
                          />

                          <Tooltip delayDuration={500}>
                            <TooltipTrigger asChild>
                          <span
                            className={'flex-1 truncate'}
                          >{name || t('grid.title.placeholder')}</span>

                            </TooltipTrigger>
                            <TooltipContent side={'right'}>
                              {name}
                            </TooltipContent>
                          </Tooltip>
                        </TabLabel>
                        <DropdownMenu
                          modal={false}
                          onOpenChange={(open) => {
                            if (!open) {
                              setMenuViewId(null);
                            }
                          }}
                          open={menuViewId === viewId}
                        >
                          <DropdownMenuTrigger asChild>
                            <div className={'absolute left-0 bottom-0 opacity-0 pointer-events-none'} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            side={'bottom'}
                            align={'start'}
                            className={'!min-w-fit'}
                            onCloseAutoFocus={e => e.preventDefault()}
                          >
                            {menuView && <DatabaseViewActions
                              onClose={() => {
                                setMenuViewId(null);
                              }}
                              onOpenDeleteModal={(viewId: string) => {
                                setDeleteConfirmOpen(viewId);
                              }}
                              onOpenRenameModal={(viewId: string) => {
                                setRenameViewId(viewId);
                              }}
                              deleteDisabled={viewId === iidIndex}
                              view={menuView}
                              onUpdatedIcon={reloadView}
                            />}

                          </DropdownMenuContent>

                        </DropdownMenu>
                      </TabsTrigger>;
                    })}
                  </TabsList>
                </Tabs>
              </div>

            </AFScroller>
            {showScrollRightButton && <div className={'pl-2'}>
              <Button
                size={'icon'}
                className={'text-icon-secondary mb-1.5 mx-1.5'}
                variant={'ghost'}
                tabIndex={-1}
                onClick={() => {
                  if (scrollRef.current) {
                    scrollRef.current.scrollTo({
                      left: scrollRef.current.scrollLeft + 100,
                      behavior: 'smooth',
                    });
                  }
                }}
              >
                <ChevronRight className={'w-5 h-5'} />
              </Button>
            </div>}
            {!readOnly && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size={'icon'}
                  variant={'ghost'}
                  loading={addLoading}
                  className={'text-icon-secondary mb-1.5 mx-1.5'}
                >
                  {addLoading ? <Progress variant={'inherit'} /> : <PlusIcon className={'w-5 h-5'} />}

                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={'bottom'}
                align={'start'}
                className={'!min-w-[120px]'}
                onCloseAutoFocus={e => e.preventDefault()}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    void handleAddView(DatabaseViewLayout.Grid);
                  }}
                >
                  <ViewIcon
                    layout={ViewLayout.Grid}
                    size={'small'}
                  />
                  {t('grid.menuName')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void handleAddView(DatabaseViewLayout.Board);
                  }}
                >
                  <ViewIcon
                    layout={ViewLayout.Board}
                    size={'small'}
                  />
                  {t('board.menuName')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}

          </div>

          {!readOnly ? <div className={'ml-auto mb-1'}>
            <DatabaseActions />
            {/*{isDocumentBlock && <DatabaseBlockActions />}*/}
          </div> : null}

        </div>

        <Separator />
        {renameView && Boolean(renameViewId) && <RenameModal
          open={Boolean(renameViewId)}
          onClose={() => {
            setRenameViewId(null);
          }}
          view={renameView}
          updatePage={async (viewId, payload) => {
            await updatePage(viewId, payload);
            void reloadView();
          }}
          viewId={renameViewId || ''}
        />}

        <DeleteViewConfirm
          viewId={deleteConfirmOpen || ''}
          open={Boolean(deleteConfirmOpen)}
          onClose={() => {
            setDeleteConfirmOpen(null);
          }}
          onDeleted={() => {
            if (!meta) return;

            if (setSelectedViewId) {setSelectedViewId(meta.view_id);}

            void reloadView();
          }}
        />
      </div>
    );
  },
);
