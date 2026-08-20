import { db } from '@/application/db';
import { emit, EventType } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';
import { ViewLayout } from '@/application/types';

import {
  getDatabaseContainerEntries,
  getDatabaseIdFromWorkspaceCatalog,
  getWorkspaceDatabaseCatalog,
  getViewIdFromWorkspaceCatalog,
  invalidateWorkspaceDatabaseCatalog,
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
let testUserSequence = 0;
let currentTestUserId = '';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

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

function databaseWithId(databaseId: string) {
  return {
    ...database,
    database_id: databaseId,
    views: database.views.map((view) => ({
      ...view,
      view_id: `${databaseId}-${view.is_container ? 'container' : 'grid'}`,
      parent_view_id: view.is_container ? 'space-1' : `${databaseId}-container`,
    })),
  };
}

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
    currentTestUserId = `test-user-${++testUserSequence}`;
    setCurrentUser(currentTestUserId);
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

    expect(catalogTable.get).toHaveBeenCalledWith([currentTestUserId, 'workspace-1', 'grid-1']);
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
        user_id: currentTestUserId,
        workspace_id: 'workspace-1',
        database_id: 'database-1',
        view_id: 'container-1',
      }),
      expect.objectContaining({
        user_id: currentTestUserId,
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

  it('reuses a successful catalog response for sequential lookup misses', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'missing-database')).resolves.toBeNull();
    await expect(getDatabaseIdFromWorkspaceCatalog('workspace-1', 'missing-view')).resolves.toBeNull();

    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);
  });

  it('keeps one shared snapshot until an explicit refresh replaces it', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValueOnce([]).mockResolvedValueOnce([database]);

    const initial = await getWorkspaceDatabaseCatalog('workspace-1');
    const shared = await getWorkspaceDatabaseCatalog('workspace-1');

    expect(shared).toBe(initial);
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);

    const refreshed = await refreshWorkspaceDatabaseCatalog('workspace-1');

    expect(refreshed).toEqual([database]);
    await expect(getWorkspaceDatabaseCatalog('workspace-1')).resolves.toBe(refreshed);
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(2);
  });

  it('supersedes a request invalidated while IndexedDB persistence is pending', async () => {
    const staleDatabase = databaseWithId('stale-database');
    const currentDatabase = databaseWithId('current-database');
    const staleDelete = createDeferred<void>();

    jest
      .mocked(listWorkspaceDatabases)
      .mockResolvedValueOnce([staleDatabase])
      .mockResolvedValueOnce([currentDatabase]);
    deleteWorkspaceRecords.mockReturnValueOnce(staleDelete.promise).mockResolvedValueOnce(undefined);

    let staleCallerSettled = false;
    const staleCaller = getWorkspaceDatabaseCatalog('workspace-1').then((value) => {
      staleCallerSettled = true;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(deleteWorkspaceRecords).toHaveBeenCalledTimes(1);

    invalidateWorkspaceDatabaseCatalog('workspace-1');
    const currentRequest = refreshWorkspaceDatabaseCatalog('workspace-1');

    await expect(currentRequest).resolves.toEqual([currentDatabase]);
    expect(staleCallerSettled).toBe(false);

    staleDelete.resolve();
    await expect(staleCaller).resolves.toEqual([currentDatabase]);
    await expect(getWorkspaceDatabaseCatalog('workspace-1')).resolves.toBe(await currentRequest);

    expect(catalogTable.bulkPut).toHaveBeenCalledTimes(1);
    expect(catalogTable.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ database_id: 'current-database' }),
      expect.objectContaining({ database_id: 'current-database' }),
    ]);
  });

  it('bypasses stale positive IndexedDB mappings after invalidation', async () => {
    await refreshWorkspaceDatabaseCatalog('workspace-1');
    invalidateWorkspaceDatabaseCatalog('workspace-1');
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);
    catalogTable.get.mockClear();
    readDatabaseRecords.mockClear();
    catalogTable.get.mockResolvedValue({ database_id: 'database-1' });
    readDatabaseRecords.mockResolvedValue([
      { view_order: 0, view: database.views[0] },
      { view_order: 1, view: database.views[1] },
    ]);

    await expect(getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1')).resolves.toBeNull();
    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'database-1')).resolves.toBeNull();

    expect(catalogTable.get).not.toHaveBeenCalled();
    expect(readDatabaseRecords).not.toHaveBeenCalled();
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(2);
  });

  it('does not return a view mapping invalidated while its IndexedDB read is pending', async () => {
    const cachedRead = createDeferred<{ database_id: string } | undefined>();

    catalogTable.get.mockReturnValue(cachedRead.promise);
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    const lookup = getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1');

    await Promise.resolve();
    expect(catalogTable.get).toHaveBeenCalledTimes(1);

    invalidateWorkspaceDatabaseCatalog('workspace-1');
    cachedRead.resolve({ database_id: 'stale-database' });

    await expect(lookup).resolves.toBeNull();
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);
  });

  it('does not return a database mapping invalidated while its IndexedDB read is pending', async () => {
    const cachedRead = createDeferred<Array<{ view_order: number; view: (typeof database.views)[number] }>>();

    readDatabaseRecords.mockReturnValue(cachedRead.promise);
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    const lookup = getViewIdFromWorkspaceCatalog('workspace-1', 'database-1');

    await Promise.resolve();
    expect(readDatabaseRecords).toHaveBeenCalledTimes(1);

    invalidateWorkspaceDatabaseCatalog('workspace-1');
    cachedRead.resolve([
      { view_order: 0, view: database.views[0] },
      { view_order: 1, view: database.views[1] },
    ]);

    await expect(lookup).resolves.toBeNull();
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);
  });

  it('terminates an IndexedDB lookup when the session changes during the read', async () => {
    const cachedRead = createDeferred<{ database_id: string } | undefined>();

    catalogTable.get.mockReturnValue(cachedRead.promise);

    const lookup = getDatabaseIdFromWorkspaceCatalog('workspace-1', 'grid-1');

    await Promise.resolve();
    expect(catalogTable.get).toHaveBeenCalledTimes(1);

    emit(EventType.SESSION_INVALID);
    setCurrentUser(`${currentTestUserId}-other`);
    cachedRead.resolve({ database_id: 'stale-database' });

    await expect(lookup).rejects.toMatchObject({ name: 'AbortError' });
    expect(listWorkspaceDatabases).not.toHaveBeenCalled();
  });

  it('isolates successful lookup responses by user and workspace', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'missing-database')).resolves.toBeNull();
    await expect(getViewIdFromWorkspaceCatalog('workspace-2', 'missing-database')).resolves.toBeNull();
    setCurrentUser(`${currentTestUserId}-other`);
    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'missing-database')).resolves.toBeNull();

    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(3);
  });

  it('drops shared snapshots when the session becomes invalid', async () => {
    jest.mocked(listWorkspaceDatabases).mockResolvedValue([]);

    await expect(getWorkspaceDatabaseCatalog('workspace-1')).resolves.toEqual([]);
    emit(EventType.SESSION_INVALID);
    await expect(getWorkspaceDatabaseCatalog('workspace-1')).resolves.toEqual([]);

    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(2);
  });

  it('terminates an in-flight caller on account switch without requesting under the new session', async () => {
    const staleRequest = createDeferred<(typeof database)[]>();

    jest.mocked(listWorkspaceDatabases).mockReturnValue(staleRequest.promise);

    const oldCaller = getWorkspaceDatabaseCatalog('workspace-1');

    await Promise.resolve();
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);

    emit(EventType.SESSION_INVALID);
    setCurrentUser(`${currentTestUserId}-other`);
    staleRequest.resolve([database]);

    await expect(oldCaller).rejects.toMatchObject({ name: 'AbortError' });
    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not cache a failed catalog refresh', async () => {
    jest
      .mocked(listWorkspaceDatabases)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce([]);

    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'missing-database')).rejects.toThrow('Unavailable');
    await expect(getViewIdFromWorkspaceCatalog('workspace-1', 'missing-database')).resolves.toBeNull();

    expect(listWorkspaceDatabases).toHaveBeenCalledTimes(2);
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
