import { useEffect, useMemo } from 'react';

import {
  holdsDatabaseSourceRows,
  peekDatabaseRowDocSeed,
  subscribeToDatabaseSourceResidency,
} from '@/application/database-blob';
import { hasRowDocSyncBinding } from '@/application/database-blob/row-doc-retention';
import {
  createDatabaseMentionRowsSource,
  DatabaseMentionRowsSource,
} from '@/application/database-yjs/mention-local-rows';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import type { YDoc } from '@/application/types';
import type { MentionLocalRowsAccess } from '@/components/editor/components/panels/mention-panel/mentionLocalRows';

const sources = new WeakMap<YDoc, DatabaseMentionRowsSource>();

/**
 * The @ picker's rows source of a database document (`mention-local-rows.ts`), one per document, so
 * every Text cell and row page of the database shares it. It reads the tab's live row documents
 * (and whether each is synced), the row walk's committed seeds and whether the tab holds every row
 * of the database.
 */
export function getDatabaseMentionRowsSource(databaseDoc: YDoc): DatabaseMentionRowsSource {
  let source = sources.get(databaseDoc);

  if (!source) {
    source = createDatabaseMentionRowsSource({
      databaseDoc,
      getLiveRowDoc: getCachedRowDoc,
      isRowDocSynced: hasRowDocSyncBinding,
      peekRowSeed: peekDatabaseRowDocSeed,
      holdsRows: holdsDatabaseSourceRows,
      subscribeToResidency: subscribeToDatabaseSourceResidency,
    });
    sources.set(databaseDoc, source);
  }

  return source;
}

type MentionRowsContext = Pick<
  DatabaseContextState,
  'databaseDoc' | 'rowMap' | 'dataSource' | 'subscribeToRowPassState'
>;

/**
 * The rows of the database an editor is in, for its @ picker (MEN-WEB-15): a Text cell or a row page
 * shown in `databaseViewId`. `undefined` when the editor cannot open the picker (`enabled` false, as
 * for a read-only cell) and in a history preview, whose rows must never come from the live caches.
 * Nothing is read until the picker subscribes; until then the editor only tells the source to look
 * again when its view opens rows or the row walk commits its seeds, which it ignores while no picker
 * listens.
 */
export function useDatabaseMentionLocalRows(
  context: MentionRowsContext | undefined,
  databaseViewId: string | undefined,
  enabled: boolean
): MentionLocalRowsAccess | undefined {
  const databaseDoc = enabled && context?.dataSource?.type !== 'history' ? context?.databaseDoc : undefined;
  const source = useMemo(() => (databaseDoc ? getDatabaseMentionRowsSource(databaseDoc) : undefined), [databaseDoc]);
  const rowMap = context?.rowMap;
  const subscribeToRowPassState = context?.subscribeToRowPassState;

  // A view that opened rows may hold the live documents of rows the source read from their seeds.
  useEffect(() => {
    source?.refresh();
  }, [rowMap, source]);

  // The row walk committed its seeds: rows without a title may have one now, and the tab may hold them all.
  useEffect(() => {
    if (!source || !subscribeToRowPassState) return;

    // This editor's own listener: the store keeps its listeners in a set, and every editor of the
    // database shares the source, so the first one to unmount would unsubscribe a shared
    // `source.refresh` for all of them.
    const onRowPass = () => source.refresh();

    return subscribeToRowPassState(onRowPass);
  }, [source, subscribeToRowPassState]);

  return useMemo(() => (source && databaseViewId ? { source, databaseViewId } : undefined), [databaseViewId, source]);
}
