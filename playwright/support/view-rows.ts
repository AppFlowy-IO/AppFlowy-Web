import type * as Y from 'yjs';

import { viewRowOrderEntries } from '../../src/application/database-yjs/row-placements-doc';
import type { YDatabase, YDatabaseView } from '../../src/application/types';

/**
 * The ids of the rows a view holds, in its order, whichever way the view stores them: an
 * anchored view does not list its rows in its own `row_orders`.
 */
export function viewRowIds(database: Y.Map<unknown>, view: Y.Map<unknown>): string[] {
  return (viewRowOrderEntries(database as unknown as YDatabase, view as unknown as YDatabaseView) ?? []).map(
    (row) => row.id
  );
}
