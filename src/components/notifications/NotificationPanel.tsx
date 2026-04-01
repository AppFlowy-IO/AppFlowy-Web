import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArchiveIcon } from '@/assets/icons/archive.svg';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { notify } from '@/components/_shared/notify';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import NotificationTab from './NotificationTab';
import { NotificationTabType } from './types';
import { UseNotificationsReturn } from './useNotifications';

interface NotificationPanelProps {
  hook: UseNotificationsReturn;
  onClose: () => void;
}

function NotificationPanel({ hook, onClose }: NotificationPanelProps) {
  const { t } = useTranslation();

  const {
    markAllRead, archiveAll, markRead, archive, loadMore,
    inboxNotifications, unreadNotifications, archivedNotifications,
    hasLoaded, isLoading, isLoadingMore, hasMoreInbox, hasMoreArchive,
  } = hook;
  const isInitialLoading = !hasLoaded && isLoading;

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
    notify.success(t('settings.notifications.markAsReadNotifications.allSuccess'));
  }, [markAllRead, t]);

  const handleArchiveAll = useCallback(async () => {
    await archiveAll();
    notify.success(t('settings.notifications.archiveNotifications.allSuccess'));
  }, [archiveAll, t]);

  const handleMarkRead = useCallback(
    async (ids: string[]) => {
      await markRead(ids);
      notify.success(t('settings.notifications.markAsReadNotifications.success'));
    },
    [markRead, t]
  );

  const handleArchive = useCallback(
    async (ids: string[]) => {
      await archive(ids);
      notify.success(t('settings.notifications.archiveNotifications.success'));
    },
    [archive, t]
  );

  const handleLoadMoreInbox = useCallback(() => {
    void loadMore(false);
  }, [loadMore]);

  const handleLoadMoreArchive = useCallback(() => {
    void loadMore(true);
  }, [loadMore]);

  return (
    <div className={'flex w-[380px] flex-col py-3.5'}>
      {/* Header — height 24px, horizontal padding 16px */}
      <div className={'flex h-6 items-center px-4'}>
        <h2 className={'flex-1 text-base font-medium leading-6 text-text-primary'}>
          {t('settings.notifications.titles.notifications')}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={'flex h-6 w-6 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary'}>
              <MoreIcon className={'h-5 w-5'} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={'end'}>
            <DropdownMenuItem onClick={handleMarkAllRead}>
              <CheckCircleIcon className={'h-5 w-5'} />
              {t('settings.notifications.settings.markAllAsRead')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleArchiveAll}>
              <ArchiveIcon className={'h-5 w-5'} />
              {t('settings.notifications.settings.archiveAll')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Gap 12px, then tabs */}
      <Tabs defaultValue={NotificationTabType.Inbox} className={'mt-3 flex flex-1 flex-col gap-0'}>
        <TabsList className={'px-4'}>
          <TabsTrigger value={NotificationTabType.Inbox} className={'min-w-0 justify-start'}>
            {t('settings.notifications.tabs.inbox')}
          </TabsTrigger>
          <TabsTrigger value={NotificationTabType.Unread} className={'min-w-0 justify-start'}>
            {t('settings.notifications.tabs.unread')}
          </TabsTrigger>
          <TabsTrigger value={NotificationTabType.Archived} className={'min-w-0 justify-start'}>
            {t('settings.notifications.tabs.archived')}
          </TabsTrigger>
        </TabsList>

        {/* Gap 14px before tab content */}
        <div className={'mt-3.5'}>
          <TabsContent value={NotificationTabType.Inbox}>
            <NotificationTab
              items={inboxNotifications}
              tab={NotificationTabType.Inbox}
              isInitialLoading={isInitialLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMoreInbox}
              onLoadMore={handleLoadMoreInbox}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
              onClose={onClose}
            />
          </TabsContent>

          <TabsContent value={NotificationTabType.Unread}>
            <NotificationTab
              items={unreadNotifications}
              tab={NotificationTabType.Unread}
              isInitialLoading={isInitialLoading}
              isLoadingMore={false}
              hasMore={false}
              onLoadMore={handleLoadMoreInbox}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
              onClose={onClose}
            />
          </TabsContent>

          <TabsContent value={NotificationTabType.Archived}>
            <NotificationTab
              items={archivedNotifications}
              tab={NotificationTabType.Archived}
              isInitialLoading={isInitialLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMoreArchive}
              onLoadMore={handleLoadMoreArchive}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
              onClose={onClose}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default NotificationPanel;
