import { useLiveQuery } from 'dexie-react-hooks';
import { useContext, useEffect, useMemo } from 'react';

import { db } from '@/application/db';
import { getWorkspaceMemberProfile } from '@/application/services/js-services/http/user-api';
import { AppContext } from '@/components/app/app.hooks';
import { AFConfigContext } from '@/components/main/app.hooks';

const pendingHydrations = new Set<string>();

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
  // Use useContext directly to avoid errors when AppProvider is not mounted
  const appContext = useContext(AppContext);
  const configContext = useContext(AFConfigContext);

  const currentWorkspaceId = appContext?.currentWorkspaceId;
  const currentUser = configContext?.currentUser;

  useEffect(() => {
    if (!currentWorkspaceId || !currentUser?.uuid) {
      return;
    }

    const cacheKey = `${currentWorkspaceId}:${currentUser.uuid}`;
    let addedToPending = false;
    let canceled = false;

    const hydrateProfile = async () => {
      try {
        const existingProfile = await db.workspace_member_profiles
          .where('[workspace_id+user_uuid]')
          .equals([currentWorkspaceId, currentUser.uuid])
          .first();

        if (existingProfile) {
          return;
        }

        if (pendingHydrations.has(cacheKey)) {
          return;
        }

        pendingHydrations.add(cacheKey);
        addedToPending = true;

        const profile = await getWorkspaceMemberProfile(currentWorkspaceId);

        if (!profile || canceled) {
          return;
        }

        await db.workspace_member_profiles.put({
          workspace_id: currentWorkspaceId,
          user_uuid: currentUser.uuid,
          ...profile,
          updated_at: Date.now(),
        });
      } catch (error) {
        console.error('Failed to hydrate workspace member profile:', error);
      } finally {
        if (addedToPending) {
          pendingHydrations.delete(cacheKey);
        }
      }
    };

    void hydrateProfile();

    return () => {
      canceled = true;
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
    return profile?.avatar_url || null;
  }, [profile]);

  return avatarUrl;
}
