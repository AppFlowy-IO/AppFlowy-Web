import { useTranslation } from 'react-i18next';

import { ReactComponent as BellIcon } from '@/assets/icons/mention_send_notification.svg';

import { NotificationTabType } from './types';

interface NotificationEmptyProps {
  tab: NotificationTabType;
}

const emptyKeys: Record<NotificationTabType, { title: string; description: string }> = {
  [NotificationTabType.Inbox]: {
    title: 'settings.notifications.emptyInbox.title',
    description: 'settings.notifications.emptyInbox.description',
  },
  [NotificationTabType.Unread]: {
    title: 'settings.notifications.emptyUnread.title',
    description: 'settings.notifications.emptyUnread.description',
  },
  [NotificationTabType.Archived]: {
    title: 'settings.notifications.emptyArchived.title',
    description: 'settings.notifications.emptyArchived.description',
  },
};

function NotificationEmpty({ tab }: NotificationEmptyProps) {
  const { t } = useTranslation();
  const keys = emptyKeys[tab];

  return (
    <div className={'flex flex-col items-center justify-center py-16 text-center'}>
      <BellIcon className={'h-12 w-12 text-icon-secondary opacity-30'} />
      <div className={'mt-3 text-base font-medium leading-6 text-text-primary'}>
        {t(keys.title)}
      </div>
      <div className={'mt-1 text-[15px] leading-[22px] text-text-primary opacity-45'}>
        {t(keys.description)}
      </div>
    </div>
  );
}

export default NotificationEmpty;
