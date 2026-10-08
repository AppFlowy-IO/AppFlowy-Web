import { useCallback, useSyncExternalStore } from 'react';

import { databaseViewLimitMessage, getDatabaseViewCount } from '@/application/database-yjs/database-view-capacity';
import { YDatabase, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getMaxDatabaseViews, subscribeToServerInfo } from '@/utils/server-info';

/** Observe membership only: changing rows, filters, or view settings cannot change capacity. */
export function useDatabaseViewCapacity(databaseDoc: YDoc | undefined) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!databaseDoc) return () => undefined;
      const root = databaseDoc.getMap(YjsEditorKey.data_section);
      let database: YDatabase | undefined;
      let views: YDatabaseViews | undefined;

      const refresh = () => {
        const nextDatabase = root.get(YjsEditorKey.database) as YDatabase | undefined;

        if (database !== nextDatabase) {
          database?.unobserve(refresh);
          database = nextDatabase;
          database?.observe(refresh);
        }

        const nextViews = database?.get(YjsDatabaseKey.views);

        if (views !== nextViews) {
          views?.unobserve(onStoreChange);
          views = nextViews;
          views?.observe(onStoreChange);
        }

        onStoreChange();
      };

      root.observe(refresh);
      refresh();
      return () => {
        root.unobserve(refresh);
        database?.unobserve(refresh);
        views?.unobserve(onStoreChange);
      };
    },
    [databaseDoc]
  );
  const snapshot = useCallback(() => getDatabaseViewCount(databaseDoc), [databaseDoc]);
  const count = useSyncExternalStore(subscribe, snapshot, snapshot);
  const limit = useSyncExternalStore(subscribeToServerInfo, getMaxDatabaseViews, getMaxDatabaseViews);

  return { count, limit, disabledReason: count >= limit ? databaseViewLimitMessage(limit) : undefined };
}
