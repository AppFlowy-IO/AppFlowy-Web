import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

interface UseOpenDatabaseAsPageOptions {
  databaseId?: string;
  fallbackViewId?: string;
}

/**
 * Opens the primary page for the mounted database.
 *
 * Linked database blocks have their own embedded view ID. Resolving through
 * the shared database ID first prevents their header and toolbar actions from
 * navigating to that embedded view instead of the source database page.
 */
export function useOpenDatabaseAsPage({ databaseId, fallbackViewId }: UseOpenDatabaseAsPageOptions = {}) {
  const { t } = useTranslation();
  const database = useDatabase();
  const { getViewIdFromDatabaseId, navigateToView } = useDatabaseContext();
  const [isOpening, setIsOpening] = useState(false);
  const mountedDatabaseId = databaseId ?? database?.get(YjsDatabaseKey.id);
  const canOpen = Boolean(navigateToView && ((mountedDatabaseId && getViewIdFromDatabaseId) || fallbackViewId));

  const openDatabaseAsPage = useCallback(async () => {
    if (isOpening || !navigateToView) return;

    setIsOpening(true);

    try {
      let targetViewId: string | null | undefined;

      if (mountedDatabaseId && getViewIdFromDatabaseId) {
        targetViewId = await getViewIdFromDatabaseId(mountedDatabaseId);
      }

      targetViewId ??= fallbackViewId;

      if (!targetViewId) {
        throw new Error('Database view not found');
      }

      await navigateToView(targetViewId);
    } catch (error) {
      console.error('[useOpenDatabaseAsPage] Failed to open database:', error);
      toast.error(t('chat.openPagePreviewFailedToast'));
    } finally {
      setIsOpening(false);
    }
  }, [fallbackViewId, getViewIdFromDatabaseId, isOpening, mountedDatabaseId, navigateToView, t]);

  return { canOpen, isOpening, openDatabaseAsPage };
}
