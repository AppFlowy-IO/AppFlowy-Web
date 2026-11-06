import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { useDatabaseContext, useDatabaseSelector } from '@/application/database-yjs/context';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import type { Column, Row } from '@/application/database-yjs/selector';
import { YDatabase, YDoc, YjsDatabaseKey } from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

import { createFeedSearchIndex } from './feed-search';

const selectDatabase = (database: YDatabase | undefined) => database;
const selectDatabaseFields = (database: YDatabase | undefined) => database?.get(YjsDatabaseKey.fields);

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
  const database = useDatabaseSelector(selectDatabase);
  const databaseFields = useDatabaseSelector(selectDatabaseFields);
  const {
    databaseDoc,
    activeViewId,
    rowMap,
    createRow,
    ensureRow,
    loadView,
    getViewIdFromDatabaseId,
    eventEmitter,
    dataSource,
  } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchActive = normalizedQuery.length > 0;
  const fieldsVersion = useDatabaseFieldsVersion(searchActive);
  const { users } = useMentionableUsersWithAutoFetch(searchActive);
  const fieldIdsKey = JSON.stringify([
    ...new Set([...(primaryFieldId ? [primaryFieldId] : []), ...fields.map((field) => field.fieldId)]),
  ]);
  // The request queue and its observers belong to this database view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => createFeedSearchIndex(), [databaseDoc, activeViewId]);
  const texts = useSyncExternalStore(index.subscribe, index.getSnapshot, index.getSnapshot);

  // Query text only filters indexed strings. Rebuild for changed inputs,
  // including in-place schema/option edits, rather than every keystroke.
  // Row and relation subscriptions keep the indexed values fresh in between.
  useLayoutEffect(() => {
    if (!searchActive || !database || !databaseFields) {
      index.dispose();
      return;
    }

    const docs: Record<string, YDoc> = isHistory ? rowMap ?? {} : {};

    if (!isHistory)
      rows?.forEach(({ id }) => {
        const doc = rowMap?.[id] ?? cachedRowDocs[id];

        if (doc) docs[id] = doc;
      });
    index.configure({
      immutable: isHistory,
      database,
      rows: docs,
      rowIds: rows?.map(({ id }) => id),
      fallbackRows: cachedRowDocs,
      fieldIds: JSON.parse(fieldIdsKey) as string[],
      users,
      createRow,
      ensureRow,
      loadView,
      getViewIdFromDatabaseId,
      eventEmitter,
    });
  }, [
    cachedRowDocs,
    createRow,
    database,
    databaseFields,
    ensureRow,
    eventEmitter,
    fieldIdsKey,
    fieldsVersion,
    getViewIdFromDatabaseId,
    index,
    isHistory,
    loadView,
    rowMap,
    rows,
    searchActive,
    users,
  ]);
  useEffect(() => () => index.dispose(), [index]);

  return normalizedQuery ? rows?.filter(({ id }) => texts.get(id)?.includes(normalizedQuery)) : rows;
}
