import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';

import { Role } from '@/application/types';
import { GoogleCalendarIntegration } from '@/components/app/integrations/GoogleCalendarIntegration';

const mockEvent = {
  id: 'event-1',
  workspaceId: 'workspace-1',
  connectionId: 'connection-1',
  summary: 'Weekly sync',
  start: Date.parse('2026-10-13T10:00:00Z'),
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  attendees: [],
};
const mockFetchCalendarEvent = jest.fn();
const mockAddPage = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockToView = jest.fn();
const mockGetCapabilities = jest.fn();
const mockToastError = jest.fn();
let mockOutline: Array<{ view_id: string; is_private: boolean; is_space?: boolean; extra?: { is_space?: boolean } }> =
  [];

const mockT = (key: string) => key;

// A stable t, like react-i18next's: the reminder effect depends on it.
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => <button {...props}>{children}</button>,
}));
jest.mock('@/application/integrations/connection-events', () => ({ onConnectionsChanged: () => () => undefined }));
jest.mock('@/application/integrations/meeting-start', () => ({ requestMeetingStart: jest.fn() }));
jest.mock('@/application/integrations/google-calendar', () => ({
  calendarReminderKey: (event: { meetUrl: string; start: number }) => `${event.meetUrl}|${event.start}`,
  fetchCalendarEvent: (...args: unknown[]) => mockFetchCalendarEvent(...args),
  CalendarReminders: class {
    constructor(
      _workspaceId: string,
      private readonly onReminder: (event: typeof mockEvent) => void,
      private readonly onDismiss: (key: string) => void
    ) {}

    start() {
      this.onReminder(mockEvent);
    }
    focus() {
      return undefined;
    }
    connectionsChanged() {
      return undefined;
    }
    dispose() {
      return undefined;
    }
    dismiss(event: typeof mockEvent) {
      this.onDismiss(`${event.meetUrl}|${event.start}`);
    }
  },
}));
jest.mock('@/application/services/domains', () => ({
  PageService: {},
  WorkspaceService: { getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetCapabilities(...args) },
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useAppOperations: () => ({
    addPage: mockAddPage,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
    toView: mockToView,
  }),
  useAppOutline: () => mockOutline,
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { id: 'workspace-1', role: Role.Member } }),
}));

let meetWindow: { opener: unknown; close: jest.Mock; location: { replace: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  mockOutline = [];
  meetWindow = { opener: {}, close: jest.fn(), location: { replace: jest.fn() } };
  jest.spyOn(window, 'open').mockReturnValue(meetWindow as unknown as Window);
  mockFetchCalendarEvent.mockResolvedValue(mockEvent);
  mockToView.mockResolvedValue(undefined);
  mockCreateSpaceWithInitialPage.mockResolvedValue({ space: { view_id: 'space-new' }, page: { view_id: 'page-new' } });
  mockAddPage.mockResolvedValue({ view_id: 'page-new' });
});

async function startTranscribing() {
  render(<GoogleCalendarIntegration />);
  await act(async () => undefined);
  fireEvent.click(screen.getByText('document.aiMeeting.startTranscribing'));
}

test('a member who cannot create spaces still joins the meeting, and no private space is created', async () => {
  mockGetCapabilities.mockResolvedValue({ can_create_space: false });
  await startTranscribing();

  await waitFor(() => expect(meetWindow.location.replace).toHaveBeenCalledWith(mockEvent.meetUrl));
  expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  expect(meetWindow.close).not.toHaveBeenCalled();
  expect(mockToastError).toHaveBeenCalledWith('spaceCreation.meetingNotesDenied');
  await waitFor(() => expect(screen.queryByText('document.aiMeeting.startTranscribing')).toBeNull());
});

test('keeps the meeting window usable when the notes page cannot be created', async () => {
  mockGetCapabilities.mockResolvedValue({ can_create_space: true });
  mockCreateSpaceWithInitialPage.mockRejectedValue({ code: 1012, httpStatus: 403, message: 'Not enough permissions' });
  await startTranscribing();

  await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  expect(meetWindow.location.replace).toHaveBeenCalledWith(mockEvent.meetUrl);
  expect(meetWindow.close).not.toHaveBeenCalled();
  expect(mockToastError.mock.calls[0][0]).toBe('spaceCreation.meetingNotesFailed');
  // The reminder stays so transcription can be retried.
  expect(screen.getByText('document.aiMeeting.startTranscribing')).toBeTruthy();
});

test('uses an existing private space without checking space creation', async () => {
  mockOutline = [{ view_id: 'private-space', is_private: true, is_space: true }];
  await startTranscribing();

  await waitFor(() => expect(mockToView).toHaveBeenCalledWith('page-new'));
  expect(mockAddPage).toHaveBeenCalledWith('private-space', expect.objectContaining({ name: expect.any(String) }));
  expect(mockGetCapabilities).not.toHaveBeenCalled();
  expect(meetWindow.location.replace).toHaveBeenCalledWith(mockEvent.meetUrl);
});

test('a server without the capability route still creates the private meeting space', async () => {
  mockGetCapabilities.mockRejectedValue({ code: 404, httpStatus: 404, message: 'Not Found' });
  await startTranscribing();

  await waitFor(() => expect(mockToView).toHaveBeenCalledWith('page-new'));
  expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(1);
  expect(mockToastError).not.toHaveBeenCalled();
});

test('checks space creation while the event is still being read', async () => {
  let resolveEvent!: (event: typeof mockEvent) => void;

  mockFetchCalendarEvent.mockReturnValue(
    new Promise((resolve) => {
      resolveEvent = resolve;
    })
  );
  mockGetCapabilities.mockResolvedValue({ can_create_space: false });
  await startTranscribing();

  // The check does not wait for the calendar while the reserved window stays blank.
  expect(mockGetCapabilities).toHaveBeenCalledWith('workspace-1');
  expect(meetWindow.location.replace).not.toHaveBeenCalled();
  await act(async () => {
    resolveEvent(mockEvent);
  });

  await waitFor(() => expect(meetWindow.location.replace).toHaveBeenCalledWith(mockEvent.meetUrl));
  expect(mockToastError).toHaveBeenCalledWith('spaceCreation.meetingNotesDenied');
  expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  expect(mockGetCapabilities).toHaveBeenCalledTimes(1);
});

test('ignores the space-creation answer when the event is gone', async () => {
  mockFetchCalendarEvent.mockResolvedValue(null);
  mockGetCapabilities.mockResolvedValue({ can_create_space: false });
  render(<GoogleCalendarIntegration />);
  await act(async () => undefined);
  await act(async () => {
    fireEvent.click(screen.getByText('document.aiMeeting.startTranscribing'));
  });

  expect(mockGetCapabilities).toHaveBeenCalledTimes(1);
  expect(meetWindow.close).toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
  expect(meetWindow.location.replace).not.toHaveBeenCalled();
  expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  expect(screen.queryByText('document.aiMeeting.startTranscribing')).toBeNull();
});

test('closes the reserved window when the calendar goes away while space creation is checked', async () => {
  let answer!: (capability: { can_create_space: boolean }) => void;

  mockGetCapabilities.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  const { unmount } = render(<GoogleCalendarIntegration />);

  await act(async () => undefined);
  fireEvent.click(screen.getByText('document.aiMeeting.startTranscribing'));
  await act(async () => undefined);
  expect(mockFetchCalendarEvent).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => {
    answer({ can_create_space: true });
  });

  expect(meetWindow.close).toHaveBeenCalled();
  expect(meetWindow.location.replace).not.toHaveBeenCalled();
  expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
});
