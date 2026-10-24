import { useMemo, useRef } from 'react';

import { FieldType, useReadOnly } from '@/application/database-yjs';
import type { GridGrouping, Row, RowOrdersHydration, SelectOption } from '@/application/database-yjs';

export enum RenderRowType {
  Header = 'header',
  Row = 'row',
  LoadMoreRow = 'load-more-row',
  NewRow = 'new-row',
  CalculateRow = 'calculate-row',
  PlaceholderRow = 'placeholder-row',
  GroupHeader = 'group-header',
  GroupSeparator = 'group-separator',
}

export type RenderRow = {
  key?: string;
  type: RenderRowType;
  rowId?: string;
  remainingRowCount?: number;
  groupId?: string;
  groupConfigId?: string;
  groupLabel?: string;
  groupRowCount?: number;
  groupCollapsed?: boolean;
  groupFieldId?: string;
  groupFieldName?: string;
  groupFieldType?: FieldType;
  groupOption?: SelectOption;
};

export function getRenderRowKey(row: RenderRow): string {
  return row.key ?? row.rowId ?? row.type;
}

export const EMBEDDED_GRID_INITIAL_ROW_LIMIT = 25;
export const EMBEDDED_GRID_LOAD_MORE_INCREMENT = 25;

/**
 * The grid's virtualized row stream. `rows` undefined is the loading state
 * (header, loading row). With `hydrating`, `rows` are the rows of a result
 * still being read: they render above a loading row, and never as a finished
 * (possibly empty) result. The stream only depends on whether rows are still
 * read, not on how many were: a tick that only moves the progress returns the
 * same stream, and the loading row reads the progress itself
 * (`GridHydrationContext`). A row that stays in the stream keeps its render
 * row object, so appending rows leaves the memoized rows above untouched.
 */
export function useRenderRows(
  rows?: Row[],
  options?: { visibleRowLimit?: number; grouping?: GridGrouping; hydrating?: RowOrdersHydration }
) {
  const readOnly = useReadOnly();
  const visibleRowLimit = options?.visibleRowLimit;
  // An ungrouped stream only reads `rows`; a new grouping object must not rebuild it.
  const grouping = options?.grouping?.isGrouped ? options.grouping : undefined;
  const hydrating = Boolean(options?.hydrating);
  // The render row of each data row of the ungrouped stream, by row id. Only
  // an identity cache: a row found here is equal to a freshly built one, so a
  // render that is thrown away cannot leave anything wrong behind.
  const dataRowsRef = useRef(new Map<string, RenderRow>());

  return useMemo(() => {
    const placeholderRows = [
      {
        type: RenderRowType.Header,
      },
      {
        type: RenderRowType.PlaceholderRow,
      },
      !readOnly && {
        type: RenderRowType.NewRow,
      },
    ].filter(Boolean) as RenderRow[];

    // If rows are still loading, show placeholder rows
    if (rows === undefined) {
      return { rows: placeholderRows, remainingRowCount: 0, lastVisibleRowId: undefined };
    }

    if (grouping?.isGrouped) {
      let visibleRowsRemaining = visibleRowLimit ?? Number.POSITIVE_INFINITY;
      let hiddenRowCount = 0;
      const groupedRows = grouping.visibleGroups.flatMap((group): RenderRow[] => {
        const visibleRows = group.collapsed ? [] : group.rows.slice(0, visibleRowsRemaining);

        if (!group.collapsed) {
          visibleRowsRemaining -= visibleRows.length;
          hiddenRowCount += group.rows.length - visibleRows.length;
        }

        return [
          {
            key: `group:${group.id}:title`,
            type: RenderRowType.GroupHeader,
            groupId: group.id,
            groupConfigId: grouping.groupId,
            groupLabel: group.label,
            groupRowCount: group.rows.length,
            groupCollapsed: group.collapsed,
            groupFieldId: grouping.fieldId,
            groupFieldName: grouping.fieldName,
            groupFieldType: grouping.fieldType,
            groupOption: group.option,
          },
          !group.collapsed && {
            key: `group:${group.id}:header`,
            type: RenderRowType.Header,
            groupId: group.id,
          },
          ...(!group.collapsed
            ? visibleRows.map((row) => ({
                key: `group:${group.id}:row:${row.id}`,
                type: RenderRowType.Row,
                rowId: row.id,
                groupId: group.id,
                groupFieldId: grouping.fieldId,
              }))
            : []),
          !group.collapsed &&
            !readOnly && {
              key: `group:${group.id}:new`,
              type: RenderRowType.NewRow,
              groupId: group.id,
              groupFieldId: grouping.fieldId,
            },
          {
            key: `group:${group.id}:separator`,
            type: RenderRowType.GroupSeparator,
            groupId: group.id,
          },
        ].filter(Boolean) as RenderRow[];
      });

      if (hiddenRowCount > 0) {
        groupedRows.push({
          key: 'group:load-more',
          type: RenderRowType.LoadMoreRow,
          remainingRowCount: hiddenRowCount,
        });
      }

      groupedRows.push({ key: 'group:calculate', type: RenderRowType.CalculateRow });

      let lastVisibleRowId: string | undefined;

      for (let index = groupedRows.length - 1; index >= 0; index -= 1) {
        if (groupedRows[index].type === RenderRowType.Row) {
          lastVisibleRowId = groupedRows[index].rowId;
          break;
        }
      }

      return { rows: groupedRows, remainingRowCount: hiddenRowCount, lastVisibleRowId };
    }

    const visibleRows = visibleRowLimit === undefined ? rows : rows.slice(0, visibleRowLimit);
    const remainingRowCount = rows.length - visibleRows.length;
    const previousDataRows = dataRowsRef.current;
    const dataRows = new Map<string, RenderRow>();
    const visibleRowItems = visibleRows.map((row) => {
      const item = previousDataRows.get(row.id) ?? { type: RenderRowType.Row, rowId: row.id };

      dataRows.set(row.id, item);
      return item;
    });

    dataRowsRef.current = dataRows;

    return {
      rows: [
        {
          type: RenderRowType.Header,
        },
        ...visibleRowItems,

        remainingRowCount > 0 && {
          type: RenderRowType.LoadMoreRow,
          remainingRowCount,
        },

        hydrating && {
          type: RenderRowType.PlaceholderRow,
        },

        !readOnly && {
          type: RenderRowType.NewRow,
        },
        // Calculations summarize the complete result only.
        !hydrating && {
          type: RenderRowType.CalculateRow,
        },
      ].filter(Boolean) as RenderRow[],
      remainingRowCount,
      lastVisibleRowId: visibleRows[visibleRows.length - 1]?.id,
    };
  }, [grouping, hydrating, readOnly, rows, visibleRowLimit]);
}
