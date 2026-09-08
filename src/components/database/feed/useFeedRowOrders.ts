import { useMemo } from 'react';

import { useRowMap, useRowOrdersSelector, useSortsSelector } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { sortFeedRowsByCreatedAt, toUnixSeconds } from './feed.utils';

export function readRowCreatedAt(rowDoc: YDoc | undefined): number | undefined {
  if (!hasRowConditionData(rowDoc)) return undefined;

  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  return toUnixSeconds(row?.get(YjsDatabaseKey.created_at));
}

/**
 * Feed rows follow the view's filters and sorts. Without a sort, Desktop
 * orders rows newest-first by creation time in memory; that needs every row
 * doc, so the shared background loader hydrates them while the sort is absent.
 */
export function useFeedRowOrders(): Row[] | undefined {
  const rowOrders = useRowOrdersSelector();
  const sorts = useSortsSelector();
  const rowMap = useRowMap();
  const hasSorts = sorts.length > 0;
  const { cachedRowDocs } = useBackgroundRowDocLoader(!hasSorts && rowOrders !== undefined, 'feed');

  return useMemo(() => {
    if (!rowOrders || hasSorts) return rowOrders;

    return sortFeedRowsByCreatedAt(rowOrders, (rowId) => readRowCreatedAt(rowMap?.[rowId] ?? cachedRowDocs[rowId]));
  }, [cachedRowDocs, hasSorts, rowMap, rowOrders]);
}
