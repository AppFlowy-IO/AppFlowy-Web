import { useCallback, useEffect, useRef, useState } from 'react';

import { MentionablePerson } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';

interface CacheEntry {
  users: MentionablePerson[];
  timestamp: number;
}

// Module-level cache: workspaceId -> CacheEntry
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

function getCachedUsers(workspaceId: string | undefined): MentionablePerson[] {
  if (!workspaceId) return [];
  const cached = cache.get(workspaceId);

  return isCacheValid(cached) ? cached.users : [];
}

export function useMentionableUsers() {
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();

  // Track current workspaceId for race condition prevention
  const workspaceIdRef = useRef(workspaceId);

  workspaceIdRef.current = workspaceId;

  const [users, setUsers] = useState<MentionablePerson[]>(() => getCachedUsers(workspaceId));
  const [loading, setLoading] = useState(false);

  // Sync users state when workspaceId changes
  useEffect(() => {
    setUsers(getCachedUsers(workspaceId));
  }, [workspaceId]);

  const fetchUsers = useCallback(async () => {
    if (!service || !workspaceId) return;

    // Check cache first
    const cached = cache.get(workspaceId);

    if (isCacheValid(cached)) {
      setUsers(cached.users);
      return;
    }

    setLoading(true);
    try {
      const fetchedUsers = await service.getMentionableUsers(workspaceId);

      // Only update state if workspaceId hasn't changed during fetch
      if (workspaceIdRef.current === workspaceId) {
        cache.set(workspaceId, {
          users: fetchedUsers,
          timestamp: Date.now(),
        });
        setUsers(fetchedUsers);
      }
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) {
        console.error('Failed to fetch mentionable users:', error);
      }
    } finally {
      if (workspaceIdRef.current === workspaceId) {
        setLoading(false);
      }
    }
  }, [service, workspaceId]);

  // Invalidate cache for this workspace
  const invalidateCache = useCallback(() => {
    if (workspaceId) {
      cache.delete(workspaceId);
    }
  }, [workspaceId]);

  return {
    users,
    loading,
    fetchUsers,
    invalidateCache,
  };
}

// Hook to auto-fetch when needed (e.g., when menu opens)
export function useMentionableUsersWithAutoFetch(shouldFetch: boolean) {
  const { users, loading, fetchUsers } = useMentionableUsers();

  useEffect(() => {
    if (shouldFetch) {
      void fetchUsers();
    }
  }, [shouldFetch, fetchUsers]);

  return { users, loading };
}
