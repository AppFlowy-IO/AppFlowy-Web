import { useCallback } from 'react';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { getCell } from '@/application/database-yjs/const';
import { FieldType } from '@/application/database-yjs/database.type';
import { useTimelineRowSource } from '@/application/database-yjs/hooks/TimelineRowValuesProvider';
import { useTimelineRowValuesSnapshot } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { useFieldCellsByRowsSelector, useFieldSelector, useFormulaColumnEvaluator } from '@/application/database-yjs/selector';
import { YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { GridCalculateRowCellWithValues } from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';

export function TimelineCalculation({ fieldId }: { fieldId: string }) {
  const { field, clock } = useFieldSelector(fieldId);

  // Cloud values use the same reader and readiness rules as Grid, independently
  // of row-document hydration. Native values retain Timeline's complete source.
  if (Number(field?.get(YjsDatabaseKey.type)) === FieldType.Verification) {
    return <ExternalTimelineCalculation fieldId={fieldId} />;
  }

  return <NativeTimelineCalculation fieldId={fieldId} field={field} clock={clock} />;
}

function ExternalTimelineCalculation({ fieldId }: { fieldId: string }) {
  const { rowOrders } = useTimelineRowSource();
  const { cells } = useFieldCellsByRowsSelector(fieldId, rowOrders);

  return <GridCalculateRowCellWithValues fieldId={fieldId} cells={cells} ready={cells !== null} />;
}

function NativeTimelineCalculation({ fieldId, field, clock }: {
  fieldId: string;
  field: YDatabaseField | undefined;
  clock: number;
}) {
  const rowSource = useTimelineRowSource();
  // A formula column has no stored cell; calculate over its results.
  const evaluateFormula = useFormulaColumnEvaluator(fieldId, rowSource);
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
