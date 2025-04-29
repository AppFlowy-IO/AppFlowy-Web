import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useAddDatabaseView, useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
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
import { TabLabel, Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

    const reloadView = useCallback(async () => {
      if (loadViewMeta) {
        try {
          const meta = await loadViewMeta(iidIndex);

          console.log('========', meta);
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

    const handleAddView = useCallback(async (layout: DatabaseViewLayout) => {
      setAddLoading(true);
      try {
        const viewId = await onAddView(layout);

        setSelectedViewId?.(viewId);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setAddLoading(false);
      }
    }, [onAddView, setSelectedViewId]);

    const handleChange = (newValue: string) => {
      setSelectedViewId?.(newValue);
    };

    useEffect(() => {
      void reloadView();
    }, [reloadView]);

    const className = useMemo(() => {
      const classList = ['-mb-[0.5px] gap-1.5 flex items-center overflow-hidden text-text-primary  max-sm:!px-6 min-w-0 overflow-hidden'];

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
          className={`flex items-center justify-between overflow-hidden database-tabs w-full gap-1.5 border-b border-border-primary`}
        >
          <div
            className="flex flex-1 items-center max-w-[500px] overflow-hidden justify-start"
          >
            <Tabs
              value={selectedViewId}
              onValueChange={handleChange}
              className="flex overflow-hidden overflow-x-auto appflowy-custom-scroller mt-2"
            >
              <TabsList>
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
                        {folderView && <DatabaseViewActions
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
                          view={folderView}
                          onUpdatedIcon={reloadView}
                        />}

                      </DropdownMenuContent>

                    </DropdownMenu>
                  </TabsTrigger>;
                })}

              </TabsList>

            </Tabs>
            {!readOnly && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size={'icon-sm'}
                  variant={'ghost'}
                  loading={addLoading}
                  className={' text-icon-secondary'}
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

          {!readOnly ? <>
            <DatabaseActions />
            {/*{isDocumentBlock && <DatabaseBlockActions />}*/}
          </> : null}
        </div>

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
          onDeleted={reloadView}
        />
      </div>
    );
  },
);
