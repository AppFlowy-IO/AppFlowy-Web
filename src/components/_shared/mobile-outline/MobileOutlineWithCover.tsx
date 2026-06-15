import { Divider } from '@mui/material';
import dayjs from 'dayjs';
import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { View, ViewLayout } from '@/application/types';
import { ViewIcon } from '@/components/_shared/view-icon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import MobileRecentViewCover from '@/components/app/recent/MobileRecentViewCover';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';

function MobileOutlineWithCover({
  view,
  navigateToView,
  timePrefix,
  time,
}: {
  view: View;
  navigateToView: (viewId: string) => void;
  timePrefix?: string;
  time?: string;
}) {
  const { t } = useTranslation();
  const isDark = useContext(ThemeModeContext)?.isDark;

  const getRelativeTime = useCallback(
    (time: string) => {
      const justNow = dayjs().diff(dayjs(time), 'minute') < 1;
      const isToday = dayjs().isSame(dayjs(time), 'day');
      const isYesterday = dayjs().isSame(dayjs(time), 'day');

      if (justNow) {
        return t('time.justNow');
      }

      if (isToday) {
        return dayjs(time).format('HH:mm');
      }

      if (isYesterday) {
        return t('time.yesterday');
      }

      return dayjs(time).format('MMM d, YYYY');
    },
    [t]
  );

  const viewIconProps = useMemo(() => {
    switch (view.layout) {
      case ViewLayout.Document:
        return {
          iconClassName: 'text-[#00C2FF]',
          bgColor: isDark ? '#658B9033' : '#EDFBFFCC',
        };
      case ViewLayout.Board:
        return {
          iconClassName: 'text-[#49CD57]',
          bgColor: isDark ? '#72936B33' : '#E0FDD97F',
        };
      case ViewLayout.Grid:
        return {
          iconClassName: 'text-[#8263FF]',
          bgColor: isDark ? '#8B80AD33' : '#F5F4FFFF',
        };
      case ViewLayout.Calendar:
        return {
          iconClassName: 'text-[#FD9D44]',
          bgColor: isDark ? '#A68B7733' : '#FFF7F0FF',
        };
      case ViewLayout.AIChat:
        return {
          iconClassName: 'text-[#FF53C5]',
          bgColor: isDark ? '#98719533' : '#FFE6FD66',
        };
      default:
        return {
          iconClassName: 'text-[#00C2FF]',
          bgColor: isDark ? '#658B9033' : '#EDFBFFCC',
        };
    }
  }, [view.layout, isDark]);

  return (
    <>
      <div
        key={view.view_id}
        className={'flex items-center justify-between gap-2 px-3'}
        onClick={() => {
          void navigateToView(view.view_id);
        }}
      >
        <div className={'flex flex-1 flex-col gap-4'}>
          <div className={'flex items-center gap-2 text-base'}>
            {view.icon && (
              <PageIcon view={view} className={'flex !h-5 !w-5 items-center justify-center'} iconSize={20} />
            )}
            <div className={'font-medium'}>{view.name}</div>
          </div>
          {view.last_edited_time && (
            <div className={'text-sm font-normal text-text-secondary'}>
              {timePrefix || ''}
              {getRelativeTime(time || view.last_edited_time)}
            </div>
          )}
        </div>
        {view.extra?.cover && view.extra?.cover.type !== 'none' ? (
          <MobileRecentViewCover cover={view.extra.cover} />
        ) : (
          <div
            style={{
              backgroundColor: viewIconProps.bgColor,
            }}
            className={
              'flex h-[54px] w-[78px] items-center justify-center overflow-hidden rounded-[8px] border border-fill-content-hover'
            }
          >
            <ViewIcon
              className={`${viewIconProps.iconClassName} text-2xl`}
              layout={view.layout || ViewLayout.Document}
              size={'unset'}
            />
          </div>
        )}
      </div>
      <Divider className={'w-full opacity-50'} />
    </>
  );
}

export default MobileOutlineWithCover;
