import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { DatabaseViewLayout, ViewIcon, ViewLayout } from '@/application/types';
import { normalizeDashboardText } from '@/utils/normalize-text';

import { NEW_VIEW_LAYOUTS } from '../constants';
import { databaseLayoutToViewLayout } from '../utils';
import { isWidgetLayout } from '../widget-status';

/**
 * The "New view" picker's content (WP06 §1.4) and its owner filter (WP05
 * §1.9), as a pure function: the same sections as desktop
 * `dashboard_picker_sections.dart`, both bound to
 * `dashboard-parity/add-widget.json` (`picker_sections`).
 */

/** A view of the host database as read from its Yjs doc. */
export interface HostViewEntry {
  viewId: string;
  name: string;
  layout: ViewLayout;
  embedded: boolean;
  /** The collab mirror of the owner marker (`null` when absent). */
  dashboardOwner?: string | null;
  /** The folder icon, when known (the catalog). */
  icon?: ViewIcon | null;
}

/** A database view a widget can render. */
export interface WidgetPickerOption {
  viewId: string;
  databaseId: string;
  name: string;
  layout: ViewLayout;
  icon: ViewIcon | null;
}

/** A catalog database as the picker reads it. */
export interface PickerCatalogDatabase {
  databaseId: string;
  name: string;
  views: PickerCatalogView[];
}

export interface PickerCatalogView {
  viewId: string;
  name: string;
  layout: ViewLayout;
  icon?: ViewIcon | null;
  isContainer?: boolean;
}

/** Shown, shown but not selectable, or not listed. */
export type PickerCreationState = 'enabled' | 'disabled' | 'hidden';

/** The "New view" rows in Notion order: Table (Grid), Board, Gallery, List, Chart, Timeline, Feed, Calendar. */
export { NEW_VIEW_LAYOUTS };

/** The New view panel's layout tiles (Notion's 3×3 grid without Map): Table, Board, Timeline / Calendar, List, Gallery / Chart, Feed. */
export const CONFIG_TILE_LAYOUTS: readonly DatabaseViewLayout[] = [
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.Board,
  DatabaseViewLayout.Timeline,
  DatabaseViewLayout.Calendar,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Chart,
  DatabaseViewLayout.Feed,
];

/** The picker label key and English text of each New view layout (Grid reads "Table", as in Notion). */
export const NEW_VIEW_LAYOUT_LABELS: Record<DatabaseViewLayout, { key: string; defaultValue: string }> = {
  [DatabaseViewLayout.Grid]: { key: 'dashboard.picker.layout.table', defaultValue: 'Table' },
  [DatabaseViewLayout.Board]: { key: 'dashboard.picker.layout.board', defaultValue: 'Board' },
  [DatabaseViewLayout.Gallery]: { key: 'dashboard.picker.layout.gallery', defaultValue: 'Gallery' },
  [DatabaseViewLayout.List]: { key: 'dashboard.picker.layout.list', defaultValue: 'List' },
  [DatabaseViewLayout.Chart]: { key: 'dashboard.picker.layout.chart', defaultValue: 'Chart' },
  [DatabaseViewLayout.Timeline]: { key: 'dashboard.picker.layout.timeline', defaultValue: 'Timeline' },
  [DatabaseViewLayout.Feed]: { key: 'dashboard.picker.layout.feed', defaultValue: 'Feed' },
  [DatabaseViewLayout.Calendar]: { key: 'dashboard.picker.layout.calendar', defaultValue: 'Calendar' },
  [DatabaseViewLayout.Form]: { key: 'form.builderName', defaultValue: 'Form builder' },
  [DatabaseViewLayout.Dashboard]: { key: 'dashboard.menuName', defaultValue: 'Dashboard' },
};

/** Views listed per group before "Show {n} more". */
export const PICKER_GROUP_LIMIT = 5;

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

/** A regular view of a catalog database: it opens the database's doc and anchors a new view there. */
export function catalogPrimaryViewOf(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return (
    database.views.find((view) => !view.is_container && !view.embedded && isWidgetSourceLayout(view.layout)) ??
    database.views.find((view) => !view.is_container && isWidgetSourceLayout(view.layout))
  );
}

/** Display name of a catalog database: its container, else its first regular view. */
export function getCatalogDatabaseName(database: WorkspaceDatabaseWithViews) {
  return (containerOf(database)?.name || catalogPrimaryViewOf(database)?.name || '').trim();
}

/** The workspace catalog as the picker reads it. */
export function toPickerCatalog(catalog: WorkspaceDatabaseWithViews[]): PickerCatalogDatabase[] {
  return catalog.map((database) => ({
    databaseId: database.database_id,
    name: getCatalogDatabaseName(database),
    views: database.views.map((view) => ({
      viewId: view.view_id,
      name: view.name,
      layout: Number(view.layout) as ViewLayout,
      icon: view.icon ?? null,
      isContainer: view.is_container,
    })),
  }));
}

export interface BuildWidgetPickerSectionsInput {
  /** The database listed first ("Views on …"): the host in add mode, the widget's own database in replace mode. */
  primaryDatabaseId: string;
  primaryDatabaseName: string;
  /** The primary database is the dashboard's host (its embedded views follow the tab rule). */
  primaryIsHost: boolean;
  /** The primary database's views in host order. */
  primaryViews: HostViewEntry[];
  /** Host tab ids: an embedded host view is offered when it is one of them. `null`: every view is a tab. */
  hostTabViewIds: readonly string[] | null;
  /** The owning dashboard of a view, `null` when not owned. */
  ownerOf: (viewId: string) => string | null;
  dashboardViewId: string;
  /** Never offered (the flow's own default view). The dashboard view is always excluded. */
  excludeViewIds?: readonly string[];
  /** The other workspace databases in catalog order (the primary's entry is skipped). */
  catalog: PickerCatalogDatabase[];
  query: string;
  otherExpanded: boolean;
  /** Databases whose "Show {n} more" was clicked. */
  showAll: ReadonlySet<string>;
  timelineCreation: PickerCreationState;
  chartCreation: Exclude<PickerCreationState, 'hidden'>;
  canCreateInOtherDatabases: boolean;
  /** The New view section (add mode). */
  includeNewView: boolean;
  /** The label the search matches for a New view row (the translated picker label). */
  layoutLabel: (layout: DatabaseViewLayout) => string;
  /** Name of an unnamed view. */
  fallbackName: (layout: ViewLayout) => string;
}

export interface PickerViewGroup {
  databaseId: string;
  name: string;
  options: WidgetPickerOption[];
  /** Views behind "Show {n} more". */
  more: number;
}

export interface PickerOtherGroup extends PickerViewGroup {
  /** The trailing "New view in {database}" row. */
  newInDatabase: boolean;
}

export interface PickerNewViewRow {
  layout: DatabaseViewLayout;
  disabled: boolean;
}

export interface WidgetPickerSections {
  /** `null` when the primary database has nothing to offer (or nothing matches). */
  host: PickerViewGroup | null;
  other: { expanded: boolean; groups: PickerOtherGroup[] };
  newView: PickerNewViewRow[];
  /** A non-empty query matched nothing. */
  noResults: boolean;
}

// The normalized text of every built option and name: a keystroke compares
// against it instead of normalizing the whole workspace again.
const searchKeys = new Map<string, string>();

function searchKey(text: string) {
  let key = searchKeys.get(text);

  if (key === undefined) {
    key = normalizeDashboardText(text);
    if (searchKeys.size > 5000) searchKeys.clear();
    searchKeys.set(text, key);
  }

  return key;
}

function truncate(
  options: WidgetPickerOption[],
  databaseId: string,
  input: BuildWidgetPickerSectionsInput,
  searching: boolean
) {
  if (searching || input.showAll.has(databaseId) || options.length <= PICKER_GROUP_LIMIT) {
    return { options, more: 0 };
  }

  return { options: options.slice(0, PICKER_GROUP_LIMIT), more: options.length - PICKER_GROUP_LIMIT };
}

/** The options of one database that a query keeps: all when its name matches, else the views whose name does. */
function matchOptions(options: WidgetPickerOption[], databaseName: string, query: string) {
  if (!query || (databaseName && searchKey(databaseName).includes(query))) return options;
  return options.filter((option) => searchKey(option.name).includes(query));
}

/**
 * The picker's sections for one state: "Views on {primary}", "Other data
 * sources" (expanded on click or by any query) and "New view". Offered views:
 * not the dashboard itself, not the flow's own view, no Dashboard layout, and
 * only views nobody owns or this dashboard owns; an embedded host view only
 * when it is a tab or this dashboard owns it.
 */
export function buildWidgetPickerSections(input: BuildWidgetPickerSectionsInput): WidgetPickerSections {
  const query = normalizeDashboardText(input.query);
  const searching = query.length > 0;
  const excluded = new Set([input.dashboardViewId, ...(input.excludeViewIds ?? [])]);
  const tabIds = input.hostTabViewIds ? new Set(input.hostTabViewIds) : null;
  const ownedHere = (viewId: string) => input.ownerOf(viewId) === input.dashboardViewId;
  const offeredOwner = (viewId: string) => {
    const owner = input.ownerOf(viewId);

    return owner === null || owner === input.dashboardViewId;
  };

  const primaryOptions = input.primaryViews
    .filter((view) => {
      if (excluded.has(view.viewId) || !isWidgetSourceLayout(view.layout) || !offeredOwner(view.viewId)) return false;
      if (!input.primaryIsHost || !view.embedded) return true;
      return (tabIds?.has(view.viewId) ?? false) || ownedHere(view.viewId);
    })
    .map<WidgetPickerOption>((view) => ({
      viewId: view.viewId,
      databaseId: input.primaryDatabaseId,
      name: view.name.trim() || input.fallbackName(view.layout),
      layout: view.layout,
      icon: view.icon ?? null,
    }));
  const matchedPrimary = matchOptions(primaryOptions, input.primaryDatabaseName, query);
  const host =
    matchedPrimary.length > 0
      ? {
          databaseId: input.primaryDatabaseId,
          name: input.primaryDatabaseName,
          ...truncate(matchedPrimary, input.primaryDatabaseId, input, searching),
        }
      : null;

  const expanded = input.otherExpanded || searching;
  const groups: PickerOtherGroup[] = [];

  if (expanded) {
    input.catalog.forEach((database) => {
      if (database.databaseId === input.primaryDatabaseId) return;
      const options = database.views
        .filter(
          (view) =>
            !view.isContainer &&
            !excluded.has(view.viewId) &&
            isWidgetSourceLayout(view.layout) &&
            offeredOwner(view.viewId)
        )
        .map<WidgetPickerOption>((view) => ({
          viewId: view.viewId,
          databaseId: database.databaseId,
          name: view.name.trim() || input.fallbackName(view.layout),
          layout: Number(view.layout) as ViewLayout,
          icon: view.icon ?? null,
        }));
      const matched = matchOptions(options, database.name, query);

      if (matched.length === 0) return;
      groups.push({
        databaseId: database.databaseId,
        name: database.name,
        ...truncate(matched, database.databaseId, input, searching),
        newInDatabase: input.canCreateInOtherDatabases && input.includeNewView,
      });
    });
  }

  const newView: PickerNewViewRow[] = input.includeNewView
    ? NEW_VIEW_LAYOUTS.flatMap((layout) => {
        const state =
          layout === DatabaseViewLayout.Timeline
            ? input.timelineCreation
            : layout === DatabaseViewLayout.Chart
            ? input.chartCreation
            : 'enabled';

        if (state === 'hidden') return [];
        if (searching && !searchKey(input.layoutLabel(layout)).includes(query)) return [];
        return [{ layout, disabled: state === 'disabled' }];
      })
    : [];

  return {
    host,
    other: { expanded, groups },
    newView,
    noResults: searching && host === null && groups.length === 0 && newView.length === 0,
  };
}
