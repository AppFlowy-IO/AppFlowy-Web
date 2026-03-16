import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NotificationService } from '@/application/services/domains';

import { mergeNotifications, toNotification } from './helpers';
import { Notification } from './types';

const PAGE_SIZE = 200;
const REFRESH_INTERVAL = 30_000;

export interface UseNotificationsReturn {
  notifications: Notification[];
  inboxNotifications: Notification[];
  unreadNotifications: Notification[];
  archivedNotifications: Notification[];
  unreadCount: number;
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreInbox, setHasMoreInbox] = useState(true);
  const [hasMoreArchive, setHasMoreArchive] = useState(true);

  const inboxOffsetRef = useRef(0);
  const archiveOffsetRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    try {
      const [inboxRes, archiveRes, countRes] = await Promise.all([
        NotificationService.list(workspaceId, { archived: false, offset: 0, limit: PAGE_SIZE }),
        NotificationService.list(workspaceId, { archived: true, offset: 0, limit: PAGE_SIZE }),
        NotificationService.getUnreadCount(workspaceId),
      ]);

      if (!mountedRef.current) return;

      const inboxItems = inboxRes.notifications.map(toNotification);
      const archiveItems = archiveRes.notifications.map(toNotification);
      const merged = mergeNotifications([...inboxItems, ...archiveItems]);

      setNotifications(merged);
      setUnreadCount(countRes.unread_count);
      setHasMoreInbox(inboxRes.has_more);
      setHasMoreArchive(archiveRes.has_more);
      inboxOffsetRef.current = inboxItems.length;
      archiveOffsetRef.current = archiveItems.length;
    } catch (e) {
      console.error('[useNotifications] refresh failed', e);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [workspaceId]);

  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(
    async (archived: boolean) => {
      if (!workspaceId) return;
      if (loadingMoreRef.current) return;
      if (archived ? !hasMoreArchive : !hasMoreInbox) return;

      loadingMoreRef.current = true;
      setIsLoadingMore(true);
      try {
        const offset = archived ? archiveOffsetRef.current : inboxOffsetRef.current;
        const res = await NotificationService.list(workspaceId, {
          archived,
          offset,
          limit: PAGE_SIZE,
        });

        if (!mountedRef.current) return;

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
        if (mountedRef.current) setIsLoadingMore(false);
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

  // Use a ref so the polling effect doesn't re-fire when `refresh` identity changes
  const refreshRef = useRef(refresh);

  refreshRef.current = refresh;

  // Initial load + polling
  useEffect(() => {
    mountedRef.current = true;
    if (!workspaceId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    void refreshRef.current();

    const interval = setInterval(() => {
      void refreshRef.current();
    }, REFRESH_INTERVAL);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [workspaceId]);

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
