import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

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

import { readHostViews, useHostViews } from '../hooks/useHostViews';
import {
  buildWidgetPickerDatabases,
  buildWidgetPickerGroups,
  BuildWidgetPickerGroupsInput,
  getCatalogDatabaseName,
  HostViewEntry,
  isWidgetSourceLayout,
} from '../picker-options';

function catalogView(
  view_id: string,
  name: string,
  layout: ViewLayout,
  extra: Partial<WorkspaceDatabaseViewItem> = {}
): WorkspaceDatabaseViewItem {
  return { view_id, name, layout, is_container: false, embedded: false, icon: null, parent_view_id: null, ...extra };
}

const HOST_VIEWS: HostViewEntry[] = [
  { viewId: 'host-grid', name: 'Projects Grid', layout: ViewLayout.Grid, embedded: false },
  { viewId: 'host-dashboard', name: 'Dashboard', layout: ViewLayout.Dashboard, embedded: false },
  { viewId: 'host-other-dashboard', name: 'KPIs', layout: ViewLayout.Dashboard, embedded: false },
  { viewId: 'host-board', name: '', layout: ViewLayout.Board, embedded: false },
  { viewId: 'host-embedded', name: 'Inline copy', layout: ViewLayout.Grid, embedded: true },
];

const CATALOG: WorkspaceDatabaseWithViews[] = [
  {
    database_id: 'host-db',
    views: [
      catalogView('host-container', 'Projects', ViewLayout.Document, { is_container: true }),
      catalogView('host-grid', 'Projects (folder name)', ViewLayout.Grid, {
        icon: { ty: ViewIconType.Emoji, value: '🚀' },
      }),
    ],
  },
  {
    database_id: 'tasks-db',
    views: [
      catalogView('tasks-container', 'Tasks', ViewLayout.Document, { is_container: true }),
      catalogView('tasks-grid', 'Tasks Grid', ViewLayout.Grid),
      catalogView('tasks-calendar', 'Due dates', ViewLayout.Calendar),
      catalogView('tasks-dashboard', 'Tasks dashboard', ViewLayout.Dashboard),
    ],
  },
  {
    database_id: 'notes-db',
    views: [catalogView('notes-grid', '', ViewLayout.Grid, { embedded: true })],
  },
  {
    database_id: 'dashboards-only-db',
    views: [catalogView('only-dashboard', 'Only a dashboard', ViewLayout.Dashboard)],
  },
];

function groups(overrides: Partial<BuildWidgetPickerGroupsInput> = {}) {
  return buildWidgetPickerGroups({
    hostDatabaseId: 'host-db',
    hostDatabaseName: '',
    hostViews: HOST_VIEWS,
    hostTabViewIds: [],
    catalog: CATALOG,
    excludeViewIds: ['host-dashboard'],
    query: '',
    fallbackName: (layout) => `Untitled ${layout}`,
    ...overrides,
  });
}

describe('widget picker options', () => {
  it('accepts every database layout except dashboards', () => {
    expect(isWidgetSourceLayout(ViewLayout.Grid)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Timeline)).toBe(true);
    expect(isWidgetSourceLayout(ViewLayout.Chart)).toBe(true);
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

  it('lists the host views first and every other database after, without dashboards', () => {
    const result = groups();

    expect(result.map((group) => [group.databaseId, group.isHost])).toEqual([
      ['host-db', true],
      ['tasks-db', false],
      ['notes-db', false],
    ]);
    expect(result[0].name).toBe('Projects');
    expect(result[0].options.map((option) => option.viewId)).toEqual(['host-grid', 'host-board']);
    expect(result[1].options.map((option) => option.viewId)).toEqual(['tasks-grid', 'tasks-calendar']);
    expect(result.flatMap((group) => group.options).every((option) => option.layout !== ViewLayout.Dashboard)).toBe(
      true
    );
  });

  it('prefers folder names and icons and names untitled views after their layout', () => {
    const [host, , notes] = groups();

    expect(host.options[0]).toEqual({
      viewId: 'host-grid',
      databaseId: 'host-db',
      name: 'Projects (folder name)',
      layout: ViewLayout.Grid,
      icon: { ty: ViewIconType.Emoji, value: '🚀' },
    });
    expect(host.options[1].name).toBe(`Untitled ${ViewLayout.Board}`);
    expect(notes.options[0].name).toBe(`Untitled ${ViewLayout.Grid}`);
  });

  it('offers embedded host views only when they are tabs of the dashboard database', () => {
    expect(groups()[0].options.some((option) => option.viewId === 'host-embedded')).toBe(false);
    expect(
      groups({ hostTabViewIds: ['host-embedded'] })[0].options.some((option) => option.viewId === 'host-embedded')
    ).toBe(true);
  });

  it('filters by view name or database name', () => {
    expect(groups({ query: 'due' }).map((group) => group.options.map((option) => option.viewId))).toEqual([
      ['tasks-calendar'],
    ]);
    expect(groups({ query: '  TASKS ' }).map((group) => group.databaseId)).toEqual(['tasks-db']);
    expect(groups({ query: 'tasks' })[0].options.map((option) => option.viewId)).toEqual([
      'tasks-grid',
      'tasks-calendar',
    ]);
    expect(groups({ query: 'projects' }).map((group) => group.databaseId)).toEqual(['host-db']);
    expect(groups({ query: 'nothing matches' })).toEqual([]);
  });

  it('uses the given host name and works without a catalog', () => {
    const result = groups({ catalog: [], hostDatabaseName: 'My projects' });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('My projects');
    expect(result[0].options.map((option) => option.name)).toEqual(['Projects Grid', `Untitled ${ViewLayout.Board}`]);
  });

  it('lists the databases a new view can be created in, host first', () => {
    const databases = buildWidgetPickerDatabases({
      hostDatabaseId: 'host-db',
      hostDatabaseName: '',
      hostPrimaryViewId: 'host-grid',
      catalog: CATALOG,
    });

    expect(databases).toEqual([
      { databaseId: 'host-db', name: 'Projects', primaryViewId: 'host-grid', isHost: true },
      { databaseId: 'tasks-db', name: 'Tasks', primaryViewId: 'tasks-grid', isHost: false },
      // An embedded-only database still opens through its embedded view.
      { databaseId: 'notes-db', name: '', primaryViewId: 'notes-grid', isHost: false },
    ]);
  });

  it('always offers the host database, even without a catalog', () => {
    expect(
      buildWidgetPickerDatabases({
        hostDatabaseId: 'host-db',
        hostDatabaseName: 'Host',
        hostPrimaryViewId: 'host-grid',
        catalog: [],
      })
    ).toEqual([{ databaseId: 'host-db', name: 'Host', primaryViewId: 'host-grid', isHost: true }]);
  });
});

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
  }
) {
  const view = new Y.Map() as YDatabaseView;

  views.set(viewId, view);
  if (fields.name !== undefined) view.set(YjsDatabaseKey.name, fields.name);
  if (fields.layout !== undefined) view.set(YjsDatabaseKey.layout, fields.layout);
  if (fields.createdAt !== undefined) view.set(YjsDatabaseKey.created_at, fields.createdAt as never);
  if (fields.inline) view.set(YjsDatabaseKey.is_inline, true);
  if (fields.embedded) view.set(YjsDatabaseKey.embedded, true as never);
  return view;
}

describe('host views', () => {
  it('reads non-inline views in creation order', () => {
    const { views } = createViews();

    addView(views, 'late', { name: 'Late', layout: DatabaseViewLayout.Board, createdAt: 300 });
    addView(views, 'early', { name: 'Early', layout: DatabaseViewLayout.Grid, createdAt: '100' });
    addView(views, 'inline', { name: 'Inline', layout: DatabaseViewLayout.Grid, createdAt: 50, inline: true });
    addView(views, 'undated', { layout: DatabaseViewLayout.Dashboard });
    addView(views, 'embedded', { name: 'Embedded', createdAt: 200, embedded: true });

    expect(readHostViews(views)).toEqual([
      { viewId: 'early', name: 'Early', layout: ViewLayout.Grid, embedded: false },
      { viewId: 'embedded', name: 'Embedded', layout: ViewLayout.Grid, embedded: true },
      { viewId: 'late', name: 'Late', layout: ViewLayout.Board, embedded: false },
      { viewId: 'undated', name: '', layout: ViewLayout.Dashboard, embedded: false },
    ]);
    expect(readHostViews(undefined)).toEqual([]);
  });

  it('follows views being added and renamed', () => {
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
  });

  it('is empty without a database', () => {
    const { result } = renderHook(() => useHostViews(undefined));

    expect(result.current).toEqual([]);
  });
});
