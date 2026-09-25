import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { onConnectionsChanged } from '@/application/integrations/connection-events';
import {
  CalendarEvent,
  CalendarReminders,
  calendarReminderKey,
  fetchCalendarEvent,
} from '@/application/integrations/google-calendar';
import { calendarMeetingPage, createCalendarMeetingPage } from '@/application/integrations/meeting-page';
import { requestMeetingStart } from '@/application/integrations/meeting-start';
import { Role } from '@/application/types';
import {
  useAIEnabled,
  useAppOperations,
  useAppOutline,
  useCurrentWorkspaceId,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/utils/errors';

export function GoogleCalendarIntegration() {
  const workspaceId = useCurrentWorkspaceId();
  const aiEnabled = useAIEnabled();
  const workspace = useUserWorkspaceInfo();
  const enabled = aiEnabled && workspace?.selectedWorkspace.role !== Role.Guest;

  return enabled && workspaceId ? <WorkspaceCalendar key={workspaceId} workspaceId={workspaceId} /> : null;
}

function WorkspaceCalendar({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const outline = useAppOutline();
  const operations = useAppOperations();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [launching, setLaunching] = useState(false);
  const launchInFlight = useRef(false);
  const reminders = useRef<CalendarReminders>();
  const lifetime = useRef<AbortController>();

  useEffect(() => {
    const controller = new AbortController();
    const notifications = new Map<string, Notification>();
    const service = new CalendarReminders(
      workspaceId,
      (event) => {
        setEvents((current) => [
          ...current.filter((value) => calendarReminderKey(value) !== calendarReminderKey(event)),
          event,
        ]);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification(t('document.aiMeeting.calendarReminder'), {
            body: event.summary,
            tag: calendarReminderKey(event),
          });

          notification.onclick = () => {
            window.focus();
            notification.close();
          };

          notifications.set(calendarReminderKey(event), notification);
        }
      },
      (key) => {
        setEvents((current) => current.filter((event) => calendarReminderKey(event) !== key));
        notifications.get(key)?.close();
        notifications.delete(key);
      }
    );

    lifetime.current = controller;
    reminders.current = service;
    const unsubscribe = onConnectionsChanged(workspaceId, () => service.connectionsChanged());
    const focus = () => service.focus();
    const start = () =>
      new Promise<void>((resolve) => {
        if (controller.signal.aborted) {
          resolve();
          return;
        }

        service.start();
        controller.signal.addEventListener(
          'abort',
          () => {
            service.dispose();
            resolve();
          },
          { once: true }
        );
      });

    // One tab owns polling and reminders. The next tab takes over when it closes.
    if (navigator.locks) {
      void navigator.locks
        .request(`appflowy-calendar-${workspaceId}`, { signal: controller.signal }, start)
        .catch(() => undefined);
    } else {
      void start();
    }

    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      service.dispose();
      unsubscribe();
      window.removeEventListener('focus', focus);
      notifications.forEach((notification) => notification.close());
    };
  }, [workspaceId, t]);

  const launch = async (event: CalendarEvent) => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setLaunching(true);
    // Reserve the window during the click so browser popup blockers do not eat the Meet link.
    const meetWindow = window.open('about:blank', '_blank');

    if (meetWindow) meetWindow.opener = null;
    try {
      const latest = await fetchCalendarEvent(event, lifetime.current?.signal);

      if (lifetime.current?.signal.aborted) {
        meetWindow?.close();
        return;
      }

      if (!latest) {
        reminders.current?.dismiss(event);
        meetWindow?.close();
        return;
      }

      const title = `${latest.summary || t('document.aiMeeting.titleDefault')} - ${new Date(
        latest.start
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const privateSpace = outline?.find((view) => view.is_private && (view.is_space || view.extra?.is_space));
      const page = await createCalendarMeetingPage(
        operations,
        privateSpace?.view_id,
        calendarMeetingPage(latest, title, t('document.aiMeeting.attendees')),
        t('document.aiMeeting.meetingSpace')
      );

      if (lifetime.current?.signal.aborted) {
        meetWindow?.close();
        return;
      }

      reminders.current?.dismiss(event);
      if (meetWindow) meetWindow.location.replace(latest.meetUrl);
      requestMeetingStart(page.view_id);
      await operations.toView(page.view_id);
    } catch (error) {
      meetWindow?.close();
      if (!lifetime.current?.signal.aborted) toast.error(getErrorMessage(error, t('document.aiMeeting.launchFailed')));
    } finally {
      launchInFlight.current = false;
      if (!lifetime.current?.signal.aborted) setLaunching(false);
    }
  };

  return (
    <div className='fixed bottom-5 right-5 z-[1400] flex max-w-sm flex-col gap-3'>
      {events.map((event) => (
        <div
          key={calendarReminderKey(event)}
          role='status'
          className='rounded-xl border border-border-primary bg-background-primary p-4 shadow-lg'
        >
          <p className='font-medium'>{t('document.aiMeeting.calendarReminder')}</p>
          <p className='my-2 text-sm text-text-secondary'>{event.summary || t('document.aiMeeting.titleDefault')}</p>
          <div className='flex gap-2'>
            <Button disabled={launching} onClick={() => void launch(event)}>
              {t('document.aiMeeting.startTranscribing')}
            </Button>
            <Button variant='ghost' disabled={launching} onClick={() => reminders.current?.dismiss(event)}>
              {t('document.aiMeeting.dismiss')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
