import { useCallback, useEffect, useMemo, useState } from 'react';

import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import {
  useDatabase,
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useRowMap,
} from '@/application/database-yjs/context';
import { asYDatabaseFilters, DetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { hasEffectiveFilters } from '@/application/database-yjs/filter';
import { useBackgroundRowDocLoader, useDatabaseFieldsVersion } from '@/application/database-yjs/hooks';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { Row } from '@/application/database-yjs/selector';
import { RowId, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { queryChartRows } from './chartRowQuery';

/** Every row of the database in the view's row order, before the view's own filters. */
function useUnfilteredRowOrders(): Row[] {
  const view = useDatabaseView();
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const inlineRowOrders = getInlineViewRowOrders(useDatabase());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!rowOrders) return;
    const bump = () => setRevision((value) => value + 1);
    const observesInline = inlineRowOrders !== undefined && inlineRowOrders !== rowOrders;

    rowOrders.observeDeep(bump);
    if (observesInline) inlineRowOrders.observeDeep(bump);
    return () => {
      rowOrders.unobserveDeep(bump);
      if (observesInline) inlineRowOrders.unobserveDeep(bump);
    };
  }, [rowOrders, inlineRowOrders]);

  return useMemo(() => {
    void revision;
    return materializeVisibleRowOrders(rowOrders?.toJSON() as Row[] | undefined, inlineRowOrders?.toJSON()) ?? [];
  }, [rowOrders, inlineRowOrders, revision]);
}

export interface ChartRowQuery {
  rowIds: readonly RowId[];
  /** Rows are still loading; `rowIds` holds the last settled result until then. */
  loading: boolean;
  /** Some rows could not be loaded, so the result may be missing them. */
  error: boolean;
  retry: () => void;
}

/**
 * The drill-down's rows: the rules applied across the whole database, the way
 * desktop's `ChartRowQueryCubit` reads database membership instead of the
 * view. Rows the view's own filters hide are not in the row map, so they are
 * loaded like the grid's filter pass loads them.
 */
export function useChartRowQuery({
  rules,
  baseRowIds,
  initialRowIds,
}: {
  rules: readonly DetachedFilter[];
  /** Rows to apply the rules to instead of the whole database. */
  baseRowIds: readonly RowId[] | null;
  /** Listed until the first result settles, like desktop seeding the clicked bucket. */
  initialRowIds: readonly RowId[];
}): ChartRowQuery {
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const rowMap = useRowMap();
  const isHistory = useDatabaseContext().dataSource?.type === 'history';
  const viewRows = useUnfilteredRowOrders();
  // A retry starts a fresh loader, which attempts every unloaded row again.
  const [attempt, setAttempt] = useState(0);
  const needsRowData = useMemo(() => {
    void fieldsVersion;
    return hasEffectiveFilters(asYDatabaseFilters(rules), fields);
  }, [rules, fields, fieldsVersion]);
  const { cachedRowDocs, unavailableRowIds } = useBackgroundRowDocLoader(needsRowData, `chart-row-popup:${attempt}`);

  const members = useMemo(() => {
    if (!baseRowIds) return viewRows;
    const rowById = new Map(viewRows.map((row) => [row.id, row]));

    return baseRowIds.map((rowId) => rowById.get(rowId)).filter((row): row is Row => row !== undefined);
  }, [baseRowIds, viewRows]);

  // Live documents win once they hold the row, like the grid's condition docs.
  // A historical snapshot holds every row behind a bounded accessor, which
  // must not be enumerated.
  const rowDocs = useMemo(() => {
    if (isHistory) return rowMap ?? {};
    const docs: Record<RowId, YDoc> = { ...cachedRowDocs };

    Object.entries(rowMap ?? {}).forEach(([rowId, doc]) => {
      if (hasRowConditionData(doc) || !docs[rowId]) docs[rowId] = doc;
    });
    return docs;
  }, [cachedRowDocs, rowMap, isHistory]);

  const [dataClock, setDataClock] = useState(0);
  const result = useMemo(() => {
    void fieldsVersion;
    void dataClock;
    return queryChartRows({ members, rowDocs, rules, fields, unavailableRowIds });
  }, [members, rowDocs, rules, fields, fieldsVersion, dataClock, unavailableRowIds]);

  // A waiting row's document can fill in place, without a new map identity.
  useEffect(() => {
    const sections = result.pendingRowIds
      .map((rowId) => rowDocs[rowId])
      .filter((doc): doc is YDoc => doc !== undefined)
      .map((doc) => doc.getMap(YjsEditorKey.data_section));

    if (sections.length === 0) return;
    const bump = () => setDataClock((value) => value + 1);

    sections.forEach((section) => section.observe(bump));
    return () => sections.forEach((section) => section.unobserve(bump));
  }, [result.pendingRowIds, rowDocs]);

  // While loading, keep listing the last settled result (React's "storing
  // information from previous renders" pattern). Comparing by content keeps
  // the list's identity across recomputes that match the same rows.
  const [settledRowIds, setSettledRowIds] = useState<readonly RowId[]>(initialRowIds);
  const changed = result.rowIds !== null && !sameRowIds(result.rowIds, settledRowIds);

  if (changed && result.rowIds) setSettledRowIds(result.rowIds);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const loading = result.rowIds === null;

  return {
    rowIds: changed && result.rowIds ? result.rowIds : settledRowIds,
    loading,
    error: !loading && result.unavailableRowIds.length > 0,
    retry,
  };
}

function sameRowIds(a: readonly RowId[], b: readonly RowId[]) {
  return a.length === b.length && a.every((rowId, index) => rowId === b[index]);
}
