import { useMemo } from 'react';

import { Row, useReadOnly } from '@/application/database-yjs';

export enum RenderRowType {
  Header = 'header',
  Row = 'row',
  LoadMoreRow = 'load-more-row',
  NewRow = 'new-row',
  CalculateRow = 'calculate-row',
  PlaceholderRow = 'placeholder-row',
}

export type RenderRow = {
  type: RenderRowType;
  rowId?: string;
  remainingRowCount?: number;
};

export const EMBEDDED_GRID_INITIAL_ROW_LIMIT = 25;
export const EMBEDDED_GRID_LOAD_MORE_INCREMENT = 25;

export function useRenderRows(rows?: Row[], options?: { visibleRowLimit?: number }) {
  const readOnly = useReadOnly();
  const visibleRowLimit = options?.visibleRowLimit;

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

    const rowItems =
      rows?.map((row) => ({
        type: RenderRowType.Row,
        rowId: row.id,
      })) ?? [];
    const visibleRowItems = visibleRowLimit === undefined ? rowItems : rowItems.slice(0, visibleRowLimit);
    const remainingRowCount =
      visibleRowLimit === undefined ? 0 : Math.max(rowItems.length - visibleRowItems.length, 0);

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
  }, [readOnly, rows, visibleRowLimit]);

  const visibleDataRows = useMemo(() => renderRows.filter((row) => row.type === RenderRowType.Row), [renderRows]);
  const loadMoreRow = useMemo(
    () => renderRows.find((row) => row.type === RenderRowType.LoadMoreRow),
    [renderRows]
  );

  return {
    rows: renderRows,
    remainingRowCount: loadMoreRow?.remainingRowCount ?? 0,
    lastVisibleRowId: visibleDataRows[visibleDataRows.length - 1]?.rowId,
  };
}
