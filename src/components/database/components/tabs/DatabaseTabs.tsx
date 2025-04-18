import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { DatabaseActions } from '@/components/database/components/conditions';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import DatabaseBlockActions from '@/components/database/components/conditions/DatabaseBlockActions';
import { Tooltip } from '@mui/material';
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewTab, ViewTabs } from 'src/components/_shared/tabs/ViewTabs';

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
    const conditionsContext = useConditionsContext();
    const expanded = conditionsContext?.expanded ?? false;
    const context = useDatabaseContext();
    const loadViewMeta = context.loadViewMeta;
    const [meta, setMeta] = useState<View | null>(null);
    const scrollLeft = context.paddingStart;
    const isDocumentBlock = context.isDocumentBlock;
    const handleChange = (_: React.SyntheticEvent, newValue: string) => {
      setSelectedViewId?.(newValue);
    };

    useEffect(() => {
      void (async () => {
        if (loadViewMeta) {
          try {
            const meta = await loadViewMeta(iidIndex, setMeta);

            setMeta(meta);
          } catch (e) {
            // do nothing
          }
        }
      })();
    }, [loadViewMeta, iidIndex]);

    const className = useMemo(() => {
      const classList = ['-mb-[0.5px] gap-1.5 flex items-center overflow-hidden text-text-title  max-sm:!px-6 min-w-0 overflow-hidden'];

      return classList.join(' ');
    }, []);

    const showActions = useDatabaseContext().showActions;

    const getSelectedTabIndicatorProps = useCallback(() => {
      const selectedTab = document.getElementById(`view-tab-${selectedViewId}`);

      if (!selectedTab) return;

      return {
        style: {
          width: selectedTab.clientWidth,
          left: selectedTab.offsetLeft,
        },
      };
    }, [selectedViewId]);

    const layout = useMemo(() => {
      return selectedViewId ? Number(views?.get(selectedViewId)?.get(YjsDatabaseKey.layout)) as DatabaseViewLayout : DatabaseViewLayout.Grid;
    }, [selectedViewId, views]);

    console.log('====', viewIds, meta?.children);
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
          className={`flex items-center  database-tabs w-full gap-1.5 ${expanded || [
            DatabaseViewLayout.Board,
            DatabaseViewLayout.Calendar,
          ].includes(layout as DatabaseViewLayout) ? 'border-b' : ''} border-line-divider `}
        >
          <div
            style={{
              width: showActions ? `auto` : '100%',
            }}
            className="flex flex-1 items-center "
          >
            <ViewTabs
              scrollButtons={false}
              variant="scrollable"
              allowScrollButtonsMobile
              value={selectedViewId}
              onChange={handleChange}
              TabIndicatorProps={getSelectedTabIndicatorProps()}
            >
              {viewIds.map((viewId) => {
                const view = views?.get(viewId) as YDatabaseView | null;

                if (!view) return null;
                const databaseLayout = Number(view.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
                const folderView = viewId === iidIndex ? meta : meta?.children?.find((v) => v.view_id === viewId);

                const name = folderView?.name || view.get(YjsDatabaseKey.name) || t('untitled');

                return (
                  <ViewTab
                    key={viewId}
                    id={`view-tab-${viewId}`}
                    data-testid={`view-tab-${viewId}`}
                    icon={<PageIcon
                      iconSize={16}
                      view={folderView || {
                        layout: databaseLayout === DatabaseViewLayout.Board ? ViewLayout.Board : databaseLayout === DatabaseViewLayout.Calendar ? ViewLayout.Calendar : ViewLayout.Grid,
                      }}
                      className={'h-5 w-5'}
                    />}
                    iconPosition="start"
                    color="inherit"
                    label={
                      <Tooltip
                        title={name}
                        enterDelay={1000}
                        enterNextDelay={1000}
                        placement={'right'}
                      >
                        <span className={'max-w-[120px] truncate'}>{name || t('grid.title.placeholder')}</span>
                      </Tooltip>
                    }
                    value={viewId}
                  />
                );
              })}
            </ViewTabs>
          </div>

          {showActions ? <>
            <DatabaseActions />
            {isDocumentBlock && <DatabaseBlockActions />}
          </> : null}
        </div>


      </div>
    );
  },
);
