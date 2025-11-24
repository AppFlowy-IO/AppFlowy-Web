import { useCallback } from 'react';
import * as Y from 'yjs';

import { YDatabaseView } from '@/application/types';

import { SYNC_MAX_ATTEMPTS, SYNC_POLL_INTERVAL } from './constants';

export const useDatabaseViewSync = (views: Y.Map<YDatabaseView> | undefined) => {
  const waitForViewData = useCallback(
    async (viewId: string): Promise<boolean> => {
      for (let i = 0; i < SYNC_MAX_ATTEMPTS; i++) {
        if (views?.has(viewId)) {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_INTERVAL));
      }

      return false;
    },
    [views]
  );

  return { waitForViewData };
};

