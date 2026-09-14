import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseLayoutSettings,
  YDatabaseTimelineLayoutSetting,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  TimelineDependencyDirection,
  TimelineDependencyLink,
  TimelineDependencyShift,
  TimelineDependencyType,
  TimelineLayout,
  TimelineLayoutSetting,
} from './database.type';

/** Layout-settings key for `DatabaseViewLayout.Timeline`. */
export const TIMELINE_LAYOUT_KEY = '8';

export const DEFAULT_TIMELINE_LAYOUT = TimelineLayout.Month;
export const DEFAULT_TIMELINE_SHOW_TABLE = true;
export const DEFAULT_TIMELINE_DEPENDENCY_SHIFT = TimelineDependencyShift.OverlapOnly;

const EMPTY_IDS: string[] = [];
const EMPTY_LINKS: Record<string, TimelineDependencyLink> = {};
// `getSnapshot` re-reads the setting on every subscriber render. Yjs hands the
// same object back until the key is rewritten, so parse each stored value once.
const parsedLinks = new WeakMap<object, Record<string, TimelineDependencyLink>>();
const parsedIds = new WeakMap<object, string[]>();

/**
 * Per-link metadata as stored (a plain map of `{ ty, lag }` records). Unknown
 * types fall back to finish-to-start and lag is clamped to whole days.
 */
function linkMap(value: unknown): Record<string, TimelineDependencyLink> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_LINKS;
  const cached = parsedLinks.get(value);

  if (cached) return cached;
  const result: Record<string, TimelineDependencyLink> = {};

  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const record = raw as { ty?: unknown; lag?: unknown };
    const type = integer(record.ty, TimelineDependencyType.FinishToStart, TimelineDependencyType.StartToFinish);
    const lag = typeof record.lag === 'number' || typeof record.lag === 'bigint' ? Math.trunc(Number(record.lag)) : 0;

    result[key] = { type: type ?? TimelineDependencyType.FinishToStart, lag: Number.isFinite(lag) ? lag : 0 };
  });

  const links = Object.keys(result).length === 0 ? EMPTY_LINKS : result;

  parsedLinks.set(value, links);
  return links;
}

function sameLinks(a: Record<string, TimelineDependencyLink>, b: Record<string, TimelineDependencyLink>) {
  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => b[key] !== undefined && a[key].type === b[key].type && a[key].lag === b[key].lag)
  );
}

/** A plain array of ids as Yjs / Yrs hand it back, or nothing. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return EMPTY_IDS;
  const cached = parsedIds.get(value);

  if (cached) return cached;
  const filtered = value.filter((id): id is string => typeof id === 'string' && id !== '');
  const ids = filtered.length === 0 ? EMPTY_IDS : filtered;

  parsedIds.set(value, ids);
  return ids;
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
  const dependencyDirection = integer(
    setting?.get(YjsDatabaseKey.dependency_direction),
    TimelineDependencyDirection.BlockedBy,
    TimelineDependencyDirection.Blocking
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
    dependencyDirection: dependencyDirection ?? TimelineDependencyDirection.BlockedBy,
    dependencyLinks: linkMap(setting?.get(YjsDatabaseKey.dependency_links)),
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
  if (settings.dependencyDirection !== undefined) {
    setting.set(YjsDatabaseKey.dependency_direction, settings.dependencyDirection);
  }

  if (settings.dependencyLinks !== undefined) {
    // Stored as a plain map so Yrs reads it as nested `Any` maps; finish-to-start
    // links with no lag are the default and need no entry.
    const entries = Object.entries(settings.dependencyLinks).filter(
      ([, link]) => link.type !== TimelineDependencyType.FinishToStart || link.lag !== 0
    );

    if (entries.length > 0) {
      setting.set(
        YjsDatabaseKey.dependency_links,
        Object.fromEntries(entries.map(([key, link]) => [key, { ty: link.type, lag: link.lag }]))
      );
    } else {
      setting.delete(YjsDatabaseKey.dependency_links);
    }
  }

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
        key === 'tableFieldIds'
          ? !sameIds(next.tableFieldIds, snapshot.tableFieldIds)
          : key === 'dependencyLinks'
          ? !sameLinks(next.dependencyLinks, snapshot.dependencyLinks)
          : next[key] !== snapshot[key]
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
