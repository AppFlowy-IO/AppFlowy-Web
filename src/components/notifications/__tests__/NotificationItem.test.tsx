import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getVerificationReminder } from '@/application/services/js-services/http/page-verification-api';

import NotificationItem from '../NotificationItem';
import { NotificationTabType } from '../types';

const mockToView = jest.fn(async () => undefined);
const mockNavigate = jest.fn();
let mockWorkspaceId: string | undefined;
let mockUserId: string | undefined;

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('@/application/services/js-services/http/page-verification-api', () => ({ getVerificationReminder: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useToView: () => mockToView,
  useCurrentWorkspaceIdOptional: () => mockWorkspaceId,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => undefined,
  useAuthenticatedUserIdOptional: () => mockUserId,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getVerificationReminder).mockReset();
  mockWorkspaceId = undefined;
  mockUserId = 'account';
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });

  return { promise, resolve };
}

it.each([
  [{ row_id: 'row', block_id: 'block' }, 'row'],
  [{ row_id: '', block_id: 'block' }, 'block'],
  [{ row_id: 123, block_id: 'block' }, 'block'],
  [{ row_id: 'row' }, 'row'],
  [{}, undefined],
])('opens the saved mention target from %j', async (metadata, anchor) => {
  mockToView.mockClear();
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();

  render(
    <NotificationItem
      notification={{
        id: 'notification', workspaceId: 'workspace', viewId: 'database-view',
        type: 'mention', metadata: metadata as Record<string, unknown>,
        isRead: false, isArchived: true, createdAt: '2026-10-01T00:00:00Z',
      }}
      tab={NotificationTabType.Archived}
      onMarkRead={markRead}
      onArchive={async () => undefined}
      onClose={close}
    />
  );
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(mockToView).toHaveBeenCalledWith('database-view', anchor);
  expect(markRead).toHaveBeenCalledWith(['notification']);
  expect(close).toHaveBeenCalledTimes(1);
});

it.each(['expiring', 'expired'])('opens the full row page for an %s verification reminder', async (kind) => {
  const getReminder = jest.mocked(getVerificationReminder);

  getReminder.mockResolvedValueOnce({ title: 'Verification reminder', body: 'Old preview', view_id: 'old-view', row_id: 'old-row' });
  getReminder.mockResolvedValueOnce({ title: 'Verification reminder', body: 'Current location', view_id: 'database-view', row_id: 'row' });
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();

  render(
    <NotificationItem
      notification={{
        id: 'notification', workspaceId: 'notification-workspace', viewId: null,
        type: 'reminder', metadata: { verification_kind: kind },
        isRead: false, isArchived: true, createdAt: '2026-10-01T00:00:00Z',
      }}
      tab={NotificationTabType.Archived}
      onMarkRead={markRead}
      onArchive={async () => undefined}
      onClose={close}
    />
  );
  await screen.findByText('Old preview');
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(getReminder).toHaveBeenLastCalledWith('notification-workspace', 'notification');
  expect(mockNavigate).toHaveBeenCalledWith('/app/notification-workspace/database-view?r=row');
  expect(mockToView).not.toHaveBeenCalled();
  expect(markRead).toHaveBeenCalledWith(['notification']);
  expect(close).toHaveBeenCalledTimes(1);
});

it.each([
  [{ title: 'Reminder', body: 'Page', view_id: 'page', row_id: null }, 'page'],
  [{ title: 'Reminder', body: 'Access removed', view_id: null, row_id: null }, null],
  [null, null],
])('only opens an authorized current destination from %j', async (details, expectedPage) => {
  jest.mocked(getVerificationReminder).mockResolvedValue(details);
  render(
    <NotificationItem
      notification={{
        id: 'notification', workspaceId: 'workspace', viewId: 'stale-view',
        type: 'reminder', metadata: { verification_kind: 'expiring', row_id: 'stale-row' },
        isRead: true, isArchived: true, createdAt: '2026-10-01T00:00:00Z',
      }}
      tab={NotificationTabType.Archived}
      onMarkRead={async () => undefined}
      onArchive={async () => undefined}
      onClose={() => undefined}
    />
  );
  await waitFor(() => expect(getVerificationReminder).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(mockNavigate).not.toHaveBeenCalled();
  if (expectedPage) expect(mockToView).toHaveBeenCalledWith(expectedPage);
  else expect(mockToView).not.toHaveBeenCalled();
});

const reminder = {
  title: 'Reminder', body: 'Preview', view_id: 'old-view', row_id: 'old-row',
};
const reminderNotification = {
  id: 'notification', workspaceId: 'old-workspace', viewId: null,
  type: 'reminder', metadata: { verification_kind: 'expiring' },
  isRead: false, isArchived: true, createdAt: '2026-10-01T00:00:00Z',
};

it.each(['workspace', 'account', 'sign-out', 'notification'])(
  'ignores a reminder response after the %s changes', async (change) => {
    const request = deferred<typeof reminder>();
    const getReminder = jest.mocked(getVerificationReminder);

    getReminder.mockResolvedValue(reminder).mockResolvedValueOnce(reminder).mockImplementationOnce(() => request.promise);
    const markRead = jest.fn(async () => undefined);
    const close = jest.fn();
    let notification = reminderNotification;
    const item = () => (
      <NotificationItem notification={notification} tab={NotificationTabType.Archived}
        onMarkRead={markRead} onArchive={async () => undefined} onClose={close} />
    );
    const { rerender } = render(item());

    await screen.findByText('Preview');
    fireEvent.click(screen.getByRole('button'));
    if (change === 'workspace') {
      mockWorkspaceId = 'new-workspace';
      mockNavigate('/app/new-workspace/new-view');
    } else if (change === 'notification') {
      notification = { ...notification, id: 'another-notification' };
    } else {
      mockUserId = change === 'account' ? 'another-account' : undefined;
    }

    rerender(item());
    await act(async () => { request.resolve(reminder); });
    expect(mockNavigate).toHaveBeenCalledTimes(change === 'workspace' ? 1 : 0);
    if (change === 'workspace') expect(mockNavigate).toHaveBeenLastCalledWith('/app/new-workspace/new-view');
    expect(mockToView).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  }
);

it('ignores a reminder response after its panel unmounts and another page opens', async () => {
  const request = deferred<typeof reminder>();

  jest.mocked(getVerificationReminder).mockResolvedValueOnce(reminder).mockImplementationOnce(() => request.promise);
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();
  const { unmount } = render(
    <NotificationItem notification={reminderNotification} tab={NotificationTabType.Archived}
      onMarkRead={markRead} onArchive={async () => undefined} onClose={close} />
  );

  await screen.findByText('Preview');
  fireEvent.click(screen.getByRole('button'));
  unmount();
  mockNavigate('/app/new-workspace/new-view');
  await act(async () => { request.resolve(reminder); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenLastCalledWith('/app/new-workspace/new-view');
  expect(markRead).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('stops remaining callbacks when the account changes while opening a page', async () => {
  const opening = deferred<void>();

  jest.mocked(getVerificationReminder).mockResolvedValue({ ...reminder, row_id: null });
  mockToView.mockImplementationOnce(() => opening.promise);
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();
  const item = () => (
    <NotificationItem notification={reminderNotification} tab={NotificationTabType.Archived}
      onMarkRead={markRead} onArchive={async () => undefined} onClose={close} />
  );
  const { rerender } = render(item());

  await screen.findByText('Preview');
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mockToView).toHaveBeenCalledWith('old-view'));
  mockUserId = 'another-account';
  rerender(item());
  await act(async () => { opening.resolve(); });
  expect(markRead).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('does not close a new workspace panel when an earlier mark-read finishes', async () => {
  const markingRead = deferred<void>();

  jest.mocked(getVerificationReminder).mockResolvedValue(reminder);
  const markRead = jest.fn(() => markingRead.promise);
  const close = jest.fn();
  const item = () => (
    <NotificationItem notification={reminderNotification} tab={NotificationTabType.Archived}
      onMarkRead={markRead} onArchive={async () => undefined} onClose={close} />
  );
  const { rerender } = render(item());

  await screen.findByText('Preview');
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
  mockWorkspaceId = 'new-workspace';
  rerender(item());
  await act(async () => { markingRead.resolve(); });
  expect(close).not.toHaveBeenCalled();
});

it('keeps a newer account action in flight when an old response finishes', async () => {
  const oldRequest = deferred<typeof reminder>();
  const newRequest = deferred<typeof reminder>();
  const getReminder = jest.mocked(getVerificationReminder);

  getReminder.mockResolvedValueOnce(reminder).mockImplementationOnce(() => oldRequest.promise)
    .mockResolvedValueOnce(reminder).mockImplementationOnce(() => newRequest.promise);
  const markRead = jest.fn(async () => undefined);
  const close = jest.fn();
  const item = () => (
    <NotificationItem notification={reminderNotification} tab={NotificationTabType.Archived}
      onMarkRead={markRead} onArchive={async () => undefined} onClose={close} />
  );
  const { rerender } = render(item());

  await screen.findByText('Preview');
  fireEvent.click(screen.getByRole('button'));
  mockUserId = 'another-account';
  rerender(item());
  await screen.findByText('Preview');
  fireEvent.click(screen.getByRole('button'));
  await act(async () => { oldRequest.resolve(reminder); });
  fireEvent.click(screen.getByRole('button'));
  expect(getReminder).toHaveBeenCalledTimes(4);
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => { newRequest.resolve(reminder); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(markRead).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
