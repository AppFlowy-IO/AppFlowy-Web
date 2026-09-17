import { TimelineLayout } from '@/application/database-yjs';

import {
  addColumns,
  buildHeaderColumns,
  buildHeaderSegments,
  dateToX,
  getBarRect,
  MIN_BAR_WIDTH,
  snapDate,
  TimelineGeometry,
  totalWidth,
  xToDate,
} from '../scale/geometry';
import { getTimelinePreset, TIMELINE_SCALE_PRESETS, TIMELINE_LAYOUT_ORDER } from '../scale/presets';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

function geometryFor(zoom: TimelineLayout, origin: Date, columnCount = 60): TimelineGeometry {
  return { preset: getTimelinePreset(zoom), origin, columnCount };
}

describe('presets', () => {
  test('every Notion zoom level has a preset in menu order', () => {
    expect(TIMELINE_LAYOUT_ORDER).toEqual([
      TimelineLayout.Hours,
      TimelineLayout.Day,
      TimelineLayout.Week,
      TimelineLayout.BiWeek,
      TimelineLayout.Month,
      TimelineLayout.Quarter,
      TimelineLayout.Year,
    ]);
    TIMELINE_LAYOUT_ORDER.forEach((zoom) => expect(TIMELINE_SCALE_PRESETS[zoom].zoom).toBe(zoom));
  });

  test('unknown layout falls back to month', () => {
    expect(getTimelinePreset(99 as TimelineLayout).zoom).toBe(TimelineLayout.Month);
  });
});

describe('day-unit geometry', () => {
  const origin = local(2020, 11, 1);
  const geometry = geometryFor(TimelineLayout.Month, origin);
  const { columnWidth } = geometry.preset;

  test('maps midnights to column edges and round-trips through xToDate', () => {
    expect(dateToX(geometry, local(2020, 11, 9))).toBe(8 * columnWidth);
    expect(xToDate(geometry, 8 * columnWidth)).toEqual(local(2020, 11, 9));
    expect(dateToX(geometry, local(2020, 11, 9, 12))).toBeCloseTo(8.5 * columnWidth, 5);
    expect(xToDate(geometry, 8.5 * columnWidth)).toEqual(local(2020, 11, 9, 12));
  });

  test('all-day ranges are end-inclusive and single days span one column', () => {
    expect(getBarRect(geometry, local(2020, 11, 9), local(2020, 11, 12), true)).toEqual({
      left: 8 * columnWidth,
      width: 4 * columnWidth,
    });
    expect(getBarRect(geometry, local(2020, 11, 9), undefined, true)).toEqual({
      left: 8 * columnWidth,
      width: columnWidth,
    });
    // A stale end before the start still yields a one-column bar.
    expect(getBarRect(geometry, local(2020, 11, 9), local(2020, 11, 2), true).width).toBe(columnWidth);
  });

  test('timed events keep a whole day column on day scales, like a calendar month cell', () => {
    const start = local(2020, 11, 9, 9);

    expect(getBarRect(geometry, start, local(2020, 11, 9, 15), false).width).toBe(columnWidth);
    expect(getBarRect(geometry, start, undefined, false).width).toBe(columnWidth);
    // A timed span longer than a day is still true to its length.
    expect(getBarRect(geometry, start, local(2020, 11, 11, 9), false).width).toBeCloseTo(columnWidth * 2, 5);
  });

  test('snaps to whole days from local midnight', () => {
    expect(snapDate(geometry.preset, local(2020, 11, 9, 13), 'round')).toEqual(local(2020, 11, 10));
    expect(snapDate(geometry.preset, local(2020, 11, 9, 13), 'floor')).toEqual(local(2020, 11, 9));
    expect(snapDate(geometry.preset, local(2020, 11, 9, 1), 'ceil')).toEqual(local(2020, 11, 10));
  });

  test('header columns are clamped to the range, flag weekends and today, and skip out-of-window indexes', () => {
    const now = local(2020, 11, 9, 10);
    const columns = buildHeaderColumns(geometry, -3, 10, 0, now);

    expect(columns.map((column) => column.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The first of a month names the month so boundaries read while scrolling.
    expect(columns[0].label).toBe('Nov 1');
    expect(columns[1].label).toBe('2');
    expect(columns.find((column) => column.isToday)?.index).toBe(8);
    // 1 Nov 2020 is a Sunday; 7 and 8 Nov are the next Saturday and Sunday.
    expect(columns.filter((column) => column.isWeekend).map((column) => column.index)).toEqual([0, 6, 7]);
    expect(columns.every((column) => column.gridLine)).toBe(true);
  });

  test('month segments are clamped to the rendered range so the sticky label stays inside', () => {
    const wide = geometryFor(TimelineLayout.Month, local(2020, 10, 25), 30);
    const segments = buildHeaderSegments(wide, 0, 30);

    expect(segments.map((segment) => segment.label)).toEqual(['October 2020', 'November 2020']);
    expect(segments[0]).toMatchObject({ x: 0, width: 7 * wide.preset.columnWidth });
    expect(segments[1].x).toBe(7 * wide.preset.columnWidth);
    expect(segments[1].x + segments[1].width).toBe(totalWidth(wide));
  });

  test('quarter and year presets only draw week or month gridlines', () => {
    const quarter = buildHeaderColumns(geometryFor(TimelineLayout.Quarter, origin, 14), 0, 14, 1, local(2000, 1, 1));

    // Mondays in Nov 2020: 2, 9; the first week of the month carries the month name.
    expect(quarter.filter((column) => column.gridLine).map((column) => column.index)).toEqual([1, 8]);
    expect(quarter.filter((column) => column.label).map((column) => column.label)).toEqual(['Nov 2', '9']);

    const year = buildHeaderColumns(
      geometryFor(TimelineLayout.Year, local(2020, 10, 30), 5),
      0,
      5,
      0,
      local(2000, 1, 1)
    );

    expect(year.filter((column) => column.gridLine).map((column) => column.index)).toEqual([2]);
    expect(year.every((column) => column.label === '' && !column.isWeekend)).toBe(true);
  });
});

describe('hour-unit geometry', () => {
  const origin = local(2020, 11, 7);
  const geometry = geometryFor(TimelineLayout.Day, origin, 48);
  const { columnWidth } = geometry.preset;

  test('timed events are true to their duration on hour scales, never thinner than the minimum', () => {
    const start = local(2020, 11, 7, 9);

    expect(getBarRect(geometry, start, local(2020, 11, 7, 15), false).width).toBeCloseTo(columnWidth * 6, 5);
    expect(getBarRect(geometry, start, undefined, false).width).toBeCloseTo(columnWidth / 2, 5);
    expect(getBarRect(geometry, start, local(2020, 11, 7, 9, 1), false).width).toBe(MIN_BAR_WIDTH);
  });

  test('positions by wall-clock hours and snaps to quarter hours', () => {
    expect(dateToX(geometry, local(2020, 11, 7, 14, 30))).toBeCloseTo(14.5 * columnWidth, 5);
    expect(xToDate(geometry, 14.5 * columnWidth)).toEqual(local(2020, 11, 7, 14, 30));
    expect(snapDate(geometry.preset, local(2020, 11, 7, 14, 37))).toEqual(local(2020, 11, 7, 14, 30));
    expect(addColumns(geometry.preset, origin, 24)).toEqual(local(2020, 11, 8));
  });

  test('hour labels follow the 24-hour preference like the calendar time grid', () => {
    const columns = buildHeaderColumns(geometry, 13, 16, 0, local(2000, 1, 1), true);

    expect(columns.map((column) => column.label)).toEqual(['13:00', '14:00', '15:00']);
  });

  test('day segments carry the full date and hour columns are labelled', () => {
    const segments = buildHeaderSegments(geometry, 0, 48);

    expect(segments.map((segment) => segment.label)).toEqual(['November 7, 2020', 'November 8, 2020']);
    const columns = buildHeaderColumns(geometry, 13, 16, 0, local(2020, 11, 7, 14, 5));

    expect(columns.map((column) => column.label)).toEqual(['1 PM', '2 PM', '3 PM']);
    expect(columns.find((column) => column.isToday)?.index).toBe(14);
  });
});
