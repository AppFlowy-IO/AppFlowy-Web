import { db } from '@/application/db';
import { getTokenParsed } from '@/application/session/token';
import { ViewLayout } from '@/application/types';

import {
  getDatabaseContainerEntries,
  getDatabaseIdFromWorkspaceCatalog,
  getViewIdFromWorkspaceCatalog,
  refreshWorkspaceDatabaseCatalog,
} from '../workspace-database-catalog';
import { listWorkspaceDatabases } from '../http/view-api';

jest.mock('@/application/db', () => ({
  db: {
    transaction: jest.fn(async (_mode: string, _table: unknown, callback: () => Promise<void>) => callback()),
    workspace_database_catalog: {
      bulkPut: jest.fn(),
      get: jest.fn(),
      where: jest.fn(),
    },
  },
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

jest.mock('../http/view-api', () => ({
  listWorkspaceDatabases: jest.fn(),
}));

const catalogTable = db.workspace_database_catalog as unknown as {
  bulkPut: jest.Mock;
  get: jest.Mock;
  where: jest.Mock;
};
const transaction = db.transaction as jest.Mock;
const deleteWorkspaceRecords = jest.fn();
const readDatabaseRecords = jest.fn();

const database = {
  database_id: 'database-1',
  views: [
    {
      view_id: 'container-1',
      layout: ViewLayout.Grid,
      is_container: true,
      embedded: false,
      name: 'Projects',
      icon: null,
      parent_view_id: 'space-1',
    },
    {
      view_id: 'grid-1',
      layout: ViewLayout.Grid,
      is_container: false,
      embedded: false,
      name: 'Grid',
      icon: null,
      parent_view_id: 'container-1',
    },
  ],
};

function setCurrentUser(userId = 'user-1') {
  jest.mocked(getTokenParsed).mockReturnValue({
    access_token: 'access-token',
    expires_at: Date.now() + 60_000,
    refresh_token: 'refresh-token',
    user: { id: userId, email: `${userId}@example.com` },
  });
}

describe('workspace database catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setCurrentUser();
    catalogTable.bulkPut.mockResolvedValue(undefined);
    catalogTable.get.mockResolvedValue(undefined);
    deleteWorkspaceRecords.mockResolvedValue(undefined);
    readDatabaseRecords.mockResolvedValue([]);
    catalogTable.where.mockImplementation((index: string) => ({
      equals: jest.fn(() =>
        index === '[user_id+workspace_id]' ? { delete: deleteWorkspaceRecords } : { toArray: readDatabaseRecords }
      ),
    }));
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([database]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves a view mapping from IndexedDB without requesting the server', async () => {
    catalogTable.get.mockResolvedValue({ database_id: 'database-1' });

    await expect(getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1')).resolves.toBe('database-1');

    expect(catalogTable.get).toHaveBeenCalledWith(['user-1', 'workspace-1', 'grid-1']);
    expect(listWorkspaceDatabases).not.toHaveBeenCalled();
  });

  it('returns one selectable entry per database container', () => {
    const withoutContainer = {
      database_id: 'database-without-container',
      views: [database.views[1]],
    };

    expect(getDatabaseContainerEntries([database, withoutContainer])).toEqual([
      {
        databaseId: 'database-1',
        container: database.views[0],
        primaryView: database.views[1],
      },
    ]);
  });

  it('refreshes and atomically replaces IndexedDB records after a cache miss', async () => {
    await expect(getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1')).resolves.toBe('database-1');

    expect(listWorkspaceDatabases).toHaveBeenCalledWith('workspace-1');
    expect(transaction).toHaveBeenCalledWith('rw', catalogTable, expect.any(Function));
    expect(deleteWorkspaceRecords).toHaveBeenCalledTimes(1);
    expect(catalogTable.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        database_id: 'database-1',
        view_id: 'container-1',
      }),
      expect.objectContaining({
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        database_id: 'database-1',
        view_id: 'grid-1',
      }),
    ]);
  });

  it('deduplicates concurrent server refreshes for the same user and workspace', async () => {
    let resolveRequest: ((value: (typeof database)[]) => void) | undefined;
    const request = new Promise<(typeof database)[]>((resolve) => {
      resolveRequest = resolve;
    });

    jest.mocked(listWorkspaceDatabases).mockReturnValue(request);

    const first = getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1');
    const second = getDatabaseIdFromWorkspaceCatalog('workspace-1', 'container-1');

    await Promise.resolve();
    await Promise.resolve();
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);

    resolveRequest?.([database]);
    await expect(Promise.all([first, second])).resolves.toEqual(['database-1', 'database-1']);
  });

  it('uses the cached primary non-container view for a database ID', async () => {
    readDatabaseRecords.mockResolvedValue([
      { view_order: 0, view: database.views[0] },
      { view_order: 1, view: database.views[1] },
    ]);

    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'database-1')).resolves.toBe('grid-1');

    expect(listWorkspaceDatabases).not.toHaveBeenCalled();
  });

  it('clears cached rows when the authoritative server catalog is empty', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    await expect(refreshWorkspaceDatabaseCatalog('workspace-1')).resolves.toEqual([]);

    expect(deleteWorkspaceRecords).toHaveBeenCalledTimes(1);
    expect(catalogTable.bulkPut).not.toHaveBeenCalled();
  });

  it('returns the server catalog when IndexedDB persistence fails', async () => {
    transaction.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    await expect(refreshWorkspaceDatabaseCatalog('workspace-1')).resolves.toEqual([database]);
  });
});
