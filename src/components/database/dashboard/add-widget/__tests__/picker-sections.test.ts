import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import {
  DatabaseViewLayout,
  ViewIconType,
  ViewLayout,
  YDatabase,
  YDatabaseView,
  YDatabaseViews,
  YjsDatabaseKey,
} from '@/application/types';

import { NEW_VIEW_LAYOUTS as CONSTANT_NEW_VIEW_LAYOUTS } from '../../constants';
import { readHostViews, useHostViews } from '../../hooks/useHostViews';
import {
  buildWidgetPickerSections,
  BuildWidgetPickerSectionsInput,
  CONFIG_TILE_LAYOUTS,
  getCatalogDatabaseName,
  HostViewEntry,
  isWidgetSourceLayout,
  NEW_VIEW_LAYOUTS,
  PICKER_GROUP_LIMIT,
  PickerCatalogDatabase,
  toPickerCatalog,
  WidgetPickerSections,
} from '../picker-sections';

// ---------------------------------------------------------------------------
// The shared fixture (`dashboard-parity/add-widget.json` `picker_sections`)
// ---------------------------------------------------------------------------

type LayoutName =
  | 'grid'
  | 'board'
  | 'calendar'
  | 'chart'
  | 'list'
  | 'gallery'
  | 'feed'
  | 'form'
  | 'timeline'
  | 'dashboard';

interface FixtureView {
  id: string;
  name: string;
  layout: LayoutName;
  embedded?: boolean;
  is_container?: boolean;
}

interface FixtureCase {
  name: string;
  input: {
    host_database: { id: string; name: string };
    host_views: FixtureView[];
    host_tab_view_ids: string[] | null;
    owned: Record<string, string>;
    dashboard_view_id: string;
    flow_view_id: string | null;
    catalog: { id: string; name: string; views: FixtureView[] }[];
    query: string;
    other_expanded: boolean;
    show_all: string[];
    timeline_creation: 'enabled' | 'disabled' | 'hidden';
    chart_creation: 'enabled' | 'disabled';
    can_create_in_other_databases: boolean;
  };
  expect: {
    host: { title: string; view_ids: string[]; more: number } | null;
    other: {
      expanded: boolean;
      groups: { database_id: string; name: string; view_ids: string[]; more: number; new_in_database: boolean }[];
    };
    new_view: LayoutName[];
    new_view_disabled: LayoutName[];
    no_results: boolean;
  };
}

interface AddWidgetFixture {
  picker_layout_labels: Record<string, string>;
  picker_sections: FixtureCase[];
}

const FIXTURE = loadParityFixture<AddWidgetFixture>('add-widget.json');

const VIEW_LAYOUTS: Record<LayoutName, ViewLayout> = {
  grid: ViewLayout.Grid,
  board: ViewLayout.Board,
  calendar: ViewLayout.Calendar,
  chart: ViewLayout.Chart,
  list: ViewLayout.List,
  gallery: ViewLayout.Gallery,
  feed: ViewLayout.Feed,
  form: ViewLayout.Form,
  timeline: ViewLayout.Timeline,
  dashboard: ViewLayout.Dashboard,
};

const DATABASE_LAYOUT_NAMES: Partial<Record<DatabaseViewLayout, LayoutName>> = {
  [DatabaseViewLayout.Grid]: 'grid',
  [DatabaseViewLayout.Board]: 'board',
  [DatabaseViewLayout.Calendar]: 'calendar',
  [DatabaseViewLayout.Chart]: 'chart',
  [DatabaseViewLayout.List]: 'list',
  [DatabaseViewLayout.Gallery]: 'gallery',
  [DatabaseViewLayout.Feed]: 'feed',
  [DatabaseViewLayout.Timeline]: 'timeline',
};

function labelOf(layout: DatabaseViewLayout) {
  return FIXTURE.picker_layout_labels[DATABASE_LAYOUT_NAMES[layout] ?? ''] ?? '';
}

function inputOf(fixtureCase: FixtureCase): BuildWidgetPickerSectionsInput {
  const { input } = fixtureCase;

  return {
    primaryDatabaseId: input.host_database.id,
    primaryDatabaseName: input.host_database.name,
    primaryIsHost: true,
    primaryViews: input.host_views.map<HostViewEntry>((view) => ({
      viewId: view.id,
      name: view.name,
      layout: VIEW_LAYOUTS[view.layout],
      embedded: view.embedded === true,
    })),
    hostTabViewIds: input.host_tab_view_ids,
    ownerOf: (viewId) => input.owned[viewId] ?? null,
    dashboardViewId: input.dashboard_view_id,
    excludeViewIds: input.flow_view_id ? [input.flow_view_id] : [],
    catalog: input.catalog.map<PickerCatalogDatabase>((database) => ({
      databaseId: database.id,
      name: database.name,
      views: database.views.map((view) => ({
        viewId: view.id,
        name: view.name,
        layout: VIEW_LAYOUTS[view.layout],
        isContainer: view.is_container === true,
      })),
    })),
    query: input.query,
    otherExpanded: input.other_expanded,
    showAll: new Set(input.show_all),
    timelineCreation: input.timeline_creation,
    chartCreation: input.chart_creation,
    canCreateInOtherDatabases: input.can_create_in_other_databases,
    includeNewView: true,
    layoutLabel: labelOf,
    fallbackName: () => 'Untitled',
  };
}

/** The English section title the clients render (`dashboard.picker.viewsOn` / `.viewsOnThisDatabase`). */
function hostTitle(name: string) {
  return name ? `Views on ${name}` : 'Views on this database';
}

function project(sections: WidgetPickerSections, primaryName: string) {
  return {
    host: sections.host
      ? {
          title: hostTitle(primaryName),
          view_ids: sections.host.options.map((option) => option.viewId),
          more: sections.host.more,
        }
      : null,
    other: {
      expanded: sections.other.expanded,
      groups: sections.other.groups.map((group) => ({
        database_id: group.databaseId,
        name: group.name,
        view_ids: group.options.map((option) => option.viewId),
        more: group.more,
        new_in_database: group.newInDatabase,
      })),
    },
    new_view: sections.newView.map((row) => DATABASE_LAYOUT_NAMES[row.layout]),
    new_view_disabled: sections.newView.filter((row) => row.disabled).map((row) => DATABASE_LAYOUT_NAMES[row.layout]),
    no_results: sections.noResults,
  };
}

describe('buildWidgetPickerSections against add-widget.json', () => {
  it('has every case', () => {
    expect(FIXTURE.picker_sections.length).toBeGreaterThanOrEqual(5);
  });

  it.each(FIXTURE.picker_sections.map((fixtureCase) => [fixtureCase.name, fixtureCase] as const))(
    '%s',
    (_name, fixtureCase) => {
      const sections = buildWidgetPickerSections(inputOf(fixtureCase));

      expect(project(sections, fixtureCase.input.host_database.name)).toEqual(fixtureCase.expect);
    }
  );
});

// ---------------------------------------------------------------------------
// Rules around the fixture
// ---------------------------------------------------------------------------

function catalogView(
  view_id: string,
  name: string,
  layout: ViewLayout,
  extra: Partial<WorkspaceDatabaseViewItem> = {}
): WorkspaceDatabaseViewItem {
  return { view_id, name, layout, is_container: false, embedded: false, icon: null, parent_view_id: null, ...extra };
}

const CATALOG: WorkspaceDatabaseWithViews[] = [
  {
    database_id: 'host-db',
    views: [
      catalogView('host-container', 'Projects', ViewLayout.Document, { is_container: true }),
      catalogView('host-grid', 'Projects Grid', ViewLayout.Grid),
    ],
  },
  {
    database_id: 'tasks-db',
    views: [
      catalogView('tasks-container', 'Tasks', ViewLayout.Document, { is_container: true }),
      catalogView('tasks-grid', 'Tasks Grid', ViewLayout.Grid, { icon: { ty: ViewIconType.Emoji, value: '🚀' } }),
      catalogView('tasks-calendar', '', ViewLayout.Calendar),
      catalogView('tasks-dashboard', 'Tasks dashboard', ViewLayout.Dashboard),
    ],
  },
];

const HOST_VIEWS: HostViewEntry[] = [
  { viewId: 'host-grid', name: 'Projects Grid', layout: ViewLayout.Grid, embedded: false },
  { viewId: 'dash', name: 'Dashboard', layout: ViewLayout.Dashboard, embedded: false },
  { viewId: 'flow', name: 'Chart', layout: ViewLayout.Chart, embedded: false },
  { viewId: 'embedded-tab', name: 'Linked', layout: ViewLayout.Grid, embedded: true },
  { viewId: 'embedded-owned', name: 'Owned board', layout: ViewLayout.Board, embedded: true },
  { viewId: 'embedded-loose', name: 'Inline copy', layout: ViewLayout.Grid, embedded: true },
  { viewId: 'other-owned', name: 'Other board', layout: ViewLayout.Board, embedded: false },
];

const OWNERS: Record<string, string> = { 'embedded-owned': 'dash', 'other-owned': 'dash-2', flow: 'dash' };

function sections(overrides: Partial<BuildWidgetPickerSectionsInput> = {}) {
  return buildWidgetPickerSections({
    primaryDatabaseId: 'host-db',
    primaryDatabaseName: 'Projects',
    primaryIsHost: true,
    primaryViews: HOST_VIEWS,
    hostTabViewIds: ['host-grid', 'embedded-tab'],
    ownerOf: (viewId) => OWNERS[viewId] ?? null,
    dashboardViewId: 'dash',
    excludeViewIds: ['flow'],
    catalog: toPickerCatalog(CATALOG),
    query: '',
    otherExpanded: true,
    showAll: new Set(),
    timelineCreation: 'enabled',
    chartCreation: 'enabled',
    canCreateInOtherDatabases: true,
    includeNewView: true,
    layoutLabel: (layout) => labelOf(layout),
    fallbackName: (layout) => `Untitled ${layout}`,
    ...overrides,
  });
}

describe('widget picker sections', () => {
  it('accepts every database layout except dashboards', () => {
    expect(isWidgetSourceLayout(ViewLayout.Grid)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Timeline)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Chart)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Form)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Dashboard)).toBe(false);
    expect(isWidgetSourceLayout(ViewLayout.Document)).toBe(false);
    expect(isWidgetSourceLayout(String(ViewLayout.Board) as unknown as ViewLayout)).toBe(true);
  });

  it('names a catalog database after its container, else its first regular view', () => {
    expect(getCatalogDatabaseName(CATALOG[1])).toBe('Tasks');
    expect(getCatalogDatabaseName({ database_id: 'x', views: [catalogView('v', ' Loose ', ViewLayout.Board)] })).toBe(
      'Loose'
    );
    expect(getCatalogDatabaseName({ database_id: 'x', views: [] })).toBe('');
  });

  it("never offers the dashboard itself or the flow's own view", () => {
    const ids = sections().host?.options.map((option) => option.viewId);

    expect(ids).not.toContain('dash');
    expect(ids).not.toContain('flow');
  });

  // WP05 §1.9: views owned by this dashboard are offered (even embedded ones that are no tab), another dashboard's never.
  it("offers this dashboard's own views, embedded host views only as tabs, and hides another dashboard's", () => {
    expect(sections().host?.options.map((option) => option.viewId)).toEqual([
      'host-grid',
      'embedded-tab',
      'embedded-owned',
    ]);
    expect(sections({ hostTabViewIds: [] }).host?.options.map((option) => option.viewId)).toEqual([
      'host-grid',
      'embedded-owned',
    ]);
  });

  it('hides views another dashboard owns in other databases and in search', () => {
    const result = sections({
      ownerOf: (viewId) => (({ 'tasks-calendar': 'dash-2' } as Record<string, string>)[viewId] ?? null),
      query: 'tasks',
    });

    expect(result.other.groups.map((group) => group.options.map((option) => option.viewId))).toEqual([['tasks-grid']]);
  });

  it('keeps catalog icons and names untitled views after their layout', () => {
    const tasks = sections().other.groups[0];

    expect(tasks.options[0]).toEqual({
      viewId: 'tasks-grid',
      databaseId: 'tasks-db',
      name: 'Tasks Grid',
      layout: ViewLayout.Grid,
      icon: { ty: ViewIconType.Emoji, value: '🚀' },
    });
    expect(tasks.options[1].name).toBe(`Untitled ${ViewLayout.Calendar}`);
  });

  it('never offers Dashboard or Form as a new view type, in Notion order', () => {
    expect(NEW_VIEW_LAYOUTS).toBe(CONSTANT_NEW_VIEW_LAYOUTS);
    expect(sections().newView.map((row) => row.layout)).toEqual([
      DatabaseViewLayout.Grid,
      DatabaseViewLayout.Board,
      DatabaseViewLayout.Gallery,
      DatabaseViewLayout.List,
      DatabaseViewLayout.Chart,
      DatabaseViewLayout.Timeline,
      DatabaseViewLayout.Feed,
      DatabaseViewLayout.Calendar,
    ]);
    expect(CONFIG_TILE_LAYOUTS).toEqual([
      DatabaseViewLayout.Grid,
      DatabaseViewLayout.Board,
      DatabaseViewLayout.Timeline,
      DatabaseViewLayout.Calendar,
      DatabaseViewLayout.List,
      DatabaseViewLayout.Gallery,
      DatabaseViewLayout.Chart,
      DatabaseViewLayout.Feed,
    ]);
  });

  it('hides Timeline while its creation flag is off and disables it while the plan refuses it', () => {
    const layouts = (state: 'enabled' | 'disabled' | 'hidden') =>
      sections({ timelineCreation: state }).newView.filter((row) => row.layout === DatabaseViewLayout.Timeline);

    expect(layouts('hidden')).toEqual([]);
    expect(layouts('disabled')).toEqual([{ layout: DatabaseViewLayout.Timeline, disabled: true }]);
    expect(layouts('enabled')).toEqual([{ layout: DatabaseViewLayout.Timeline, disabled: false }]);
  });

  it('truncates every group to five until Show more, per database', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      viewId: `v${index}`,
      name: `View ${index}`,
      layout: ViewLayout.Grid,
      embedded: false,
    }));

    expect(sections({ primaryViews: many }).host?.options).toHaveLength(PICKER_GROUP_LIMIT);
    expect(sections({ primaryViews: many }).host?.more).toBe(2);
    expect(sections({ primaryViews: many, showAll: new Set(['host-db']) }).host?.options).toHaveLength(7);
  });

  it('matches accents and case the same way ("Café" matches "cafe")', () => {
    const result = sections({
      primaryViews: [{ viewId: 'cafe', name: 'Café', layout: ViewLayout.Grid, embedded: false }],
      hostTabViewIds: null,
      query: 'cafe',
    });

    expect(result.host?.options.map((option) => option.viewId)).toEqual(['cafe']);
  });

  it('lists no New view section in replace mode (Settings › Source)', () => {
    const result = sections({ includeNewView: false });

    expect(result.newView).toEqual([]);
    expect(result.other.groups.every((group) => !group.newInDatabase)).toBe(true);
  });

  it('lists a foreign primary database from the catalog without the host tab rule', () => {
    const result = sections({
      primaryDatabaseId: 'tasks-db',
      primaryDatabaseName: 'Tasks',
      primaryIsHost: false,
      primaryViews: [{ viewId: 'tasks-grid', name: 'Tasks Grid', layout: ViewLayout.Grid, embedded: true }],
      includeNewView: false,
    });

    expect(result.host?.options.map((option) => option.viewId)).toEqual(['tasks-grid']);
    // The primary database is not listed again under Other data sources; the host is.
    expect(result.other.groups.map((group) => group.databaseId)).toEqual(['host-db']);
  });
});

// ---------------------------------------------------------------------------
// Host views (the live list the picker reads)
// ---------------------------------------------------------------------------

function createViews() {
  const doc = new Y.Doc();
  const database = doc.getMap('database') as unknown as YDatabase;
  const views = new Y.Map() as unknown as YDatabaseViews;

  database.set(YjsDatabaseKey.views, views as never);
  return { database, views };
}

function addView(
  views: YDatabaseViews,
  viewId: string,
  fields: {
    name?: string;
    layout?: DatabaseViewLayout;
    createdAt?: number | string;
    inline?: boolean;
    embedded?: boolean;
    owner?: string;
  }
) {
  const view = new Y.Map() as YDatabaseView;

  views.set(viewId, view);
  if (fields.name !== undefined) view.set(YjsDatabaseKey.name, fields.name);
  if (fields.layout !== undefined) view.set(YjsDatabaseKey.layout, fields.layout);
  if (fields.createdAt !== undefined) view.set(YjsDatabaseKey.created_at, fields.createdAt as never);
  if (fields.inline) view.set(YjsDatabaseKey.is_inline, true);
  if (fields.embedded) view.set(YjsDatabaseKey.embedded, true as never);
  if (fields.owner !== undefined) view.set(YjsDatabaseKey.dashboard_owner, fields.owner as never);
  return view;
}

describe('host views', () => {
  it('reads non-inline views in creation order, with their collab owner', () => {
    const { views } = createViews();

    addView(views, 'late', { name: 'Late', layout: DatabaseViewLayout.Board, createdAt: 300, owner: 'dash' });
    addView(views, 'early', { name: 'Early', layout: DatabaseViewLayout.Grid, createdAt: '100' });
    addView(views, 'inline', { name: 'Inline', layout: DatabaseViewLayout.Grid, createdAt: 50, inline: true });
    addView(views, 'undated', { layout: DatabaseViewLayout.Dashboard, owner: '' });
    addView(views, 'embedded', { name: 'Embedded', createdAt: 200, embedded: true });

    expect(readHostViews(views)).toEqual([
      { viewId: 'early', name: 'Early', layout: ViewLayout.Grid, embedded: false, dashboardOwner: null },
      { viewId: 'embedded', name: 'Embedded', layout: ViewLayout.Grid, embedded: true, dashboardOwner: null },
      { viewId: 'late', name: 'Late', layout: ViewLayout.Board, embedded: false, dashboardOwner: 'dash' },
      { viewId: 'undated', name: '', layout: ViewLayout.Dashboard, embedded: false, dashboardOwner: null },
    ]);
    expect(readHostViews(undefined)).toEqual([]);
  });

  it('follows views being added, renamed and marked owned', () => {
    const { database, views } = createViews();
    const grid = addView(views, 'grid', { name: 'Grid', layout: DatabaseViewLayout.Grid, createdAt: 1 });
    const { result } = renderHook(() => useHostViews(database));
    const before = result.current;

    expect(before.map((view) => view.viewId)).toEqual(['grid']);

    act(() => {
      addView(views, 'chart', { name: 'Chart', layout: DatabaseViewLayout.Chart, createdAt: 2 });
    });
    expect(result.current.map((view) => [view.viewId, view.layout])).toEqual([
      ['grid', ViewLayout.Grid],
      ['chart', ViewLayout.Chart],
    ]);

    act(() => {
      grid.set(YjsDatabaseKey.name, 'Renamed');
    });
    expect(result.current[0].name).toBe('Renamed');

    act(() => {
      grid.set(YjsDatabaseKey.dashboard_owner, 'dash' as never);
    });
    expect(result.current[0].dashboardOwner).toBe('dash');
  });

  it('is empty without a database', () => {
    const { result } = renderHook(() => useHostViews(undefined));

    expect(result.current).toEqual([]);
  });
});
