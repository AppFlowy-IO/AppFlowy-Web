import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { NotificationService } from '@/application/services/domains';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import { mergeNotifications, toNotification } from './helpers';
import { Notification } from './types';

const PAGE_SIZE = 200;

export const INITIAL_NOTIFICATION_REFRESH_DELAY = 30_000;
export const NOTIFICATION_REFRESH_INTERVAL = 10 * 60_000;
export const NOTIFICATION_REFRESH_JITTER = 2 * 60_000;

export function getNextNotificationRefreshDelay(random = Math.random): number {
  const minDelay = NOTIFICATION_REFRESH_INTERVAL - NOTIFICATION_REFRESH_JITTER;
  const maxDelay = NOTIFICATION_REFRESH_INTERVAL + NOTIFICATION_REFRESH_JITTER;

  return minDelay + Math.round(random() * (maxDelay - minDelay));
}

type RefreshSource = 'manual' | 'event' | 'timer';

export interface UseNotificationsReturn {
  notifications: Notification[];
  inboxNotifications: Notification[];
  unreadNotifications: Notification[];
  archivedNotifications: Notification[];
  unreadCount: number;
  hasLoaded: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreInbox: boolean;
  hasMoreArchive: boolean;
  refresh: () => Promise<void>;
  loadMore: (archived: boolean) => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  archive: (ids: string[]) => Promise<void>;
  archiveAll: () => Promise<void>;
}

export function useNotifications(workspaceId: string | undefined): UseNotificationsReturn {
  const eventEmitter = useContext(AppEventEmitterContext);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreInbox, setHasMoreInbox] = useState(true);
  const [hasMoreArchive, setHasMoreArchive] = useState(true);

  const inboxOffsetRef = useRef(0);
  const archiveOffsetRef = useRef(0);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const pendingRefreshRef = useRef<RefreshSource | null>(null);
  const refreshSessionRef = useRef(0);
  const activeWorkspaceIdRef = useRef<string | undefined>(workspaceId);
  const hasDeferredInitialRefreshRef = useRef(false);
  const scheduledRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(source: RefreshSource) => Promise<void>>(async () => undefined);

  const clearScheduledRefresh = useCallback(() => {
    if (scheduledRefreshRef.current) {
      clearTimeout(scheduledRefreshRef.current);
      scheduledRefreshRef.current = null;
    }
  }, []);

  const scheduleNextRefresh = useCallback(
    (delay: number) => {
      clearScheduledRefresh();

      const refreshSession = refreshSessionRef.current;
      const currentWorkspaceId = activeWorkspaceIdRef.current;

      if (!currentWorkspaceId) return;

      scheduledRefreshRef.current = setTimeout(() => {
        scheduledRefreshRef.current = null;

        if (
          !mountedRef.current ||
          refreshSessionRef.current !== refreshSession ||
          activeWorkspaceIdRef.current !== currentWorkspaceId
        ) {
          return;
        }

        void refreshRef.current('timer');
      }, delay);
    },
    [clearScheduledRefresh]
  );

  const resetNotificationState = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
    setHasLoaded(false);
    setHasMoreInbox(true);
    setHasMoreArchive(true);
    setIsLoading(false);
    setIsLoadingMore(false);
    inboxOffsetRef.current = 0;
    archiveOffsetRef.current = 0;
  }, []);

  const refreshWithSource = useCallback(async (source: RefreshSource) => {
    const currentWorkspaceId = activeWorkspaceIdRef.current;

    if (!currentWorkspaceId) return;

    if (source !== 'timer') {
      clearScheduledRefresh();
    }

    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = source;
      return refreshInFlightRef.current;
    }

    const refreshSession = refreshSessionRef.current;

    const runRefresh = async () => {
      setIsLoading(true);
      try {
        const [inboxRes, archiveRes, countRes] = await Promise.all([
          NotificationService.list(currentWorkspaceId, { archived: false, offset: 0, limit: PAGE_SIZE }),
          NotificationService.list(currentWorkspaceId, { archived: true, offset: 0, limit: PAGE_SIZE }),
          NotificationService.getUnreadCount(currentWorkspaceId),
        ]);

        if (
          !mountedRef.current ||
          refreshSessionRef.current !== refreshSession ||
          activeWorkspaceIdRef.current !== currentWorkspaceId
        ) {
          return;
        }

        const inboxItems = inboxRes.notifications.map(toNotification);
        const archiveItems = archiveRes.notifications.map(toNotification);
        const merged = mergeNotifications([...inboxItems, ...archiveItems]);

        setHasLoaded(true);
        setNotifications(merged);
        setUnreadCount(countRes.unread_count);
        setHasMoreInbox(inboxRes.has_more);
        setHasMoreArchive(archiveRes.has_more);
        inboxOffsetRef.current = inboxItems.length;
        archiveOffsetRef.current = archiveItems.length;
      } catch (e) {
        console.error('[useNotifications] refresh failed', e);
      } finally {
        if (
          mountedRef.current &&
          refreshSessionRef.current === refreshSession &&
          activeWorkspaceIdRef.current === currentWorkspaceId
        ) {
          setIsLoading(false);
        }
      }
    };

    const refreshPromise = runRefresh().finally(() => {
      if (refreshInFlightRef.current === refreshPromise) {
        refreshInFlightRef.current = null;
      }

      if (
        !mountedRef.current ||
        refreshSessionRef.current !== refreshSession ||
        activeWorkspaceIdRef.current !== currentWorkspaceId
      ) {
        pendingRefreshRef.current = null;
        return;
      }

      if (pendingRefreshRef.current) {
        const pendingSource = pendingRefreshRef.current;

        pendingRefreshRef.current = null;
        void refreshRef.current(pendingSource);
        return;
      }

      scheduleNextRefresh(getNextNotificationRefreshDelay());
    });

    refreshInFlightRef.current = refreshPromise;

    return refreshPromise;
  }, [clearScheduledRefresh, scheduleNextRefresh]);

  refreshRef.current = refreshWithSource;

  const refresh = useCallback(() => refreshWithSource('manual'), [refreshWithSource]);

  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(
    async (archived: boolean) => {
      if (!workspaceId) return;
      if (loadingMoreRef.current) return;
      if (archived ? !hasMoreArchive : !hasMoreInbox) return;

      const loadMoreSession = refreshSessionRef.current;
      const currentWorkspaceId = workspaceId;

      loadingMoreRef.current = true;
      setIsLoadingMore(true);
      try {
        const offset = archived ? archiveOffsetRef.current : inboxOffsetRef.current;
        const res = await NotificationService.list(currentWorkspaceId, {
          archived,
          offset,
          limit: PAGE_SIZE,
        });

        if (
          !mountedRef.current ||
          refreshSessionRef.current !== loadMoreSession ||
          activeWorkspaceIdRef.current !== currentWorkspaceId
        ) {
          return;
        }

        const newItems = res.notifications.map(toNotification);

        setNotifications((prev) => mergeNotifications([...prev, ...newItems]));

        if (archived) {
          archiveOffsetRef.current += newItems.length;
          setHasMoreArchive(res.has_more);
        } else {
          inboxOffsetRef.current += newItems.length;
          setHasMoreInbox(res.has_more);
        }
      } catch (e) {
        console.error('[useNotifications] loadMore failed', e);
      } finally {
        loadingMoreRef.current = false;
        if (
          mountedRef.current &&
          refreshSessionRef.current === loadMoreSession &&
          activeWorkspaceIdRef.current === currentWorkspaceId
        ) {
          setIsLoadingMore(false);
        }
      }
    },
    [workspaceId, hasMoreArchive, hasMoreInbox]
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!workspaceId) return;

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => {
        const actuallyUnread = notificationsRef.current.filter((n) => ids.includes(n.id) && !n.isRead).length;

        return Math.max(0, prev - actuallyUnread);
      });

      try {
        await NotificationService.markRead(workspaceId, ids);
      } catch {
        await refresh();
      }
    },
    [workspaceId, refresh]
  );

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);

    try {
      await NotificationService.markAllRead(workspaceId);
    } catch {
      await refresh();
    }
  }, [workspaceId, refresh]);

  const notificationsRef = useRef(notifications);

  notificationsRef.current = notifications;

  const archive = useCallback(
    async (ids: string[]) => {
      if (!workspaceId) return;

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, isArchived: true, isRead: true } : n))
      );
      setUnreadCount((prev) => {
        const unreadArchived = notificationsRef.current.filter((n) => ids.includes(n.id) && !n.isRead).length;

        return Math.max(0, prev - unreadArchived);
      });

      try {
        await NotificationService.archive(workspaceId, ids);
      } catch {
        await refresh();
      }
    },
    [workspaceId, refresh]
  );

  const archiveAll = useCallback(async () => {
    if (!workspaceId) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isArchived: true, isRead: true })));
    setUnreadCount(0);

    try {
      await NotificationService.archiveAll(workspaceId);
    } catch {
      await refresh();
    }
  }, [workspaceId, refresh]);

  // Refresh immediately when the server pushes a new inbox notification over workspace WS.
  useEffect(() => {
    if (!workspaceId || !eventEmitter) return;

    const handleInboxNotification = () => {
      void refreshRef.current('event');
    };

    eventEmitter.on(APP_EVENTS.INBOX_NOTIFICATION, handleInboxNotification);

    return () => {
      eventEmitter.off(APP_EVENTS.INBOX_NOTIFICATION, handleInboxNotification);
    };
  }, [workspaceId, eventEmitter]);

  useEffect(() => {
    activeWorkspaceIdRef.current = workspaceId;
    refreshSessionRef.current += 1;
    refreshInFlightRef.current = null;
    pendingRefreshRef.current = null;
    clearScheduledRefresh();
    resetNotificationState();

    if (!workspaceId) {
      return;
    }

    const initialDelay = hasDeferredInitialRefreshRef.current ? 0 : INITIAL_NOTIFICATION_REFRESH_DELAY;

    hasDeferredInitialRefreshRef.current = true;
    scheduleNextRefresh(initialDelay);
  }, [workspaceId, clearScheduledRefresh, resetNotificationState, scheduleNextRefresh]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearScheduledRefresh();
    };
  }, [clearScheduledRefresh]);

  // Derived lists
  const inboxNotifications = useMemo(() => notifications.filter((n) => !n.isArchived), [notifications]);
  const unreadNotifications = useMemo(() => notifications.filter((n) => !n.isRead && !n.isArchived), [notifications]);
  const archivedNotifications = useMemo(() => notifications.filter((n) => n.isArchived), [notifications]);

  return {
    notifications,
    inboxNotifications,
    unreadNotifications,
    archivedNotifications,
    unreadCount,
    hasLoaded,
    isLoading,
    isLoadingMore,
    hasMoreInbox,
    hasMoreArchive,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    archive,
    archiveAll,
  };
}
