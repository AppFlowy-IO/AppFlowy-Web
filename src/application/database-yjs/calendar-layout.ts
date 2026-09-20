import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseCalendarLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { CalendarLayout, CalendarLayoutSetting } from './database.type';

function integer(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'bigint') return undefined;
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined;
}

/** Yrs integers arrive as BigInt, while Yjs clients can also encode numbers. */
export function readCalendarLayoutSetting(
  database: YDatabase | undefined,
  viewId: string,
  firstDayOfWeek: number,
  use24Hour: boolean
): CalendarLayoutSetting {
  const setting = database?.get(YjsDatabaseKey.views)?.get(viewId)?.get(YjsDatabaseKey.layout_settings)?.get('2');
  const storedLayout = integer(setting?.get(YjsDatabaseKey.layout_ty), 0, 2);
  const layout =
    storedLayout === CalendarLayout.WeekLayout || storedLayout === CalendarLayout.DayLayout
      ? storedLayout
      : CalendarLayout.MonthLayout;
  const count =
    integer(setting?.get(YjsDatabaseKey.day_count), 1, 8) ?? integer(setting?.get(YjsDatabaseKey.number_of_days), 1, 8);
  const weekday = integer(setting?.get(YjsDatabaseKey.first_day_of_week_v2), 0, 6) ?? integer(setting?.get(YjsDatabaseKey.first_day_of_week), 0, 6);

  return {
    fieldId: setting?.get(YjsDatabaseKey.field_id) ?? '',
    firstDayOfWeek: weekday ?? firstDayOfWeek,
    showWeekNumbers: Boolean(setting?.get(YjsDatabaseKey.show_week_numbers)),
    showWeekends: Boolean(setting?.get(YjsDatabaseKey.show_weekends)),
    layout,
    numberOfDays: layout === CalendarLayout.DayLayout ? 1 : layout === CalendarLayout.WeekLayout ? count ?? 7 : 7,
    use24Hour,
  };
}

export type CalendarLayoutUpdate = Partial<Omit<CalendarLayoutSetting, 'numberOfDays'>> & {
  numberOfDays?: number | null;
};

/** Patch the existing map so unrelated layout options survive concurrent edits. */
export function updateCalendarLayoutSetting(view: YDatabaseView, settings: CalendarLayoutUpdate) {
  let layouts = view.get(YjsDatabaseKey.layout_settings);

  if (!layouts) {
    layouts = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layouts);
  }

  let setting = layouts.get('2');

  if (!setting) {
    setting = new Y.Map() as YDatabaseCalendarLayoutSetting;
    layouts.set('2', setting);
  }

  if (settings.fieldId !== undefined) setting.set(YjsDatabaseKey.field_id, settings.fieldId);
  if (settings.firstDayOfWeek !== undefined) setting.set(YjsDatabaseKey.first_day_of_week_v2, settings.firstDayOfWeek);
  if (settings.showWeekNumbers !== undefined) setting.set(YjsDatabaseKey.show_week_numbers, settings.showWeekNumbers);
  if (settings.showWeekends !== undefined) setting.set(YjsDatabaseKey.show_weekends, settings.showWeekends);
  if (settings.layout !== undefined) setting.set(YjsDatabaseKey.layout_ty, settings.layout);
  if (settings.numberOfDays === null || settings.layout === CalendarLayout.MonthLayout) {
    setting.delete(YjsDatabaseKey.day_count);
    setting.delete(YjsDatabaseKey.number_of_days);
  } else if (settings.numberOfDays !== undefined) {
    setting.set(YjsDatabaseKey.day_count, settings.numberOfDays);
  }
}

/** Stable snapshots keep row updates from rebuilding calendar configuration consumers. */
export function createCalendarLayoutStore(
  databaseDoc: Y.Doc,
  viewId: string,
  firstDayOfWeek: number,
  use24Hour: boolean
) {
  const root = databaseDoc.getMap(YjsEditorKey.data_section);
  const read = () =>
    readCalendarLayoutSetting(
      root.get(YjsEditorKey.database) as YDatabase | undefined,
      viewId,
      firstDayOfWeek,
      use24Hour
    );
  let snapshot = read();
  const getSnapshot = () => {
    const next = read();

    if ((Object.keys(next) as (keyof CalendarLayoutSetting)[]).some((key) => next[key] !== snapshot[key]))
      snapshot = next;
    return snapshot;
  };

  const subscribe = (notify: () => void) => {
    const observer: Parameters<typeof root.observeDeep>[0] = (events) => {
      // Observe ancestors too: an incoming update can insert or replace the view,
      // layout_settings, or calendar map instead of changing an existing key.
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
        return path.length === 3 ? event.changes.keys.has('2') : path[3] === '2';
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
