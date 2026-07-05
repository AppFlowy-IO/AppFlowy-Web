import { Collapse } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import dayjs from 'dayjs';
import { groupBy, orderBy, sortBy } from 'lodash-es';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigate } from 'react-router-dom';

import { getRowDocumentSourceFromView } from '@/application/row-document/lifecycle';
import { ViewService } from '@/application/services/domains';
import { UIVariant, View, ViewLayout } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM } from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { Log } from '@/utils/log';
import { ReactComponent as FavoritedIcon } from '@/assets/icons/filled_star.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import OutlineItem from '@/components/_shared/outline/OutlineItem';
import { Popover } from '@/components/_shared/popover';
import RecentListSkeleton from '@/components/_shared/skeleton/RecentListSkeleton';
import {
  useAIEnabled,
  useAppFavorites,
  useCurrentWorkspaceIdOptional,
  useToView,
  useSidebarSelectedViewId,
} from '@/components/app/app.hooks';

const popoverOrigin: Partial<PopoverProps> = {
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
};

enum FavoriteGroup {
  today = 'today',
  yesterday = 'yesterday',
  thisWeek = 'thisWeek',
  Others = 'Others',
}

function favoriteTimestampMs(view: View): number {
  if (!view.favorited_at) {
    return 0;
  }

  const timestamp = Date.parse(view.favorited_at);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isPinnedFavorite(view: View): boolean {
  return view.is_pinned ?? view.extra?.is_pinned ?? true;
}

export function Favorite() {
  const { favoriteViews, loadFavoriteViews } = useAppFavorites();
  const toView = useToView();
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceIdOptional();
  // Row-page favorites (row-document views) open the containing database view
  // with the row expanded (?r=) instead of the orphan view id itself. The app
  // routes database rows as /app/{ws}/{container}?v={view}&r={row}, so resolve
  // the concrete view's container first — concrete child-view routes don't
  // reliably render when the database collab is already open elsewhere.
  const navigateToView = React.useCallback(
    async (targetViewId: string) => {
      const view = favoriteViews?.find((item) => item.view_id === targetViewId);
      const rowDocumentSource = getRowDocumentSourceFromView(view);

      if (rowDocumentSource) {
        const { database_view_id, row_id } = rowDocumentSource;

        if (workspaceId && database_view_id && row_id) {
          try {
            const concreteView = await ViewService.get(workspaceId, database_view_id);
            const parentId = concreteView?.parent_view_id;
            const parent = parentId && parentId !== database_view_id ? await ViewService.get(workspaceId, parentId) : null;

            if (parent && isDatabaseContainer(parent)) {
              navigate(
                `/app/${workspaceId}/${parent.view_id}?${DATABASE_TAB_VIEW_ID_QUERY_PARAM}=${database_view_id}&r=${row_id}`
              );
              return;
            }
          } catch (e) {
            Log.debug('[Favorite] failed to resolve container for row-page favorite', { targetViewId, error: e });
          }
        }

        await toView?.(database_view_id, row_id);
        return;
      }

      await toView?.(targetViewId);
    },
    [favoriteViews, navigate, toView, workspaceId]
  );
  const viewId = useSidebarSelectedViewId();
  const aiEnabled = useAIEnabled();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(() => {
    return localStorage.getItem('favorite_expanded') !== 'false';
  });
  const moreButtonRef = React.useRef<HTMLDivElement>(null);
  const [moreOpened, setMoreOpened] = React.useState(false);

  useEffect(() => {
    void loadFavoriteViews?.();
  }, [loadFavoriteViews]);

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    localStorage.setItem('favorite_expanded', String(!isExpanded));
  };

  const visibleFavoriteViews = useMemo(() => {
    if (!favoriteViews) {
      return [];
    }

    if (aiEnabled) {
      return favoriteViews;
    }

    return favoriteViews.filter((view) => view.layout !== ViewLayout.AIChat);
  }, [aiEnabled, favoriteViews]);

  const sortedFavoriteViews = useMemo(() => {
    if (visibleFavoriteViews.length === 0) {
      return [];
    }

    return orderBy(visibleFavoriteViews, [(view) => favoriteTimestampMs(view), (view) => view.view_id], ['desc', 'asc']);
  }, [visibleFavoriteViews]);

  const { pinViews, unpinViews } = useMemo(() => {
    if (sortedFavoriteViews.length === 0) {
      return { pinViews: [], unpinViews: [] };
    }

    return groupBy(sortedFavoriteViews, (view) => (isPinnedFavorite(view) ? 'pinViews' : 'unpinViews'));
  }, [sortedFavoriteViews]);

  const groupByViewsWithDay = useMemo(() => {
    if (sortedFavoriteViews.length === 0) return {};

    return groupBy(sortedFavoriteViews, (view) => {
      if (!view.favorited_at) {
        return FavoriteGroup.Others;
      }

      const date = dayjs(view.favorited_at);

      if (!date.isValid()) {
        return FavoriteGroup.Others;
      }

      const today = date.isSame(dayjs(), 'day');
      const yesterday = date.isSame(dayjs().subtract(1, 'day'), 'day');
      const thisWeek = date.isSame(dayjs(), 'week');

      if (today) return FavoriteGroup.today;
      if (yesterday) return FavoriteGroup.yesterday;
      if (thisWeek) return FavoriteGroup.thisWeek;
      return FavoriteGroup.Others;
    });
  }, [sortedFavoriteViews]);

  const groupByViews = useMemo(() => {
    return sortBy(Object.entries(groupByViewsWithDay), ([key]) => {
      return key === FavoriteGroup.today
        ? 0
        : key === FavoriteGroup.yesterday
        ? 1
        : key === FavoriteGroup.thisWeek
        ? 2
        : 3;
    }).map(([key, value]) => {
      const timeLabel: Record<string, string> = {
        [FavoriteGroup.today]: t('calendar.navigation.today'),
        [FavoriteGroup.yesterday]: t('relativeDates.yesterday'),
        [FavoriteGroup.thisWeek]: t('sideBar.thisWeek'),
        [FavoriteGroup.Others]: t('sideBar.others'),
      };

      return (
        <div className={'flex flex-col gap-2'} key={key}>
          <div className={'px-1 py-1 text-xs text-text-secondary'}>{timeLabel[key]}</div>
          <div className={'px-1'}>
            {value.map((view) => (
              <OutlineItem variant={UIVariant.Favorite} key={view.view_id} view={view} navigateToView={navigateToView} />
            ))}
          </div>
        </div>
      );
    });
  }, [groupByViewsWithDay, navigateToView, t]);

  if (!favoriteViews || visibleFavoriteViews.length === 0) {
    return null;
  }

  return (
    <div className={'mb-3 flex w-full flex-col'}>
      <div onClick={handleToggleExpand} className={'my-0.5 flex h-fit w-full cursor-pointer flex-col gap-2'}>
        <div
          className={
            'flex w-full items-center gap-2 rounded-[8px] p-1 text-sm hover:bg-fill-content-hover focus:outline-none'
          }
        >
          <FavoritedIcon className={'h-5 w-5'} />
          <div className={'flex-1 truncate'}>{t('sideBar.favorites')}</div>
        </div>
      </div>
      {!favoriteViews ? (
        <RecentListSkeleton rows={3} />
      ) : (
        <Collapse in={isExpanded} className={'flex transform flex-col gap-2 px-1 transition-all'}>
          {pinViews?.map((view) => (
            <OutlineItem
              variant={UIVariant.Favorite}
              key={view.view_id}
              selectedViewId={viewId}
              view={view}
              navigateToView={navigateToView}
            />
          ))}
          {unpinViews?.length > 0 && (
            <div
              onClick={() => {
                setMoreOpened(true);
              }}
              ref={moreButtonRef}
              className={
                'flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-theme-select focus:bg-fill-theme-select focus:outline-none'
              }
            >
              <MoreIcon className={'h-5 w-5 text-text-secondary'} />
              <div>{t('button.more')}</div>
            </div>
          )}
        </Collapse>
      )}
      <Popover
        {...popoverOrigin}
        className={'appflowy-scroller'}
        sx={{
          maxHeight: '50vh',
        }}
        open={moreOpened}
        anchorEl={moreButtonRef.current}
        onClose={() => setMoreOpened(false)}
      >
        <div className={'flex w-[240px] flex-col gap-2 px-2 py-2'}>{groupByViews}</div>
      </Popover>
    </div>
  );
}

export default Favorite;
