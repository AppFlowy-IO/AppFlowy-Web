/**
 * Timeline scale presets.
 *
 * The preset shape (a column unit + step, a column width, upper/lower header
 * label formatters, a snap unit and a padding chunk) is adapted from
 * frappe/gantt's `DEFAULT_VIEW_MODES` (MIT, Copyright (c) 2024 Frappe
 * Technologies Pvt. Ltd.). The seven presets themselves mirror Notion's
 * timeline zoom menu: Hours, Day, Week, Bi-week, Month, Quarter, Year.
 */
import dayjs from 'dayjs';

import { TimelineLayout } from '@/application/database-yjs';

export type TimelineUnit = 'hour' | 'day';

export type TimelineGridLines = 'column' | 'week' | 'month';

/** How the single header row is drawn: one label per column, or one per band segment. */
export type TimelineHeaderMode = 'cells' | 'segments';

export interface TimelineScalePreset {
  zoom: TimelineLayout;
  /** i18n key under `timeline.zoom` and its English fallback. */
  labelKey: string;
  label: string;
  /** Unit each column represents. Hour presets position bars by wall-clock time. */
  unit: TimelineUnit;
  /** Pixel width of a single column. */
  columnWidth: number;
  /** Columns added on each side when the range is first built or extended. */
  chunkColumns: number;
  /** Columns scrolled by the ‹ › steppers. */
  stepColumns: number;
  /** How far drag/resize snaps, in minutes. */
  snapMinutes: number;
  /**
   * Toolbar title for the date at the left edge of the viewport, and the label
   * of a band segment (a day for hour presets, a month otherwise).
   */
  upperText: (segmentStart: Date) => string;
  /** Label for a column cell; empty string hides the cell label. */
  lowerText: (columnStart: Date, firstDayOfWeek: number, use24Hour: boolean) => string;
  /** Whether the header row shows per-column labels or per-segment labels. */
  headerMode: TimelineHeaderMode;
  /** Which columns get a gridline; coarse presets only draw week or month lines. */
  gridLines: TimelineGridLines;
  /** Whether weekend columns are shaded. */
  shadeWeekends: boolean;
}

const HOUR_UPPER = (segmentStart: Date) => dayjs(segmentStart).format('ddd, MMM D');
const DAY_UPPER = (segmentStart: Date) => dayjs(segmentStart).format('MMMM D, YYYY');
const MONTH_UPPER = (segmentStart: Date) => dayjs(segmentStart).format('MMMM YYYY');
/** Hour labels follow the user's 12/24-hour preference, as the calendar's time grid does. */
const HOUR_LOWER = (columnStart: Date, _firstDayOfWeek: number, use24Hour: boolean) =>
  dayjs(columnStart).format(use24Hour ? 'HH:mm' : 'h A');
/** Day number, with the month named on the first of each month so boundaries read while scrolling. */
const DAY_NUMBER = (columnStart: Date) => dayjs(columnStart).format(columnStart.getDate() === 1 ? 'MMM D' : 'D');
/** Calendar week-header style: weekday name and day number. */
const WEEKDAY_AND_DAY = (columnStart: Date) =>
  dayjs(columnStart).format(columnStart.getDate() === 1 ? 'ddd MMM D' : 'ddd D');
const SHORT_WEEKDAY_AND_DAY = (columnStart: Date) => dayjs(columnStart).format('dd D');

export const TIMELINE_SCALE_PRESETS: Record<TimelineLayout, TimelineScalePreset> = {
  [TimelineLayout.Hours]: {
    zoom: TimelineLayout.Hours,
    labelKey: 'timeline.zoom.hours',
    label: 'Hours',
    unit: 'hour',
    columnWidth: 60,
    chunkColumns: 24 * 7,
    stepColumns: 6,
    snapMinutes: 15,
    upperText: HOUR_UPPER,
    lowerText: HOUR_LOWER,
    headerMode: 'cells',
    gridLines: 'column',
    shadeWeekends: true,
  },
  [TimelineLayout.Day]: {
    zoom: TimelineLayout.Day,
    labelKey: 'timeline.zoom.day',
    label: 'Day',
    unit: 'hour',
    columnWidth: 88,
    chunkColumns: 24 * 7,
    stepColumns: 24,
    snapMinutes: 15,
    upperText: DAY_UPPER,
    lowerText: HOUR_LOWER,
    headerMode: 'cells',
    gridLines: 'column',
    shadeWeekends: true,
  },
  [TimelineLayout.Week]: {
    zoom: TimelineLayout.Week,
    labelKey: 'timeline.zoom.week',
    label: 'Week',
    unit: 'day',
    columnWidth: 140,
    chunkColumns: 28,
    stepColumns: 7,
    snapMinutes: 24 * 60,
    upperText: MONTH_UPPER,
    lowerText: WEEKDAY_AND_DAY,
    headerMode: 'cells',
    gridLines: 'column',
    shadeWeekends: true,
  },
  [TimelineLayout.BiWeek]: {
    zoom: TimelineLayout.BiWeek,
    labelKey: 'timeline.zoom.biWeek',
    label: 'Bi-week',
    unit: 'day',
    columnWidth: 70,
    chunkColumns: 42,
    stepColumns: 14,
    snapMinutes: 24 * 60,
    upperText: MONTH_UPPER,
    lowerText: SHORT_WEEKDAY_AND_DAY,
    headerMode: 'cells',
    gridLines: 'column',
    shadeWeekends: true,
  },
  [TimelineLayout.Month]: {
    zoom: TimelineLayout.Month,
    labelKey: 'timeline.zoom.month',
    label: 'Month',
    unit: 'day',
    columnWidth: 36,
    chunkColumns: 62,
    stepColumns: 30,
    snapMinutes: 24 * 60,
    upperText: MONTH_UPPER,
    lowerText: DAY_NUMBER,
    headerMode: 'cells',
    gridLines: 'column',
    shadeWeekends: true,
  },
  [TimelineLayout.Quarter]: {
    zoom: TimelineLayout.Quarter,
    labelKey: 'timeline.zoom.quarter',
    label: 'Quarter',
    unit: 'day',
    columnWidth: 12,
    chunkColumns: 120,
    stepColumns: 90,
    snapMinutes: 24 * 60,
    upperText: MONTH_UPPER,
    // One label per week start; the first week of a month names the month.
    lowerText: (columnStart, firstDayOfWeek) =>
      columnStart.getDay() === firstDayOfWeek
        ? dayjs(columnStart).format(columnStart.getDate() <= 7 ? 'MMM D' : 'D')
        : '',
    headerMode: 'cells',
    gridLines: 'week',
    shadeWeekends: true,
  },
  [TimelineLayout.Year]: {
    zoom: TimelineLayout.Year,
    labelKey: 'timeline.zoom.year',
    label: 'Year',
    unit: 'day',
    columnWidth: 4,
    chunkColumns: 365,
    stepColumns: 365,
    snapMinutes: 24 * 60,
    upperText: (segmentStart) => dayjs(segmentStart).format('MMM YYYY'),
    lowerText: () => '',
    headerMode: 'segments',
    gridLines: 'month',
    shadeWeekends: false,
  },
};

export const TIMELINE_LAYOUT_ORDER: TimelineLayout[] = [
  TimelineLayout.Hours,
  TimelineLayout.Day,
  TimelineLayout.Week,
  TimelineLayout.BiWeek,
  TimelineLayout.Month,
  TimelineLayout.Quarter,
  TimelineLayout.Year,
];

export function getTimelinePreset(zoom: TimelineLayout): TimelineScalePreset {
  return TIMELINE_SCALE_PRESETS[zoom] ?? TIMELINE_SCALE_PRESETS[TimelineLayout.Month];
}
