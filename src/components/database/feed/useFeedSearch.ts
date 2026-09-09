import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import type { Column, Row } from '@/application/database-yjs/selector';
import { YDoc } from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

import { createFeedSearchIndex } from './feed-search';

/** Match already hydrated data before deciding which full cards to mount. */
export function useFeedSearch({
  rows,
  fields,
  primaryFieldId,
  cachedRowDocs,
  query,
}: {
  rows: Row[] | undefined;
  fields: Column[];
  primaryFieldId: string | null | undefined;
  cachedRowDocs: Record<string, YDoc>;
  query: string;
}) {
  const database = useDatabase();
  const { databaseDoc, activeViewId, rowMap, createRow, ensureRow, loadView, getViewIdFromDatabaseId, eventEmitter } =
    useDatabaseContext();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const { users } = useMentionableUsersWithAutoFetch(Boolean(normalizedQuery));
  // The request queue and its observers belong to this database view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => createFeedSearchIndex(), [databaseDoc, activeViewId]);
  const texts = useSyncExternalStore(index.subscribe, index.getSnapshot, index.getSnapshot);

  // Configure after every committed render: Yjs fields can change in place,
  // including option names, without changing the selected Column objects.
  // The index preserves matching doc subscriptions and publishes only changes.
  useLayoutEffect(() => {
    if (!normalizedQuery || !database) {
      index.dispose();
      return;
    }

    const docs: Record<string, YDoc> = {};

    rows?.forEach(({ id }) => {
      const doc = rowMap?.[id] ?? cachedRowDocs[id];

      if (doc) docs[id] = doc;
    });
    index.configure({
      database,
      rows: docs,
      rowIds: rows?.map(({ id }) => id),
      fallbackRows: cachedRowDocs,
      fieldIds: [...new Set([...(primaryFieldId ? [primaryFieldId] : []), ...fields.map((field) => field.fieldId)])],
      users,
      createRow,
      ensureRow,
      loadView,
      getViewIdFromDatabaseId,
      eventEmitter,
    });
  });
  useEffect(() => () => index.dispose(), [index]);

  return normalizedQuery ? rows?.filter(({ id }) => texts.get(id)?.includes(normalizedQuery)) : rows;
}
