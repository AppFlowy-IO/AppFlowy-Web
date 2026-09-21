import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export function CalendarNotifications() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? undefined : Notification.permission
  );

  return (
    <div className='mt-5 text-sm text-text-secondary'>
      <p>{t('settings.connections.calendarReminderHint')}</p>
      {permission === 'default' && (
        <Button
          className='mt-2'
          variant='outline'
          onClick={() => {
            void Notification.requestPermission()
              .then(setPermission)
              .catch(() => undefined);
          }}
        >
          {t('settings.connections.enableBrowserNotifications')}
        </Button>
      )}
    </div>
  );
}
