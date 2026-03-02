import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CircularProgress } from '@mui/material';

import { isToday } from './helpers';
import NotificationEmpty from './NotificationEmpty';
import NotificationItem from './NotificationItem';
import { Notification, NotificationTabType } from './types';

interface NotificationTabProps {
  items: Notification[];
  tab: NotificationTabType;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkRead: (ids: string[]) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

function NotificationTab({
  items,
  tab,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onMarkRead,
  onArchive,
  onClose,
}: NotificationTabProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;

    if (!el || !hasMore || isLoadingMore) return;
    if (el.scrollHeight <= el.clientHeight) return;

    const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight);

    if (ratio >= 0.9) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Group by Today / Older — must be before early return to satisfy Rules of Hooks
  const todayItems = useMemo(() => items.filter((n) => isToday(n.createdAt)), [items]);
  const olderItems = useMemo(() => items.filter((n) => !isToday(n.createdAt)), [items]);

  if (items.length === 0) {
    return (
      <div className={'flex h-[420px] items-center justify-center'}>
        <NotificationEmpty tab={tab} />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={'flex h-[420px] flex-col overflow-y-auto'}
    >
      {todayItems.length > 0 && (
        <>
          {/* Section header — desktop: 14px regular, px-16, pb-4 */}
          <div className={'px-4 pb-1 text-sm leading-[18px] text-text-primary'}>
            {t('sideBar.today')}
          </div>
          {todayItems.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              tab={tab}
              onMarkRead={onMarkRead}
              onArchive={onArchive}
              onClose={onClose}
            />
          ))}
        </>
      )}

      {olderItems.length > 0 && (
        <>
          <div className={'px-4 pb-1 pt-1 text-sm leading-[18px] text-text-primary'}>
            {t('sideBar.earlier')}
          </div>
          {olderItems.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              tab={tab}
              onMarkRead={onMarkRead}
              onArchive={onArchive}
              onClose={onClose}
            />
          ))}
        </>
      )}

      {isLoadingMore && (
        <div className={'flex items-center justify-center py-3'}>
          <CircularProgress size={16} sx={{ strokeWidth: 2 }} />
        </div>
      )}
    </div>
  );
}

export default NotificationTab;
