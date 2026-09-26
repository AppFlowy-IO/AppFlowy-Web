import {
  TIMELINE_MIN_PRIMARY_COLUMN_WIDTH,
  TIMELINE_MIN_TABLE_COLUMN_WIDTH,
  TIMELINE_SIDEBAR_WIDTH,
  TIMELINE_TABLE_COLUMN_WIDTH,
  TIMELINE_TABLE_CONTROL_WIDTH,
} from './constants';

import type { CSSProperties } from 'react';

export const TIMELINE_DEFAULT_PRIMARY_COLUMN_WIDTH = TIMELINE_SIDEBAR_WIDTH - TIMELINE_TABLE_CONTROL_WIDTH;

export interface TimelineColumnResize {
  fieldId: string;
  width: number;
}

/** A single set of widths shared by the header, rows and calculations. */
export function timelineTableColumnWidths(
  saved: ReadonlyMap<string, number>,
  primaryFieldId: string | null | undefined,
  tableFieldIds: string[],
  resize: TimelineColumnResize | null
): ReadonlyMap<string, number> {
  const widths = new Map<string, number>();

  for (const fieldId of [primaryFieldId, ...tableFieldIds]) {
    if (!fieldId) continue;
    const primary = fieldId === primaryFieldId;
    const width = resize?.fieldId === fieldId ? resize.width : saved.get(fieldId);
    const fallback = primary ? TIMELINE_DEFAULT_PRIMARY_COLUMN_WIDTH : TIMELINE_TABLE_COLUMN_WIDTH;

    widths.set(
      fieldId,
      width !== undefined && Number.isFinite(width) && width > 0
        ? Math.max(primary ? TIMELINE_MIN_PRIMARY_COLUMN_WIDTH : TIMELINE_MIN_TABLE_COLUMN_WIDTH, width)
        : fallback
    );
  }

  return widths;
}

export function timelinePropertyColumnWidth(widths: ReadonlyMap<string, number>, fieldId: string) {
  return widths.get(fieldId) ?? TIMELINE_TABLE_COLUMN_WIDTH;
}

function columnWidthVar(fieldId: string) {
  return `--timeline-column-${fieldId.replace(/[^\w-]/g, '_')}`;
}

/**
 * Widths published as CSS variables on the view root, so memoized rows follow
 * a resize through layout alone instead of re-rendering for every width.
 */
export function timelineColumnWidthVars(widths: ReadonlyMap<string, number>) {
  const vars: Record<string, string> = {};

  widths.forEach((width, fieldId) => {
    vars[columnWidthVar(fieldId)] = `${width}px`;
  });
  return vars as CSSProperties;
}

export function timelineColumnWidthStyle(fieldId: string): CSSProperties {
  return { width: `var(${columnWidthVar(fieldId)}, ${TIMELINE_TABLE_COLUMN_WIDTH}px)` };
}
