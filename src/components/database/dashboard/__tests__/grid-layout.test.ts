import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DASHBOARD_GEOMETRY, DASHBOARD_MIN_WIDGET_WIDTH } from '@/application/database-yjs/dashboard-geometry';

import {
  clampDashboardWidthDelta,
  computeDashboardRowLayout,
  dashboardLineSizes,
  dashboardMinWidgetColumns,
  dashboardPixelsToColumns,
  dashboardWidgetSlots,
  dashboardWrapColumns,
  getDashboardFlexBasis,
  getWidthHandleCenter,
  roundHalfAwayFromZero,
  snapDashboardRowHeight,
} from '../grid-layout';

/** The WP02 sections of `dashboard-parity/wrap-and-split.json`, shared with desktop. */
interface WrapAndSplitFixture {
  grid: {
    column_gap: number;
    row_gap: number;
    min_widget_width: number;
    min_widget_columns: number;
    columns: number;
    height_snap: number;
    min_row_height: number;
    max_row_height: number;
  };
  wrap: { row_width: number; count: number; cols: number; lines: number[] }[];
  min_columns: { row_width: number; count: number; min: number }[];
  pixels_to_columns: { delta: number; row_width: number; count: number; columns: number }[];
  width_clamp: { widths: number[]; index: number; delta: number; min: number; result: number }[];
  height_snap: { height: number; snapped: number }[];
  row_layout: {
    row_width: number;
    widths: number[];
    height: number;
    cols: number;
    lines: number[];
    rects: [number, number, number, number][];
    block_height: number;
    boundaries: number[];
  }[];
}

const fixture = loadParityFixture<WrapAndSplitFixture>('wrap-and-split.json');
const TOLERANCE = 0.01;

/** Evaluates `calc((100% ± Apx) * C / 12 + Bpx)` and `calc((100% - Apx) * S / 12 - 0.5px)` at a width. */
function evaluateCalc(expression: string, width: number) {
  const match = /^calc\(\(100% ([+-]) (-?[\d.]+)px\) \* ([\d.]+) \/ 12 ([+-]) ([\d.]+)px\)$/.exec(expression);

  if (!match) throw new Error(`unexpected calc: ${expression}`);
  const [, sign, inner, factor, outerSign, outer] = match;
  const base = width + (sign === '+' ? 1 : -1) * Number(inner);

  return (base * Number(factor)) / 12 + (outerSign === '+' ? 1 : -1) * Number(outer);
}

describe('grid layout constants', () => {
  it('match the fixture grid section and the shared tokens', () => {
    expect(fixture.grid).toEqual({
      column_gap: DASHBOARD_GEOMETRY.grid.columnGap,
      row_gap: DASHBOARD_GEOMETRY.grid.rowGap,
      min_widget_width: DASHBOARD_MIN_WIDGET_WIDTH,
      min_widget_columns: DASHBOARD_GEOMETRY.grid.minWidgetColumns,
      columns: 12,
      height_snap: 20,
      min_row_height: 240,
      max_row_height: 1200,
    });
  });
});

describe('dashboardWrapColumns / dashboardLineSizes', () => {
  it.each(fixture.wrap.map((entry) => [entry.row_width, entry.count, entry] as const))(
    'wraps %spx with %s widgets',
    (_width, _count, entry) => {
      const cols = dashboardWrapColumns(entry.row_width, entry.count);

      expect(cols).toBe(entry.cols);
      expect(dashboardLineSizes(entry.count, cols)).toEqual(entry.lines);
    }
  );

  it('never lays four widgets out three up', () => {
    for (let width = 300; width <= 1300; width += 1) {
      expect(dashboardWrapColumns(width, 4)).not.toBe(3);
    }
  });
});

describe('dashboardMinWidgetColumns', () => {
  it.each(fixture.min_columns.map((entry) => [entry.row_width, entry.count, entry] as const))(
    'keeps widgets of a %spx row with %s widgets at least 240px and 2 columns wide',
    (_width, _count, entry) => {
      expect(dashboardMinWidgetColumns(entry.row_width, entry.count)).toBe(entry.min);
    }
  );

  it('falls back to the whole row when the gaps leave no width', () => {
    expect(dashboardMinWidgetColumns(24, 3)).toBe(12);
  });
});

describe('dashboardPixelsToColumns', () => {
  it.each(fixture.pixels_to_columns.map((entry) => [entry.delta, entry.row_width, entry.count, entry] as const))(
    'turns %spx over %spx with %s widgets into whole columns',
    (_delta, _width, _count, entry) => {
      const columns = dashboardPixelsToColumns(entry.delta, entry.row_width, entry.count);

      expect(columns).toBe(entry.columns);
      expect(Object.is(columns, -0)).toBe(false);
    }
  );

  it('ignores non-finite deltas', () => {
    expect(dashboardPixelsToColumns(Number.NaN, 1224, 2)).toBe(0);
    expect(dashboardPixelsToColumns(Number.POSITIVE_INFINITY, 1224, 2)).toBe(0);
  });

  it('rounds halves away from zero like Dart', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(1.49)).toBe(1);
    expect(Object.is(roundHalfAwayFromZero(-0.2), -0)).toBe(false);
  });
});

describe('clampDashboardWidthDelta', () => {
  it.each(
    fixture.width_clamp.map((entry) => [entry.widths.join('/'), entry.index, entry.delta, entry.min, entry] as const)
  )('clamps %s at boundary %s by %s with minimum %s', (_widths, _index, _delta, _min, entry) => {
    const result = clampDashboardWidthDelta(entry.widths, entry.index, entry.delta, entry.min);

    expect(result).toBe(entry.result);
    expect(Object.is(result, -0)).toBe(false);
  });

  it('defaults to a one-column minimum', () => {
    expect(clampDashboardWidthDelta([6, 6], 0, 10)).toBe(5);
    expect(clampDashboardWidthDelta([6, 6], 0, Number.NaN)).toBe(0);
  });
});

describe('snapDashboardRowHeight', () => {
  it.each(fixture.height_snap.map((entry) => [entry.height, entry.snapped] as const))(
    'snaps %spx to %spx',
    (height, snapped) => {
      expect(snapDashboardRowHeight(height)).toBe(snapped);
    }
  );

  it('snaps a non-finite height to the minimum', () => {
    expect(snapDashboardRowHeight(Number.NaN)).toBe(240);
  });
});

describe('computeDashboardRowLayout', () => {
  it.each(fixture.row_layout.map((entry) => [entry.row_width, entry.widths.join(', '), entry] as const))(
    'lays out a %spx row of %s',
    (_width, _widths, entry) => {
      const layout = computeDashboardRowLayout(entry.row_width, entry.widths, entry.height);

      expect(layout.cols).toBe(entry.cols);
      expect(layout.lines).toEqual(entry.lines);
      expect(layout.blockHeight).toBe(entry.block_height);
      expect(layout.rects).toHaveLength(entry.rects.length);
      layout.rects.forEach((rect, index) =>
        rect.forEach((value, part) => expect(Math.abs(value - entry.rects[index][part])).toBeLessThan(TOLERANCE))
      );
      expect(layout.boundaries).toHaveLength(entry.boundaries.length);
      layout.boundaries.forEach((value, index) =>
        expect(Math.abs(value - entry.boundaries[index])).toBeLessThan(TOLERANCE)
      );
    }
  );
});

describe('dashboardWidgetSlots', () => {
  it('gives each widget of a wrapped line an equal share and ignores the stored widths', () => {
    expect(dashboardWidgetSlots([4, 4, 4], 2)).toEqual([
      { line: 0, lineSize: 2, span: 6 },
      { line: 0, lineSize: 2, span: 6 },
      { line: 1, lineSize: 1, span: 12 },
    ]);
    expect(dashboardWidgetSlots([3, 3, 3, 3], 2).map((slot) => slot.span)).toEqual([6, 6, 6, 6]);
  });

  it('keeps the stored widths of an unwrapped row', () => {
    expect(dashboardWidgetSlots([8, 4], 2)).toEqual([
      { line: 0, lineSize: 2, span: 8 },
      { line: 0, lineSize: 2, span: 4 },
    ]);
  });
});

describe('CSS helpers', () => {
  it('builds the flex basis of a box from its span and line size', () => {
    expect(getDashboardFlexBasis(8, 2)).toBe('calc((100% - 12px) * 8 / 12 - 0.5px)');
    expect(getDashboardFlexBasis(12, 1)).toBe('calc((100% - 0px) * 12 / 12 - 0.5px)');
  });

  it('centres a width handle on its column gap', () => {
    expect(getWidthHandleCenter(6, 0, 2)).toBe('calc((100% + 0px) * 6 / 12 + 0px)');
    expect(getWidthHandleCenter(8, 1, 3)).toBe('calc((100% + -12px) * 8 / 12 + 12px)');
  });

  it('puts the handle on the layout boundaries (row coordinates = track - 6)', () => {
    fixture.row_layout
      .filter((entry) => entry.cols === entry.widths.length)
      .forEach((entry) => {
        const rowWidth = entry.row_width - 12;
        const layout = computeDashboardRowLayout(entry.row_width, entry.widths, entry.height);

        layout.boundaries.forEach((boundary, index) => {
          const columnsBefore = entry.widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0);
          const center = evaluateCalc(getWidthHandleCenter(columnsBefore, index, entry.widths.length), rowWidth);

          expect(Math.abs(center - (boundary - 6))).toBeLessThan(TOLERANCE);
        });
      });
  });

  it('gives a box exactly its layout width once flex-grow hands back the half pixel', () => {
    fixture.row_layout.forEach((entry) => {
      const layout = computeDashboardRowLayout(entry.row_width, entry.widths, entry.height);
      const slots = dashboardWidgetSlots(entry.widths, layout.cols);

      slots.forEach((slot, index) => {
        const basis = evaluateCalc(getDashboardFlexBasis(slot.span, slot.lineSize), entry.row_width);

        expect(Math.abs(basis + 0.5 - layout.rects[index][2])).toBeLessThan(TOLERANCE);
      });
    });
  });
});
