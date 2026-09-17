import { useCallback } from 'react';

import { getCell, useFieldSelector, useFormulaColumnEvaluator } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { useTimelineRowValuesSnapshot } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { YDatabaseRow, YDoc, YjsEditorKey } from '@/application/types';
import { GridCalculateRowCellWithValues } from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';

/** Calculations use the same detached/live row source as the timeline bars. */
export function TimelineCalculation({ fieldId }: { fieldId: string }) {
  const { field, clock } = useFieldSelector(fieldId);
  // A formula column has no stored cell; calculate over its results.
  const evaluateFormula = useFormulaColumnEvaluator(fieldId);
  const parse = useCallback(
    (rowId: string, doc: YDoc) => {
      // Type options can change without replacing the Y.Map field object.
      void clock;
      if (!field) return undefined;
      if (evaluateFormula) {
        const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

        return row ? evaluateFormula(rowId, row) : undefined;
      }

      const cell = getCell(rowId, fieldId, { [rowId]: doc });

      return cell ? parseYDatabaseCellToCell(cell, field).data : '';
    },
    [clock, field, fieldId, evaluateFormula]
  );
  const { values, complete } = useTimelineRowValuesSnapshot(parse);

  return <GridCalculateRowCellWithValues fieldId={fieldId} cells={values} ready={complete && Boolean(field)} />;
}
