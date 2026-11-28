import { databaseCatalogViewToView, getDatabaseContainerEntries } from '@/application/services/domains/view';
import type { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { View, ViewLayout } from '@/application/types';

/** One database of the `/linked ...` picker. */
export interface LinkedDatabaseOption {
  databaseId: string;
  /** The view a new linked view of the database is modelled on: its primary view. */
  sourceViewId: string;
  /** The database's row: its container page, with `dashboards` as its children. */
  view: View;
  /**
   * `/Linked Dashboard` only: the database's existing dashboards. Picking one
   * links a dashboard that starts with a copy of its widgets; picking the
   * database itself links an empty dashboard.
   */
  dashboards: View[];
}

/** A picked row: a database, or one of its dashboards to copy. */
export interface LinkedDatabaseSelection {
  option: LinkedDatabaseOption;
  dashboard?: View;
}

// A view a dashboard owns is a widget's view, never a dashboard of its own.
function isCopyableDashboard(view: WorkspaceDatabaseViewItem) {
  return Number(view.layout) === ViewLayout.Dashboard && !view.is_container && !view.dashboard_owner;
}

/** The picker's databases, each with its dashboards when `layout` is a Dashboard. */
export function getLinkedDatabaseOptions(
  databases: WorkspaceDatabaseWithViews[],
  layout: ViewLayout
): LinkedDatabaseOption[] {
  const viewsByDatabase = new Map(databases.map((database) => [database.database_id, database.views]));

  return getDatabaseContainerEntries(databases, { includeStandalone: true }).map(
    ({ databaseId, container, primaryView }) => {
      const dashboards =
        layout === ViewLayout.Dashboard
          ? (viewsByDatabase.get(databaseId) ?? [])
              .filter(isCopyableDashboard)
              .map((view) => databaseCatalogViewToView(databaseId, view))
          : [];

      return {
        databaseId,
        sourceViewId: primaryView.view_id,
        view: { ...databaseCatalogViewToView(databaseId, container), children: dashboards },
        dashboards,
      };
    }
  );
}

/** The ids of every row the picker lets the user pick. */
export function getLinkedDatabaseSelectableIds(options: LinkedDatabaseOption[]): Set<string> {
  return new Set(
    options.flatMap((option) => [option.view.view_id, ...option.dashboards.map((dashboard) => dashboard.view_id)])
  );
}

export function findLinkedDatabaseSelection(
  options: LinkedDatabaseOption[],
  viewId: string
): LinkedDatabaseSelection | undefined {
  for (const option of options) {
    if (option.view.view_id === viewId) return { option };
    const dashboard = option.dashboards.find((view) => view.view_id === viewId);

    if (dashboard) return { option, dashboard };
  }

  return undefined;
}

/**
 * The picker rows matching `keyword`. A matching database keeps all its
 * dashboards; a database that does not match stays to hold a matching dashboard.
 */
export function filterLinkedDatabaseTree(views: View[], selectableIds: Set<string>, keyword: string): View[] {
  const lowercaseKeyword = keyword.toLowerCase();

  const filter = (items: View[]): View[] =>
    items.flatMap((item) => {
      const matchKeyword = !keyword || Boolean(item.name?.toLowerCase().includes(lowercaseKeyword));
      const includeSelf = selectableIds.has(item.view_id) && matchKeyword;
      const children = includeSelf ? item.children ?? [] : filter(item.children ?? []);

      return includeSelf || children.length > 0 ? [{ ...item, children }] : [];
    });

  return filter(views);
}
