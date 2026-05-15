/**
 * Shared data config for the "relative date filter" feature, kept in lock-step
 * with the desktop integration test fixture:
 *
 *   AppFlowy-Premium/frontend/appflowy_flutter/test/step/
 *     the_current_grid_has_relative_date_anchor_rows_in_date_field.dart
 *
 * If you change row names or date arithmetic here, mirror the change there
 * (and vice versa) so both platforms run the same scenario.
 */

export const RELATIVE_DATE_FIELD_NAME = 'Due Date';

export interface RelativeDateAnchor {
  readonly name: string;
  readonly date: Date;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

// Monday-based week start (ISO 8601), matching the source's
// dateRangeForRelative() and the desktop fixture's `monday`.
function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  const monBased = (day.getDay() + 6) % 7;
  return addDays(day, -monBased);
}

/**
 * Returns the nine anchor rows used by both the web and desktop scenarios.
 * Order matters: the test fills row[i] from anchors[i].
 */
export function getRelativeDateAnchors(today: Date = new Date()): RelativeDateAnchor[] {
  const todayDate = startOfDay(today);
  const monday = mondayOf(todayDate);

  return [
    { name: 'Today task', date: todayDate },
    { name: 'Yesterday task', date: addDays(todayDate, -1) },
    { name: 'Tomorrow task', date: addDays(todayDate, 1) },
    { name: 'ThisMon task', date: monday },
    { name: 'ThisSun task', date: addDays(monday, 6) },
    { name: 'LastMon task', date: addDays(monday, -7) },
    { name: 'LastSun task', date: addDays(monday, -1) },
    { name: 'NextMon task', date: addDays(monday, 7) },
    { name: 'NextSun task', date: addDays(monday, 13) },
  ];
}
