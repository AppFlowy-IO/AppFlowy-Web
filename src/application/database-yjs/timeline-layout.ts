import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseLayoutSettings,
  YDatabaseTimelineLayoutSetting,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { TimelineDependencyShift, TimelineLayout, TimelineLayoutSetting } from './database.type';

/** Layout-settings key for `DatabaseViewLayout.Timeline`. */
export const TIMELINE_LAYOUT_KEY = '8';

export const DEFAULT_TIMELINE_LAYOUT = TimelineLayout.Month;
export const DEFAULT_TIMELINE_SHOW_TABLE = true;
export const DEFAULT_TIMELINE_DEPENDENCY_SHIFT = TimelineDependencyShift.OverlapOnly;

const EMPTY_IDS: string[] = [];

/** A plain array of ids as Yjs / Yrs hand it back, or nothing. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return EMPTY_IDS;
  const ids = value.filter((id): id is string => typeof id === 'string' && id !== '');

  return ids.length === 0 ? EMPTY_IDS : ids;
}

function integer(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'bigint') return undefined;
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined;
}

/**
 * Mirrors `readCalendarLayoutSetting`: Yrs integers arrive as BigInt while Yjs
 * clients encode numbers, the week start falls back from `first_day_of_week_v2`
 * to the legacy `first_day_of_week` and then to the user's preference.
 */
export function readTimelineLayoutSetting(
  database: YDatabase | undefined,
  viewId: string,
  firstDayOfWeek: number,
  use24Hour: boolean
): TimelineLayoutSetting {
  const setting = database
    ?.get(YjsDatabaseKey.views)
    ?.get(viewId)
    ?.get(YjsDatabaseKey.layout_settings)
    ?.get(TIMELINE_LAYOUT_KEY);
  const layout = integer(setting?.get(YjsDatabaseKey.layout_ty), TimelineLayout.Hours, TimelineLayout.Year);
  const showTable = setting?.get(YjsDatabaseKey.show_table);
  const avoidWeekends = setting?.get(YjsDatabaseKey.avoid_weekends);
  const dependencyShift = integer(
    setting?.get(YjsDatabaseKey.dependency_shift_ty),
    TimelineDependencyShift.OverlapOnly,
    TimelineDependencyShift.Never
  );
  const weekday =
    integer(setting?.get(YjsDatabaseKey.first_day_of_week_v2), 0, 6) ??
    integer(setting?.get(YjsDatabaseKey.first_day_of_week), 0, 6);

  return {
    fieldId: setting?.get(YjsDatabaseKey.field_id) ?? '',
    layout: layout ?? DEFAULT_TIMELINE_LAYOUT,
    showTable: typeof showTable === 'boolean' ? showTable : DEFAULT_TIMELINE_SHOW_TABLE,
    firstDayOfWeek: weekday ?? firstDayOfWeek,
    use24Hour,
    endFieldId: setting?.get(YjsDatabaseKey.end_field_id) ?? '',
    dependencyFieldId: setting?.get(YjsDatabaseKey.dependency_field_id) ?? '',
    dependencyShift: dependencyShift ?? DEFAULT_TIMELINE_DEPENDENCY_SHIFT,
    avoidWeekends: typeof avoidWeekends === 'boolean' ? avoidWeekends : false,
    progressFieldId: setting?.get(YjsDatabaseKey.progress_field_id) ?? '',
    tableFieldIds: idList(setting?.get(YjsDatabaseKey.table_field_ids)),
  };
}

export type TimelineLayoutUpdate = Partial<Omit<TimelineLayoutSetting, 'use24Hour'>>;

export function createTimelineLayoutSetting(fieldId: string) {
  const setting = new Y.Map() as YDatabaseTimelineLayoutSetting;

  setting.set(YjsDatabaseKey.field_id, fieldId);
  setting.set(YjsDatabaseKey.layout_ty, DEFAULT_TIMELINE_LAYOUT);
  setting.set(YjsDatabaseKey.show_table, DEFAULT_TIMELINE_SHOW_TABLE);
  return setting;
}

/** Patch the existing map so unrelated layout options survive concurrent edits. */
export function updateTimelineLayoutSetting(view: YDatabaseView, settings: TimelineLayoutUpdate) {
  let layouts = view.get(YjsDatabaseKey.layout_settings);

  if (!layouts) {
    layouts = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layouts);
  }

  let setting = layouts.get(TIMELINE_LAYOUT_KEY);

  if (!setting) {
    setting = new Y.Map() as YDatabaseTimelineLayoutSetting;
    layouts.set(TIMELINE_LAYOUT_KEY, setting);
  }

  if (settings.fieldId !== undefined) setting.set(YjsDatabaseKey.field_id, settings.fieldId);
  if (settings.layout !== undefined) setting.set(YjsDatabaseKey.layout_ty, settings.layout);
  if (settings.showTable !== undefined) setting.set(YjsDatabaseKey.show_table, settings.showTable);
  if (settings.firstDayOfWeek !== undefined) setting.set(YjsDatabaseKey.first_day_of_week_v2, settings.firstDayOfWeek);
  // An empty id unbinds; the server treats a missing key as "none".
  if (settings.dependencyFieldId !== undefined) {
    if (settings.dependencyFieldId) setting.set(YjsDatabaseKey.dependency_field_id, settings.dependencyFieldId);
    else setting.delete(YjsDatabaseKey.dependency_field_id);
  }

  if (settings.progressFieldId !== undefined) {
    if (settings.progressFieldId) setting.set(YjsDatabaseKey.progress_field_id, settings.progressFieldId);
    else setting.delete(YjsDatabaseKey.progress_field_id);
  }

  if (settings.endFieldId !== undefined) {
    if (settings.endFieldId) setting.set(YjsDatabaseKey.end_field_id, settings.endFieldId);
    else setting.delete(YjsDatabaseKey.end_field_id);
  }

  if (settings.dependencyShift !== undefined) setting.set(YjsDatabaseKey.dependency_shift_ty, settings.dependencyShift);
  if (settings.avoidWeekends !== undefined) setting.set(YjsDatabaseKey.avoid_weekends, settings.avoidWeekends);
  if (settings.tableFieldIds !== undefined) {
    if (settings.tableFieldIds.length > 0) setting.set(YjsDatabaseKey.table_field_ids, [...settings.tableFieldIds]);
    else setting.delete(YjsDatabaseKey.table_field_ids);
  }
}

/**
 * Ensure the view has a timeline layout setting pointing at `fieldId`, without
 * touching zoom/table options a collaborator may have set.
 */
export function initializeTimelineLayoutSetting(view: YDatabaseView, fieldId: string) {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  const setting = layoutSettings.get(TIMELINE_LAYOUT_KEY);

  if (!setting) {
    layoutSettings.set(TIMELINE_LAYOUT_KEY, createTimelineLayoutSetting(fieldId));
  } else if (setting.get(YjsDatabaseKey.field_id) !== fieldId) {
    updateTimelineLayoutSetting(view, { fieldId });
  }
}

/** Stable snapshots keep row updates from rebuilding timeline configuration consumers. */
export function createTimelineLayoutStore(
  databaseDoc: Y.Doc,
  viewId: string,
  firstDayOfWeek: number,
  use24Hour: boolean
) {
  const root = databaseDoc.getMap(YjsEditorKey.data_section);
  const read = () =>
    readTimelineLayoutSetting(
      root.get(YjsEditorKey.database) as YDatabase | undefined,
      viewId,
      firstDayOfWeek,
      use24Hour
    );
  let snapshot = read();
  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
  const getSnapshot = () => {
    const next = read();

    if (
      (Object.keys(next) as (keyof TimelineLayoutSetting)[]).some((key) =>
        key === 'tableFieldIds' ? !sameIds(next.tableFieldIds, snapshot.tableFieldIds) : next[key] !== snapshot[key]
      )
    )
      snapshot = next;
    return snapshot;
  };

  const subscribe = (notify: () => void) => {
    const observer: Parameters<typeof root.observeDeep>[0] = (events) => {
      // Observe ancestors too: an incoming update can insert or replace the view,
      // layout_settings, or timeline map instead of changing an existing key.
      const relevant = events.some((event) => {
        if (event.path.length === 0) return event.changes.keys.has(YjsEditorKey.database);
        if (event.path[0] !== YjsEditorKey.database) return false;
        const path = event.path.slice(1);

        if (path.length === 0) return event.changes.keys.has(YjsDatabaseKey.views);
        if (path[0] !== YjsDatabaseKey.views) return false;
        if (path.length === 1) return event.changes.keys.has(viewId);
        if (path[1] !== viewId) return false;
        if (path.length === 2) return event.changes.keys.has(YjsDatabaseKey.layout_settings);
        if (path[2] !== YjsDatabaseKey.layout_settings) return false;
        return path.length === 3 ? event.changes.keys.has(TIMELINE_LAYOUT_KEY) : path[3] === TIMELINE_LAYOUT_KEY;
      });

      if (relevant && getSnapshot() !== snapshotBeforeChange) {
        snapshotBeforeChange = snapshot;
        notify();
      }
    };

    let snapshotBeforeChange = getSnapshot();

    root.observeDeep(observer);
    return () => root.unobserveDeep(observer);
  };

  return { getSnapshot, subscribe };
}
