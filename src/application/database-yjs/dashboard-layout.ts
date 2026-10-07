import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseDashboardLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  EMPTY_DASHBOARD_GLOBAL_FILTERS,
  parseDashboardGlobalFilters,
  sameDashboardGlobalFilters,
  serializeDashboardGlobalFilters,
  shareDashboardGlobalFilters,
} from './dashboard-global-filters';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardAddControlState,
  DashboardDropIndicator,
  DashboardDropTarget,
  DashboardLayoutSetting,
  DashboardLayoutUpdate,
  DashboardMoveFeedback,
  DashboardRow,
  DashboardRowControls,
  DashboardWidget,
  DashboardWidgetPlacement,
} from './dashboard.type';
import { clampInteger, isPlainRecord, nonEmptyString, pickUnknownKeys, readBoolean, toPlainValue } from './layout-codec';

// The global-filter codec lives in `dashboard-global-filters.ts`.
export {
  indexGlobalFilterExtras,
  sameDashboardGlobalFilters,
  serializeDashboardGlobalFilters,
  shareDashboardGlobalFilters,
} from './dashboard-global-filters';

const EMPTY_ROWS: DashboardRow[] = [];
// Plain values keep their identity until the key is rewritten, so parsed
// results can be cached per stored value (same trick as the timeline links).
const parsedRows = new WeakMap<object, DashboardRow[]>();

/**
 * The keys this client writes on a stored row / widget. Any other key belongs
 * to another (newer) client and is carried over by id (ARCHITECTURE §3.1.4); a
 * key in these sets always comes from the writer. Same sets as Rust
 * `ROW_KNOWN_KEYS` / `WIDGET_KNOWN_KEYS`.
 */
const DASHBOARD_ROW_KEYS: ReadonlySet<string> = new Set(['id', 'height', 'widgets']);
const DASHBOARD_WIDGET_KEYS: ReadonlySet<string> = new Set(['id', 'view_id', 'database_id', 'width']);

export const DEFAULT_DASHBOARD_LAYOUT_SETTING: DashboardLayoutSetting = {
  rows: EMPTY_ROWS,
  globalFilters: EMPTY_DASHBOARD_GLOBAL_FILTERS,
  showWidgetTitles: true,
  showIconsInHeading: false,
};

type DashboardFlag = 'showWidgetTitles' | 'showIconsInHeading';

const DASHBOARD_FLAG_KEYS = {
  showWidgetTitles: YjsDatabaseKey.show_widget_titles,
  showIconsInHeading: YjsDatabaseKey.show_icons_in_heading,
} as const;

/** A boolean setting: absent or of another type reads as its default (ARCHITECTURE §3.1.2). */
function readFlag(setting: YDatabaseDashboardLayoutSetting, flag: DashboardFlag): boolean {
  return readBoolean(setting.get(DASHBOARD_FLAG_KEYS[flag]), DEFAULT_DASHBOARD_LAYOUT_SETTING[flag]);
}

/** Write a boolean setting unless it already reads as `value`. */
function writeFlag(setting: YDatabaseDashboardLayoutSetting, flag: DashboardFlag, value: boolean) {
  if (readFlag(setting, flag) !== value) setting.set(DASHBOARD_FLAG_KEYS[flag], value);
}

/**
 * Transaction origins of the dashboard setting writes that are not undo steps
 * (the history tracks no string origin). They only label the write.
 */
export const DASHBOARD_LAYOUT_ORIGIN = {
  /** The empty setting of a new dashboard, or the first widget of a converted view. */
  seed: 'initializeDashboardLayout',
  /** A duplicate taking over its source's whole setting. */
  copy: 'copyDashboardLayout',
  /** A failed conversion taking its seed back. */
  rollback: 'rollbackDashboardLayout',
} as const;

export function generateDashboardId(prefix: 'w' | 'r' | 'gf') {
  return `${prefix}:${nanoid(8)}`;
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
 * widgets overall (extra widgets are left out from the end). A stored layout
 * over the limit keeps its extra widgets in storage: see `overflowStoredRows`.
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

/** The effective id of the stored row at `rowIndex` (positional when it stores none). */
function storedRowId(row: { id?: unknown }, rowIndex: number) {
  return nonEmptyString(row.id) ?? `r:${rowIndex}`;
}

/** The effective id of the stored widget at `index` of the row at `rowIndex`. */
function storedWidgetId(widget: { id?: unknown }, rowIndex: number, index: number) {
  return nonEmptyString(widget.id) ?? `w:${rowIndex}:${index}`;
}

/** A stored widget every client reads: an object with a view and a database. */
function isStoredWidget(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && Boolean(nonEmptyString(value.view_id)) && Boolean(nonEmptyString(value.database_id));
}

/**
 * Every valid stored row and widget, before the limits apply. Entries without
 * an id get a positional fallback id, never a random one: a Y.Array value is
 * re-read (and re-parsed) on every snapshot read, and random ids would make
 * every read look like a layout change.
 */
function parseStoredRows(raw: unknown[]): DashboardRow[] {
  const rows: DashboardRow[] = [];

  raw.forEach((item, rowIndex) => {
    if (!item || typeof item !== 'object') return;
    const record = item as { id?: unknown; height?: unknown; widgets?: unknown };
    const widgetsRaw = Array.isArray(record.widgets) ? record.widgets : [];
    const widgets: DashboardWidget[] = [];

    widgetsRaw.forEach((widget, index) => {
      if (!isStoredWidget(widget)) return;
      widgets.push({
        id: storedWidgetId(widget, rowIndex, index),
        viewId: widget.view_id as string,
        databaseId: widget.database_id as string,
        width: clampInteger(widget.width, 1, DASHBOARD_GRID_COLUMNS, 0),
      });
    });

    rows.push({
      id: storedRowId(record, rowIndex),
      height: clampInteger(
        record.height,
        DASHBOARD_MIN_ROW_HEIGHT,
        DASHBOARD_MAX_ROW_HEIGHT,
        DASHBOARD_DEFAULT_ROW_HEIGHT
      ),
      widgets,
    });
  });
  return rows;
}

function parseRows(value: unknown): DashboardRow[] {
  const raw = toPlainValue(value);

  if (!Array.isArray(raw)) return EMPTY_ROWS;
  const cached = parsedRows.get(raw);

  if (cached) return cached;
  const normalized = normalizeDashboardRows(parseStoredRows(raw));
  const stable = normalized.length === 0 ? EMPTY_ROWS : normalized;

  parsedRows.set(raw, stable);
  return stable;
}

/**
 * The stored rows that hold the widgets beyond `DASHBOARD_MAX_WIDGETS`, for a
 * layout another client wrote over the limit. `parseRows` shows the first
 * twelve widgets; a rewrite of `rows` appends these after the shown rows, so
 * the extra widgets stay in storage and show up again once there is room.
 *
 * Each entry is the stored object (unknown keys included) with only its hidden
 * widgets. Ids are written out, because a positional fallback id would change
 * with the row's new position. The hidden rest of a row that is partly shown
 * gets its own id, unique among `shownRowIds`.
 */
function overflowStoredRows(stored: unknown, shownRowIds: Iterable<string>): Record<string, unknown>[] {
  const raw = toPlainValue(stored);

  if (!Array.isArray(raw)) return [];
  const usedRowIds = new Set(shownRowIds);
  const overflow: Record<string, unknown>[] = [];
  let remaining = DASHBOARD_MAX_WIDGETS;

  raw.forEach((row, rowIndex) => {
    if (!isPlainRecord(row) || !Array.isArray(row.widgets)) return;
    const hidden: Record<string, unknown>[] = [];

    row.widgets.forEach((widget, index) => {
      if (!isStoredWidget(widget)) return;

      if (remaining > 0) {
        remaining -= 1;
        return;
      }

      hidden.push({ ...widget, id: storedWidgetId(widget, rowIndex, index) });
    });

    if (hidden.length === 0) return;
    let id = storedRowId(row, rowIndex);

    while (usedRowIds.has(id)) id = `${id}:rest`;
    usedRowIds.add(id);
    overflow.push({ ...row, id, widgets: hidden });
  });
  return overflow;
}

/**
 * Every widget the dashboard stores, shown or not (see `overflowStoredRows`),
 * in stored order. For operations that must reach the views of hidden widgets
 * too, such as copying the views a dashboard owns.
 */
export function readStoredDashboardWidgets(database: YDatabase | undefined, viewId: string): DashboardWidget[] {
  const raw = toPlainValue(
    database
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.layout_settings)
      ?.get(DASHBOARD_LAYOUT_KEY)
      ?.get(YjsDatabaseKey.dashboard_rows)
  );

  return Array.isArray(raw) ? parseStoredRows(raw).flatMap((row) => row.widgets) : [];
}

export function readDashboardLayoutSetting(database: YDatabase | undefined, viewId: string): DashboardLayoutSetting {
  const setting = database
    ?.get(YjsDatabaseKey.views)
    ?.get(viewId)
    ?.get(YjsDatabaseKey.layout_settings)
    ?.get(DASHBOARD_LAYOUT_KEY);

  if (!setting) return DEFAULT_DASHBOARD_LAYOUT_SETTING;

  return {
    rows: parseRows(setting.get(YjsDatabaseKey.dashboard_rows)),
    globalFilters: parseDashboardGlobalFilters(setting.get(YjsDatabaseKey.dashboard_global_filters)),
    showWidgetTitles: readFlag(setting, 'showWidgetTitles'),
    showIconsInHeading: readFlag(setting, 'showIconsInHeading'),
  };
}

export interface DashboardRowExtras {
  rows: Map<string, Record<string, unknown>>;
  widgets: Map<string, Record<string, unknown>>;
}

/**
 * The unknown keys of the stored rows and widgets, by effective id: the stored
 * `id`, or `r:{rowIndex}` / `w:{rowIndex}:{widgetIndex}` counting every entry
 * exactly as `parseRows` does. Widgets are indexed across all rows, so their
 * extras follow a widget into another row. The first occurrence of an id wins,
 * as in Rust `index_dashboard_row_extras`.
 */
export function indexDashboardRowExtras(stored: unknown): DashboardRowExtras {
  const extras: DashboardRowExtras = { rows: new Map(), widgets: new Map() };
  const raw = toPlainValue(stored);

  if (!Array.isArray(raw)) return extras;
  const seenRows = new Set<string>();
  const seenWidgets = new Set<string>();

  raw.forEach((row, rowIndex) => {
    if (!isPlainRecord(row)) return;
    const rowId = storedRowId(row, rowIndex);

    if (!seenRows.has(rowId)) {
      seenRows.add(rowId);
      const unknown = pickUnknownKeys(row, DASHBOARD_ROW_KEYS);

      if (unknown) extras.rows.set(rowId, unknown);
    }

    if (!Array.isArray(row.widgets)) return;
    row.widgets.forEach((widget, index) => {
      if (!isPlainRecord(widget)) return;
      const widgetId = storedWidgetId(widget, rowIndex, index);

      if (seenWidgets.has(widgetId)) return;
      seenWidgets.add(widgetId);
      const unknown = pickUnknownKeys(widget, DASHBOARD_WIDGET_KEYS);

      if (unknown) extras.widgets.set(widgetId, unknown);
    });
  });
  return extras;
}

/**
 * Serialize rows in the persisted snake_case shape. With `stored` (the current
 * value of the key), each row and widget keeps the unknown keys of the stored
 * entry with the same id (ARCHITECTURE §3.1.4).
 */
export function serializeDashboardRows(rows: DashboardRow[], stored?: unknown) {
  const extras = indexDashboardRowExtras(stored);

  return rows.map((row) => ({
    ...extras.rows.get(row.id),
    id: row.id,
    height: row.height,
    widgets: row.widgets.map((widget) => ({
      // Keyed by widget id across all rows: extras follow a moved widget.
      ...extras.widgets.get(widget.id),
      id: widget.id,
      view_id: widget.viewId,
      database_id: widget.databaseId,
      width: widget.width,
    })),
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
 * behind its Edit mode); `showWidgetTitles` and `showIconsInHeading` are
 * separate keys.
 *
 * A key is written only when its parsed value changes, as Rust
 * `into_layout_patch` does, so an identical write creates no Yjs item and no
 * undo step. A rewritten `rows` / `global_filters` keeps the unknown keys
 * another client stored on its entries, read from the current value.
 */
export function updateDashboardLayoutSetting(view: YDatabaseView, update: DashboardLayoutUpdate) {
  const setting = getOrCreateDashboardLayoutSetting(view);

  if (update.rows !== undefined) {
    const stored = setting.get(YjsDatabaseKey.dashboard_rows);
    const rows = normalizeDashboardRows(update.rows);

    if (!sameDashboardRows(parseRows(stored), rows)) {
      setting.set(YjsDatabaseKey.dashboard_rows, [
        ...serializeDashboardRows(rows, stored),
        // Widgets beyond the limit are not in `rows`; they stay in storage.
        ...overflowStoredRows(
          stored,
          rows.map((row) => row.id)
        ),
      ]);
    }
  }

  if (update.globalFilters !== undefined) {
    const stored = setting.get(YjsDatabaseKey.dashboard_global_filters);

    if (!sameDashboardGlobalFilters(parseDashboardGlobalFilters(stored), update.globalFilters)) {
      setting.set(
        YjsDatabaseKey.dashboard_global_filters,
        serializeDashboardGlobalFilters(update.globalFilters, stored)
      );
    }
  }

  if (update.showWidgetTitles !== undefined) writeFlag(setting, 'showWidgetTitles', update.showWidgetTitles);
  if (update.showIconsInHeading !== undefined) writeFlag(setting, 'showIconsInHeading', update.showIconsInHeading);
}

/** Ensure the view carries an (empty) dashboard setting so readers see a stable shape. */
export function initializeDashboardLayoutSetting(view: YDatabaseView) {
  const setting = getOrCreateDashboardLayoutSetting(view);

  if (setting.get(YjsDatabaseKey.dashboard_rows) === undefined) setting.set(YjsDatabaseKey.dashboard_rows, []);
  if (setting.get(YjsDatabaseKey.dashboard_global_filters) === undefined)
    setting.set(YjsDatabaseKey.dashboard_global_filters, []);
}

/**
 * `initializeDashboardLayoutSetting` in its own transaction (not an undo
 * step): the server writes no dashboard settings, so a new dashboard view is
 * seeded with the empty rows / global filters.
 */
export function seedDashboardLayoutSetting(doc: YDoc, view: YDatabaseView) {
  doc.transact(() => initializeDashboardLayoutSetting(view), DASHBOARD_LAYOUT_ORIGIN.seed);
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

/**
 * Whether deep events of a database doc's data section can change the
 * dashboard setting of `viewId`. Ancestors count too: an incoming update can
 * insert or replace the view, `layout_settings` or the dashboard map instead
 * of changing an existing key.
 */
function touchesDashboardSetting(
  events: readonly { path: (string | number)[]; changes: { keys: Map<string, unknown> } }[],
  viewId: string
) {
  return events.some((event) => {
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
}

/**
 * Report the dashboard's rows changes made by this client: its own writes,
 * undo and redo (all local transactions). Remote updates and a local cache
 * catching up (applied updates) only move the baseline. `listener` gets every
 * stored widget before and after the change, hidden ones included (they still
 * reference their views). Feeds the owned-view deletion queue (WP05 §1.5).
 */
export function observeLocalDashboardRowsChanges(
  databaseDoc: Y.Doc,
  viewId: string,
  listener: (before: DashboardWidget[], after: DashboardWidget[]) => void
): () => void {
  const root = databaseDoc.getMap(YjsEditorKey.data_section);
  const read = () => readStoredDashboardWidgets(root.get(YjsEditorKey.database) as YDatabase | undefined, viewId);
  let previous = read();
  const observer: Parameters<typeof root.observeDeep>[0] = (events, transaction) => {
    if (!touchesDashboardSetting(events, viewId)) return;
    const before = previous;

    previous = read();
    if (transaction.local) listener(before, previous);
  };

  root.observeDeep(observer);
  return () => root.unobserveDeep(observer);
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
      next.showWidgetTitles !== snapshot.showWidgetTitles ||
      next.showIconsInHeading !== snapshot.showIconsInHeading
    ) {
      snapshot = {
        rows: shareDashboardRows(snapshot.rows, next.rows),
        globalFilters: shareDashboardGlobalFilters(snapshot.globalFilters, next.globalFilters),
        showWidgetTitles: next.showWidgetTitles,
        showIconsInHeading: next.showIconsInHeading,
      };
    }

    return snapshot;
  };

  const subscribe = (notify: () => void) => {
    const observer: Parameters<typeof root.observeDeep>[0] = (events) => {
      if (touchesDashboardSetting(events, viewId) && getSnapshot() !== snapshotBeforeChange) {
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

/**
 * A new widget. The add flow passes the id it generated when the "+" was
 * clicked (WP06 §1.1), so the pending slot, the persisted widget, the
 * selection and the docked picker share one identity.
 */
export function createDashboardWidget(
  viewId: string,
  databaseId: string,
  width = DASHBOARD_GRID_COLUMNS,
  id = generateDashboardId('w')
): DashboardWidget {
  return { id, viewId, databaseId, width };
}

export function createDashboardRow(widgets: DashboardWidget[], height = DASHBOARD_DEFAULT_ROW_HEIGHT): DashboardRow {
  return { id: generateDashboardId('r'), height, widgets: balanceRowWidths(widgets) };
}

/**
 * R-SPLIT: every widget of the row gets an equal share of the twelve columns
 * (12, 6/6, 4/4/4, 3/3/3/3), discarding earlier custom widths as Notion does
 * when a widget joins or leaves a row. Returns `widgets` itself when nothing
 * changes, so memoized rows keep their identity. An equal split is a fixed
 * point of `normalizeDashboardRows` (and of Rust `normalize_dashboard_rows`).
 */
export function splitDashboardRowEqually(widgets: DashboardWidget[]): DashboardWidget[] {
  const count = widgets.length;

  if (count === 0) return widgets;
  // At most four widgets after normalization, so 12 / n is exact; anything else balances evenly.
  if (DASHBOARD_GRID_COLUMNS % count !== 0) return balanceRowWidths(widgets.map((widget) => ({ ...widget, width: 0 })));
  const width = DASHBOARD_GRID_COLUMNS / count;

  return widgets.every((widget) => widget.width === width)
    ? widgets
    : widgets.map((widget) => (widget.width === width ? widget : { ...widget, width }));
}

/**
 * Add a widget; returns the unchanged rows when the limits refuse it. A widget
 * joining a row splits that row equally (R-SPLIT); a new row holds it alone.
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

        widgets.splice(index, 0, widget);
        return { ...row, widgets: splitDashboardRowEqually(widgets) };
      })
    );
  }

  const next = [...rows];
  const row = createDashboardRow([{ ...widget, width: DASHBOARD_GRID_COLUMNS }]);
  const rowIndex = placement.rowIndex === undefined ? next.length : Math.min(placement.rowIndex, next.length);

  next.splice(rowIndex, 0, row);
  return normalizeDashboardRows(next);
}

/** Remove a widget; the rest of its row splits equally (R-SPLIT) and an emptied row disappears. */
export function removeDashboardWidget(rows: DashboardRow[], widgetId: string): DashboardRow[] {
  return normalizeDashboardRows(
    rows.map((row) => {
      if (!row.widgets.some((widget) => widget.id === widgetId)) return row;
      return { ...row, widgets: splitDashboardRowEqually(row.widgets.filter((widget) => widget.id !== widgetId)) };
    })
  );
}

/**
 * Duplicate a widget next to its source. When the row is full the copy starts
 * a new row directly below; when the dashboard is full nothing changes. With
 * `copy`, the new widget shows that view (the source view's owned copy, WP05
 * §1.4) instead of sharing the source's.
 */
export function duplicateDashboardWidget(
  rows: DashboardRow[],
  widgetId: string,
  copyView?: { viewId: string; databaseId: string }
): DashboardRow[] {
  const location = findDashboardWidget(rows, widgetId);

  if (!location || countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS) return rows;
  const copy: DashboardWidget = {
    ...location.widget,
    ...(copyView ? { viewId: copyView.viewId, databaseId: copyView.databaseId } : null),
    id: generateDashboardId('w'),
  };

  if (location.row.widgets.length < DASHBOARD_MAX_WIDGETS_PER_ROW) {
    return addDashboardWidget(rows, copy, { type: 'existing_row', rowId: location.row.id, index: location.index + 1 });
  }

  return addDashboardWidget(rows, copy, { type: 'new_row', rowIndex: location.rowIndex + 1 });
}

/**
 * Move a widget to a new position. Moving into a full row is refused unless
 * the widget already lives in that row (a reorder). A reorder inside a row
 * keeps every width; a widget that changes rows splits both rows equally
 * (R-SPLIT), and a new row holds it alone at its old row's height. Rows left
 * empty vanish. A widget alone in its row dropped next to that row returns
 * `rows` itself (#15).
 */
export function moveDashboardWidget(
  rows: DashboardRow[],
  widgetId: string,
  placement: DashboardWidgetPlacement
): DashboardRow[] {
  const location = findDashboardWidget(rows, widgetId);

  if (!location) return rows;
  const { widget } = location;
  const sameRow = placement.type === 'existing_row' && placement.rowId === location.row.id;
  const withoutWidget = rows.map((row) => {
    if (row.id !== location.row.id) return row;
    const rest = row.widgets.filter((item) => item.id !== widgetId);

    // The widget leaves the row: the rest splits equally (a reorder keeps the widths).
    return { ...row, widgets: sameRow ? rest : splitDashboardRowEqually(rest) };
  });

  if (placement.type === 'existing_row') {
    const target = withoutWidget.find((row) => row.id === placement.rowId);

    if (!target || target.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW) return rows;
    const next = withoutWidget.map((row) => {
      if (row.id !== placement.rowId) return row;
      const widgets = [...row.widgets];
      const index = placement.index === undefined ? widgets.length : Math.min(placement.index, widgets.length);

      widgets.splice(index, 0, widget);
      return { ...row, widgets: sameRow ? widgets : splitDashboardRowEqually(widgets) };
    });

    return normalizeDashboardRows(next.filter((row) => row.widgets.length > 0));
  }

  // A new row: the index is expressed against the row list before the source
  // row (if now empty) disappears, so compute it on the pruned list.
  const pruned = withoutWidget.filter((row) => row.widgets.length > 0);
  const alone = location.row.widgets.length === 1;
  let rowIndex = placement.rowIndex === undefined ? pruned.length : placement.rowIndex;

  if (placement.rowIndex !== undefined && alone && location.rowIndex < placement.rowIndex) {
    rowIndex -= 1;
  }

  rowIndex = Math.max(0, Math.min(rowIndex, pruned.length));
  // A widget alone in its row, put back where that row was: nothing changes.
  if (alone && rowIndex === location.rowIndex) return rows;
  const next = [...pruned];

  next.splice(rowIndex, 0, createDashboardRow([{ ...widget, width: DASHBOARD_GRID_COLUMNS }], location.row.height));
  return normalizeDashboardRows(next);
}

/**
 * How a move would end: `blocked` when the widget would join a full row,
 * `noop` when the layout would not change (or the widget or row is unknown),
 * else `allowed`.
 */
export function classifyDashboardMove(
  rows: DashboardRow[],
  widgetId: string,
  placement: DashboardWidgetPlacement
): DashboardMoveFeedback {
  const source = findDashboardWidget(rows, widgetId);

  if (!source) return 'noop';
  if (placement.type === 'existing_row' && placement.rowId !== source.row.id) {
    const target = rows.find((row) => row.id === placement.rowId);

    if (!target) return 'noop';
    if (target.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW) return 'blocked';
  }

  const next = moveDashboardWidget(rows, widgetId, placement);

  return next === rows || sameDashboardRows(next, rows) ? 'noop' : 'allowed';
}

/**
 * The `moveDashboardWidget` placement of dropping `sourceId` on `target`, by
 * position alone (whether the move is allowed is `getDashboardDropFeedback`).
 * `null` for an unknown source or target, or a drop on the source itself.
 */
export function resolveDashboardDropPlacement(
  rows: DashboardRow[],
  sourceId: string,
  target: DashboardDropTarget
): DashboardWidgetPlacement | null {
  const source = findDashboardWidget(rows, sourceId);

  if (!source) return null;
  if (target.type === 'row_gap') {
    return { type: 'new_row', rowIndex: Math.max(0, Math.min(target.rowIndex, rows.length)) };
  }

  if (target.widgetId === sourceId) return null;
  const destination = findDashboardWidget(rows, target.widgetId);

  if (!destination) return null;
  let index = target.edge === 'left' ? destination.index : destination.index + 1;

  // `moveDashboardWidget` inserts into the row after removing the widget.
  if (destination.row.id === source.row.id && source.index < index) index -= 1;
  return { type: 'existing_row', rowId: destination.row.id, index };
}

/**
 * Dropping `sourceId` on `target`: `blocked` next to a widget of another full
 * row, `noop` where the widget would stay put (beside itself in its row, or a
 * widget alone in its row dropped next to that row), else `allowed`.
 */
export function getDashboardDropFeedback(
  rows: DashboardRow[],
  sourceId: string,
  target: DashboardDropTarget
): DashboardMoveFeedback {
  const placement = resolveDashboardDropPlacement(rows, sourceId, target);

  return placement ? classifyDashboardMove(rows, sourceId, placement) : 'noop';
}

/**
 * The line an allowed drop draws, else `null` (blocked and no-op targets show
 * nothing). The right edge of widget `i` and the left edge of widget `i + 1`
 * give the same boundary, so the row shows one line there.
 */
export function getDashboardDropIndicator(
  rows: DashboardRow[],
  sourceId: string,
  target: DashboardDropTarget
): DashboardDropIndicator | null {
  if (getDashboardDropFeedback(rows, sourceId, target) !== 'allowed') return null;
  if (target.type === 'row_gap') {
    return { type: 'row_gap', rowIndex: Math.max(0, Math.min(target.rowIndex, rows.length)) };
  }

  const destination = findDashboardWidget(rows, target.widgetId);

  if (!destination) return null;
  return {
    type: 'column',
    rowId: destination.row.id,
    boundary: target.edge === 'left' ? destination.index : destination.index + 1,
  };
}

/**
 * Give `delta` columns to the widget at `index` and take them from its right
 * neighbour (negative deltas do the reverse), so the row still sums to twelve.
 * Both widgets keep `minColumns` (the resize minimum of the measured row, see
 * `dashboardMinWidgetColumns`); a widget already narrower than that is never
 * forced to grow and never shrinks further. Stored widths are never rewritten
 * to meet the minimum.
 */
export function resizeDashboardWidget(
  rows: DashboardRow[],
  rowId: string,
  index: number,
  delta: number,
  minColumns = 1
): DashboardRow[] {
  if (delta === 0) return rows;

  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const left = row.widgets[index];
    const right = row.widgets[index + 1];

    if (!left || !right) return row;
    const applied = Math.max(
      Math.min(minColumns, left.width) - left.width,
      Math.min(right.width - Math.min(minColumns, right.width), delta)
    );

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

/**
 * Swap a row with its neighbour above (`-1`) or below (`1`): one write, so one
 * undo step. The row objects are kept as they are (ids, heights, widths).
 * Returns `rows` itself at either end, for an unknown row or a single row.
 */
export function moveDashboardRow(rows: DashboardRow[], rowId: string, delta: -1 | 1): DashboardRow[] {
  const from = rows.findIndex((row) => row.id === rowId);
  const to = from + delta;

  if (from === -1 || (delta !== 1 && delta !== -1) || to < 0 || to >= rows.length) return rows;
  const next = [...rows];

  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * What the controls beside row `rowId` offer: the move arrows (none for a
 * single row) and the "Add to row" control, hidden for a full row and
 * disabled on a full dashboard.
 */
export function getDashboardRowControls(rows: DashboardRow[], rowId: string): DashboardRowControls {
  const index = rows.findIndex((row) => row.id === rowId);
  const row = rows[index];

  if (!row) return { moveUp: false, moveDown: false, addToRow: 'hidden' };
  // Notion's glyph for a single row is unverified: it gets no move control.
  const single = rows.length < 2;

  return {
    moveUp: !single && index > 0,
    moveDown: !single && index < rows.length - 1,
    addToRow:
      row.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW
        ? 'hidden'
        : countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS
        ? 'disabled'
        : 'enabled',
  };
}

/** The "Add to new row" button under the last row: disabled on a full dashboard. */
export function getDashboardAddToNewRowState(rows: DashboardRow[]): Exclude<DashboardAddControlState, 'hidden'> {
  return countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS ? 'disabled' : 'enabled';
}

/** Replace the view a widget shows (Settings › Source). */
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
