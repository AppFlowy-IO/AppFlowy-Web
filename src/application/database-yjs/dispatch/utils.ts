/**
 * Shared dispatch utilities used across multiple category files
 */

import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { YDatabase, YDatabaseView, YjsDatabaseKey, YSharedRoot } from '@/application/types';

/**
 * Execute an operation across all database views
 */
export function executeOperationWithAllViews(
  sharedRoot: YSharedRoot,
  database: YDatabase,
  operation: (view: YDatabaseView, viewId: string) => void,
  operationName: string
) {
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views.toJSON());

  executeOperations(
    sharedRoot,
    [
      () => {
        viewIds.forEach((viewId) => {
          const view = database.get(YjsDatabaseKey.views)?.get(viewId);

          if (!view) {
            throw new Error(`View not found`);
          }

          try {
            operation(view, viewId);
          } catch (e) {
            // do nothing
          }
        });
      },
    ],
    operationName
  );
}
