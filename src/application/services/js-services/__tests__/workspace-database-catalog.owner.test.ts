import { expect } from '@jest/globals';

import { getTokenParsed } from '@/application/session/token';
import { ViewLayout } from '@/application/types';

import { listWorkspaceDatabases } from '../http/view-api';
import {
  databaseCatalogViewToView,
  parseWorkspaceDatabaseViewItem,
  refreshWorkspaceDatabaseCatalog,
} from '../workspace-database-catalog';

jest.mock('@/application/db', () => ({
  db: {
    transaction: jest.fn(async (_mode: string, _table: unknown, callback: () => Promise<void>) => callback()),
    workspace_database_catalog: {
      bulkPut: jest.fn(),
      get: jest.fn(),
      where: jest.fn(() => ({ equals: () => ({ delete: jest.fn() }) })),
    },
  },
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

jest.mock('../http/view-api', () => ({
  listWorkspaceDatabases: jest.fn(),
}));

const item = {
  view_id: 'owned-board',
  layout: ViewLayout.Board,
  is_container: false,
  embedded: false,
  name: 'Board',
  icon: null,
  parent_view_id: 'container',
};

describe('workspace database catalog: dashboard owner (WP05 E2)', () => {
  beforeEach(() => {
    jest.mocked(getTokenParsed).mockReturnValue(null);
  });

  it('keeps an item without an owner as it is', () => {
    expect(parseWorkspaceDatabaseViewItem(item)).toBe(item);
    expect(parseWorkspaceDatabaseViewItem({ ...item, extra: '{"embedded":false}' })).toEqual({
      ...item,
      extra: '{"embedded":false}',
    });
  });

  it('reads the owner from the item, a projected extra object or its JSON string', () => {
    expect(parseWorkspaceDatabaseViewItem({ ...item, dashboard_owner: 'dash' }).dashboard_owner).toBe('dash');
    expect(parseWorkspaceDatabaseViewItem({ ...item, extra: { dashboard_owner: 'dash' } }).dashboard_owner).toBe('dash');
    expect(
      parseWorkspaceDatabaseViewItem({ ...item, extra: JSON.stringify({ dashboard_owner: 'dash', other: 1 }) })
        .dashboard_owner
    ).toBe('dash');
    expect(parseWorkspaceDatabaseViewItem({ ...item, extra: '{not json' }).dashboard_owner).toBeUndefined();
    expect(parseWorkspaceDatabaseViewItem({ ...item, dashboard_owner: '' }).dashboard_owner).toBe('');
  });

  it('carries the owner into the folder view a catalog item maps to', () => {
    expect(databaseCatalogViewToView('db', { ...item, dashboard_owner: 'dash' }).extra?.dashboard_owner).toBe('dash');
    expect(databaseCatalogViewToView('db', item).extra).not.toHaveProperty('dashboard_owner');
  });

  it('parses the owner of every refreshed catalog item', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([
      { database_id: 'db', views: [item, { ...item, view_id: 'other', extra: { dashboard_owner: 'dash' } } as never] },
    ]);

    const [database] = await refreshWorkspaceDatabaseCatalog('workspace-owner-test');

    expect(database.views[0]).toBe(item);
    expect(database.views[1].dashboard_owner).toBe('dash');
  });
});
