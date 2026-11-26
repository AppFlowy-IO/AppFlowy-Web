/**
 * Shared dispatch utilities used across multiple category files
 */

import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import { repairAnchoredViewsBeforeRemoval } from '@/application/database-yjs/row-placements-doc';
import { YDatabase, YDatabaseView, YjsDatabaseKey, YSharedRoot } from '@/application/types';

/**
 * Wraps the per-view step of a permanent row delete. Before the first view loses the rows, the
 * anchored views are repaired, so that rows moved next to a deleted row stay where they are.
 * The rows themselves leave an anchored view when they leave the storage view.
 */
export function withAnchoredViewRepair(
  database: YDatabase,
  rowIds: string[],
  operation: (view: YDatabaseView, viewId: string) => void
): (view: YDatabaseView, viewId: string) => void {
  let repaired = false;

  return (view, viewId) => {
    if (!repaired) {
      repaired = true;
      repairAnchoredViewsBeforeRemoval(database, rowIds);
    }

    operation(view, viewId);
  };
}

/**
 * Execute an operation across all database views
 */
export function executeOperationWithAllViews(
  sharedRoot: YSharedRoot,
  database: YDatabase,
  operation: (view: YDatabaseView, viewId: string) => void,
  operationName: string,
  historyGroup?: object
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
    operationName,
    { type: `database.${operationName}`, historyGroup }
  );
}
