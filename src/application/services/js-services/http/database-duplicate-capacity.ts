import { t } from 'i18next';
import * as Y from 'yjs';

import { getDatabaseViewCount } from '@/application/database-yjs/database-view-capacity';
import { Types, View, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromExtra, isDatabaseContainer, isDatabaseLayout } from '@/application/view-utils';
import { getMaxDatabaseViews } from '@/utils/server-info';

import { getDatabaseIdFromWorkspaceCatalog } from '../workspace-database-catalog';

import { getCollab } from './collab-api';

const CHECK_FAILED_MESSAGE = 'Could not verify the database view count. Refresh the page and try again.';

/** Reject an oversized source before queueing a whole-page duplicate on the server. */
export async function assertDatabaseDuplicateCapacity(workspaceId: string, source: View): Promise<void> {
  const pending = [source];
  const visited = new Set<string>();
  const databaseIds = new Set<string>();

  while (pending.length > 0) {
    const view = pending.pop();

    if (!view || visited.has(view.view_id)) continue;
    visited.add(view.view_id);
    pending.push(...(view.children ?? []));
    if (!isDatabaseLayout(view.layout) && !isDatabaseContainer(view)) continue;

    const databaseId = getDatabaseIdFromExtra(view) ?? await getDatabaseIdFromWorkspaceCatalog(workspaceId, view.view_id);

    if (!databaseId) throw new Error(CHECK_FAILED_MESSAGE);
    databaseIds.add(databaseId);
  }

  // Bound document reads when a duplicated page contains many independent databases.
  const ids = [...databaseIds];

  for (let index = 0; index < ids.length; index += 4) {
    await Promise.all(ids.slice(index, index + 4).map(async (databaseId) => {
      const { data } = await getCollab(workspaceId, databaseId, Types.Database);
      const doc = new Y.Doc({ guid: databaseId }) as YDoc;

      try {
        Y.applyUpdate(doc, data);
        const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;

        if (!(database?.get(YjsDatabaseKey.views) instanceof Y.Map)) throw new Error(CHECK_FAILED_MESSAGE);
        // A whole copy creates a new database with the source's view count; it does not add a
        // view to the source. Check the current server setting after the asynchronous read.
        const limit = getMaxDatabaseViews();

        if (getDatabaseViewCount(doc) > limit) {
          const fallback = `This database has more than the limit of ${limit} views and cannot be duplicated. Remove views before duplicating it.`;

          throw new Error(t('databaseViewCreation.duplicateLimitExceeded', { limit, defaultValue: fallback }) || fallback);
        }
      } finally {
        doc.destroy();
      }
    }));
  }
}
