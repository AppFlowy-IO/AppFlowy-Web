import EventEmitter from 'events';

import { expect } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { NotificationService } from '@/application/services/domains';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import {
  getNextNotificationRefreshDelay,
  INITIAL_NOTIFICATION_REFRESH_DELAY,
  NOTIFICATION_REFRESH_INTERVAL,
  NOTIFICATION_REFRESH_JITTER,
  useNotifications,
} from '../useNotifications';

jest.mock('@/application/services/domains', () => ({
  NotificationService: {
    list: jest.fn(),
    getUnreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    archive: jest.fn(),
    archiveAll: jest.fn(),
  },
}));

const mockNotificationService = NotificationService as jest.Mocked<typeof NotificationService>;

const listResponse = {
  notifications: [],
  has_more: false,
};

const createRawNotification = (id: string, workspaceId = 'workspace-id') => ({
  id,
  workspace_id: workspaceId,
  type: 'mention',
  metadata: {},
  is_read: false,
  is_archived: false,
  created_at: '2024-01-01T00:00:00.000Z',
  read_at: null,
});

const createWrapper =
  (eventEmitter?: EventEmitter) =>
  ({ children }: { children: ReactNode }) =>
    createElement(AppEventEmitterContext.Provider, { value: eventEmitter ?? null }, children);

const createStrictModeWrapper = ({ children }: { children: ReactNode }) =>
  createElement(StrictMode, null, children);

function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNotificationService.list.mockResolvedValue(listResponse);
    mockNotificationService.getUnreadCount.mockResolvedValue({ unread_count: 0 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns a jittered delay around the 10 minute base', () => {
    expect(getNextNotificationRefreshDelay(() => 0)).toBe(
      NOTIFICATION_REFRESH_INTERVAL - NOTIFICATION_REFRESH_JITTER
    );
    expect(getNextNotificationRefreshDelay(() => 1)).toBe(
      NOTIFICATION_REFRESH_INTERVAL + NOTIFICATION_REFRESH_JITTER
    );
    expect(getNextNotificationRefreshDelay(() => 0.5)).toBe(NOTIFICATION_REFRESH_INTERVAL);
  });

  it('applies refresh results inside React Strict Mode', async () => {
    mockNotificationService.list
      .mockResolvedValueOnce({
        notifications: [createRawNotification('notif-1')],
        has_more: false,
      })
      .mockResolvedValueOnce(listResponse);
    mockNotificationService.getUnreadCount.mockResolvedValueOnce({ unread_count: 1 });

    const { result } = renderHook(() => useNotifications('workspace-id'), {
      wrapper: createStrictModeWrapper,
    });

    await act(async () => {
      void result.current.refresh();
      await flushPromises();
    });

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0]?.id).toBe('notif-1');
      expect(result.current.unreadCount).toBe(1);
    });
  });

  it('waits before the first refresh, then uses jittered polling', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    renderHook(() => useNotifications('workspace-id'));

    expect(mockNotificationService.list).not.toHaveBeenCalled();
    expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(INITIAL_NOTIFICATION_REFRESH_DELAY - 1);
    });

    expect(mockNotificationService.list).not.toHaveBeenCalled();
    expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(NOTIFICATION_REFRESH_INTERVAL - NOTIFICATION_REFRESH_JITTER - 1);
    });

    expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
    expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(4);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(2);
    });
  });

  it('only delays the first automatic refresh', async () => {
    const { rerender } = renderHook(({ workspaceId }) => useNotifications(workspaceId), {
      initialProps: { workspaceId: 'workspace-a' },
    });

    await act(async () => {
      jest.advanceTimersByTime(INITIAL_NOTIFICATION_REFRESH_DELAY);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });

    mockNotificationService.list.mockClear();
    mockNotificationService.getUnreadCount.mockClear();

    rerender({ workspaceId: 'workspace-b' });

    expect(mockNotificationService.list).not.toHaveBeenCalled();
    expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes when an inbox notification event arrives', async () => {
    const eventEmitter = new EventEmitter();

    renderHook(() => useNotifications('workspace-id'), {
      wrapper: createWrapper(eventEmitter),
    });

    expect(mockNotificationService.list).not.toHaveBeenCalled();
    expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();

    act(() => {
      eventEmitter.emit(APP_EVENTS.INBOX_NOTIFICATION, {
        id: 'notif-1',
        type: 'mention',
        metadataJson: '{}',
        createdAt: 1,
      });
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });
  });

  it('reschedules polling after an inbox notification refreshes before the initial delay elapses', async () => {
    const eventEmitter = new EventEmitter();

    jest.spyOn(Math, 'random').mockReturnValue(0);

    renderHook(() => useNotifications('workspace-id'), {
      wrapper: createWrapper(eventEmitter),
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.INBOX_NOTIFICATION, {
        id: 'notif-1',
        type: 'mention',
        metadataJson: '{}',
        createdAt: 1,
      });
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });

    act(() => {
      jest.advanceTimersByTime(INITIAL_NOTIFICATION_REFRESH_DELAY);
    });

    expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
    expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(NOTIFICATION_REFRESH_INTERVAL - NOTIFICATION_REFRESH_JITTER);
      await flushPromises();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(4);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(2);
    });
  });

  it('coalesces overlapping inbox-triggered refreshes', async () => {
    const eventEmitter = new EventEmitter();

    renderHook(() => useNotifications('workspace-id'), {
      wrapper: createWrapper(eventEmitter),
    });

    expect(mockNotificationService.list).not.toHaveBeenCalled();
    expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();

    const inboxResponse = createDeferred<typeof listResponse>();
    const archiveResponse = createDeferred<typeof listResponse>();
    const unreadCountResponse = createDeferred<{ unread_count: number }>();

    mockNotificationService.list
      .mockImplementationOnce(() => inboxResponse.promise)
      .mockImplementationOnce(() => archiveResponse.promise);
    mockNotificationService.getUnreadCount.mockImplementationOnce(() => unreadCountResponse.promise);

    act(() => {
      eventEmitter.emit(APP_EVENTS.INBOX_NOTIFICATION, {
        id: 'notif-1',
        type: 'mention',
        metadataJson: '{}',
        createdAt: 1,
      });
      eventEmitter.emit(APP_EVENTS.INBOX_NOTIFICATION, {
        id: 'notif-2',
        type: 'mention',
        metadataJson: '{}',
        createdAt: 2,
      });
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });

    expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
    expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      inboxResponse.resolve(listResponse);
      archiveResponse.resolve(listResponse);
      unreadCountResponse.resolve({ unread_count: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(4);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores stale refresh results after the workspace changes', async () => {
    const workspaceAInbox = createDeferred<typeof listResponse>();
    const workspaceAArchive = createDeferred<typeof listResponse>();
    const workspaceAUnread = createDeferred<{ unread_count: number }>();
    const workspaceBInbox = {
      notifications: [createRawNotification('notif-b', 'workspace-b')],
      has_more: false,
    };

    mockNotificationService.list
      .mockImplementationOnce(() => workspaceAInbox.promise)
      .mockImplementationOnce(() => workspaceAArchive.promise)
      .mockResolvedValueOnce(workspaceBInbox)
      .mockResolvedValueOnce(listResponse);
    mockNotificationService.getUnreadCount
      .mockImplementationOnce(() => workspaceAUnread.promise)
      .mockResolvedValueOnce({ unread_count: 1 });

    const { result, rerender } = renderHook(({ currentWorkspaceId }) => useNotifications(currentWorkspaceId), {
      initialProps: { currentWorkspaceId: 'workspace-a' },
    });

    await act(async () => {
      void result.current.refresh();
      await flushPromises();
    });

    await waitFor(() => {
      expect(mockNotificationService.list).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledTimes(1);
    });

    rerender({ currentWorkspaceId: 'workspace-b' });

    await act(async () => {
      jest.advanceTimersByTime(0);
      await flushPromises();
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0]?.id).toBe('notif-b');
      expect(result.current.unreadCount).toBe(1);
    });

    await act(async () => {
      workspaceAInbox.resolve({
        notifications: [createRawNotification('notif-a', 'workspace-a')],
        has_more: false,
      });
      workspaceAArchive.resolve(listResponse);
      workspaceAUnread.resolve({ unread_count: 99 });
      await flushPromises();
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]?.id).toBe('notif-b');
    expect(result.current.unreadCount).toBe(1);
  });
});
