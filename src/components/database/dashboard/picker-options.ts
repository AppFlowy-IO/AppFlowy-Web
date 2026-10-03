import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { DatabaseViewLayout, ViewIcon, ViewLayout } from '@/application/types';

import { databaseLayoutToViewLayout } from './utils';
import { isWidgetLayout } from './widget-status';

/** A database view a widget can render. */
export interface WidgetPickerOption {
  viewId: string;
  databaseId: string;
  name: string;
  layout: ViewLayout;
  icon: ViewIcon | null;
}

export interface WidgetPickerGroup {
  databaseId: string;
  name: string;
  isHost: boolean;
  options: WidgetPickerOption[];
}

/** A database the "New view" tab can create a view in. */
export interface WidgetPickerDatabase {
  databaseId: string;
  name: string;
  /** A regular view of the database, used to open its doc and resolve its container. */
  primaryViewId: string;
  isHost: boolean;
}

/** A view of the host database as read from its Yjs doc. */
export interface HostViewEntry {
  viewId: string;
  name: string;
  layout: ViewLayout;
  embedded: boolean;
}

// The folder layouts of the database layouts a widget can show (`isWidgetLayout`).
const SOURCE_LAYOUTS = new Set<ViewLayout>(
  Object.values(DatabaseViewLayout)
    .filter((layout): layout is DatabaseViewLayout => typeof layout === 'number')
    .filter(isWidgetLayout)
    .map(databaseLayoutToViewLayout)
);

/** Folder layouts a widget may render: every database layout except Dashboard (no nesting). */
export function isWidgetSourceLayout(layout: ViewLayout) {
  return SOURCE_LAYOUTS.has(Number(layout) as ViewLayout);
}

function containerOf(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return database.views.find((view) => view.is_container);
}

function primaryOf(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return (
    database.views.find((view) => !view.is_container && !view.embedded && isWidgetSourceLayout(view.layout)) ??
    database.views.find((view) => !view.is_container && isWidgetSourceLayout(view.layout))
  );
}

/** Display name of a catalog database: its container, else its first regular view. */
export function getCatalogDatabaseName(database: WorkspaceDatabaseWithViews) {
  return (containerOf(database)?.name || primaryOf(database)?.name || '').trim();
}

// The lowercased name of every built group and option: a search compares
// against it instead of lowercasing the whole workspace on each keystroke.
const searchKeys = new WeakMap<WidgetPickerGroup | WidgetPickerOption, string>();

function searchKeyOf(entry: WidgetPickerGroup | WidgetPickerOption) {
  let key = searchKeys.get(entry);

  if (key === undefined) {
    key = entry.name.toLowerCase();
    searchKeys.set(entry, key);
  }

  return key;
}

/**
 * The groups a search query keeps: the views whose own name or whose database
 * name contains it. Groups and options the query leaves whole keep their
 * identity, so their (memoized) rows do not render again.
 */
export function filterWidgetPickerGroups(groups: WidgetPickerGroup[], query: string): WidgetPickerGroup[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return groups;
  const filtered: WidgetPickerGroup[] = [];

  groups.forEach((group) => {
    if (searchKeyOf(group).includes(normalizedQuery)) {
      filtered.push(group);
      return;
    }

    const options = group.options.filter((option) => searchKeyOf(option).includes(normalizedQuery));

    if (options.length === group.options.length) filtered.push(group);
    else if (options.length > 0) filtered.push({ ...group, options });
  });
  return filtered;
}

export interface BuildWidgetPickerGroupsInput {
  hostDatabaseId: string;
  hostDatabaseName: string;
  /** Host views in display order. */
  hostViews: HostViewEntry[];
  /** Host tab ids; embedded host views are only offered when they are one of these. */
  hostTabViewIds: string[];
  catalog: WorkspaceDatabaseWithViews[];
  /** Views that must never be offered (the dashboard itself). */
  excludeViewIds: string[];
  /** A search query (`filterWidgetPickerGroups`); callers that search as the user types filter the built groups instead. */
  query?: string;
  /** Name for an unnamed view. */
  fallbackName: (layout: ViewLayout) => string;
}

/**
 * Existing views grouped by database: the host database first (from its live
 * Yjs doc, so freshly created views are listed), then every other database of
 * the workspace catalog. Dashboards are never offered.
 */
export function buildWidgetPickerGroups({
  hostDatabaseId,
  hostDatabaseName,
  hostViews,
  hostTabViewIds,
  catalog,
  excludeViewIds,
  query = '',
  fallbackName,
}: BuildWidgetPickerGroupsInput): WidgetPickerGroup[] {
  const excluded = new Set(excludeViewIds);
  const tabIds = new Set(hostTabViewIds);
  const hostCatalog = catalog.find((database) => database.database_id === hostDatabaseId);
  const catalogHostViews = new Map(hostCatalog?.views.map((view) => [view.view_id, view]) ?? []);
  const groups: WidgetPickerGroup[] = [];
  const hostName = hostDatabaseName || (hostCatalog ? getCatalogDatabaseName(hostCatalog) : '');

  const hostOptions = hostViews
    .filter(
      (view) =>
        !excluded.has(view.viewId) && isWidgetSourceLayout(view.layout) && (!view.embedded || tabIds.has(view.viewId))
    )
    .map<WidgetPickerOption>((view) => {
      const catalogView = catalogHostViews.get(view.viewId);

      return {
        viewId: view.viewId,
        databaseId: hostDatabaseId,
        name: (catalogView?.name || view.name || '').trim() || fallbackName(view.layout),
        layout: view.layout,
        icon: catalogView?.icon ?? null,
      };
    });

  if (hostOptions.length > 0) {
    groups.push({ databaseId: hostDatabaseId, name: hostName, isHost: true, options: hostOptions });
  }

  catalog.forEach((database) => {
    if (database.database_id === hostDatabaseId) return;
    const options = database.views
      .filter((view) => !view.is_container && !excluded.has(view.view_id) && isWidgetSourceLayout(view.layout))
      .map<WidgetPickerOption>((view) => ({
        viewId: view.view_id,
        databaseId: database.database_id,
        name: view.name.trim() || fallbackName(view.layout),
        layout: Number(view.layout) as ViewLayout,
        icon: view.icon ?? null,
      }));

    if (options.length > 0) {
      groups.push({ databaseId: database.database_id, name: getCatalogDatabaseName(database), isHost: false, options });
    }
  });

  return filterWidgetPickerGroups(groups, query);
}

/** Databases a new widget view can be created in: the host first, then the catalog. */
export function buildWidgetPickerDatabases({
  hostDatabaseId,
  hostDatabaseName,
  hostPrimaryViewId,
  catalog,
}: {
  hostDatabaseId: string;
  hostDatabaseName: string;
  hostPrimaryViewId: string;
  catalog: WorkspaceDatabaseWithViews[];
}): WidgetPickerDatabase[] {
  const hostCatalog = catalog.find((database) => database.database_id === hostDatabaseId);
  const databases: WidgetPickerDatabase[] = [
    {
      databaseId: hostDatabaseId,
      name: hostDatabaseName || (hostCatalog ? getCatalogDatabaseName(hostCatalog) : ''),
      primaryViewId: hostPrimaryViewId,
      isHost: true,
    },
  ];

  catalog.forEach((database) => {
    if (database.database_id === hostDatabaseId) return;
    const primary = primaryOf(database);

    if (!primary) return;
    databases.push({
      databaseId: database.database_id,
      name: getCatalogDatabaseName(database),
      primaryViewId: primary.view_id,
      isHost: false,
    });
  });

  return databases;
}
