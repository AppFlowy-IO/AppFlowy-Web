/**
 * The "Open pages in" view preference hooks (WP13 §3.8): read a view's
 * `open_pages_in` live, and write only that key as one undoable view-setting
 * change.
 */
import { useCallback, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { useDatabaseContext, useSharedRoot } from '@/application/database-yjs/context';
import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import { OPEN_PAGES_IN_KEY, OpenPagesIn, readViewOpenPagesIn } from '@/application/database-yjs/open-pages-in';
import { YDatabase, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

/**
 * The raw stored `open_pages_in` of `viewId` (`undefined` when absent). The
 * caller re-renders only when that key changes (or the view, the views map or
 * the database map holding it is replaced), never for other view edits.
 */
export function useViewOpenPagesIn(viewId: string | null | undefined): unknown {
  const { databaseDoc } = useDatabaseContext();
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!viewId) return () => undefined;
      const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      let detach: (() => void) | null = null;

      const attach = () => {
        detach?.();
        const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
        const views = database?.get(YjsDatabaseKey.views);
        const view = views?.get(viewId);
        const onViews = (event: Y.YMapEvent<unknown>) => {
          if (!event.keysChanged.has(viewId)) return;
          attach();
          notify();
        };

        const onView = (event: Y.YMapEvent<unknown>) => {
          if (event.keysChanged.has(OPEN_PAGES_IN_KEY)) notify();
        };

        const onDatabase = (event: Y.YMapEvent<unknown>) => {
          if (!event.keysChanged.has(YjsDatabaseKey.views)) return;
          attach();
          notify();
        };

        database?.observe(onDatabase);
        views?.observe(onViews);
        view?.observe(onView);
        detach = () => {
          database?.unobserve(onDatabase);
          views?.unobserve(onViews);
          view?.unobserve(onView);
        };
      };

      const onRoot = (event: Y.YMapEvent<unknown>) => {
        if (!event.keysChanged.has(YjsEditorKey.database)) return;
        attach();
        notify();
      };

      sharedRoot.observe(onRoot);
      attach();
      return () => {
        sharedRoot.unobserve(onRoot);
        detach?.();
      };
    },
    [databaseDoc, viewId]
  );
  const getSnapshot = useCallback(() => readViewOpenPagesIn(databaseDoc, viewId), [databaseDoc, viewId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Writes only `views[viewId].open_pages_in`; every other key of the view map is kept. */
export function useSetViewOpenPagesIn() {
  const sharedRoot = useSharedRoot();

  return useCallback(
    (viewId: string, value: OpenPagesIn) => {
      const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
      const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view || view.get(OPEN_PAGES_IN_KEY) === value) return;
      executeOperations(sharedRoot, [() => view.set(OPEN_PAGES_IN_KEY, value)], 'setViewOpenPagesIn');
    },
    [sharedRoot]
  );
}
