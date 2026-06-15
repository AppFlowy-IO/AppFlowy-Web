import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BellIcon } from '@/assets/icons/mention_send_notification.svg';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import NotificationPanel from './NotificationPanel';
import { useNotifications } from './useNotifications';

function NotificationBell() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspaceIdOptional();
  const hook = useNotifications(workspaceId);
  const { hasLoaded, isLoading, refresh, unreadCount } = hook;
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);

      if (nextOpen && !hasLoaded && !isLoading) {
        void refresh();
      }
    },
    [hasLoaded, isLoading, refresh]
  );

  if (!workspaceId) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {/* Desktop: SizedBox.square(28), Stack with bell + red dot top-right */}
            <button
              aria-label={t('settings.notifications.titles.notifications')}
              className={
                'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-300 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary'
              }
            >
              <BellIcon className={'h-5 w-5 opacity-70'} />
              {unreadCount > 0 && (
                <span
                  className={
                    'absolute right-0 top-0 h-2 w-2 rounded-full bg-fill-error-thick'
                  }
                />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t('settings.notifications.titles.notifications')}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align={'start'}
        sideOffset={8}
        className={'p-0'}
      >
        <NotificationPanel hook={hook} onClose={handleClose} />
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
