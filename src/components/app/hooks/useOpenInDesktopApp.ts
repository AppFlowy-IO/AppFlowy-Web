import { useCallback } from 'react';

import { UserService } from '@/application/services/domains';
import { MetadataKey } from '@/application/user-metadata';
import { notify } from '@/components/_shared/notify';
import { useAppConfig } from '@/components/main/app.hooks';

interface UseOpenInDesktopApp {
  /** Whether the user has enabled "open links in the desktop app". Defaults to false. */
  enabled: boolean;
  /** Whether the preference has ever been set (used to decide whether to show a first-time prompt). */
  isSet: boolean;
  /** Persist the preference: server (metadata merge) + local user cache. */
  setEnabled: (value: boolean) => Promise<void>;
}

/**
 * Reads/writes the per-user, server-synced "open links in desktop app" preference
 * (`MetadataKey.OpenInDesktopApp`). Stored in the user's metadata, identical to how timezone /
 * language / date-format preferences are persisted (server merge via `UserService.updateProfile`
 * plus the local user cache via `updateCurrentUser`).
 */
export function useOpenInDesktopApp(): UseOpenInDesktopApp {
  const { currentUser, updateCurrentUser } = useAppConfig();

  const raw = currentUser?.metadata?.[MetadataKey.OpenInDesktopApp];
  const enabled = raw === true;
  const isSet = raw !== undefined;

  const setEnabled = useCallback(
    async (value: boolean) => {
      try {
        await UserService.updateProfile({ [MetadataKey.OpenInDesktopApp]: value });

        if (currentUser) {
          await updateCurrentUser({
            ...currentUser,
            metadata: { ...currentUser.metadata, [MetadataKey.OpenInDesktopApp]: value },
          });
        }
      } catch (e) {
        notify.error(e instanceof Error ? e.message : 'Failed to update preference');
      }
    },
    [currentUser, updateCurrentUser]
  );

  return { enabled, isSet, setEnabled };
}
