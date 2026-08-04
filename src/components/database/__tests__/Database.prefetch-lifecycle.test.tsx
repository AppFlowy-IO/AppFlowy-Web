import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { peekDatabaseRowDocSeed, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { APP_EVENTS } from '@/application/constants';
import { getCachedRowDoc, openRowDoc } from '@/application/services/js-services/cache';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import Database, { Database2Props } from '@/components/database/Database';

const mockSeedLoadPromises: Array<Promise<YDoc | undefined>> = [];
const mockEnsureRowPromises: Array<Promise<YDoc | undefined> | void> = [];
let mockLoadSeedOnLifecycleChange = false;

jest.mock('@/application/database-blob', () => ({
  getDatabaseRowDocFromSeed: jest.fn(),
  peekDatabaseRowDocSeed: jest.fn(),
  prefetchDatabaseBlobDiff: jest.fn(),
  releaseDatabaseRowDocSeedCache: jest.fn(),
  retainDatabaseRowDocSeedCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowDoc: jest.fn(),
  openRowDoc: jest.fn(),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => null,
}));

jest.mock('@/components/database/DatabaseRowModal', () => () => null);
jest.mock('@/components/database/DatabaseContext', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { DatabaseContext } =
    jest.requireActual<typeof import('@/application/database-yjs/context')>('@/application/database-yjs/context');

  return {
    DatabaseContextProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: React.ContextType<typeof DatabaseContext>;
    }) => React.createElement(DatabaseContext.Provider, { value }, children),
  };
});
jest.mock('@/components/database/DatabaseViews', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { useDatabaseContext } =
    jest.requireActual<typeof import('@/application/database-yjs/context')>('@/application/database-yjs/context');

  return function MockDatabaseViews() {
    const { bindRowSync, ensureRow, loadRowFromSeed, rowMap } = useDatabaseContext();
    const initialLoadRowFromSeed = React.useRef(loadRowFromSeed).current;
    const previousLoadRowFromSeed = React.useRef(loadRowFromSeed);

    React.useEffect(() => {
      const previous = previousLoadRowFromSeed.current;

      previousLoadRowFromSeed.current = loadRowFromSeed;
      if (!mockLoadSeedOnLifecycleChange || previous === loadRowFromSeed || !loadRowFromSeed) return;
      mockSeedLoadPromises.push(loadRowFromSeed('row-id'));
    }, [loadRowFromSeed]);

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'button',
        {
          'data-row-guid': rowMap?.['row-id']?.guid ?? '',
          onClick: () => {
            if (!loadRowFromSeed) throw new Error('loadRowFromSeed is not available');
            mockSeedLoadPromises.push(loadRowFromSeed('row-id'));
          },
          type: 'button',
        },
        'Load seeded row'
      ),
      React.createElement(
        'button',
        {
          onClick: () => {
            if (!initialLoadRowFromSeed) throw new Error('initial loadRowFromSeed is not available');
            mockSeedLoadPromises.push(initialLoadRowFromSeed('row-id'));
          },
          type: 'button',
        },
        'Load seeded row with initial lifecycle'
      ),
      React.createElement(
        'button',
        {
          onClick: () => bindRowSync?.('row-id'),
          type: 'button',
        },
        'Bind row sync'
      ),
      React.createElement(
        'button',
        {
          onClick: () => {
            if (!ensureRow) throw new Error('ensureRow is not available');
            mockEnsureRowPromises.push(ensureRow('row-id'));
          },
          type: 'button',
        },
        'Ensure row'
      )
    );
  };
});

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockedPrefetch = prefetchDatabaseBlobDiff as jest.MockedFunction<typeof prefetchDatabaseBlobDiff>;
const mockedPeekSeed = peekDatabaseRowDocSeed as jest.MockedFunction<typeof peekDatabaseRowDocSeed>;
const mockedGetCachedRowDoc = getCachedRowDoc as jest.MockedFunction<typeof getCachedRowDoc>;
const mockedOpenRowDoc = openRowDoc as jest.MockedFunction<typeof openRowDoc>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createDatabaseDoc(guid: string, databaseId = 'database-id') {
  const doc = new Y.Doc({ guid }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array();

  rowOrders.push([{ id: 'row-id' }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function databaseProps(doc: YDoc): Database2Props {
  return {
    workspaceId: 'workspace-id',
    doc,
    readOnly: false,
    activeViewId: 'view-id',
    databaseName: '',
    databasePageId: '',
    onChangeView: jest.fn(),
  };
}

function requestSeedLoad() {
  const requestIndex = mockSeedLoadPromises.length;

  fireEvent.click(screen.getByRole('button', { name: 'Load seeded row' }));
  const request = mockSeedLoadPromises[requestIndex];

  if (!request) throw new Error('DatabaseViews did not request a seeded row');
  return request;
}

function requestSeedLoadFromInitialLifecycle() {
  const requestIndex = mockSeedLoadPromises.length;

  fireEvent.click(screen.getByRole('button', { name: 'Load seeded row with initial lifecycle' }));
  const request = mockSeedLoadPromises[requestIndex];

  if (!request) throw new Error('DatabaseViews did not request a seeded row from its initial lifecycle');
  return request;
}

function requestEnsureRow() {
  const requestIndex = mockEnsureRowPromises.length;

  fireEvent.click(screen.getByRole('button', { name: 'Ensure row' }));
  const request = mockEnsureRowPromises[requestIndex];

  if (!request) throw new Error('DatabaseViews did not request an ensured row');
  return request;
}

function createHydratedRowDoc(guid: string) {
  const doc = new Y.Doc({ guid }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);

  sharedRoot.set(YjsEditorKey.database_row, new Y.Map());
  return doc;
}

describe('Database blob prefetch lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSeedLoadPromises.length = 0;
    mockEnsureRowPromises.length = 0;
    mockLoadSeedOnLifecycleChange = false;
    mockedPeekSeed.mockReset();
    mockedGetCachedRowDoc.mockReset();
    mockedOpenRowDoc.mockReset();
    mockedPrefetch.mockReset();
    mockedGetCachedRowDoc.mockReturnValue(undefined);
    mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
  });

  it('requests a complete row seed set for a grouped Board view', async () => {
    const doc = createDatabaseDoc('database-id');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
    const groups = new Y.Array();

    groups.push([new Y.Map()]);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    view?.set(YjsDatabaseKey.groups, groups);

    const { unmount } = render(<Database {...databaseProps(doc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });

    expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(true);

    unmount();
    doc.destroy();
  });

  it('starts a new prefetch when the Y.Doc instance changes but its guid stays the same', async () => {
    const firstDoc = createDatabaseDoc('database-id');
    const secondDoc = createDatabaseDoc('database-id');
    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });

    rerender(<Database {...databaseProps(secondDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(2);
    });

    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });

    expect(mockedPeekSeed).not.toHaveBeenCalled();

    act(() => {
      mockedPrefetch.mock.calls[1][2]?.onSeedsReady?.();
    });

    expect(mockedPeekSeed).toHaveBeenCalledWith('database-id_rows_row-id');

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
  });

  it('isolates pending seed loads across database lifecycles', async () => {
    const firstDoc = createDatabaseDoc('shared-guid', 'database-a');
    const secondDoc = createDatabaseDoc('shared-guid', 'database-b');
    // An empty stale doc keeps the later request on the pending-load path, so
    // stale row injection cannot mask stale cleanup deleting the newer promise.
    const firstRowDoc = new Y.Doc({ guid: 'row-a' }) as YDoc;
    const secondRowDoc = new Y.Doc({ guid: 'row-b' }) as YDoc;
    const firstLoad = createDeferred<YDoc>();
    const secondLoad = createDeferred<YDoc>();
    const seed = { bytes: new Uint8Array([1, 2, 3]), encoderVersion: 1 };

    mockedPeekSeed.mockReturnValue(seed);
    mockedOpenRowDoc.mockImplementation((rowKey) => {
      if (rowKey === 'database-a_rows_row-id') return firstLoad.promise;
      if (rowKey === 'database-b_rows_row-id') return secondLoad.promise;
      throw new Error(`unexpected row key: ${rowKey}`);
    });

    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);
    const firstOwner = requestSeedLoad();
    const firstFollower = requestSeedLoad();

    expect(mockedOpenRowDoc).toHaveBeenCalledTimes(1);
    expect(mockedOpenRowDoc).toHaveBeenCalledWith('database-a_rows_row-id', seed);

    rerender(<Database {...databaseProps(secondDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(2);
    });

    const secondOwner = requestSeedLoad();

    expect(mockedOpenRowDoc).toHaveBeenCalledTimes(2);
    expect(mockedOpenRowDoc).toHaveBeenLastCalledWith('database-b_rows_row-id', seed);

    let firstResults: Array<YDoc | undefined> = [];

    await act(async () => {
      firstLoad.resolve(firstRowDoc);
      firstResults = await Promise.all([firstOwner, firstFollower]);
    });

    expect(firstResults).toEqual([undefined, undefined]);
    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('');

    const secondFollower = requestSeedLoad();

    expect(mockedOpenRowDoc).toHaveBeenCalledTimes(2);

    let secondResults: Array<YDoc | undefined> = [];

    await act(async () => {
      secondLoad.resolve(secondRowDoc);
      secondResults = await Promise.all([secondOwner, secondFollower]);
    });

    expect(secondResults).toEqual([secondRowDoc, secondRowDoc]);
    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('row-b');

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
    firstRowDoc.destroy();
    secondRowDoc.destroy();
  });

  it('ignores a seed loader retained from a previous database lifecycle', async () => {
    const firstDoc = createDatabaseDoc('shared-guid', 'database-a');
    const secondDoc = createDatabaseDoc('shared-guid', 'database-b');
    const staleRowDoc = new Y.Doc({ guid: 'row-a' }) as YDoc;
    const seed = { bytes: new Uint8Array([1, 2, 3]), encoderVersion: 1 };

    mockedPeekSeed.mockReturnValue(seed);
    mockedOpenRowDoc.mockResolvedValue(staleRowDoc);

    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);

    rerender(<Database {...databaseProps(secondDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(2);
    });

    let staleResult: YDoc | undefined;

    await act(async () => {
      staleResult = await requestSeedLoadFromInitialLifecycle();
    });

    expect(staleResult).toBeUndefined();
    expect(mockedOpenRowDoc).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('');

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
    staleRowDoc.destroy();
  });

  it('activates a new seed loader before descendant effects run', async () => {
    const firstDoc = createDatabaseDoc('shared-guid', 'database-a');
    const secondDoc = createDatabaseDoc('shared-guid', 'database-b');
    const secondRowDoc = new Y.Doc({ guid: 'row-b' }) as YDoc;
    const seed = { bytes: new Uint8Array([1, 2, 3]), encoderVersion: 1 };

    mockLoadSeedOnLifecycleChange = true;
    mockedPeekSeed.mockReturnValue(seed);
    mockedOpenRowDoc.mockResolvedValue(secondRowDoc);

    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);

    rerender(<Database {...databaseProps(secondDoc)} />);

    await waitFor(() => {
      expect(mockedOpenRowDoc).toHaveBeenCalledWith('database-b_rows_row-id', seed);
    });

    let results: Array<YDoc | undefined> = [];

    await act(async () => {
      results = await Promise.all(mockSeedLoadPromises);
    });

    expect(results).toEqual([secondRowDoc]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('row-b');
    });

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
    secondRowDoc.destroy();
  });

  it('releases each lifecycle row-sync owner when the Y.Doc instance changes', async () => {
    const firstDoc = createDatabaseDoc('shared-guid');
    const secondDoc = createDatabaseDoc('shared-guid');
    const rowDoc = new Y.Doc({ guid: 'row-id' }) as YDoc;
    const createRow = jest.fn().mockResolvedValue(rowDoc);
    const scheduleDeferredCleanup = jest.fn();
    const firstProps = {
      ...databaseProps(firstDoc),
      createRow,
      scheduleDeferredCleanup,
    };
    const { rerender, unmount } = render(<Database {...firstProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(1));

    rerender(
      <Database
        {...databaseProps(secondDoc)}
        createRow={createRow}
        scheduleDeferredCleanup={scheduleDeferredCleanup}
      />
    );

    await waitFor(() => expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1));
    expect(scheduleDeferredCleanup).toHaveBeenLastCalledWith('row-id');

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(2));

    unmount();

    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
    expect(scheduleDeferredCleanup).toHaveBeenLastCalledWith('row-id');

    firstDoc.destroy();
    secondDoc.destroy();
    rowDoc.destroy();
  });

  it('replaces a hydrated seed shell with the canonical force-synced row doc', async () => {
    const doc = createDatabaseDoc('database-id');
    const seedShell = createHydratedRowDoc('seed-shell');
    const canonicalRowDoc = createHydratedRowDoc('canonical-row');
    const createRow = jest.fn(async (_rowKey: string, options?: { forceSync?: boolean }) =>
      options?.forceSync ? canonicalRowDoc : seedShell
    );
    const props = {
      ...databaseProps(doc),
      createRow,
      initialRowMap: { 'row-id': seedShell },
    };
    const { unmount } = render(<Database {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    await waitFor(() => {
      expect(createRow).toHaveBeenCalledWith('database-id_rows_row-id');
    });
    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('seed-shell');

    let ensuredRow: YDoc | undefined;

    await act(async () => {
      ensuredRow = await requestEnsureRow();
    });

    expect(createRow).toHaveBeenLastCalledWith('database-id_rows_row-id', { forceSync: true });
    expect(ensuredRow).toBe(canonicalRowDoc);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe(
        'canonical-row'
      );
    });

    unmount();
    doc.destroy();
    seedShell.destroy();
    canonicalRowDoc.destroy();
  });

  it('adopts a replacement DatabaseRow doc emitted by a version reset', async () => {
    const doc = createDatabaseDoc('database-id');
    const seedShell = createHydratedRowDoc('seed-shell');
    const canonicalRowDoc = createHydratedRowDoc('canonical-row');
    const eventEmitter = new EventEmitter();
    const { unmount } = render(
      <Database {...databaseProps(doc)} eventEmitter={eventEmitter} initialRowMap={{ 'row-id': seedShell }} />
    );

    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('seed-shell');

    act(() => {
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, {
        objectId: 'row-id',
        doc: canonicalRowDoc,
      });
    });

    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('canonical-row');

    unmount();
    doc.destroy();
    seedShell.destroy();
    canonicalRowDoc.destroy();
  });

  it('releases a row sync that finishes registering after its lifecycle ended', async () => {
    const firstDoc = createDatabaseDoc('shared-guid');
    const secondDoc = createDatabaseDoc('shared-guid');
    const rowDoc = new Y.Doc({ guid: 'row-id' }) as YDoc;
    const pendingRowSync = createDeferred<YDoc>();
    const createRow = jest.fn().mockReturnValue(pendingRowSync.promise);
    const scheduleDeferredCleanup = jest.fn();
    const { rerender, unmount } = render(
      <Database
        {...databaseProps(firstDoc)}
        createRow={createRow}
        scheduleDeferredCleanup={scheduleDeferredCleanup}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    expect(createRow).toHaveBeenCalledTimes(1);

    rerender(
      <Database
        {...databaseProps(secondDoc)}
        createRow={createRow}
        scheduleDeferredCleanup={scheduleDeferredCleanup}
      />
    );

    expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

    await act(async () => {
      pendingRowSync.resolve(rowDoc);
      await pendingRowSync.promise;
    });

    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith('row-id');

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
    rowDoc.destroy();
  });
});
