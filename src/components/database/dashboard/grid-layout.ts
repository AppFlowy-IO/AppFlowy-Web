import {
  DASHBOARD_GEOMETRY,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
  DASHBOARD_MIN_WIDGET_WIDTH,
  DASHBOARD_ROW_HEIGHT_SNAP,
} from '@/application/database-yjs/dashboard-geometry';

/**
 * Dashboard grid geometry (WP02): the wrap rule, the resize minimum, column
 * snapping and whole-row layouts. Pure, and checked against the WP02
 * sections of `dashboard-parity/wrap-and-split.json`; desktop runs the same
 * functions (`dashboard_grid_layout.dart`).
 *
 * `rowWidth` is always the row TRACK width: the content column plus the 6px
 * box bleed on each side (the grid element's width + 12).
 */

const COLUMN_GAP = DASHBOARD_GEOMETRY.grid.columnGap;
const ROW_GAP = DASHBOARD_GEOMETRY.grid.rowGap;
const MIN_WIDGET_COLUMNS = DASHBOARD_GEOMETRY.grid.minWidgetColumns;

/** `[left, top, width, height]` in track coordinates. */
export type DashboardRect = [number, number, number, number];

export interface DashboardRowLayout {
  /** Widgets per line. */
  cols: number;
  /** Widgets on each line, in order (a trailing partial line is shorter). */
  lines: number[];
  rects: DashboardRect[];
  /** Height of all lines and the gaps between them. */
  blockHeight: number;
  /** Centre of each column gap, only when the row is unwrapped. */
  boundaries: number[];
}

export interface DashboardWidgetSlot {
  line: number;
  /** Widgets on the widget's line. */
  lineSize: number;
  /** Effective columns on its line: the stored width when unwrapped, else an equal share. */
  span: number;
}

/** Dart's `num.round()`: halves round away from zero. Never returns -0. */
export function roundHalfAwayFromZero(value: number) {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);

  return rounded === 0 ? 0 : rounded;
}

/**
 * R-WRAP: widgets per line so no widget box is narrower than 240px. A row of
 * four goes straight to two by two, never three up.
 */
export function dashboardWrapColumns(rowWidth: number, count: number) {
  let cols = Math.max(1, count);

  while (cols > 1 && (rowWidth - (cols - 1) * COLUMN_GAP) / cols < DASHBOARD_MIN_WIDGET_WIDTH) {
    cols = count === DASHBOARD_MAX_WIDGETS_PER_ROW && cols === DASHBOARD_MAX_WIDGETS_PER_ROW ? 2 : cols - 1;
  }

  return cols;
}

/** Line sizes for `count` widgets at `cols` per line (3 at 2 → [2, 1]). */
export function dashboardLineSizes(count: number, cols: number) {
  const lines: number[] = [];
  const perLine = Math.max(1, cols);

  for (let remaining = count; remaining > 0; remaining -= perLine) {
    lines.push(Math.min(perLine, remaining));
  }

  return lines;
}

/** Fewest columns a widget keeps while resizing: at least 2, and at least 240px wide. */
export function dashboardMinWidgetColumns(rowWidth: number, count: number) {
  const available = rowWidth - (count - 1) * COLUMN_GAP;

  if (!(available > 0)) return DASHBOARD_GRID_COLUMNS;
  // The epsilon keeps an exact quotient (2880 / 480) from rounding up.
  return Math.max(
    MIN_WIDGET_COLUMNS,
    Math.ceil((DASHBOARD_MIN_WIDGET_WIDTH * DASHBOARD_GRID_COLUMNS) / available - 1e-9)
  );
}

/** Whole columns covered by a pointer delta over a row of `count` widgets. */
export function dashboardPixelsToColumns(deltaPx: number, rowWidth: number, count: number) {
  const pitch = (rowWidth - (count - 1) * COLUMN_GAP) / DASHBOARD_GRID_COLUMNS;

  if (!Number.isFinite(deltaPx) || !(pitch > 0)) return 0;
  return roundHalfAwayFromZero(deltaPx / pitch);
}

/**
 * Clamp a width delta for the boundary after `index`. Both neighbours keep
 * `minColumns`; a widget already below it is never forced to grow and never
 * shrinks further.
 */
export function clampDashboardWidthDelta(widths: number[], index: number, delta: number, minColumns = 1) {
  const left = widths[index];
  const right = widths[index + 1];

  if (left === undefined || right === undefined || !Number.isFinite(delta)) return 0;
  const lower = Math.min(minColumns, left) - left;
  const upper = right - Math.min(minColumns, right);
  const clamped = Math.max(lower, Math.min(upper, delta));

  return clamped === 0 ? 0 : clamped;
}

/** A dragged row height, snapped to 20px and clamped to 240–1200. */
export function snapDashboardRowHeight(height: number) {
  if (!Number.isFinite(height)) return DASHBOARD_MIN_ROW_HEIGHT;
  const snapped = roundHalfAwayFromZero(height / DASHBOARD_ROW_HEIGHT_SNAP) * DASHBOARD_ROW_HEIGHT_SNAP;

  return Math.min(DASHBOARD_MAX_ROW_HEIGHT, Math.max(DASHBOARD_MIN_ROW_HEIGHT, snapped));
}

/** The line, line size and effective columns of every widget of a row wrapped at `cols`. */
export function dashboardWidgetSlots(widths: number[], cols: number): DashboardWidgetSlot[] {
  const count = widths.length;
  const unwrapped = cols >= count;
  const lines = dashboardLineSizes(count, cols);
  const slots: DashboardWidgetSlot[] = [];

  lines.forEach((lineSize, line) => {
    for (let index = 0; index < lineSize; index += 1) {
      const width = widths[slots.length];

      // 12 / k is exact for k ≤ 4.
      slots.push({ line, lineSize, span: unwrapped ? width : DASHBOARD_GRID_COLUMNS / lineSize });
    }
  });
  return slots;
}

/**
 * Box rects of a row in track coordinates. Unwrapped, each box gets its share
 * of the width left after the gaps (Notion's flex-basis); wrapped, every box
 * on a line gets an equal share and the stored widths are ignored.
 */
export function computeDashboardRowLayout(rowWidth: number, widths: number[], height: number): DashboardRowLayout {
  const count = widths.length;
  const cols = dashboardWrapColumns(rowWidth, count);
  const lines = dashboardLineSizes(count, cols);
  const unwrapped = cols === count;
  const rects: DashboardRect[] = [];

  lines.forEach((lineSize, line) => {
    let x = 0;

    for (let index = 0; index < lineSize; index += 1) {
      const width = unwrapped
        ? ((rowWidth - (count - 1) * COLUMN_GAP) * widths[rects.length]) / DASHBOARD_GRID_COLUMNS
        : (rowWidth - (lineSize - 1) * COLUMN_GAP) / lineSize;

      rects.push([x, line * (height + ROW_GAP), width, height]);
      x += width + COLUMN_GAP;
    }
  });

  const blockHeight = lines.length * height + Math.max(0, lines.length - 1) * ROW_GAP;
  const boundaries = unwrapped ? rects.slice(0, -1).map(([left, , width]) => left + width + COLUMN_GAP / 2) : [];

  return { cols, lines, rects, blockHeight, boundaries };
}

/**
 * CSS flex-basis of a widget box in the track (`flex: 1 1 <basis>`). The half
 * pixel that every box gives up is handed back by `flex-grow`, so rounding
 * never wraps a line early and the next widget always wraps.
 */
export function getDashboardFlexBasis(span: number, lineSize: number) {
  return `calc((100% - ${(lineSize - 1) * COLUMN_GAP}px) * ${span} / ${DASHBOARD_GRID_COLUMNS} - 0.5px)`;
}

/**
 * CSS `left` of the width handle after widget `index` (`columnsBefore` columns
 * up to and including it), in row coordinates: the track starts 6px before
 * the row, so this is `boundaries[index] - 6` of the track.
 */
export function getWidthHandleCenter(columnsBefore: number, index: number, count: number) {
  return `calc((100% + ${COLUMN_GAP - (count - 1) * COLUMN_GAP}px) * ${columnsBefore} / ${DASHBOARD_GRID_COLUMNS} + ${
    index * COLUMN_GAP
  }px)`;
}
