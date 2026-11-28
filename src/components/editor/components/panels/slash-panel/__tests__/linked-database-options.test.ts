import type { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { ViewLayout } from '@/application/types';

import {
  filterLinkedDatabaseTree,
  findLinkedDatabaseSelection,
  getLinkedDatabaseOptions,
  getLinkedDatabaseSelectableIds,
} from '../linked-database-options';

// The real catalog projections, so the picker follows the app's container and primary-view policy.
jest.mock('@/application/services/domains/view', () => {
  const catalog = jest.requireActual('@/application/services/js-services/workspace-database-catalog');

  return {
    databaseCatalogViewToView: catalog.databaseCatalogViewToView,
    getDatabaseContainerEntries: catalog.getDatabaseContainerEntries,
  };
});

function catalogView(
  viewId: string,
  name: string,
  layout: ViewLayout,
  extra: Partial<WorkspaceDatabaseViewItem> = {}
): WorkspaceDatabaseViewItem {
  return {
    view_id: viewId,
    name,
    layout,
    is_container: false,
    embedded: false,
    icon: null,
    parent_view_id: 'space',
    ...extra,
  };
}

const projects: WorkspaceDatabaseWithViews = {
  database_id: 'projects-db',
  views: [
    catalogView('projects-page', 'Projects', ViewLayout.Grid, { is_container: true }),
    catalogView('projects-grid', 'Grid', ViewLayout.Grid, { parent_view_id: 'projects-page' }),
    catalogView('projects-dashboard', 'Dashboard', ViewLayout.Dashboard, { parent_view_id: 'projects-page' }),
    catalogView('projects-kpis', 'KPIs', ViewLayout.Dashboard, { parent_view_id: 'projects-page' }),
    // A widget's own view, kept off the tab bar: never a dashboard of its own.
    catalogView('owned-board', 'Board', ViewLayout.Board, {
      parent_view_id: 'projects-page',
      dashboard_owner: 'projects-dashboard',
    }),
  ],
};
// `/dashboard` in a document: a standalone Grid page and its dashboard embedded in the document.
const slashDashboard: WorkspaceDatabaseWithViews = {
  database_id: 'slash-db',
  views: [
    catalogView('slash-grid', 'New Database', ViewLayout.Grid, { parent_view_id: 'document' }),
    catalogView('slash-dashboard', 'Dashboard', ViewLayout.Dashboard, {
      parent_view_id: 'document',
      embedded: true,
    }),
  ],
};
const tasks: WorkspaceDatabaseWithViews = {
  database_id: 'tasks-db',
  views: [
    catalogView('tasks-page', 'Tasks', ViewLayout.Grid, { is_container: true }),
    catalogView('tasks-grid', 'Grid', ViewLayout.Grid, { parent_view_id: 'tasks-page' }),
  ],
};
const catalog = [projects, slashDashboard, tasks];

describe('the linked database picker', () => {
  it('lists the dashboards of each database under it for a linked Dashboard', () => {
    const options = getLinkedDatabaseOptions(catalog, ViewLayout.Dashboard);

    expect(options.map((option) => [option.view.name, option.dashboards.map((view) => view.view_id)])).toEqual([
      ['Projects', ['projects-dashboard', 'projects-kpis']],
      ['New Database', ['slash-dashboard']],
      ['Tasks', []],
    ]);
    // The database row holds them, so the tree shows them beneath it.
    expect(options[0].view.children.map((view) => view.view_id)).toEqual(['projects-dashboard', 'projects-kpis']);
    expect(options[0].dashboards[0]).toMatchObject({
      layout: ViewLayout.Dashboard,
      extra: { database_id: 'projects-db' },
    });
    // A new linked view is still modelled on the database's primary view.
    expect(options.map((option) => option.sourceViewId)).toEqual(['projects-grid', 'slash-grid', 'tasks-grid']);
  });

  it('lists no dashboards for the other linked layouts', () => {
    const options = getLinkedDatabaseOptions(catalog, ViewLayout.Grid);

    expect(options.every((option) => option.dashboards.length === 0 && option.view.children.length === 0)).toBe(true);
  });

  it('tells a picked database from a picked dashboard', () => {
    const options = getLinkedDatabaseOptions(catalog, ViewLayout.Dashboard);

    expect(findLinkedDatabaseSelection(options, 'projects-page')).toEqual({ option: options[0] });
    expect(findLinkedDatabaseSelection(options, 'projects-kpis')).toEqual({
      option: options[0],
      dashboard: options[0].dashboards[1],
    });
    expect(findLinkedDatabaseSelection(options, 'slash-dashboard')?.option.databaseId).toBe('slash-db');
    expect(findLinkedDatabaseSelection(options, 'owned-board')).toBeUndefined();
    expect([...getLinkedDatabaseSelectableIds(options)]).toEqual([
      'projects-page',
      'projects-dashboard',
      'projects-kpis',
      'slash-grid',
      'slash-dashboard',
      'tasks-page',
    ]);
  });

  it('keeps every dashboard of a database whose name matches the search', () => {
    const options = getLinkedDatabaseOptions(catalog, ViewLayout.Dashboard);
    const tree = filterLinkedDatabaseTree(
      options.map((option) => option.view),
      getLinkedDatabaseSelectableIds(options),
      'proj'
    );

    expect(tree.map((view) => [view.name, view.children.map((child) => child.name)])).toEqual([
      ['Projects', ['Dashboard', 'KPIs']],
    ]);
  });

  it('keeps a database for a matching dashboard, with only the dashboards that match', () => {
    const options = getLinkedDatabaseOptions(catalog, ViewLayout.Dashboard);
    const views = options.map((option) => option.view);
    const selectable = getLinkedDatabaseSelectableIds(options);

    expect(
      filterLinkedDatabaseTree(views, selectable, 'kpi').map((view) => [view.name, view.children.map((child) => child.name)])
    ).toEqual([['Projects', ['KPIs']]]);
    expect(filterLinkedDatabaseTree(views, selectable, '').map((view) => view.children.length)).toEqual([2, 1, 0]);
    expect(filterLinkedDatabaseTree(views, selectable, 'nothing')).toEqual([]);
  });
});
