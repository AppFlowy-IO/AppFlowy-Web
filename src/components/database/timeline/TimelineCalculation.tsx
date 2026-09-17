import { useCallback } from 'react';

import { getCell, useFieldSelector } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { useTimelineRowValuesSnapshot } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { YDoc } from '@/application/types';
import { GridCalculateRowCellWithValues } from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';

/** Calculations use the same detached/live row source as the timeline bars. */
export function TimelineCalculation({ fieldId }: { fieldId: string }) {
  const { field, clock } = useFieldSelector(fieldId);
  const parse = useCallback(
    (rowId: string, doc: YDoc) => {
      // Type options can change without replacing the Y.Map field object.
      void clock;
      if (!field) return undefined;
      const cell = getCell(rowId, fieldId, { [rowId]: doc });

      return cell ? parseYDatabaseCellToCell(cell, field).data : '';
    },
    [clock, field, fieldId]
  );
  const { values, complete } = useTimelineRowValuesSnapshot(parse);

  return <GridCalculateRowCellWithValues fieldId={fieldId} cells={values} ready={complete && Boolean(field)} />;
}
