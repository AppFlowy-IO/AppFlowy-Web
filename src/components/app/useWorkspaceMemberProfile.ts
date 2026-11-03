import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';

import { db } from '@/application/db';
import { WorkspaceMemberProfile } from '@/application/db/tables/workspace_member_profiles';
import { getWorkspaceMemberProfile } from '@/application/services/js-services/http/user-api';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

const profileHydrations = new Map<string, { consumers: number; pending: boolean }>();

/**
 * Hook to get the current user's workspace member profile avatar
 * Returns the avatar URL or null
 *
 * This hook uses Dexie's useLiveQuery to automatically re-render when
 * the workspace member profile is updated in the database via WebSocket notifications.
 *
 * Safe to use in both App and Publish contexts - returns null when App context is unavailable.
 */
export function useCurrentUserWorkspaceAvatar() {
  const currentWorkspaceId = useCurrentWorkspaceIdOptional();
  const currentUser = useCurrentUserOptional();

  useEffect(() => {
    if (!currentWorkspaceId || !currentUser?.uuid) {
      return;
    }

    const cacheKey = `${currentWorkspaceId}:${currentUser.uuid}`;
    const existing = profileHydrations.get(cacheKey);
    const hydration = existing ?? { consumers: 0, pending: true };

    hydration.consumers += 1;

    const hydrateProfile = async () => {
      const newerFields = new Set<keyof WorkspaceMemberProfile>();

      try {
        // A cache replay and a newer notification both change updated_at. If
        // either wins the first read, revalidate once instead of dropping the
        // refresh forever or overwriting that concurrent profile.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const existingProfile = await db.workspace_member_profiles
            .where('[workspace_id+user_uuid]')
            .equals([currentWorkspaceId, currentUser.uuid])
            .first();

          // Keep rendering the cache. Every live consumer shares this refresh.
          if (hydration.consumers === 0) return;
          const profile = await getWorkspaceMemberProfile(currentWorkspaceId);

          if (!profile || hydration.consumers === 0) return;
          const published = await db.transaction('rw', db.workspace_member_profiles, async () => {
            const latest = await db.workspace_member_profiles.get([currentWorkspaceId, currentUser.uuid]);

            if (hydration.consumers === 0) return false;
            if (latest?.updated_at !== existingProfile?.updated_at) {
              for (const field of Object.keys(latest ?? {}) as Array<keyof WorkspaceMemberProfile>) {
                if (field === 'updated_at' || field === 'workspace_id' || field === 'user_uuid') continue;
                if (latest?.[field] !== existingProfile?.[field]) newerFields.add(field);
              }

              return false;
            }

            // Revalidation can still hit an older server cache. Preserve fields
            // changed concurrently, using their latest value inside this write.
            const refreshedProfile = { ...profile };

            for (const field of newerFields) {
              Object.assign(refreshedProfile, { [field]: latest?.[field] });
            }

            await db.workspace_member_profiles.put({
              ...refreshedProfile,
              workspace_id: currentWorkspaceId,
              user_uuid: currentUser.uuid,
              updated_at: Date.now(),
            });
            return true;
          });

          if (published) return;
        }
      } catch (error) {
        console.error('Failed to hydrate workspace member profile:', error);
      } finally {
        hydration.pending = false;
        if (hydration.consumers === 0) profileHydrations.delete(cacheKey);
      }
    };

    // Opening another document or widget must not refetch the same profile.
    // A new scope entry refreshes again after its last consumer has left.
    if (!existing) {
      profileHydrations.set(cacheKey, hydration);
      void hydrateProfile();
    }

    return () => {
      hydration.consumers -= 1;
      if (hydration.consumers === 0 && !hydration.pending) profileHydrations.delete(cacheKey);
    };
  }, [currentWorkspaceId, currentUser?.uuid]);

  // Use useLiveQuery to reactively watch the database for changes
  const profile = useLiveQuery(
    async () => {
      // Return null if we're not in App context (e.g., publish pages)
      if (!currentWorkspaceId || !currentUser?.uuid) {
        return null;
      }

      try {
        // Query workspace member profile from database
        const cachedProfile = await db.workspace_member_profiles
          .where('[workspace_id+user_uuid]')
          .equals([currentWorkspaceId, currentUser.uuid])
          .first();

        return cachedProfile || null;
      } catch (error) {
        console.error('Failed to fetch current user workspace avatar:', error);
        return null;
      }
    },
    [currentWorkspaceId, currentUser?.uuid]
  );

  // Extract avatar_url from profile
  const avatarUrl = useMemo(() => {
    // Live queries can retain the previous value until the next scope's query
    // finishes. Never show another account or workspace's cached profile.
    if (profile?.workspace_id !== currentWorkspaceId || profile?.user_uuid !== currentUser?.uuid) return null;
    return profile?.avatar_url || null;
  }, [profile, currentWorkspaceId, currentUser?.uuid]);

  return avatarUrl;
}
