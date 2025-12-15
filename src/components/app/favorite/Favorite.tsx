import { Collapse } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import dayjs from 'dayjs';
import { groupBy, sortBy } from 'lodash-es';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { UIVariant } from '@/application/types';
import { ReactComponent as FavoritedIcon } from '@/assets/icons/filled_star.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import OutlineItem from '@/components/_shared/outline/OutlineItem';
import { Popover } from '@/components/_shared/popover';
import RecentListSkeleton from '@/components/_shared/skeleton/RecentListSkeleton';
import { useAppFavorites, useAppHandlers, useSidebarSelectedViewId } from '@/components/app/app.hooks';

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

export function Favorite() {
  const { favoriteViews, loadFavoriteViews } = useAppFavorites();
  const navigateToView = useAppHandlers().toView;
  const viewId = useSidebarSelectedViewId();
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

  const { pinViews, unpinViews } = useMemo(() => {
    if (!favoriteViews) {
      return { pinViews: [], unpinViews: [] };
    }

    return groupBy(favoriteViews, (view) => (view.extra?.is_pinned ? 'pinViews' : 'unpinViews'));
  }, [favoriteViews]);

  const groupByViewsWithDay = useMemo(() => {
    if (!favoriteViews) return {};

    return groupBy(favoriteViews, (view) => {
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
  }, [favoriteViews]);

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

  if (!favoriteViews || favoriteViews.length === 0) {
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
