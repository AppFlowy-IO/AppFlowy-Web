import { useMemo } from 'react';

import { Row, useDatabaseView, useReadOnly, useRowMap } from '@/application/database-yjs';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { YjsDatabaseKey } from '@/application/types';

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
  const rowMap = useRowMap();
  const view = useDatabaseView();
  const hasConditions = (view?.get(YjsDatabaseKey.sorts)?.length ?? 0) > 0 || (view?.get(YjsDatabaseKey.filters)?.length ?? 0) > 0;

  const renderRows = useMemo(() => {
    const placeholderRows = [
      {
        type: RenderRowType.Header,
      },
      {
        type: RenderRowType.PlaceholderRow,
      },
    ].filter(Boolean) as RenderRow[];

    // If rows are still loading, show placeholder rows
    if (rows === undefined) {
      return placeholderRows;
    }

    const firstViewportRows = rows.slice(0, 20);

    if (hasConditions && firstViewportRows.length > 0 && !firstViewportRows.some((row) => hasRowConditionData(rowMap?.[row.id]))) {
      return placeholderRows;
    }

    if (hasConditions && rows.length === 0) {
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
  }, [hasConditions, readOnly, rowMap, rows]);

  return {
    rows: renderRows,
  };
}
