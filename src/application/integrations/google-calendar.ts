import { listConnections, queryIntegration } from '@/application/services/domains/integration';

export interface CalendarEvent {
  id: string;
  workspaceId: string;
  connectionId: string;
  summary: string;
  start: number;
  end?: number;
  meetUrl: string;
  attendees: { email: string; displayName?: string }[];
}

interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  hangoutLink?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
}

export const CALENDAR_REMINDER_LEAD_MS = 90_000;
const POLL_INTERVAL = 10 * 60_000;
const LOOK_AHEAD = 30 * 60_000;
const EVENTS_ENDPOINT = '/calendar/v3/calendars/primary/events';

export function parseCalendarEvent(
  raw: GoogleEvent,
  workspaceId: string,
  connectionId: string
): CalendarEvent | undefined {
  if (!raw?.id || raw.status === 'cancelled' || !raw.hangoutLink || !raw.start?.dateTime) return;
  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];

  if (attendees.some((attendee) => attendee.self && attendee.responseStatus === 'declined')) return;
  let meetUrl: URL;

  try {
    meetUrl = new URL(raw.hangoutLink);
  } catch {
    return;
  }

  if (meetUrl.protocol !== 'https:' || meetUrl.hostname !== 'meet.google.com') return;
  const start = Date.parse(raw.start.dateTime);
  const end = raw.end?.dateTime ? Date.parse(raw.end.dateTime) : undefined;

  if (!Number.isFinite(start)) return;
  return {
    id: raw.id,
    workspaceId,
    connectionId,
    summary: raw.summary || '',
    start,
    end: end !== undefined && Number.isFinite(end) ? end : undefined,
    meetUrl: meetUrl.toString(),
    attendees: attendees
      .filter(
        (person): person is typeof person & { email: string } => typeof person.email === 'string' && !!person.email
      )
      .map(({ email, displayName }) => ({ email, displayName })),
  };
}

export function calendarReminderKey(event: CalendarEvent) {
  return `${event.meetUrl}|${event.start}`;
}

export async function fetchCalendarEvent(event: CalendarEvent, signal?: AbortSignal) {
  const raw = await queryIntegration<GoogleEvent>(
    event.workspaceId,
    event.connectionId,
    `${EVENTS_ENDPOINT}/${encodeURIComponent(event.id)}`,
    {},
    signal
  );

  return parseCalendarEvent(raw, event.workspaceId, event.connectionId);
}

async function upcomingEvents(workspaceId: string, connectionId: string, signal: AbortSignal) {
  const events: CalendarEvent[] = [];
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + LOOK_AHEAD).toISOString();
  let pageToken: string | undefined;

  do {
    const result = await queryIntegration<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      workspaceId,
      connectionId,
      EVENTS_ENDPOINT,
      {
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      },
      signal
    );

    for (const item of result.items ?? []) {
      const event = parseCalendarEvent(item, workspaceId, connectionId);

      if (event) events.push(event);
    }

    pageToken = result.nextPageToken;
  } while (pageToken && !signal.aborted);

  return events;
}

/** Own all timers/requests in one workspace lifetime, independent of React renders. */
export class CalendarReminders {
  private readonly lifetime = new AbortController();
  private request?: AbortController;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reminders = new Map<string, { event: CalendarEvent; timer: ReturnType<typeof setTimeout> }>();
  private pending = new Map<string, CalendarEvent>();
  private handled = new Map<string, number>();
  private lastPoll = 0;
  private connectionsVersion = 0;

  constructor(
    private readonly workspaceId: string,
    private readonly onReminder: (event: CalendarEvent) => void,
    private readonly onDismiss: (key: string) => void
  ) {}

  start() {
    if (this.pollTimer || this.lifetime.signal.aborted) return;
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL);
    void this.refresh();
  }

  focus() {
    if (this.pollTimer && Date.now() - this.lastPoll >= 5 * 60_000) void this.refresh();
  }

  connectionsChanged() {
    this.connectionsVersion++;
    this.clearReminders();
    if (this.pollTimer) void this.refresh();
  }

  dismiss(event: CalendarEvent) {
    const key = calendarReminderKey(event);

    this.handled.set(key, event.start + 60 * 60_000);
    this.pending.delete(key);
    this.onDismiss(key);
  }

  async refresh() {
    if (this.lifetime.signal.aborted) return;
    this.request?.abort();
    const request = new AbortController();

    this.request = request;
    this.lastPoll = Date.now();
    try {
      const connections = (await listConnections(this.workspaceId, request.signal)).filter(
        (connection) => connection.provider === 'google-calendar'
      );
      const responses = await Promise.allSettled(
        connections.map((connection) => upcomingEvents(this.workspaceId, connection.id, request.signal))
      );

      if (request.signal.aborted) return;
      const desired = new Map<string, CalendarEvent>();
      const failedConnections = new Set<string>();

      responses.forEach((response, index) => {
        if (response.status === 'rejected') {
          failedConnections.add(connections[index].id);
          return;
        }

        response.value.forEach((event) => {
          const key = calendarReminderKey(event);
          const existing = desired.get(key);

          if (!existing || event.attendees.length > existing.attendees.length) desired.set(key, event);
        });
      });
      // Keep scheduled reminders during a transient provider failure; disconnected accounts are removed.
      for (const [key, { event }] of this.reminders) {
        if (failedConnections.has(event.connectionId)) desired.set(key, event);
      }

      for (const [key, reminder] of this.reminders) {
        if (!desired.has(key)) {
          clearTimeout(reminder.timer);
          this.reminders.delete(key);
        }
      }

      for (const [key, event] of this.pending) {
        if (!desired.has(key) && !failedConnections.has(event.connectionId)) {
          this.pending.delete(key);
          this.onDismiss(key);
        }
      }

      for (const event of desired.values()) this.schedule(event);
      for (const [key, expiry] of this.handled) if (expiry < Date.now()) this.handled.delete(key);
    } catch {
      /* Retry at the next poll or focus without turning network failures into notifications. */
    }
  }

  private schedule(event: CalendarEvent) {
    const key = calendarReminderKey(event);

    if (this.handled.has(key) || this.pending.has(key) || event.start < Date.now() || this.lifetime.signal.aborted)
      return;
    const existing = this.reminders.get(key);

    if (existing) {
      existing.event = event;
      return;
    }

    const timer = setTimeout(
      () => void this.show(key),
      Math.max(0, event.start - CALENDAR_REMINDER_LEAD_MS - Date.now())
    );

    this.reminders.set(key, { event, timer });
  }

  private async show(key: string) {
    const scheduled = this.reminders.get(key);
    const version = this.connectionsVersion;

    if (!scheduled || this.lifetime.signal.aborted) return;
    this.reminders.delete(key);
    try {
      const event = await fetchCalendarEvent(scheduled.event, this.lifetime.signal);

      if (!event || this.lifetime.signal.aborted || version !== this.connectionsVersion || event.start < Date.now())
        return;
      if (event.start - CALENDAR_REMINDER_LEAD_MS > Date.now()) {
        this.schedule(event);
        return;
      }

      const currentKey = calendarReminderKey(event);

      if (this.handled.has(currentKey) || this.pending.has(currentKey)) return;
      this.pending.set(currentKey, event);
      this.onReminder(event);
    } catch {
      /* A failed refresh must not launch a cancelled or inaccessible meeting. */
    }
  }

  private clearReminders() {
    this.reminders.forEach(({ timer }) => clearTimeout(timer));
    this.reminders.clear();
    this.pending.forEach((_, key) => this.onDismiss(key));
    this.pending.clear();
  }

  dispose() {
    this.lifetime.abort();
    this.request?.abort();
    clearInterval(this.pollTimer);
    this.clearReminders();
  }
}
