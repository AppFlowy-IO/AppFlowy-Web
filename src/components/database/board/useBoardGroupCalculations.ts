import { debounce } from 'lodash-es';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useDatabaseFields } from '@/application/database-yjs';
import {
  type BoardGroupCalculation,
  type BoardGroupCalculationRow,
  computeBoardGroupCalculation,
  formatBoardGroupCalculation,
} from '@/application/database-yjs/board-group-calculation';
import { resolveChartLocale } from '@/application/database-yjs/chart-format';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import type { Row } from '@/application/database-yjs/selector';
import { RowId, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { groupCalculationLabel } from '@/components/database/components/board/column/group-calculation-labels';

import type * as Y from 'yjs';

/** What a column header shows for a calculation: the formatted value (`''` for none) and its tooltip. */
export interface BoardColumnCalculation {
  text: string;
  tooltip: string;
}

/** A row of a column as the calculation reads it. */
function readCalculationRow(rowDoc: YDoc | undefined, fieldId: string): BoardGroupCalculationRow {
  const row = rowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  return {
    cell: row?.get(YjsDatabaseKey.cells)?.get(fieldId),
    createdAt: row?.get(YjsDatabaseKey.created_at),
    lastModified: row?.get(YjsDatabaseKey.last_modified),
  };
}

/**
 * Whether a change of a row doc (events relative to its `data_section`)
 * changes what the calculation reads: the calculated field's cell, or, for a
 * time field, the row's timestamps. Edits of other fields, and the
 * `last_modified` they bump, do not.
 */
function touchesCalculation(events: Y.YEvent[], fieldId: string, timeField: boolean) {
  return events.some((event) => {
    const [, section, cellFieldId] = event.path;

    // The row itself was replaced.
    if (event.path.length === 0) return event.keys.has(YjsEditorKey.database_row);
    if (section === YjsDatabaseKey.cells) {
      return cellFieldId === undefined ? event.keys.has(fieldId) : cellFieldId === fieldId;
    }

    return (
      timeField &&
      section === undefined &&
      (event.keys.has(YjsDatabaseKey.created_at) || event.keys.has(YjsDatabaseKey.last_modified))
    );
  });
}

/**
 * The board-wide column calculation (WP09 §1.6) of every column, over the
 * column's effective rows (filters, global filters, private overlay and
 * search applied): `null` while the board shows card counts. It follows edits
 * of the calculated cells (debounced 150 ms) and field format changes.
 */
export function useBoardGroupCalculations({
  groupResult,
  groupingRows,
  calculation,
}: {
  groupResult: Map<string, Row[]>;
  groupingRows: Record<RowId, YDoc>;
  calculation: BoardGroupCalculation | undefined;
}): ReadonlyMap<string, BoardColumnCalculation> | null {
  const { t, i18n } = useTranslation();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion(Boolean(calculation));
  const [cellsVersion, setCellsVersion] = useState(0);
  const fieldType = Number(calculation && fields?.get(calculation.fieldId)?.get(YjsDatabaseKey.type));
  const timeField = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;

  useEffect(() => {
    if (!calculation) return;
    const { fieldId } = calculation;
    const bump = debounce(() => setCellsVersion((version) => version + 1), 150);
    const onChange = (events: Y.YEvent[]) => {
      if (touchesCalculation(events, fieldId, timeField)) bump();
    };

    const docs = Object.values(groupingRows);

    docs.forEach((doc) => doc.getMap(YjsEditorKey.data_section).observeDeep(onChange));
    return () => {
      bump.cancel();
      docs.forEach((doc) => doc.getMap(YjsEditorKey.data_section).unobserveDeep(onChange));
    };
  }, [calculation, groupingRows, timeField]);

  const language = i18n?.language;

  return useMemo(() => {
    void fieldsVersion;
    void cellsVersion;
    if (!calculation) return null;
    const field = fields?.get(calculation.fieldId);

    if (!field) return null;
    const locale = resolveChartLocale(language);
    const tooltip = t('board.column.calculationTooltip', {
      calculation: groupCalculationLabel(t, calculation.type),
      property: String(field.get(YjsDatabaseKey.name) ?? ''),
    });
    const labels = { days: (count: number) => t('chart.value.days', { count, defaultValue: `${count} days` }) };
    const result = new Map<string, BoardColumnCalculation>();

    groupResult.forEach((rows, columnId) => {
      const value = computeBoardGroupCalculation({
        type: calculation.type,
        field,
        rows: rows.map((row) => readCalculationRow(groupingRows[row.id], calculation.fieldId)),
      });

      result.set(columnId, {
        text: formatBoardGroupCalculation(value, { type: calculation.type, field, locale, labels }),
        tooltip,
      });
    });

    return result;
  }, [calculation, cellsVersion, fields, fieldsVersion, groupResult, groupingRows, language, t]);
}
