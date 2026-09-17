import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardRow,
  DashboardWidget,
} from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';

import {
  DASHBOARD_EDIT_ROW_ACTION_GUTTER,
  WIDGET_BODY_BORDER,
  WIDGET_EDIT_HEADER_HEIGHT,
  WIDGET_MIN_VIEWPORT_HEIGHT,
  WIDGET_TITLE_HEIGHT,
} from '../constants';
import {
  clampRowHeight,
  clampWidthDelta,
  databaseLayoutToViewLayout,
  getColumnBoundaryOffset,
  getDashboardInlinePadding,
  getLayoutLabel,
  getWidgetHeaderHeight,
  getWidgetViewportHeight,
  pixelsToColumns,
  shouldOpenInEditMode,
  viewLayoutToDatabaseLayout,
} from '../utils';

function widgets(...widths: number[]): DashboardWidget[] {
  return widths.map((width, index) => ({ id: `w${index}`, viewId: `v${index}`, databaseId: 'db', width }));
}

describe('dashboard layout mapping', () => {
  it.each([
    [DatabaseViewLayout.Grid, ViewLayout.Grid],
    [DatabaseViewLayout.Board, ViewLayout.Board],
    [DatabaseViewLayout.Calendar, ViewLayout.Calendar],
    [DatabaseViewLayout.Chart, ViewLayout.Chart],
    [DatabaseViewLayout.List, ViewLayout.List],
    [DatabaseViewLayout.Gallery, ViewLayout.Gallery],
    [DatabaseViewLayout.Feed, ViewLayout.Feed],
    [DatabaseViewLayout.Form, ViewLayout.Form],
    [DatabaseViewLayout.Timeline, ViewLayout.Timeline],
    [DatabaseViewLayout.Dashboard, ViewLayout.Dashboard],
  ])('maps database layout %s to folder layout %s and back', (databaseLayout, viewLayout) => {
    expect(databaseLayoutToViewLayout(databaseLayout)).toBe(viewLayout);
    expect(viewLayoutToDatabaseLayout(viewLayout)).toBe(databaseLayout);
  });

  it('falls back to Grid for unknown database layouts', () => {
    expect(databaseLayoutToViewLayout(null)).toBe(ViewLayout.Grid);
    expect(databaseLayoutToViewLayout(undefined)).toBe(ViewLayout.Grid);
    expect(databaseLayoutToViewLayout(42 as DatabaseViewLayout)).toBe(ViewLayout.Grid);
  });

  it('has no database layout for document-like folder layouts', () => {
    expect(viewLayoutToDatabaseLayout(ViewLayout.Document)).toBeNull();
    expect(viewLayoutToDatabaseLayout(null)).toBeNull();
    expect(viewLayoutToDatabaseLayout(undefined)).toBeNull();
  });

  it('names every layout with a translation key and an English fallback', () => {
    expect(getLayoutLabel(ViewLayout.Dashboard)).toEqual({ key: 'dashboard.menuName', defaultValue: 'Dashboard' });
    expect(getLayoutLabel(ViewLayout.Timeline)).toEqual({ key: 'timeline.menuName', defaultValue: 'Timeline' });
    expect(getLayoutLabel(ViewLayout.Board)).toEqual({ key: 'board.menuName', defaultValue: 'Board' });
    expect(getLayoutLabel(ViewLayout.Grid)).toEqual({ key: 'grid.menuName', defaultValue: 'Grid' });
    expect(getLayoutLabel(ViewLayout.Document)).toEqual({ key: 'grid.menuName', defaultValue: 'Grid' });
  });
});

describe('widget chrome sizes', () => {
  it('reserves the tinted header in Edit mode, whatever the title setting', () => {
    expect(getWidgetHeaderHeight({ isEditing: true, showWidgetTitles: true })).toBe(WIDGET_EDIT_HEADER_HEIGHT);
    expect(getWidgetHeaderHeight({ isEditing: true, showWidgetTitles: false })).toBe(WIDGET_EDIT_HEADER_HEIGHT);
  });

  it('reserves the quiet title in View mode only when titles are shown', () => {
    expect(getWidgetHeaderHeight({ isEditing: false, showWidgetTitles: true })).toBe(WIDGET_TITLE_HEIGHT);
    expect(getWidgetHeaderHeight({ isEditing: false, showWidgetTitles: false })).toBe(0);
  });

  it('hands the rest of the row height to the nested database', () => {
    expect(getWidgetViewportHeight(360, { isEditing: false, showWidgetTitles: true })).toBe(
      360 - WIDGET_TITLE_HEIGHT - WIDGET_BODY_BORDER
    );
    expect(getWidgetViewportHeight(360, { isEditing: true, showWidgetTitles: true })).toBe(
      360 - WIDGET_EDIT_HEADER_HEIGHT - WIDGET_BODY_BORDER
    );
    expect(getWidgetViewportHeight(360, { isEditing: false, showWidgetTitles: false })).toBe(360 - WIDGET_BODY_BORDER);
  });

  it('never hands out less than the minimum viewport', () => {
    expect(getWidgetViewportHeight(40, { isEditing: true, showWidgetTitles: true })).toBe(WIDGET_MIN_VIEWPORT_HEIGHT);
  });
});

describe('column geometry', () => {
  it('centres a boundary in the gap after the given number of columns', () => {
    expect(getColumnBoundaryOffset(6)).toBe('calc((100% + 16px) * 6 / 12 - 8px)');
    expect(getColumnBoundaryOffset(3, 24)).toBe('calc((100% + 24px) * 3 / 12 - 12px)');
  });

  it('converts a pointer delta into whole columns of the row pitch', () => {
    // 1184 px row + 16 px gap → one column pitch is 100 px.
    expect(pixelsToColumns(0, 1184)).toBe(0);
    expect(pixelsToColumns(49, 1184)).toBe(0);
    expect(pixelsToColumns(51, 1184)).toBe(1);
    expect(pixelsToColumns(200, 1184)).toBe(2);
    expect(pixelsToColumns(-260, 1184)).toBe(-3);
  });

  it('snaps a drag of whole column widths measured without the gap', () => {
    const rowWidth = 1100;
    const columnWidth = rowWidth / 12;

    for (let columns = -6; columns <= 6; columns += 1) {
      expect(pixelsToColumns(columns * columnWidth, rowWidth)).toBe(columns);
    }
  });

  it('ignores invalid rows and deltas and never returns negative zero', () => {
    expect(pixelsToColumns(120, 0)).toBe(0);
    expect(pixelsToColumns(Number.NaN, 1184)).toBe(0);
    expect(Object.is(pixelsToColumns(-10, 1184), -0)).toBe(false);
  });

  it('keeps both neighbours of a boundary at least one column wide', () => {
    const row = widgets(6, 3, 3);

    expect(clampWidthDelta(row, 0, 2)).toBe(2);
    expect(clampWidthDelta(row, 0, 5)).toBe(2);
    expect(clampWidthDelta(row, 0, -8)).toBe(-5);
    expect(clampWidthDelta(row, 1, -3)).toBe(-2);
    expect(Object.is(clampWidthDelta(widgets(1, 11), 0, -1), -0)).toBe(false);
  });

  it('refuses a boundary without a right neighbour', () => {
    expect(clampWidthDelta(widgets(12), 0, 1)).toBe(0);
    expect(clampWidthDelta(widgets(6, 6), 1, 1)).toBe(0);
  });
});

describe('row heights', () => {
  it('clamps and rounds heights to the supported range', () => {
    expect(clampRowHeight(DASHBOARD_DEFAULT_ROW_HEIGHT + 0.4)).toBe(DASHBOARD_DEFAULT_ROW_HEIGHT);
    expect(clampRowHeight(10)).toBe(DASHBOARD_MIN_ROW_HEIGHT);
    expect(clampRowHeight(10_000)).toBe(DASHBOARD_MAX_ROW_HEIGHT);
    expect(clampRowHeight(Number.NaN)).toBe(DASHBOARD_MIN_ROW_HEIGHT);
  });
});

describe('dashboard modes and padding', () => {
  const row: DashboardRow = { id: 'r1', height: 360, widgets: widgets(12) };

  it('opens an empty dashboard in Edit mode for editors only', () => {
    expect(shouldOpenInEditMode({ canEdit: true, rows: [] })).toBe(true);
    expect(shouldOpenInEditMode({ canEdit: false, rows: [] })).toBe(false);
    expect(shouldOpenInEditMode({ canEdit: true, rows: [row] })).toBe(false);
  });

  it('keeps the page padding in View mode', () => {
    expect(getDashboardInlinePadding({ paddingStart: 96, paddingEnd: 12, editing: false })).toEqual({
      paddingLeft: 96,
      paddingRight: 12,
    });
  });

  it('keeps room for the row add button in Edit mode', () => {
    expect(getDashboardInlinePadding({ paddingStart: 12, paddingEnd: 12, editing: true })).toEqual({
      paddingLeft: 12,
      paddingRight: DASHBOARD_EDIT_ROW_ACTION_GUTTER,
    });
    expect(getDashboardInlinePadding({ paddingStart: 96, paddingEnd: 96, editing: true })).toEqual({
      paddingLeft: 96,
      paddingRight: 96,
    });
  });
});
