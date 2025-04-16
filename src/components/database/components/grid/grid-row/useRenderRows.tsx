import { useReadOnly, useRowOrdersSelector } from '@/application/database-yjs';

import { useMemo } from 'react';

export enum RenderRowType {
  Header = 'header',
  Row = 'row',
  NewRow = 'new-row',
  CalculateRow = 'calculate-row',
}

export type RenderRow = {
  type: RenderRowType;
  rowId?: string;
};

export function useRenderRows () {
  const rows = useRowOrdersSelector();
  const readOnly = useReadOnly();

  const renderRows = useMemo(() => {
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
