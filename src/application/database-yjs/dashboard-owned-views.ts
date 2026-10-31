import { YDatabase, YjsDatabaseKey } from '@/application/types';

import { isPlainRecord, nonEmptyString } from './layout-codec';

/**
 * Dashboard-owned widget views (WP05 §1, the cross-client contract). A view a
 * dashboard creates for one of its widgets carries the owning dashboard's view
 * id in two places: the folder view `extra.dashboard_owner` (authoritative)
 * and the database collab mirror `views[view_id].dashboard_owner`. Owned views
 * are never listed as database tabs. Same names and semantics as desktop
 * `dashboard_owned_views.dart` and Rust `dashboard_entities.rs`, bound to the
 * shared `dashboard-parity/` fixtures.
 */
export const DASHBOARD_OWNER_KEY = YjsDatabaseKey.dashboard_owner;

/** Anything that carries a folder `extra` (a folder `View`, a catalog item mapped to one). */
export interface DashboardOwnerFolderSource {
  extra?: { dashboard_owner?: unknown } | null;
}

/** Anything that reads like a database collab view map. */
export interface DashboardOwnerCollabSource {
  get(key: string): unknown;
}

/**
 * A stored owner marker: a non-empty string, anything else is `null` (not
 * owned). The one rule every reader of the marker goes through.
 */
export function parseDashboardOwner(value: unknown): string | null {
  return nonEmptyString(value) ?? null;
}

/**
 * The owning dashboard of a view: the folder marker when it is a non-empty
 * string, else the collab mirror when it is one, else `null` (not owned).
 * Read either, write both.
 */
export function readDashboardOwner(
  folderView?: DashboardOwnerFolderSource | null,
  collabView?: DashboardOwnerCollabSource | null
): string | null {
  return (
    parseDashboardOwner(folderView?.extra?.dashboard_owner) ?? parseDashboardOwner(collabView?.get(DASHBOARD_OWNER_KEY))
  );
}

export function isOwnedByDashboard(
  dashboardViewId: string,
  folderView?: DashboardOwnerFolderSource | null,
  collabView?: DashboardOwnerCollabSource | null
): boolean {
  return readDashboardOwner(folderView, collabView) === dashboardViewId;
}

/**
 * The first free name for a new view of `base` among `existingNames` (every
 * view name of the target database): the trimmed base, else `"<base> (n)"`
 * for the smallest free n ≥ 1. Names are trimmed and compared case-sensitively.
 */
export function nextViewName(base: string, existingNames: Iterable<string>): string {
  const trimmed = base.trim();
  const names = new Set(Array.from(existingNames, (name) => name.trim()));

  if (!names.has(trimmed)) return trimmed;
  for (let n = 1; ; n += 1) {
    const candidate = `${trimmed} (${n})`;

    if (!names.has(candidate)) return candidate;
  }
}

/** The name a duplicate counts from: the trimmed name without one trailing `" (n)"`. */
export function duplicateBaseName(name: string): string {
  return name.trim().replace(/ \((\d+)\)$/, '');
}

/**
 * Hide owned views from a tab list derived from folder children (a database
 * container or a standalone database). A route that opened an owned view
 * shows it as the only tab. Never apply this to an explicit host list (a
 * document block's `view_ids`, a widget's single view).
 */
export function filterOwnedTabViewIds(
  ids: string[],
  openedViewId: string | undefined,
  isOwned: (viewId: string) => boolean
): string[] {
  if (openedViewId && isOwned(openedViewId)) return [openedViewId];
  const visible = ids.filter((id) => !isOwned(id));

  // Keep the caller's array when nothing is hidden so memoized consumers stay stable.
  return visible.length === ids.length ? ids : visible;
}

/**
 * The names of every view of `database` as the folder names them, falling
 * back to the collab name for a view the folder does not know (yet).
 */
export function collectDatabaseViewNames(
  database: YDatabase | undefined,
  folderNameById: ReadonlyMap<string, string> | Record<string, string | undefined> = {}
): string[] {
  const folderName = (viewId: string) =>
    folderNameById instanceof Map ? folderNameById.get(viewId) : (folderNameById as Record<string, string>)[viewId];
  const names: string[] = [];

  database?.get(YjsDatabaseKey.views)?.forEach((view, viewId) => {
    const name = folderName(viewId) || view.get(YjsDatabaseKey.name);

    if (typeof name === 'string' && name.length > 0) names.push(name);
  });
  return names;
}

// ---------------------------------------------------------------------------
// Remap (WP05 §1.8): pure, on the plain JSON of layout_settings['9'].
// ---------------------------------------------------------------------------

export type DashboardIdMap = Readonly<Record<string, string>>;

function mapped(map: DashboardIdMap, key: unknown): string | undefined {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function remapWidget(widget: unknown, viewIdMap: DashboardIdMap, databaseIdMap: DashboardIdMap): unknown {
  if (!isPlainRecord(widget)) return widget;
  const viewId = mapped(viewIdMap, widget.view_id);
  const databaseId = mapped(databaseIdMap, widget.database_id);

  // A widget of the copied database moves only together with its view; a view
  // that was not copied keeps pointing at the original, which still renders.
  if (typeof widget.database_id === 'string' && databaseId !== undefined) {
    return viewId === undefined ? widget : { ...widget, view_id: viewId, database_id: databaseId };
  }

  return viewId === undefined ? widget : { ...widget, view_id: viewId };
}

function remapList(value: unknown[], remap: (item: unknown) => unknown): unknown[] {
  let changed = false;
  const next = value.map((item) => {
    const result = remap(item);

    if (result !== item) changed = true;
    return result;
  });

  return changed ? next : value;
}

function remapRow(row: unknown, viewIdMap: DashboardIdMap, databaseIdMap: DashboardIdMap): unknown {
  if (!isPlainRecord(row) || !Array.isArray(row.widgets)) return row;
  const widgets = remapList(row.widgets, (widget) => remapWidget(widget, viewIdMap, databaseIdMap));

  return widgets === row.widgets ? row : { ...row, widgets };
}

function remapGlobalFilter(filter: unknown, databaseIdMap: DashboardIdMap): unknown {
  if (!isPlainRecord(filter)) return filter;
  let next: Record<string, unknown> = filter;

  if (
    isPlainRecord(filter.targets) &&
    Object.keys(filter.targets).some((key) => mapped(databaseIdMap, key) !== undefined)
  ) {
    // Field ids stay: a database copy keeps its field ids.
    const targets = Object.fromEntries(
      Object.entries(filter.targets).map(([key, value]) => [mapped(databaseIdMap, key) ?? key, value])
    );

    next = { ...next, targets };
  }

  if (Array.isArray(filter.target_order)) {
    const order = remapList(filter.target_order, (entry) => mapped(databaseIdMap, entry) ?? entry);

    if (order !== filter.target_order) next = { ...next, target_order: order };
  }

  return next;
}

/**
 * Point a dashboard layout at copied views and databases. `viewIdMap` maps
 * old to new view ids (every copied view of a database copy, or the owned
 * copies of a duplicated dashboard); `databaseIdMap` maps a copied database
 * to its copy (empty for a dashboard duplicate). Every other key at every
 * level, and every value of the wrong type, is copied unchanged. Returns the
 * input object itself when nothing changes.
 */
export function remapDashboardLayout<T>(layout: T, viewIdMap: DashboardIdMap, databaseIdMap: DashboardIdMap): T {
  if (!isPlainRecord(layout)) return layout;
  const record = layout as Record<string, unknown>;
  let next: Record<string, unknown> = record;

  if (Array.isArray(record.rows)) {
    const rows = remapList(record.rows, (row) => remapRow(row, viewIdMap, databaseIdMap));

    if (rows !== record.rows) next = { ...next, rows };
  }

  if (Array.isArray(record.global_filters)) {
    const filters = remapList(record.global_filters, (filter) => remapGlobalFilter(filter, databaseIdMap));

    if (filters !== record.global_filters) next = { ...next, global_filters: filters };
  }

  return next as T;
}

/** The owner of a copied owned view: the owner's copy, or `null` (remove the marker) when it was not copied. */
export function remapDashboardOwner(owner: string, viewIdMap: DashboardIdMap): string | null {
  return mapped(viewIdMap, owner) ?? null;
}
