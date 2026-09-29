import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { ViewIcon, ViewLayout } from '@/application/types';

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

const SOURCE_LAYOUTS = new Set<ViewLayout>([
  ViewLayout.Grid,
  ViewLayout.Board,
  ViewLayout.Calendar,
  ViewLayout.Chart,
  ViewLayout.List,
  ViewLayout.Gallery,
  ViewLayout.Feed,
  ViewLayout.Form,
  ViewLayout.Timeline,
]);

/** Layouts a widget may render: every database layout except Dashboard (no nesting). */
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

function matches(query: string, ...values: string[]) {
  if (!query) return true;
  return values.some((value) => value.toLowerCase().includes(query));
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
  query: string;
  /** Name for an unnamed view. */
  fallbackName: (layout: ViewLayout) => string;
}

/**
 * Existing views grouped by database: the host database first (from its live
 * Yjs doc, so freshly created views are listed), then every other database of
 * the workspace catalog. Dashboards are never offered, and a search query
 * keeps views whose own name or whose database name matches.
 */
export function buildWidgetPickerGroups({
  hostDatabaseId,
  hostDatabaseName,
  hostViews,
  hostTabViewIds,
  catalog,
  excludeViewIds,
  query,
  fallbackName,
}: BuildWidgetPickerGroupsInput): WidgetPickerGroup[] {
  const excluded = new Set(excludeViewIds);
  const tabIds = new Set(hostTabViewIds);
  const normalizedQuery = query.trim().toLowerCase();
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
    })
    .filter((option) => matches(normalizedQuery, option.name, hostName));

  if (hostOptions.length > 0) {
    groups.push({ databaseId: hostDatabaseId, name: hostName, isHost: true, options: hostOptions });
  }

  catalog.forEach((database) => {
    if (database.database_id === hostDatabaseId) return;
    const name = getCatalogDatabaseName(database);
    const options = database.views
      .filter((view) => !view.is_container && !excluded.has(view.view_id) && isWidgetSourceLayout(view.layout))
      .map<WidgetPickerOption>((view) => ({
        viewId: view.view_id,
        databaseId: database.database_id,
        name: view.name.trim() || fallbackName(view.layout),
        layout: Number(view.layout) as ViewLayout,
        icon: view.icon ?? null,
      }))
      .filter((option) => matches(normalizedQuery, option.name, name));

    if (options.length > 0) {
      groups.push({ databaseId: database.database_id, name, isHost: false, options });
    }
  });

  return groups;
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
