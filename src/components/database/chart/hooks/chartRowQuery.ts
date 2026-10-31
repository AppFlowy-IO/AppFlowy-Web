import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { asYDatabaseFilters, DetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { filterBy, hasEffectiveFilters } from '@/application/database-yjs/filter';
import { Row } from '@/application/database-yjs/selector';
import { RowId, YDatabaseFields, YDoc } from '@/application/types';

export interface ChartRowQueryInput {
  /** Rows the rules are applied to, in the order they are listed. */
  members: readonly Row[];
  rowDocs: Readonly<Record<RowId, YDoc>>;
  rules: readonly DetachedFilter[];
  fields: YDatabaseFields;
  /** Members whose row data could not be loaded. */
  unavailableRowIds?: ReadonlySet<RowId>;
}

export interface ChartRowQueryResult {
  /** Matching members, or null while some still lack the row data the rules read. */
  rowIds: RowId[] | null;
  /** Members left out because their row data could not be loaded. */
  unavailableRowIds: RowId[];
  /** Members still waiting for their row data. */
  pendingRowIds: RowId[];
}

/**
 * Desktop's `ChartRowQueryCubit.setFilters`, over the loaded row documents and
 * with the grid's own predicates (`filterBy`), so the drill-down and a filtered
 * grid cannot disagree about a row. Blank or incomplete rules are drafts and
 * do not restrict the rows, and members keep their order.
 */
export function queryChartRows({
  members,
  rowDocs,
  rules,
  fields,
  unavailableRowIds,
}: ChartRowQueryInput): ChartRowQueryResult {
  const filters = asYDatabaseFilters(rules);

  // Nothing to read: every member matches.
  if (!hasEffectiveFilters(filters, fields)) {
    return { rowIds: members.map(({ id }) => id), unavailableRowIds: [], pendingRowIds: [] };
  }

  const ready: Row[] = [];
  const unavailable: RowId[] = [];
  const pending: RowId[] = [];

  members.forEach((row) => {
    if (hasRowConditionData(rowDocs[row.id])) ready.push(row);
    else if (unavailableRowIds?.has(row.id)) unavailable.push(row.id);
    else pending.push(row.id);
  });

  if (pending.length > 0) return { rowIds: null, unavailableRowIds: unavailable, pendingRowIds: pending };

  // `filterBy` returns its input unfiltered for an empty document map; with no
  // loaded member there is nothing to list either.
  const rowIds = ready.length === 0 ? [] : filterBy(ready, filters, fields, rowDocs as Record<RowId, YDoc>).map(({ id }) => id);

  return { rowIds, unavailableRowIds: unavailable, pendingRowIds: [] };
}
