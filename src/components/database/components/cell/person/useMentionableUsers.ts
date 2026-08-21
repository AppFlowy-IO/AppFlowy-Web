import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { db } from '@/application/db';
import { WorkspaceService } from '@/application/services/domains';
import { MentionablePerson } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';

interface CacheEntry {
  users: MentionablePerson[];
  timestamp: number;
}

// Module-level in-memory cache: workspaceId -> CacheEntry
const cache = new Map<string, CacheEntry>();
const diskLoads = new Map<string, Promise<{ users: MentionablePerson[]; fresh: boolean }>>();
const refreshes = new Map<string, Promise<MentionablePerson[]>>();
const userIndexes = new WeakMap<readonly MentionablePerson[], ReadonlyMap<string, MentionablePerson>>();
const EMPTY_USERS: MentionablePerson[] = [];
const MEMORY_CACHE_TTL_MS = 30 * 1000; // 30 seconds for in-memory
const DISK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for IndexedDB

function isMemoryCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < MEMORY_CACHE_TTL_MS;
}

function getMemoryCachedUsers(workspaceId: string | undefined): MentionablePerson[] {
  if (!workspaceId) return EMPTY_USERS;
  const cached = cache.get(workspaceId);

  return isMemoryCacheValid(cached) ? cached.users : EMPTY_USERS;
}

/** Build one lossless UID index per shared member-list snapshot. */
export function getMentionableUserIndex(
  users: readonly MentionablePerson[]
): ReadonlyMap<string, MentionablePerson> {
  const cached = userIndexes.get(users);

  if (cached) return cached;

  const index = new Map<string, MentionablePerson>();

  users.forEach((user) => {
    const uid = canonicalizeUserUid(user.uid);

    if (uid !== null) index.set(uid, user);
  });
  userIndexes.set(users, index);

  return index;
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
    // Profiles cached before attribution fields were introduced do not have
    // the numeric uid needed to resolve created_by/last_edited_by values.
    const users = profiles.map((profile) => {
      const uid = canonicalizeUserUid(profile.uid);

      return uid === null ? profile : { ...profile, uid };
    });
    const hasAttributionIdentifiers = users.every((profile) => canonicalizeUserUid(profile.uid) !== null);
    const fresh = hasAttributionIdentifiers && Date.now() - newestUpdatedAt < DISK_CACHE_TTL_MS;

    return { users, fresh };
  } catch (error) {
    console.error('Failed to load mentionable users from disk:', error);
    return { users: [], fresh: false };
  }
}

function loadFromDiskDeduplicated(workspaceId: string) {
  let load = diskLoads.get(workspaceId);

  if (!load) {
    load = loadFromDisk(workspaceId);
    diskLoads.set(workspaceId, load);
    void load.finally(() => {
      if (diskLoads.get(workspaceId) === load) diskLoads.delete(workspaceId);
    });
  }

  return load;
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

function refreshFromApi(workspaceId: string): Promise<MentionablePerson[]> {
  const pending = refreshes.get(workspaceId);

  if (pending) return pending;

  const refresh: Promise<MentionablePerson[]> = WorkspaceService.getMentionableUsers(workspaceId)
    .then((users) => {
      cache.set(workspaceId, { users, timestamp: Date.now() });
      // The request and its persistence are shared by every mounted cell.
      void saveToDisk(workspaceId, users);
      return users;
    })
    .finally(() => {
      if (refreshes.get(workspaceId) === refresh) refreshes.delete(workspaceId);
    });

  refreshes.set(workspaceId, refresh);
  return refresh;
}

export function useMentionableUsers() {
  const workspaceId = useCurrentWorkspaceIdOptional();

  // Track current workspaceId for race condition prevention
  const workspaceIdRef = useRef(workspaceId);

  workspaceIdRef.current = workspaceId;

  const [users, setUsers] = useState<MentionablePerson[]>(() => getMemoryCachedUsers(workspaceId));
  const [loading, setLoading] = useState(false);

  // Sync users state when workspaceId changes
  useEffect(() => {
    setUsers(getMemoryCachedUsers(workspaceId));
  }, [workspaceId]);

  const fetchUsers = useCallback(async (forceRefresh = false) => {
    if (!workspaceId) return;

    // 1. Check in-memory cache first (fastest)
    const memoryCached = cache.get(workspaceId);

    if (!forceRefresh && isMemoryCacheValid(memoryCached)) {
      setUsers(memoryCached.users);
      return;
    }

    // 2. Check disk cache (IndexedDB)
    const { users: diskUsers, fresh } = forceRefresh
      ? { users: [] as MentionablePerson[], fresh: false }
      : await loadFromDiskDeduplicated(workspaceId);

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
      const fetchedUsers = await refreshFromApi(workspaceId);

      // Only update state if workspaceId hasn't changed during fetch
      if (workspaceIdRef.current === workspaceId) {
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
  }, [workspaceId]);

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
export function useMentionableUsersWithAutoFetch(shouldFetch: boolean, requiredUid?: string | null) {
  const { users, loading, fetchUsers } = useMentionableUsers();
  const usersByUid = useMemo(() => getMentionableUserIndex(users), [users]);
  const hasRequiredUser =
    requiredUid === undefined ||
    requiredUid === null ||
    usersByUid.has(requiredUid);
  const shouldForceRefresh = users.length > 0 && !hasRequiredUser;

  useEffect(() => {
    if (shouldFetch) {
      // A cached member list can legitimately predate a newly added workspace
      // member. Attribution rows only carry the numeric UID, so force one API
      // refresh when that UID is absent instead of showing a stale fallback for
      // the full cache TTL.
      // Let an empty memory cache consult IndexedDB first. If that cached list
      // loads without the required actor, this derived flag changes and the
      // next effect pass upgrades the shared request to an API refresh.
      void fetchUsers(shouldForceRefresh);
    }
  }, [shouldFetch, fetchUsers, requiredUid, shouldForceRefresh]);

  return { users, usersByUid, loading };
}
