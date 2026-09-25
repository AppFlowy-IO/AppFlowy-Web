import type { Column } from '@/application/database-yjs';

import {
  TIMELINE_MIN_PRIMARY_COLUMN_WIDTH,
  TIMELINE_MIN_TABLE_COLUMN_WIDTH,
  TIMELINE_SIDEBAR_WIDTH,
  TIMELINE_TABLE_COLUMN_WIDTH,
  TIMELINE_TABLE_CONTROL_WIDTH,
} from './constants';

export interface TimelineColumnResize {
  fieldId: string;
  width: number;
}

/** A single set of widths shared by the header, rows and calculations. */
export function timelineTableColumnWidths(
  columns: Column[],
  primaryFieldId: string | null | undefined,
  tableFieldIds: string[],
  resize: TimelineColumnResize | null
): ReadonlyMap<string, number> {
  const saved = new Map(columns.map((column) => [column.fieldId, column.width]));
  const widths = new Map<string, number>();

  for (const fieldId of [primaryFieldId, ...tableFieldIds]) {
    if (!fieldId) continue;
    const primary = fieldId === primaryFieldId;
    const width = resize?.fieldId === fieldId ? resize.width : saved.get(fieldId);
    const fallback = primary ? TIMELINE_SIDEBAR_WIDTH - TIMELINE_TABLE_CONTROL_WIDTH : TIMELINE_TABLE_COLUMN_WIDTH;

    widths.set(
      fieldId,
      width !== undefined && Number.isFinite(width) && width > 0
        ? Math.max(primary ? TIMELINE_MIN_PRIMARY_COLUMN_WIDTH : TIMELINE_MIN_TABLE_COLUMN_WIDTH, width)
        : fallback
    );
  }

  return widths;
}
