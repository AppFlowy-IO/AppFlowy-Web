import { CalendarReminders, parseCalendarEvent } from '../google-calendar';
import { listConnections, queryIntegration } from '@/application/services/domains/integration';

jest.mock('@/application/services/domains/integration', () => ({
  listConnections: jest.fn(),
  queryIntegration: jest.fn(),
}));
const api = jest.mocked({ listConnections, queryIntegration });
const now = Date.parse('2026-09-21T08:00:00Z');
const connection = { id: 'calendar', provider: 'google-calendar', status: 'active', connected_at: '' };
const event = (minutes = 5) => ({
  id: 'event',
  summary: 'Planning',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  start: { dateTime: new Date(now + minutes * 60_000).toISOString() },
  attendees: [{ email: 'person@example.com', displayName: 'Person' }],
});
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe('Google Calendar meeting reminders', () => {
  let service: CalendarReminders;
  const show = jest.fn();
  const dismiss = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
    api.listConnections.mockResolvedValue([connection]);
    api.queryIntegration.mockImplementation(async (_workspace, _connection, endpoint) =>
      endpoint.endsWith('/event') ? event() : { items: [event()] }
    );
    service = new CalendarReminders('workspace', show, dismiss);
  });
  afterEach(() => {
    service.dispose();
    jest.useRealTimers();
  });

  it('reads primary-calendar events and refreshes before reminding 90 seconds before start', async () => {
    service.start();
    await flush();
    expect(api.queryIntegration).toHaveBeenCalledWith(
      'workspace',
      'calendar',
      '/calendar/v3/calendars/primary/events',
      expect.objectContaining({ singleEvents: 'true', timeMax: new Date(now + 30 * 60_000).toISOString() }),
      expect.any(AbortSignal)
    );
    await jest.advanceTimersByTimeAsync(209_999);
    expect(show).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Planning',
        attendees: [{ email: 'person@example.com', displayName: 'Person' }],
      })
    );
    expect(api.queryIntegration).toHaveBeenLastCalledWith(
      'workspace',
      'calendar',
      '/calendar/v3/calendars/primary/events/event',
      {},
      expect.any(AbortSignal)
    );
  });

  it('ignores cancelled, declined, all-day and non-Meet events', () => {
    for (const raw of [
      { ...event(), status: 'cancelled' },
      { ...event(), hangoutLink: 'https://evil.example/' },
      { ...event(), hangoutLink: '' },
      { ...event(), start: { dateTime: '' } },
      { ...event(), attendees: [{ email: 'person@example.com', self: true, responseStatus: 'declined' }] },
    ]) {
      expect(parseCalendarEvent(raw, 'workspace', 'calendar')).toBeUndefined();
    }
  });

  it('reschedules when the meeting moved before the reminder was displayed', async () => {
    service.start();
    await flush();
    api.queryIntegration.mockImplementation(async () => event(8));
    await jest.advanceTimersByTimeAsync(210_000);
    expect(show).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the same meeting across connected accounts and after dismissing', async () => {
    api.listConnections.mockResolvedValue([connection, { ...connection, id: 'second' }]);
    service.start();
    await flush();
    await jest.advanceTimersByTimeAsync(210_000);
    expect(show).toHaveBeenCalledTimes(1);
    service.dismiss(show.mock.calls[0][0]);
    await service.refresh();
    await jest.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('cancels reminders immediately after disconnecting and releases requests on workspace exit', async () => {
    service.start();
    await flush();
    api.listConnections.mockResolvedValue([]);
    service.connectionsChanged();
    await flush();
    await jest.advanceTimersByTimeAsync(210_000);
    expect(show).not.toHaveBeenCalled();
    const signal = api.listConnections.mock.calls.at(-1)?.[1];

    service.dispose();
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves reminders through a transient list failure', async () => {
    service.start();
    await flush();
    api.listConnections.mockRejectedValueOnce(new Error('offline'));
    await service.refresh();
    await jest.advanceTimersByTimeAsync(210_000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('ignores a reminder response that arrives after disconnecting the account', async () => {
    service.start();
    await flush();
    let resolve!: (value: unknown) => void;

    api.queryIntegration.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await jest.advanceTimersByTimeAsync(210_000);
    api.listConnections.mockResolvedValue([]);
    service.connectionsChanged();
    await flush();
    resolve(event());
    await flush();
    expect(show).not.toHaveBeenCalled();
  });

  it('does not poll on focus or account changes before acquiring ownership', async () => {
    service.focus();
    service.connectionsChanged();
    await flush();
    expect(api.listConnections).not.toHaveBeenCalled();
  });
});
