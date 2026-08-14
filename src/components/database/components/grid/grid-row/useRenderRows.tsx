import { useMemo } from 'react';

import { FieldType, useReadOnly } from '@/application/database-yjs';
import type { GridGrouping, Row, SelectOption } from '@/application/database-yjs';

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

export function useRenderRows(rows?: Row[], options?: { visibleRowLimit?: number; grouping?: GridGrouping }) {
  const readOnly = useReadOnly();
  const visibleRowLimit = options?.visibleRowLimit;
  const grouping = options?.grouping;

  const renderRows = useMemo(() => {
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
      return placeholderRows;
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
      return groupedRows;
    }

    const rowItems =
      rows?.map((row) => ({
        type: RenderRowType.Row,
        rowId: row.id,
      })) ?? [];
    const visibleRowItems = visibleRowLimit === undefined ? rowItems : rowItems.slice(0, visibleRowLimit);
    const remainingRowCount = visibleRowLimit === undefined ? 0 : Math.max(rowItems.length - visibleRowItems.length, 0);

    return [
      {
        type: RenderRowType.Header,
      },
      ...visibleRowItems,

      remainingRowCount > 0 && {
        type: RenderRowType.LoadMoreRow,
        remainingRowCount,
      },

      !readOnly && {
        type: RenderRowType.NewRow,
      },
      {
        type: RenderRowType.CalculateRow,
      },
    ].filter(Boolean) as RenderRow[];
  }, [grouping, readOnly, rows, visibleRowLimit]);

  const visibleDataRows = useMemo(() => renderRows.filter((row) => row.type === RenderRowType.Row), [renderRows]);
  const loadMoreRow = useMemo(() => renderRows.find((row) => row.type === RenderRowType.LoadMoreRow), [renderRows]);

  return {
    rows: renderRows,
    remainingRowCount: loadMoreRow?.remainingRowCount ?? 0,
    lastVisibleRowId: visibleDataRows[visibleDataRows.length - 1]?.rowId,
  };
}
