import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseDashboardLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardGlobalFilter,
  DashboardLayoutSetting,
  DashboardLayoutUpdate,
  DashboardRow,
  DashboardWidget,
  DashboardWidgetPlacement,
} from './dashboard.type';
import { FieldType } from './database.type';

const EMPTY_ROWS: DashboardRow[] = [];
const EMPTY_FILTERS: DashboardGlobalFilter[] = [];
// Plain values keep their identity until the key is rewritten, so parsed
// results can be cached per stored value (same trick as the timeline links).
const parsedRows = new WeakMap<object, DashboardRow[]>();
const parsedFilters = new WeakMap<object, DashboardGlobalFilter[]>();

export const DEFAULT_DASHBOARD_LAYOUT_SETTING: DashboardLayoutSetting = {
  rows: EMPTY_ROWS,
  globalFilters: EMPTY_FILTERS,
  showWidgetTitles: true,
};

export function generateDashboardId(prefix: 'w' | 'r' | 'gf') {
  return `${prefix}:${nanoid(8)}`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' && typeof value !== 'bigint') return fallback;
  const number = Math.round(Number(value));

  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toPlain(value: unknown): unknown {
  if (value instanceof Y.Array || value instanceof Y.Map) return value.toJSON();
  return value;
}

/**
 * Distribute `DASHBOARD_GRID_COLUMNS` across the widgets of a row, keeping the
 * stored proportions and giving any remainder to the last widget. A row with
 * no widths (or invalid ones) becomes an equal split.
 */
export function balanceRowWidths(widgets: DashboardWidget[]): DashboardWidget[] {
  const count = widgets.length;

  if (count === 0) return widgets;
  const raw = widgets.map((widget) => (Number.isFinite(widget.width) && widget.width > 0 ? widget.width : 0));
  const total = raw.reduce((sum, width) => sum + width, 0);
  const shares =
    total === 0
      ? widgets.map(() => DASHBOARD_GRID_COLUMNS / count)
      : raw.map((width) => (width / total) * DASHBOARD_GRID_COLUMNS);
  const widths = shares.map((share) => Math.max(1, Math.floor(share)));
  let used = widths.reduce((sum, width) => sum + width, 0);

  // Hand out or take back columns one at a time, largest fractional part first.
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction)
    .map((entry) => entry.index);
  let cursor = 0;

  while (used < DASHBOARD_GRID_COLUMNS) {
    widths[order[cursor % count]] += 1;
    used += 1;
    cursor += 1;
  }

  cursor = count - 1;
  while (used > DASHBOARD_GRID_COLUMNS) {
    const index = order[cursor % count];

    if (widths[index] > 1) {
      widths[index] -= 1;
      used -= 1;
    }

    cursor -= 1;
    if (cursor < 0) cursor = count - 1;
  }

  return widgets.map((widget, index) => (widget.width === widths[index] ? widget : { ...widget, width: widths[index] }));
}

/**
 * Enforce the dashboard invariants on a row list: no empty rows, at most four
 * widgets per row, widths summing to twelve, valid heights, and at most twelve
 * widgets overall (extra widgets are dropped from the end).
 */
export function normalizeDashboardRows(rows: DashboardRow[]): DashboardRow[] {
  const result: DashboardRow[] = [];
  let remaining = DASHBOARD_MAX_WIDGETS;

  rows.forEach((row) => {
    const widgets: DashboardWidget[] = [];

    row.widgets.forEach((widget) => {
      if (remaining <= 0) return;
      widgets.push(widget);
      remaining -= 1;
    });

    // Overflowing rows spill into new rows instead of losing widgets. Spill
    // ids derive from the row id so re-reading the same value yields the same
    // rows (snapshot stores compare ids).
    for (let start = 0; start < widgets.length; start += DASHBOARD_MAX_WIDGETS_PER_ROW) {
      const chunk = widgets.slice(start, start + DASHBOARD_MAX_WIDGETS_PER_ROW);
      const chunkIndex = start / DASHBOARD_MAX_WIDGETS_PER_ROW;

      result.push({
        id: chunkIndex === 0 ? row.id : `${row.id}:${chunkIndex}`,
        height: clampInteger(
          row.height,
          DASHBOARD_MIN_ROW_HEIGHT,
          DASHBOARD_MAX_ROW_HEIGHT,
          DASHBOARD_DEFAULT_ROW_HEIGHT
        ),
        widgets: balanceRowWidths(chunk),
      });
    }
  });

  return result;
}

function parseRows(value: unknown): DashboardRow[] {
  const raw = toPlain(value);

  if (!Array.isArray(raw)) return EMPTY_ROWS;
  const cached = parsedRows.get(raw);

  if (cached) return cached;
  const rows: DashboardRow[] = [];

  // Entries without an id get a positional fallback id, never a random one: a
  // Y.Array value is re-read (and re-parsed) on every snapshot read, and random
  // ids would make every read look like a layout change.
  raw.forEach((item, rowIndex) => {
    if (!item || typeof item !== 'object') return;
    const record = item as { id?: unknown; height?: unknown; widgets?: unknown };
    const widgetsRaw = Array.isArray(record.widgets) ? record.widgets : [];
    const widgets: DashboardWidget[] = [];

    widgetsRaw.forEach((widgetRaw, index) => {
      if (!widgetRaw || typeof widgetRaw !== 'object') return;
      const widget = widgetRaw as { id?: unknown; view_id?: unknown; database_id?: unknown; width?: unknown };
      const viewId = nonEmptyString(widget.view_id);
      const databaseId = nonEmptyString(widget.database_id);

      if (!viewId || !databaseId) return;
      widgets.push({
        id: nonEmptyString(widget.id) ?? `w:${rowIndex}:${index}`,
        viewId,
        databaseId,
        width: clampInteger(widget.width, 1, DASHBOARD_GRID_COLUMNS, 0),
      });
    });

    rows.push({
      id: nonEmptyString(record.id) ?? `r:${rowIndex}`,
      height: clampInteger(
        record.height,
        DASHBOARD_MIN_ROW_HEIGHT,
        DASHBOARD_MAX_ROW_HEIGHT,
        DASHBOARD_DEFAULT_ROW_HEIGHT
      ),
      widgets,
    });
  });

  const normalized = normalizeDashboardRows(rows);
  const stable = normalized.length === 0 ? EMPTY_ROWS : normalized;

  parsedRows.set(raw, stable);
  return stable;
}

/**
 * A global filter's `targets` in their stored order. The first mapping is the
 * primary one (select content refers to its options), but `targets` is a JSON
 * object, which Yrs decodes into a hash map and re-encodes in arbitrary key
 * order. The order therefore lives in the `target_order` array; mappings it
 * does not list (older data) follow in sorted order so every client agrees.
 */
function parseGlobalFilterTargets(targetsValue: unknown, orderValue: unknown): Record<string, string> {
  const targetsRaw = toPlain(targetsValue);
  const entries = new Map<string, string>();

  if (targetsRaw && typeof targetsRaw === 'object' && !Array.isArray(targetsRaw)) {
    Object.entries(targetsRaw as Record<string, unknown>).forEach(([databaseId, fieldId]) => {
      const id = nonEmptyString(fieldId);

      if (databaseId && id) entries.set(databaseId, id);
    });
  }

  const orderRaw = toPlain(orderValue);
  const listed = Array.isArray(orderRaw)
    ? orderRaw.filter((databaseId): databaseId is string => typeof databaseId === 'string' && entries.has(databaseId))
    : [];
  const ordered = [...new Set(listed)];
  const listedSet = new Set(ordered);
  const rest = [...entries.keys()].filter((databaseId) => !listedSet.has(databaseId)).sort();
  const targets: Record<string, string> = {};

  [...ordered, ...rest].forEach((databaseId) => {
    targets[databaseId] = entries.get(databaseId) as string;
  });
  return targets;
}

function parseGlobalFilters(value: unknown): DashboardGlobalFilter[] {
  const raw = toPlain(value);

  if (!Array.isArray(raw)) return EMPTY_FILTERS;
  const cached = parsedFilters.get(raw);

  if (cached) return cached;
  const filters: DashboardGlobalFilter[] = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as {
      id?: unknown;
      name?: unknown;
      ty?: unknown;
      condition?: unknown;
      content?: unknown;
      targets?: unknown;
      target_order?: unknown;
    };
    const fieldType = clampInteger(record.ty, 0, 1000, -1);

    if (fieldType < 0) return;

    filters.push({
      // Positional, like the row fallback ids (see `parseRows`).
      id: nonEmptyString(record.id) ?? `gf:${index}`,
      name: typeof record.name === 'string' ? record.name : '',
      fieldType: fieldType as FieldType,
      condition: clampInteger(record.condition, 0, 1000, 0),
      content: typeof record.content === 'string' ? record.content : '',
      targets: parseGlobalFilterTargets(record.targets, record.target_order),
    });
  });

  const stable = filters.length === 0 ? EMPTY_FILTERS : filters;

  parsedFilters.set(raw, stable);
  return stable;
}

export function readDashboardLayoutSetting(database: YDatabase | undefined, viewId: string): DashboardLayoutSetting {
  const setting = database
    ?.get(YjsDatabaseKey.views)
    ?.get(viewId)
    ?.get(YjsDatabaseKey.layout_settings)
    ?.get(DASHBOARD_LAYOUT_KEY);

  if (!setting) return DEFAULT_DASHBOARD_LAYOUT_SETTING;
  const showWidgetTitles = setting.get(YjsDatabaseKey.show_widget_titles);

  return {
    rows: parseRows(setting.get(YjsDatabaseKey.dashboard_rows)),
    globalFilters: parseGlobalFilters(setting.get(YjsDatabaseKey.dashboard_global_filters)),
    showWidgetTitles: typeof showWidgetTitles === 'boolean' ? showWidgetTitles : true,
  };
}

/** Serialize rows in the persisted snake_case shape. */
export function serializeDashboardRows(rows: DashboardRow[]) {
  return rows.map((row) => ({
    id: row.id,
    height: row.height,
    widgets: row.widgets.map((widget) => ({
      id: widget.id,
      view_id: widget.viewId,
      database_id: widget.databaseId,
      width: widget.width,
    })),
  }));
}

export function serializeDashboardGlobalFilters(filters: DashboardGlobalFilter[]) {
  return filters.map((filter) => ({
    id: filter.id,
    name: filter.name,
    ty: filter.fieldType,
    condition: filter.condition,
    content: filter.content,
    targets: { ...filter.targets },
    // Arrays keep their order through Yrs; the object above does not.
    target_order: Object.keys(filter.targets),
  }));
}

function getOrCreateDashboardLayoutSetting(view: YDatabaseView): YDatabaseDashboardLayoutSetting {
  let layouts = view.get(YjsDatabaseKey.layout_settings);

  if (!layouts) {
    layouts = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layouts);
  }

  let setting = layouts.get(DASHBOARD_LAYOUT_KEY);

  if (!setting) {
    setting = new Y.Map() as YDatabaseDashboardLayoutSetting;
    layouts.set(DASHBOARD_LAYOUT_KEY, setting);
  }

  return setting;
}

/**
 * Patch the dashboard setting. Rows and global filters are whole-value writes
 * (last writer wins for concurrent layout edits, which Notion also serializes
 * behind its Edit mode); `showWidgetTitles` is a separate key.
 */
export function updateDashboardLayoutSetting(view: YDatabaseView, update: DashboardLayoutUpdate) {
  const setting = getOrCreateDashboardLayoutSetting(view);

  if (update.rows !== undefined) {
    setting.set(YjsDatabaseKey.dashboard_rows, serializeDashboardRows(normalizeDashboardRows(update.rows)));
  }

  if (update.globalFilters !== undefined) {
    setting.set(YjsDatabaseKey.dashboard_global_filters, serializeDashboardGlobalFilters(update.globalFilters));
  }

  if (update.showWidgetTitles !== undefined) {
    setting.set(YjsDatabaseKey.show_widget_titles, update.showWidgetTitles);
  }
}

/** Ensure the view carries an (empty) dashboard setting so readers see a stable shape. */
export function initializeDashboardLayoutSetting(view: YDatabaseView) {
  const setting = getOrCreateDashboardLayoutSetting(view);

  if (setting.get(YjsDatabaseKey.dashboard_rows) === undefined) setting.set(YjsDatabaseKey.dashboard_rows, []);
  if (setting.get(YjsDatabaseKey.dashboard_global_filters) === undefined)
    setting.set(YjsDatabaseKey.dashboard_global_filters, []);
}

function sameWidget(a: DashboardWidget, b: DashboardWidget) {
  return a.id === b.id && a.viewId === b.viewId && a.databaseId === b.databaseId && a.width === b.width;
}

function sameWidgets(a: DashboardWidget[], b: DashboardWidget[]) {
  return a.length === b.length && a.every((widget, index) => sameWidget(widget, b[index]));
}

export function sameDashboardRows(a: DashboardRow[], b: DashboardRow[]) {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (row, index) =>
          row.id === b[index].id && row.height === b[index].height && sameWidgets(row.widgets, b[index].widgets)
      ))
  );
}

function sameGlobalFilterTargets(a: Record<string, string>, b: Record<string, string>) {
  if (a === b) return true;
  const keys = Object.keys(a);
  const otherKeys = Object.keys(b);

  // Order matters: the first mapping is the primary one.
  return keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && a[key] === b[key]);
}

function sameGlobalFilter(a: DashboardGlobalFilter, b: DashboardGlobalFilter) {
  return (
    a === b ||
    (a.id === b.id &&
      a.name === b.name &&
      a.fieldType === b.fieldType &&
      a.condition === b.condition &&
      a.content === b.content &&
      sameGlobalFilterTargets(a.targets, b.targets))
  );
}

export function sameDashboardGlobalFilters(a: DashboardGlobalFilter[], b: DashboardGlobalFilter[]) {
  return a === b || (a.length === b.length && a.every((filter, index) => sameGlobalFilter(filter, b[index])));
}

/**
 * `next`, reusing every row and widget of `previous` that did not change, so
 * memoized rows and widgets skip the render when another part of the layout
 * changes.
 */
export function shareDashboardRows(previous: DashboardRow[], next: DashboardRow[]): DashboardRow[] {
  if (sameDashboardRows(previous, next)) return previous;
  const previousRows = new Map(previous.map((row): [string, DashboardRow] => [row.id, row]));
  const previousWidgets = new Map(
    previous.flatMap((row) => row.widgets.map((widget): [string, DashboardWidget] => [widget.id, widget]))
  );

  return next.map((row) => {
    const widgets = row.widgets.map((widget) => {
      const kept = previousWidgets.get(widget.id);

      return kept && sameWidget(kept, widget) ? kept : widget;
    });
    const kept = previousRows.get(row.id);

    if (kept && kept.height === row.height && sameWidgets(kept.widgets, widgets)) return kept;
    return widgets.every((widget, index) => widget === row.widgets[index]) ? row : { ...row, widgets };
  });
}

/** `next`, reusing every unchanged filter (and unchanged `targets`) of `previous`. */
export function shareDashboardGlobalFilters(
  previous: DashboardGlobalFilter[],
  next: DashboardGlobalFilter[]
): DashboardGlobalFilter[] {
  if (sameDashboardGlobalFilters(previous, next)) return previous;
  const previousFilters = new Map(previous.map((filter): [string, DashboardGlobalFilter] => [filter.id, filter]));

  return next.map((filter) => {
    const kept = previousFilters.get(filter.id);

    if (!kept) return filter;
    if (sameGlobalFilter(kept, filter)) return kept;
    return kept.targets !== filter.targets && sameGlobalFilterTargets(kept.targets, filter.targets)
      ? { ...filter, targets: kept.targets }
      : filter;
  });
}

/** Stable snapshots keep row updates from rebuilding dashboard consumers. */
export function createDashboardLayoutStore(databaseDoc: Y.Doc, viewId: string) {
  const root = databaseDoc.getMap(YjsEditorKey.data_section);
  const read = () => readDashboardLayoutSetting(root.get(YjsEditorKey.database) as YDatabase | undefined, viewId);
  let snapshot = read();
  const getSnapshot = () => {
    const next = read();

    if (
      !sameDashboardRows(next.rows, snapshot.rows) ||
      !sameDashboardGlobalFilters(next.globalFilters, snapshot.globalFilters) ||
      next.showWidgetTitles !== snapshot.showWidgetTitles
    ) {
      snapshot = {
        rows: shareDashboardRows(snapshot.rows, next.rows),
        globalFilters: shareDashboardGlobalFilters(snapshot.globalFilters, next.globalFilters),
        showWidgetTitles: next.showWidgetTitles,
      };
    }

    return snapshot;
  };

  const subscribe = (notify: () => void) => {
    const observer: Parameters<typeof root.observeDeep>[0] = (events) => {
      // Observe ancestors too: an incoming update can insert or replace the view,
      // layout_settings, or dashboard map instead of changing an existing key.
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
        return path.length === 3 ? event.changes.keys.has(DASHBOARD_LAYOUT_KEY) : path[3] === DASHBOARD_LAYOUT_KEY;
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

// ---------------------------------------------------------------------------
// Pure layout operations. Each returns a new, normalized row list and never
// mutates its input, so callers can diff against the current snapshot.
// ---------------------------------------------------------------------------

export function countDashboardWidgets(rows: DashboardRow[]) {
  return rows.reduce((sum, row) => sum + row.widgets.length, 0);
}

export function findDashboardWidget(rows: DashboardRow[], widgetId: string) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const index = rows[rowIndex].widgets.findIndex((widget) => widget.id === widgetId);

    if (index !== -1) return { rowIndex, index, row: rows[rowIndex], widget: rows[rowIndex].widgets[index] };
  }

  return null;
}

export function canAddDashboardWidget(rows: DashboardRow[], placement?: DashboardWidgetPlacement) {
  if (countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS) return false;
  if (placement?.type === 'existing_row') {
    const row = rows.find((candidate) => candidate.id === placement.rowId);

    return Boolean(row) && (row?.widgets.length ?? 0) < DASHBOARD_MAX_WIDGETS_PER_ROW;
  }

  return true;
}

export function createDashboardWidget(
  viewId: string,
  databaseId: string,
  width = DASHBOARD_GRID_COLUMNS
): DashboardWidget {
  return { id: generateDashboardId('w'), viewId, databaseId, width };
}

export function createDashboardRow(widgets: DashboardWidget[], height = DASHBOARD_DEFAULT_ROW_HEIGHT): DashboardRow {
  return { id: generateDashboardId('r'), height, widgets: balanceRowWidths(widgets) };
}

/**
 * Width a widget must carry into `row` so that, once the row is rebalanced, it
 * holds an equal share (`1 / (n + 1)`: 1 → 2 widgets is 6 / 6, 2 → 3 is
 * 4 / 4 / 4) while the widgets already there keep their proportions.
 */
export function getDashboardJoinWidth(row: DashboardRow) {
  const count = row.widgets.length;

  if (count === 0) return DASHBOARD_GRID_COLUMNS;
  const total = row.widgets.reduce((sum, widget) => sum + (Number.isFinite(widget.width) ? widget.width : 0), 0);

  return Math.max(1, Math.round((total > 0 ? total : DASHBOARD_GRID_COLUMNS) / count));
}

/**
 * Add a widget; returns the unchanged rows when the limits refuse it. A widget
 * joining a row gets an equal share of it (see `getDashboardJoinWidth`).
 */
export function addDashboardWidget(
  rows: DashboardRow[],
  widget: DashboardWidget,
  placement: DashboardWidgetPlacement = { type: 'new_row' }
): DashboardRow[] {
  if (!canAddDashboardWidget(rows, placement)) return rows;

  if (placement.type === 'existing_row') {
    return normalizeDashboardRows(
      rows.map((row) => {
        if (row.id !== placement.rowId) return row;
        const widgets = [...row.widgets];
        const index = placement.index === undefined ? widgets.length : Math.min(placement.index, widgets.length);

        widgets.splice(index, 0, { ...widget, width: getDashboardJoinWidth(row) });
        return { ...row, widgets: balanceRowWidths(widgets) };
      })
    );
  }

  const next = [...rows];
  const row = createDashboardRow([{ ...widget, width: DASHBOARD_GRID_COLUMNS }]);
  const rowIndex = placement.rowIndex === undefined ? next.length : Math.min(placement.rowIndex, next.length);

  next.splice(rowIndex, 0, row);
  return normalizeDashboardRows(next);
}

export function removeDashboardWidget(rows: DashboardRow[], widgetId: string): DashboardRow[] {
  return normalizeDashboardRows(
    rows.map((row) => {
      if (!row.widgets.some((widget) => widget.id === widgetId)) return row;
      return { ...row, widgets: balanceRowWidths(row.widgets.filter((widget) => widget.id !== widgetId)) };
    })
  );
}

/**
 * Duplicate a widget next to its source. When the row is full the copy starts
 * a new row directly below; when the dashboard is full nothing changes.
 */
export function duplicateDashboardWidget(rows: DashboardRow[], widgetId: string): DashboardRow[] {
  const location = findDashboardWidget(rows, widgetId);

  if (!location || countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS) return rows;
  const copy: DashboardWidget = { ...location.widget, id: generateDashboardId('w') };

  if (location.row.widgets.length < DASHBOARD_MAX_WIDGETS_PER_ROW) {
    return addDashboardWidget(rows, copy, { type: 'existing_row', rowId: location.row.id, index: location.index + 1 });
  }

  return addDashboardWidget(rows, copy, { type: 'new_row', rowIndex: location.rowIndex + 1 });
}

/**
 * Move a widget to a new position. Moving into a full row is refused unless
 * the widget already lives in that row (a reorder). A widget joining another
 * row gets an equal share of it; a reorder inside a row keeps every width.
 * Rows left empty vanish.
 */
export function moveDashboardWidget(
  rows: DashboardRow[],
  widgetId: string,
  placement: DashboardWidgetPlacement
): DashboardRow[] {
  const location = findDashboardWidget(rows, widgetId);

  if (!location) return rows;
  const { widget } = location;
  const withoutWidget = rows.map((row) =>
    row.id === location.row.id ? { ...row, widgets: row.widgets.filter((item) => item.id !== widgetId) } : row
  );

  if (placement.type === 'existing_row') {
    const target = withoutWidget.find((row) => row.id === placement.rowId);

    if (!target || target.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW) return rows;
    const moving = target.id === location.row.id ? widget : { ...widget, width: getDashboardJoinWidth(target) };
    const next = withoutWidget.map((row) => {
      if (row.id !== placement.rowId) return row;
      const widgets = [...row.widgets];
      const index = placement.index === undefined ? widgets.length : Math.min(placement.index, widgets.length);

      widgets.splice(index, 0, moving);
      return { ...row, widgets: balanceRowWidths(widgets) };
    });

    return normalizeDashboardRows(next.filter((row) => row.widgets.length > 0));
  }

  // A new row: the index is expressed against the row list before the source
  // row (if now empty) disappears, so compute it on the pruned list.
  const pruned = withoutWidget.filter((row) => row.widgets.length > 0);
  let rowIndex = placement.rowIndex === undefined ? pruned.length : placement.rowIndex;

  if (placement.rowIndex !== undefined && location.row.widgets.length === 1 && location.rowIndex < placement.rowIndex) {
    rowIndex -= 1;
  }

  rowIndex = Math.max(0, Math.min(rowIndex, pruned.length));
  const next = [...pruned];

  next.splice(rowIndex, 0, createDashboardRow([{ ...widget, width: DASHBOARD_GRID_COLUMNS }], location.row.height));
  return normalizeDashboardRows(next);
}

/**
 * Give `delta` columns to the widget at `index` and take them from its right
 * neighbour (negative deltas do the reverse). Both widgets keep at least one
 * column, so the row still sums to twelve.
 */
export function resizeDashboardWidget(
  rows: DashboardRow[],
  rowId: string,
  index: number,
  delta: number
): DashboardRow[] {
  if (delta === 0) return rows;

  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const left = row.widgets[index];
    const right = row.widgets[index + 1];

    if (!left || !right) return row;
    const applied = Math.max(1 - left.width, Math.min(right.width - 1, delta));

    if (applied === 0) return row;
    const widgets = row.widgets.map((widget, widgetIndex) =>
      widgetIndex === index
        ? { ...widget, width: widget.width + applied }
        : widgetIndex === index + 1
        ? { ...widget, width: widget.width - applied }
        : widget
    );

    return { ...row, widgets };
  });
}

export function setDashboardRowHeight(rows: DashboardRow[], rowId: string, height: number): DashboardRow[] {
  const clamped = clampInteger(height, DASHBOARD_MIN_ROW_HEIGHT, DASHBOARD_MAX_ROW_HEIGHT, DASHBOARD_DEFAULT_ROW_HEIGHT);

  return rows.map((row) => (row.id === rowId && row.height !== clamped ? { ...row, height: clamped } : row));
}

export function moveDashboardRow(rows: DashboardRow[], rowId: string, toIndex: number): DashboardRow[] {
  const fromIndex = rows.findIndex((row) => row.id === rowId);

  if (fromIndex === -1) return rows;
  const target = Math.max(0, Math.min(toIndex, rows.length - 1));

  if (target === fromIndex) return rows;
  const next = [...rows];
  const [row] = next.splice(fromIndex, 1);

  next.splice(target, 0, row);
  return next;
}

/** Replace the view a widget shows (used by "Change view"). */
export function replaceDashboardWidgetView(
  rows: DashboardRow[],
  widgetId: string,
  viewId: string,
  databaseId: string
): DashboardRow[] {
  return rows.map((row) => {
    if (!row.widgets.some((widget) => widget.id === widgetId)) return row;
    return {
      ...row,
      widgets: row.widgets.map((widget) => (widget.id === widgetId ? { ...widget, viewId, databaseId } : widget)),
    };
  });
}

/** Database ids referenced by the dashboard, host first when present. */
export function dashboardSourceDatabaseIds(rows: DashboardRow[], hostDatabaseId?: string) {
  const ids = new Set<string>();

  if (hostDatabaseId) ids.add(hostDatabaseId);
  rows.forEach((row) => row.widgets.forEach((widget) => ids.add(widget.databaseId)));
  return [...ids];
}
