import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';

import { db } from '@/application/db';
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
      try {
        const existingProfile = await db.workspace_member_profiles
          .where('[workspace_id+user_uuid]')
          .equals([currentWorkspaceId, currentUser.uuid])
          .first();

        // Keep rendering the cache, but refresh it after a missed notification
        // or reopening the app. One request serves every live consumer.
        if (hydration.consumers === 0) return;

        const profile = await getWorkspaceMemberProfile(currentWorkspaceId);

        if (!profile || hydration.consumers === 0) {
          return;
        }

        await db.transaction('rw', db.workspace_member_profiles, async () => {
          const latest = await db.workspace_member_profiles.get([currentWorkspaceId, currentUser.uuid]);

          // A notification can update the cache while the GET is in flight.
          // Compare and publish together so its newer profile always wins.
          if (hydration.consumers === 0 || latest?.updated_at !== existingProfile?.updated_at) return;
          await db.workspace_member_profiles.put({
            workspace_id: currentWorkspaceId,
            user_uuid: currentUser.uuid,
            ...profile,
            updated_at: Date.now(),
          });
        });
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
