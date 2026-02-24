import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { db } from '@/application/db';
import { MentionablePerson } from '@/application/types';
import { AppContext } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';

interface CacheEntry {
  users: MentionablePerson[];
  timestamp: number;
}

// Module-level in-memory cache: workspaceId -> CacheEntry
const cache = new Map<string, CacheEntry>();
const MEMORY_CACHE_TTL_MS = 30 * 1000; // 30 seconds for in-memory
const DISK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for IndexedDB

function isMemoryCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < MEMORY_CACHE_TTL_MS;
}

function getMemoryCachedUsers(workspaceId: string | undefined): MentionablePerson[] {
  if (!workspaceId) return [];
  const cached = cache.get(workspaceId);

  return isMemoryCacheValid(cached) ? cached.users : [];
}

/**
 * Load mentionable users from IndexedDB (workspace_member_profiles table).
 * Returns the users if any exist for this workspace with a valid TTL, otherwise empty array.
 */
async function loadFromDisk(workspaceId: string): Promise<{ users: MentionablePerson[]; fresh: boolean }> {
  try {
    const profiles = await db.workspace_member_profiles
      .where('workspace_id')
      .equals(workspaceId)
      .toArray();

    if (profiles.length === 0) {
      return { users: [], fresh: false };
    }

    // Check freshness using the newest updated_at among all profiles
    const newestUpdatedAt = Math.max(...profiles.map((p) => p.updated_at));
    const fresh = Date.now() - newestUpdatedAt < DISK_CACHE_TTL_MS;

    return { users: profiles, fresh };
  } catch (error) {
    console.error('Failed to load mentionable users from disk:', error);
    return { users: [], fresh: false };
  }
}

/**
 * Persist mentionable users to IndexedDB.
 */
async function saveToDisk(workspaceId: string, users: MentionablePerson[]): Promise<void> {
  try {
    const now = Date.now();
    const records = users.map((user) => ({
      ...user,
      workspace_id: workspaceId,
      user_uuid: user.person_id,
      updated_at: now,
    }));

    // Delete stale entries for this workspace before writing fresh data
    await db.workspace_member_profiles.where('workspace_id').equals(workspaceId).delete();
    await db.workspace_member_profiles.bulkPut(records);
  } catch (error) {
    console.error('Failed to save mentionable users to disk:', error);
  }
}

export function useMentionableUsers() {
  const service = useService();
  // Use AppContext directly to avoid throwing when outside AppProvider (e.g., in publish view)
  const appContext = useContext(AppContext);
  const workspaceId = appContext?.currentWorkspaceId;

  // Track current workspaceId for race condition prevention
  const workspaceIdRef = useRef(workspaceId);

  workspaceIdRef.current = workspaceId;

  const [users, setUsers] = useState<MentionablePerson[]>(() => getMemoryCachedUsers(workspaceId));
  const [loading, setLoading] = useState(false);

  // Sync users state when workspaceId changes
  useEffect(() => {
    setUsers(getMemoryCachedUsers(workspaceId));
  }, [workspaceId]);

  const fetchUsers = useCallback(async () => {
    if (!service || !workspaceId) return;

    // 1. Check in-memory cache first (fastest)
    const memoryCached = cache.get(workspaceId);

    if (isMemoryCacheValid(memoryCached)) {
      setUsers(memoryCached.users);
      return;
    }

    // 2. Check disk cache (IndexedDB)
    const { users: diskUsers, fresh } = await loadFromDisk(workspaceId);

    if (workspaceIdRef.current !== workspaceId) return;

    if (diskUsers.length > 0) {
      // Populate in-memory cache from disk
      cache.set(workspaceId, { users: diskUsers, timestamp: Date.now() });
      setUsers(diskUsers);

      // If disk cache is still fresh, no need to fetch from API
      if (fresh) return;
    }

    // 3. Fetch from API (disk cache expired or empty)
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

        // Persist to disk in the background
        void saveToDisk(workspaceId, fetchedUsers);
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
