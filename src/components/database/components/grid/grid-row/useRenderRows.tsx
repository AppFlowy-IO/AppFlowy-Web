import { useMemo } from 'react';

import { Row, useReadOnly } from '@/application/database-yjs';

export enum RenderRowType {
  Header = 'header',
  Row = 'row',
  NewRow = 'new-row',
  CalculateRow = 'calculate-row',
  PlaceholderRow = 'placeholder-row',
}

export type RenderRow = {
  type: RenderRowType;
  rowId?: string;
};

export function useRenderRows (rows?: Row[]) {
  const readOnly = useReadOnly();

  const renderRows = useMemo(() => {
    const placeholderRows = [
      {
        type: RenderRowType.Header,
      },
      !readOnly && {
        type: RenderRowType.NewRow,
      },
      {
        type: RenderRowType.PlaceholderRow,
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

    return [
      {
        type: RenderRowType.Header,
      },
      ...rowItems,

      !readOnly && {
        type: RenderRowType.NewRow,
      },
      {
        type: RenderRowType.CalculateRow,
      },
    ].filter(Boolean) as RenderRow[];
  }, [readOnly, rows]);

  return {
    rows: renderRows,
  };
}
