import { useTranslation } from 'react-i18next';

import { ReactComponent as BellIcon } from '@/assets/icons/mention_send_notification.svg';

import { NotificationTabType } from './types';

interface NotificationEmptyProps {
  tab: NotificationTabType;
}

function useEmptyText(tab: NotificationTabType) {
  const { t } = useTranslation();

  switch (tab) {
    case NotificationTabType.Inbox:
      return {
        title: t('settings.notifications.emptyInbox.title', { defaultValue: 'No notifications' }),
        description: t('settings.notifications.emptyInbox.description', { defaultValue: 'You\'re all caught up!' }),
      };
    case NotificationTabType.Unread:
      return {
        title: t('settings.notifications.emptyUnread.title', { defaultValue: 'No unread notifications' }),
        description: t('settings.notifications.emptyUnread.description', { defaultValue: 'You\'ve read everything!' }),
      };
    case NotificationTabType.Archived:
      return {
        title: t('settings.notifications.emptyArchived.title', { defaultValue: 'No archived notifications' }),
        description: t('settings.notifications.emptyArchived.description', { defaultValue: 'Archived notifications will appear here.' }),
      };
  }
}

function NotificationEmpty({ tab }: NotificationEmptyProps) {
  const { title, description } = useEmptyText(tab);

  return (
    <div className={'flex flex-col items-center justify-center py-16 text-center'}>
      <BellIcon className={'h-12 w-12 text-icon-secondary opacity-30'} />
      <div className={'mt-3 text-base font-medium leading-6 text-text-primary'}>
        {title}
      </div>
      <div className={'mt-1 text-[15px] leading-[22px] text-text-primary opacity-45'}>
        {description}
      </div>
    </div>
  );
}

export default NotificationEmpty;
