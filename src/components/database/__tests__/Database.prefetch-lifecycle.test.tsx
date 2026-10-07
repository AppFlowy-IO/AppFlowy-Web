import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import {
  getDatabaseRowDocFromSeed,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
} from '@/application/database-blob';
import type { DatabaseContextState } from '@/application/database-yjs';
import { DatabaseContext } from '@/application/database-yjs/context';
import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { getCachedRowDoc, openRowDoc } from '@/application/services/js-services/cache';
import { DatabaseViewLayout, UIVariant, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useChartedRowDataClock } from '@/components/database/chart/hooks/useChartedRowDataClock';
import Database, { Database2Props } from '@/components/database/Database';

const mockSeedLoadPromises: Array<Promise<YDoc | undefined>> = [];
const mockEnsureRowPromises: Array<Promise<YDoc | undefined> | void> = [];
let mockDatabaseContext: DatabaseContextState | undefined;
let mockLoadSeedOnLifecycleChange = false;
/** Databases whose rows the tab holds (`isDatabaseSourceResident`). */
const mockResidentSources = new Set<string>();
/** Databases whose walk committed every row and still writes them to storage: held, not yet resident. */
const mockHeldSources = new Set<string>();
const mockResidencyListeners = new Set<() => void>();

jest.mock('@/application/database-blob', () => ({
  getDatabaseRowDocFromSeed: jest.fn(),
  holdsDatabaseSourceRows: (databaseId: string) =>
    mockResidentSources.has(databaseId) || mockHeldSources.has(databaseId),
  isDatabaseSourceResident: (databaseId: string) => mockResidentSources.has(databaseId),
  peekDatabaseRowDocSeed: jest.fn(),
  prefetchDatabaseBlobDiff: jest.fn(),
  releaseDatabaseRowDocSeedCache: jest.fn(),
  retainDatabaseRowDocSeedCache: jest.fn(),
  subscribeToDatabaseSourceResidency: (listener: () => void) => {
    mockResidencyListeners.add(listener);
    return () => {
      mockResidencyListeners.delete(listener);
    };
  },
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowDoc: jest.fn(),
  openRowDoc: jest.fn(),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => null,
}));

jest.mock(
  '@/components/database/DatabaseRowModal',
  () =>
    ({ open }: { open: boolean }) =>
      open ? <div data-testid='database-row-modal' /> : null
);
jest.mock('@/components/database/DatabaseContext', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { DatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

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
  const { useDatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

  return function MockDatabaseViews() {
    const databaseContext = useDatabaseContext();
    const { bindRowSync, ensureRow, loadRowFromSeed, navigateToRow, rowMap } = databaseContext;

    mockDatabaseContext = databaseContext;
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
            if (!loadRowFromSeed) throw new Error('loadRowFromSeed is not available');
            mockSeedLoadPromises.push(loadRowFromSeed('remote-row-id'));
          },
          type: 'button',
        },
        'Load remote seeded row'
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
      ),
      React.createElement(
        'button',
        {
          onClick: () => {
            if (!ensureRow) throw new Error('ensureRow is not available');
            mockEnsureRowPromises.push(ensureRow('remote-row-id'));
          },
          type: 'button',
        },
        'Ensure remote row'
      ),
      React.createElement(
        'button',
        {
          onClick: () => navigateToRow?.('row-id'),
          type: 'button',
        },
        'Open row'
      ),
      ...['remote-row-a', 'remote-row-b', 'remote-row-c'].map((rowId) =>
        React.createElement(
          'button',
          {
            key: rowId,
            onClick: () => {
              if (!ensureRow) throw new Error('ensureRow is not available');
              mockEnsureRowPromises.push(ensureRow(rowId));
            },
            type: 'button',
          },
          `Ensure ${rowId}`
        )
      )
    );
  };
});

const mockedPrefetch = prefetchDatabaseBlobDiff as jest.MockedFunction<typeof prefetchDatabaseBlobDiff>;
const mockedPeekSeed = peekDatabaseRowDocSeed as jest.MockedFunction<typeof peekDatabaseRowDocSeed>;
const mockedSeedDoc = getDatabaseRowDocFromSeed as jest.MockedFunction<typeof getDatabaseRowDocFromSeed>;
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

function insertRemoteRowOrder(doc: YDoc, rowId: string) {
  const remoteDoc = new Y.Doc();

  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
  const beforeInsert = Y.encodeStateVector(remoteDoc);
  const database = remoteDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);

  rowOrders?.push([{ id: rowId }]);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc, beforeInsert));
  remoteDoc.destroy();
}

function hydrateDatabaseIdWithRemoteRowOrders(doc: YDoc, databaseId: string, rowIds: string[]) {
  const remoteDoc = new Y.Doc();

  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
  const beforeHydration = Y.encodeStateVector(remoteDoc);
  const database = remoteDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);

  remoteDoc.transact(() => {
    database?.set(YjsDatabaseKey.id, databaseId);
    rowOrders?.push(rowIds.map((id) => ({ id })));
  });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc, beforeHydration));
  remoteDoc.destroy();
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

function requestRemoteSeedLoad() {
  const requestIndex = mockSeedLoadPromises.length;

  fireEvent.click(screen.getByRole('button', { name: 'Load remote seeded row' }));
  const request = mockSeedLoadPromises[requestIndex];

  if (!request) throw new Error('DatabaseViews did not request the remote seeded row');
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

function requestRemoteRowEnsure() {
  const requestIndex = mockEnsureRowPromises.length;

  fireEvent.click(screen.getByRole('button', { name: 'Ensure remote row' }));
  const request = mockEnsureRowPromises[requestIndex];

  if (!request) throw new Error('DatabaseViews did not request the remote row');
  return request;
}

function requestNamedRemoteRowEnsure(rowId: string) {
  const requestIndex = mockEnsureRowPromises.length;

  fireEvent.click(screen.getByRole('button', { name: `Ensure ${rowId}` }));
  const request = mockEnsureRowPromises[requestIndex];

  if (!request) throw new Error(`DatabaseViews did not request remote row ${rowId}`);
  return request;
}

function createHydratedRowDoc(guid: string) {
  const doc = new Y.Doc({ guid }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);

  sharedRoot.set(YjsEditorKey.database_row, new Y.Map());
  return doc;
}

function setSalary(doc: YDoc, value: string) {
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

  if (!row) throw new Error('Expected a hydrated row');
  if (!row.get(YjsDatabaseKey.cells)) row.set(YjsDatabaseKey.cells, new Y.Map());
  const cells = row.get(YjsDatabaseKey.cells)!;

  if (!cells.get('salary')) cells.set('salary', new Y.Map());
  cells.get('salary')!.set(YjsDatabaseKey.data, value);
}

/** A sibling chart reads detached seeds, without opening any live rows itself. */
function SeededSalaryChart() {
  const { cachedRowDocs } = useBackgroundRowDocLoader(true, 'salary-chart');
  const docs = Object.values(cachedRowDocs);
  const clock = useChartedRowDataClock(docs, { fieldIds: new Set(['salary']), rowTimes: false }, true);
  const row = cachedRowDocs['row-id'];
  const salary = row?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)
    ?.get(YjsDatabaseKey.cells)?.get('salary')?.get(YjsDatabaseKey.data);

  return <output data-testid='salary-chart' data-row-guid={row?.guid ?? ''} data-clock={clock}>{salary}</output>;
}

/** The source's seeds are released (or retired by a restore): it is no longer resident. */
function releaseResidentSource(databaseId: string) {
  mockResidentSources.delete(databaseId);
  mockHeldSources.delete(databaseId);
  act(() => {
    mockResidencyListeners.forEach((listener) => listener());
  });
}

describe('Database blob prefetch lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSeedLoadPromises.length = 0;
    mockEnsureRowPromises.length = 0;
    mockDatabaseContext = undefined;
    mockLoadSeedOnLifecycleChange = false;
    mockedPeekSeed.mockReset();
    mockedSeedDoc.mockReset();
    mockedGetCachedRowDoc.mockReset();
    mockedOpenRowDoc.mockReset();
    mockedPrefetch.mockReset();
    mockedGetCachedRowDoc.mockReturnValue(undefined);
    mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
    dashboardLoadStats.reset();
  });

  afterEach(() => {
    // Bindings a test left with a resident source go with it.
    Array.from(new Set([...mockResidentSources, ...mockHeldSources])).forEach(releaseResidentSource);
  });

  it.each(['before', 'after'] as const)(
    'keeps a sibling seed-only chart mounted %s an ordinary Grid row open live',
    async (mounted) => {
      const doc = createDatabaseDoc(`grid-chart-${mounted}`);
      const seed = createHydratedRowDoc(`seed-${mounted}`);
      const canonical = createHydratedRowDoc(`canonical-${mounted}`);
      const seedDestroyed = jest.fn();

      seed.on('destroy', seedDestroyed);
      let readable = seed;
      const createRow = jest.fn(async () => {
        readable = canonical;
        return canonical;
      });
      const context: DatabaseContextState = {
        activeViewId: 'view-id', databaseDoc: doc, databasePageId: 'view-id',
        readOnly: false, rowMap: {}, workspaceId: 'workspace-id',
        seedsReady: true, blobPrefetchComplete: true, peekRowDocFromSeed: () => readable,
      };
      const contents = (chartVisible: boolean) => (
        <>
          <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'row-id': seed }} />
          {chartVisible && <DatabaseContext.Provider value={context}><SeededSalaryChart /></DatabaseContext.Provider>}
        </>
      );

      setSalary(seed, '185000');
      setSalary(canonical, '185000');
      const { rerender, unmount } = render(contents(mounted === 'before'));

      try {
        if (mounted === 'before') {
          await waitFor(() => expect(screen.getByTestId('salary-chart').textContent).toBe('185000'));
          expect(screen.getByTestId('salary-chart').getAttribute('data-row-guid')).toBe(seed.guid);
        }

        await act(async () => { expect(await requestEnsureRow()).toBe(canonical); });
        if (mounted === 'after') rerender(contents(true));
        await waitFor(() => expect(screen.getByTestId('salary-chart').getAttribute('data-row-guid')).toBe(canonical.guid));
        const clock = Number(screen.getByTestId('salary-chart').getAttribute('data-clock'));

        act(() => setSalary(canonical, '205000'));
        await waitFor(() => expect(screen.getByTestId('salary-chart').textContent).toBe('205000'));
        expect(Number(screen.getByTestId('salary-chart').getAttribute('data-clock'))).toBeGreaterThan(clock);
        expect(createRow).toHaveBeenCalledTimes(1);
        expect(seedDestroyed).not.toHaveBeenCalled();
        rerender(contents(false));
        rerender(contents(true));
        await waitFor(() => expect(screen.getByTestId('salary-chart').textContent).toBe('205000'));
        act(() => setSalary(canonical, '215000'));
        await waitFor(() => expect(screen.getByTestId('salary-chart').textContent).toBe('215000'));
      } finally {
        unmount();
        doc.destroy();
        seed.destroy();
        canonical.destroy();
      }
    }
  );

  it('does not publish a row whose Grid lifecycle ended before ensureRow settled', async () => {
    const doc = createDatabaseDoc('obsolete-grid-chart');
    const seed = createHydratedRowDoc('current-seed');
    const canonical = createHydratedRowDoc('obsolete-canonical');
    const pending = createDeferred<YDoc>();
    const createRow = jest.fn(() => pending.promise);
    let readable = seed;
    const context: DatabaseContextState = {
      activeViewId: 'view-id', databaseDoc: doc, databasePageId: 'view-id',
      readOnly: false, rowMap: {}, workspaceId: 'workspace-id',
      seedsReady: true, blobPrefetchComplete: true, peekRowDocFromSeed: () => readable,
    };
    const contents = (gridVisible: boolean) => (
      <>
        {gridVisible && <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'row-id': seed }} />}
        <DatabaseContext.Provider value={context}><SeededSalaryChart /></DatabaseContext.Provider>
      </>
    );

    setSalary(seed, '185000');
    setSalary(canonical, '205000');
    const { rerender, unmount } = render(contents(true));

    try {
      await waitFor(() => expect(screen.getByTestId('salary-chart').textContent).toBe('185000'));
      let ensured: Promise<YDoc | undefined> | void;

      act(() => { ensured = requestEnsureRow(); });
      expect(createRow).toHaveBeenCalledTimes(1);
      rerender(contents(false));
      await act(async () => {
        readable = canonical;
        pending.resolve(canonical);
        expect(await ensured).toBeUndefined();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(screen.getByTestId('salary-chart').getAttribute('data-row-guid')).toBe(seed.guid);
      expect(screen.getByTestId('salary-chart').textContent).toBe('185000');
    } finally {
      unmount();
      doc.destroy();
      seed.destroy();
      canonical.destroy();
    }
  });

  it.each([
    ['Board', DatabaseViewLayout.Board],
    ['List', DatabaseViewLayout.List],
  ])('requests a complete row seed set for a grouped %s view', async (_name, layout) => {
    const doc = createDatabaseDoc('database-id');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
    const groups = new Y.Array();

    groups.push([new Y.Map()]);
    view?.set(YjsDatabaseKey.layout, layout);
    view?.set(YjsDatabaseKey.groups, groups);

    const { unmount } = render(<Database {...databaseProps(doc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });

    expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(true);

    unmount();
    doc.destroy();
  });

  it('requests a complete row seed set for a Chart view, which aggregates every row', async () => {
    const doc = createDatabaseDoc('database-id');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    database?.get(YjsDatabaseKey.views)?.get('view-id')?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Chart);
    const { unmount } = render(<Database {...databaseProps(doc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });
    expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(true);

    unmount();
    doc.destroy();
  });

  it('requests only the changed rows for a plain Grid view', async () => {
    const doc = createDatabaseDoc('database-id');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    database?.get(YjsDatabaseKey.views)?.get('view-id')?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    const { unmount } = render(<Database {...databaseProps(doc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });
    expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(false);

    unmount();
    doc.destroy();
  });

  describe('row gate while a walk is in flight', () => {
    const rowKey = 'database-id_rows_row-id';
    const flush = async () => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('lets a row the view lists first pass the gate as soon as a staged page delivered it', async () => {
      const doc = createDatabaseDoc('database-id');
      const liveRowDoc = new Y.Doc({ guid: 'row-id' }) as YDoc;
      const deliveredDoc = createHydratedRowDoc('delivered-row');
      const createRow = jest.fn(async () => liveRowDoc);

      mockedOpenRowDoc.mockResolvedValue(liveRowDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
        const walk = mockedPrefetch.mock.calls[0][2];
        let ensured: YDoc | undefined;
        let settled = false;

        void Promise.resolve(requestEnsureRow()).then((rowDoc) => {
          ensured = rowDoc;
          settled = true;
        });
        await flush();
        // No page was staged: the row waits at the gate.
        expect(settled).toBe(false);
        expect(mockedOpenRowDoc).not.toHaveBeenCalled();

        // A page that does not hold the row is staged: it keeps waiting.
        act(() => {
          walk?.onSeedsProgress?.();
        });
        await flush();
        expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(1);
        expect(mockedOpenRowDoc).not.toHaveBeenCalled();

        // The page that delivers it is staged: the row opens before the terminal page.
        mockedSeedDoc.mockImplementation((key) => (key === rowKey ? deliveredDoc : null));
        act(() => {
          walk?.onSeedsProgress?.();
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(250);
        });
        await flush();
        expect(settled).toBe(true);
        expect(ensured).toBe(liveRowDoc);
        // Its seed is still provisional: the live doc opens without one and binds realtime.
        expect(mockedOpenRowDoc).toHaveBeenCalledTimes(1);
        expect(mockedOpenRowDoc).toHaveBeenCalledWith(rowKey, undefined);
        expect(createRow).toHaveBeenCalledWith(rowKey);
        expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(liveRowDoc);
        expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(false);
        // An empty doc before the seeds are committed is not a missing row: no recovery walk.
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);

        // The terminal page commits the seeds: the row opened early gets its seed.
        const seed = { rowId: 'row-id' } as unknown as ReturnType<typeof peekDatabaseRowDocSeed>;

        mockedPeekSeed.mockImplementation((key) => (key === rowKey ? seed : null));
        act(() => {
          walk?.onSeedsReady?.();
        });
        await flush();
        expect(mockedOpenRowDoc).toHaveBeenCalledWith(rowKey, seed);
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
      } finally {
        unmount();
        doc.destroy();
        liveRowDoc.destroy();
        deliveredDoc.destroy();
      }
    });

    it('keeps a row outside the first rows of the view waiting for the terminal page, even once delivered', async () => {
      const doc = createDatabaseDoc('database-id');
      const liveRowDoc = createHydratedRowDoc('remote-row-id');
      const deliveredDoc = createHydratedRowDoc('delivered-row');
      const createRow = jest.fn(async () => liveRowDoc);

      mockedOpenRowDoc.mockResolvedValue(liveRowDoc);
      // Every row is delivered by the first page.
      mockedSeedDoc.mockReturnValue(deliveredDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        const walk = mockedPrefetch.mock.calls[0][2];
        let settled = false;

        // "remote-row-id" is not one of the rows the view lists first.
        void Promise.resolve(requestRemoteRowEnsure()).then(() => {
          settled = true;
        });
        act(() => {
          walk?.onSeedsProgress?.();
        });
        await flush();
        expect(settled).toBe(false);
        expect(mockedOpenRowDoc).not.toHaveBeenCalled();
        expect(createRow).not.toHaveBeenCalled();

        act(() => {
          walk?.onSeedsReady?.();
        });
        await flush();
        expect(settled).toBe(true);
        expect(mockedOpenRowDoc).toHaveBeenCalledWith('database-id_rows_remote-row-id', undefined);
      } finally {
        unmount();
        doc.destroy();
        liveRowDoc.destroy();
        deliveredDoc.destroy();
      }
    });

    it('recovers a row opened early that the walk did not bring after all', async () => {
      const doc = createDatabaseDoc('database-id');
      const liveRowDoc = new Y.Doc({ guid: 'row-id' }) as YDoc;
      const deliveredDoc = createHydratedRowDoc('delivered-row');
      const createRow = jest.fn(async () => liveRowDoc);

      mockedOpenRowDoc.mockResolvedValue(liveRowDoc);
      mockedSeedDoc.mockImplementation((key) => (key === rowKey ? deliveredDoc : null));
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        const walk = mockedPrefetch.mock.calls[0][2];

        act(() => {
          walk?.onSeedsProgress?.();
        });
        void requestEnsureRow();
        await flush();
        expect(mockedOpenRowDoc).toHaveBeenCalledWith(rowKey, undefined);
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);

        // The walk restarted and committed without the row: the same recovery as after the gate.
        mockedPeekSeed.mockReturnValue(null);
        act(() => {
          walk?.onSeedsReady?.();
        });
        await flush();
        expect(mockedPrefetch).toHaveBeenCalledTimes(2);
        expect(mockedPrefetch.mock.calls[1][2]?.forceFullSync).toBe(true);
      } finally {
        unmount();
        doc.destroy();
        liveRowDoc.destroy();
        deliveredDoc.destroy();
      }
    });
  });

  describe('a resident source, while the walk that refreshes it is held open', () => {
    const rowKey = 'database-id_rows_row-id';
    const remoteRowKey = 'database-id_rows_remote-row-id';
    const seedOf = (rowId: string) => ({ rowId } as unknown as ReturnType<typeof peekDatabaseRowDocSeed>);
    const flush = async () => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
    };

    beforeEach(() => {
      jest.useFakeTimers();
      // Neither a page, nor the commit, nor the answer of the blob walk ever comes.
      mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      ['reaches the row map before the delta walk resolves on a resident source', true],
      ['waits for the gate on a source that is not resident', false],
    ])('a row with a committed seed %s', async (_name, resident) => {
      const doc = createDatabaseDoc('database-id');
      const seededRowDoc = createHydratedRowDoc('seeded-row');
      const createRow = jest.fn(async () => seededRowDoc);
      const seed = seedOf('row-id');

      if (resident) mockResidentSources.add('database-id');
      mockedPeekSeed.mockImplementation((key) => (key === rowKey ? seed : null));
      mockedSeedDoc.mockImplementation((key) => (key === rowKey ? seededRowDoc : null));
      mockedOpenRowDoc.mockResolvedValue(seededRowDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        // The walk still starts: it refreshes the rows in the background.
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
        expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(false);
        let settled = false;

        void Promise.resolve(requestEnsureRow()).then(() => {
          settled = true;
        });
        await flush();

        if (resident) {
          expect(settled).toBe(true);
          expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(seededRowDoc);
          expect(mockedOpenRowDoc).toHaveBeenCalledWith(rowKey, seed);
          expect(mockDatabaseContext?.getRowPassState?.()).toEqual({ blobPrefetchComplete: false, seedsReady: true });
        } else {
          // The row waits for the walk to commit its seeds.
          expect(settled).toBe(false);
          expect(mockDatabaseContext?.rowMap?.['row-id']).toBeUndefined();
          expect(mockedOpenRowDoc).not.toHaveBeenCalled();
          expect(createRow).not.toHaveBeenCalled();
          expect(mockDatabaseContext?.getRowPassState?.()).toEqual({ blobPrefetchComplete: false, seedsReady: false });
        }
      } finally {
        unmount();
        doc.destroy();
        seededRowDoc.destroy();
      }
    });

    it('lets a row the tab holds pass the gate at once, even outside the first rows and with the gate closed', async () => {
      const doc = createDatabaseDoc('database-id');
      const remoteRowDoc = createHydratedRowDoc('remote-row');
      const createRow = jest.fn(async () => remoteRowDoc);

      mockResidentSources.add('database-id');
      mockedSeedDoc.mockImplementation((key) => (key === remoteRowKey ? remoteRowDoc : null));
      // The preload of the first rows never ends, so the gate stays closed.
      mockedOpenRowDoc.mockImplementation((key) =>
        key === remoteRowKey ? Promise.resolve(remoteRowDoc) : new Promise(() => undefined)
      );
      mockedPeekSeed.mockImplementation((key) => (key === rowKey || key === remoteRowKey ? seedOf(key) : null));
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        let ensured: YDoc | undefined;

        // "remote-row-id" is not one of the rows the view lists first.
        void Promise.resolve(requestRemoteRowEnsure()).then((rowDoc) => {
          ensured = rowDoc;
        });
        await flush();
        expect(ensured).toBe(remoteRowDoc);
        expect(mockDatabaseContext?.rowMap?.['remote-row-id']).toBe(remoteRowDoc);
        expect(createRow).toHaveBeenCalledWith(remoteRowKey);
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
      } finally {
        unmount();
        doc.destroy();
        remoteRowDoc.destroy();
      }
    });

    it('applies the seed of a row the tab lacks once the refresh commits, without a recovery walk, and counts it read', async () => {
      const doc = createDatabaseDoc('database-id');
      const seededRowDoc = createHydratedRowDoc('seeded-row');
      const emptyRemoteRowDoc = new Y.Doc({ guid: 'remote-row-id' }) as YDoc;
      const createRow = jest.fn(async (key: string) => (key === rowKey ? seededRowDoc : emptyRemoteRowDoc));
      const remoteSeed = seedOf('remote-row-id');

      mockResidentSources.add('database-id');
      mockedPeekSeed.mockImplementation((key) => (key === rowKey ? seedOf('row-id') : null));
      mockedSeedDoc.mockImplementation((key) => (key === rowKey ? seededRowDoc : null));
      mockedOpenRowDoc.mockImplementation(async (key) => (key === rowKey ? seededRowDoc : emptyRemoteRowDoc));
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        const walk = mockedPrefetch.mock.calls[0][2];

        // A row created since the snapshot: no seed, no data in the tab.
        await act(async () => {
          await requestRemoteRowEnsure();
        });
        expect(mockedOpenRowDoc).toHaveBeenCalledWith(remoteRowKey, undefined);
        // Its data may come with the refresh: no full walk to recover it.
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
        // It was read on its own; the seeded row was not.
        expect(dashboardLoadStats.snapshot().rowsRead).toEqual({ 'database-id': 1 });

        // The refresh commits the row's seed: it lands in the doc the row renders.
        mockedPeekSeed.mockImplementation((key) => {
          if (key === remoteRowKey) return remoteSeed;
          return key === rowKey ? seedOf('row-id') : null;
        });
        act(() => {
          walk?.onSeedsReady?.();
        });
        await flush();
        expect(mockedOpenRowDoc).toHaveBeenCalledWith(remoteRowKey, remoteSeed);
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);
      } finally {
        unmount();
        doc.destroy();
        seededRowDoc.destroy();
        emptyRemoteRowDoc.destroy();
      }
    });

    it('recovers a row the refresh left without data when the walk ends without a commit of its own', async () => {
      const doc = createDatabaseDoc('database-id');
      const seededRowDoc = createHydratedRowDoc('seeded-row');
      const emptyRemoteRowDoc = new Y.Doc({ guid: 'remote-row-id' }) as YDoc;
      const createRow = jest.fn(async (key: string) => (key === rowKey ? seededRowDoc : emptyRemoteRowDoc));
      const refresh = createDeferred<void>();

      mockResidentSources.add('database-id');
      mockedPrefetch.mockImplementationOnce(() => refresh.promise as ReturnType<typeof prefetchDatabaseBlobDiff>);
      mockedPeekSeed.mockImplementation((key) => (key === rowKey ? seedOf('row-id') : null));
      mockedSeedDoc.mockImplementation((key) => (key === rowKey ? seededRowDoc : null));
      mockedOpenRowDoc.mockImplementation(async (key) => (key === rowKey ? seededRowDoc : emptyRemoteRowDoc));
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      try {
        await flush();
        await act(async () => {
          await requestRemoteRowEnsure();
        });
        // It waits for the refresh, which may bring it.
        expect(mockedPrefetch).toHaveBeenCalledTimes(1);

        // The refresh answers without committing seeds (it reused a walk whose fence moved, say).
        await act(async () => {
          refresh.resolve();
          await refresh.promise;
        });
        await flush();
        // The row has neither data nor a seed: the one-shot full walk recovers it.
        expect(mockedPrefetch).toHaveBeenCalledTimes(2);
        expect(mockedPrefetch.mock.calls[1][2]?.forceFullSync).toBe(true);
      } finally {
        unmount();
        doc.destroy();
        seededRowDoc.destroy();
        emptyRemoteRowDoc.destroy();
      }
    });
  });

  describe('the row bindings of a resident source', () => {
    const rowKey = 'database-id_rows_row-id';

    beforeEach(() => {
      // The walk commits at once.
      mockedPrefetch.mockImplementation(async (_workspaceId, _databaseId, options) => {
        options?.onSeedsReady?.();
      });
    });

    it('are adopted by a view mounted within the residency window: no new registration and no forced sync', async () => {
      const doc = createDatabaseDoc('database-id');
      const rowDoc = createHydratedRowDoc('row-id');
      const createRow = jest.fn(async (_rowKey: string, _options?: { forceSync?: boolean }) => rowDoc);
      const scheduleDeferredCleanup = jest.fn();
      const props = { ...databaseProps(doc), createRow, scheduleDeferredCleanup };

      // The row document stays in the tab's row cache while its binding lives.
      mockedGetCachedRowDoc.mockImplementation((key) => (key === rowKey ? rowDoc : undefined));
      const first = render(<Database {...props} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await requestEnsureRow();
      });
      await act(async () => {
        await requestEnsureRow();
      });
      expect(createRow).toHaveBeenCalledWith(rowKey);
      expect(dashboardLoadStats.snapshot().rowsBound).toEqual({ 'database-id': 1 });
      const registrations = createRow.mock.calls.length;

      // The view unmounts while the source is resident: its binding stays.
      mockResidentSources.add('database-id');
      first.unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      // A view of the same source mounts within the window.
      const second = render(<Database {...props} />);
      let ensured: YDoc | undefined;

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(2));
      await act(async () => {
        ensured = await requestEnsureRow();
      });
      await act(async () => {
        await requestEnsureRow();
      });
      expect(ensured).toBe(rowDoc);
      expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(rowDoc);
      // 0 new registrations and 0 forced syncs: the row is not bound again.
      expect(createRow).toHaveBeenCalledTimes(registrations);
      expect(createRow.mock.calls.slice(registrations).filter(([, options]) => options?.forceSync)).toEqual([]);
      expect(dashboardLoadStats.snapshot().rowsBound).toEqual({ 'database-id': 1 });

      // It is released with the source, as before.
      second.unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();
      releaseResidentSource('database-id');
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith('row-id');

      // After the release, the next view registers the row again.
      const third = render(<Database {...props} />);

      await act(async () => {
        await requestEnsureRow();
      });
      expect(createRow).toHaveBeenCalledTimes(registrations + 1);
      expect(createRow).toHaveBeenLastCalledWith(rowKey);
      expect(dashboardLoadStats.snapshot().rowsBound).toEqual({ 'database-id': 2 });
      third.unmount();
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);

      doc.destroy();
      rowDoc.destroy();
    });

    it('are kept while the walk that makes the source resident still writes its rows, and released if it never does', async () => {
      const doc = createDatabaseDoc('database-id');
      const rowDoc = createHydratedRowDoc('row-id');
      const createRow = jest.fn(async () => rowDoc);
      const scheduleDeferredCleanup = jest.fn();
      const props = { ...databaseProps(doc), createRow, scheduleDeferredCleanup };

      mockedGetCachedRowDoc.mockImplementation((key) => (key === rowKey ? rowDoc : undefined));
      const first = render(<Database {...props} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await requestEnsureRow();
      });
      // Every row is in memory; the walk still writes them to storage.
      mockHeldSources.add('database-id');
      first.unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      // Another source becomes resident: this one still holds its rows.
      act(() => {
        mockResidencyListeners.forEach((listener) => listener());
      });
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      // The walk ends without making the source resident (a restore retired it).
      releaseResidentSource('database-id');
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith('row-id');

      doc.destroy();
      rowDoc.destroy();
    });

    it('keeps a binding still registering when the view unmounts, for the next view of the source', async () => {
      const doc = createDatabaseDoc('database-id');
      const rowDoc = createHydratedRowDoc('row-id');
      const registering = createDeferred<YDoc>();
      const createRow = jest.fn((_rowKey: string, _options?: { forceSync?: boolean }) => registering.promise);
      const scheduleDeferredCleanup = jest.fn();
      const props = { ...databaseProps(doc), createRow, scheduleDeferredCleanup };

      mockedGetCachedRowDoc.mockImplementation((key) => (key === rowKey ? rowDoc : undefined));
      mockResidentSources.add('database-id');
      const first = render(<Database {...props} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
      expect(createRow).toHaveBeenCalledTimes(1);
      // The view unmounts before the row's realtime binding is registered.
      first.unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      const second = render(<Database {...props} />);
      let ensured: YDoc | undefined;
      const ensure = requestEnsureRow();

      await act(async () => {
        registering.resolve(rowDoc);
        ensured = await ensure;
      });
      await act(async () => {
        await requestEnsureRow();
      });
      expect(ensured).toBe(rowDoc);
      expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(rowDoc);
      // The one registration, no forced sync.
      expect(createRow).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      second.unmount();
      releaseResidentSource('database-id');
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith('row-id');

      doc.destroy();
      rowDoc.destroy();
    });

    it('releases a kept binding that was still registering once it completes, when the source goes first', async () => {
      const doc = createDatabaseDoc('database-id');
      const rowDoc = createHydratedRowDoc('row-id');
      const registering = createDeferred<YDoc>();
      const createRow = jest.fn(() => registering.promise);
      const scheduleDeferredCleanup = jest.fn();

      mockResidentSources.add('database-id');
      const { unmount } = render(
        <Database {...databaseProps(doc)} createRow={createRow} scheduleDeferredCleanup={scheduleDeferredCleanup} />
      );

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
      unmount();
      releaseResidentSource('database-id');
      // Nothing to release before the registration completes.
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      await act(async () => {
        registering.resolve(rowDoc);
        await registering.promise;
      });
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith('row-id');

      doc.destroy();
      rowDoc.destroy();
    });

    it('binds the row again when a version reset replaced its document while the binding was kept', async () => {
      const doc = createDatabaseDoc('database-id');
      const rowDoc = createHydratedRowDoc('row-id');
      const replacementDoc = createHydratedRowDoc('row-id');
      const createRow = jest.fn(async () => rowDoc);
      const scheduleDeferredCleanup = jest.fn();
      const props = { ...databaseProps(doc), createRow, scheduleDeferredCleanup };

      mockedGetCachedRowDoc.mockImplementation((key) => (key === rowKey ? rowDoc : undefined));
      const first = render(<Database {...props} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await requestEnsureRow();
      });
      mockResidentSources.add('database-id');
      first.unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      // The tab now caches the replacement document of the row.
      mockedGetCachedRowDoc.mockImplementation((key) => (key === rowKey ? replacementDoc : undefined));
      createRow.mockResolvedValue(replacementDoc);
      const second = render(<Database {...props} />);

      await act(async () => {
        await requestEnsureRow();
      });
      // The stale binding is released and the row registered on its replacement.
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(createRow).toHaveBeenCalledTimes(2);
      expect(createRow).toHaveBeenLastCalledWith(rowKey);
      expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(replacementDoc);

      second.unmount();
      doc.destroy();
      rowDoc.destroy();
      replacementDoc.destroy();
    });
  });

  it('starts from nothing fetched when a read-only database turns writable', async () => {
    const doc = createDatabaseDoc('database-id');
    const walk = createDeferred<void>();

    mockedPrefetch.mockImplementation((() => walk.promise) as unknown as typeof prefetchDatabaseBlobDiff);
    const { rerender, unmount } = render(<Database {...databaseProps(doc)} readOnly />);

    // Read-only: no walk, rows load one by one, so the prefetch counts as complete.
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));
    expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(true);
    expect(mockedPrefetch).not.toHaveBeenCalled();

    // The permission arrives: the walk starts, and row loaders wait for its seeds again.
    rerender(<Database {...databaseProps(doc)} />);
    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    expect(mockedPrefetch.mock.calls[0][2]?.forceFullSync).toBe(false);
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(false));
    expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(false);

    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(true);
    await act(async () => {
      walk.resolve();
      await walk.promise;
    });
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));

    unmount();
    doc.destroy();
  });

  it('counts a realtime binding once for each row it binds', async () => {
    const doc = createDatabaseDoc('database-id');
    const rowDoc = createHydratedRowDoc('row-id');
    const createRow = jest.fn(async () => rowDoc);

    mockedOpenRowDoc.mockResolvedValue(rowDoc);
    const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    expect(dashboardLoadStats.snapshot().rowsBound).toEqual({});

    await act(async () => {
      await requestEnsureRow();
    });
    expect(dashboardLoadStats.snapshot().rowsBound).toEqual({ 'database-id': 1 });

    // Ensuring the same row again reuses its binding.
    await act(async () => {
      await requestEnsureRow();
    });
    expect(dashboardLoadStats.snapshot().rowsBound).toEqual({ 'database-id': 1 });

    unmount();
    doc.destroy();
    rowDoc.destroy();
  });

  it('keeps related-database rows out of the current row map and local mutation store', async () => {
    const doc = createDatabaseDoc('database-id');
    const relatedRowDoc = createHydratedRowDoc('related-row-doc');
    const currentRowDoc = createHydratedRowDoc('current-row-doc');
    const createRow = jest.fn(async (rowKey: string) =>
      rowKey === 'database-b_rows_row-id' ? relatedRowDoc : currentRowDoc
    );
    const scheduleDeferredCleanup = jest.fn();
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} scheduleDeferredCleanup={scheduleDeferredCleanup} />
    );

    try {
      if (!mockDatabaseContext?.createRow) throw new Error('Database context did not expose createRow');

      await act(async () => {
        await mockDatabaseContext?.createRow?.('database-b_rows_row-id');
      });

      expect(createRow).toHaveBeenCalledWith('database-b_rows_row-id');
      expect(mockDatabaseContext.rowMap?.['row-id']).toBeUndefined();
      expect(mockDatabaseContext.hasCellLocalMutation?.('row-id', 'field-id')).toBe(false);

      await act(async () => {
        await mockDatabaseContext?.createRow?.('database-id_rows_row-id');
      });

      expect(createRow).toHaveBeenCalledWith('database-id_rows_row-id');
      expect(mockDatabaseContext.rowMap?.['row-id']).toBe(currentRowDoc);
      expect(mockDatabaseContext.hasCellLocalMutation?.('row-id', 'field-id')).toBe(true);
    } finally {
      unmount();
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
      expect(scheduleDeferredCleanup).toHaveBeenNthCalledWith(1, 'row-id');
      expect(scheduleDeferredCleanup).toHaveBeenNthCalledWith(2, 'row-id');
      doc.destroy();
      relatedRowDoc.destroy();
      currentRowDoc.destroy();
    }
  });

  it('sequentially rebinds a visible remote row after its initial registration settles', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-id');
    const seededRowDoc = createHydratedRowDoc('remote-row-id');
    const initialRegistration = createDeferred<YDoc>();
    const createRow = jest.fn((_rowKey: string, options?: { forceSync?: boolean }) =>
      options?.forceSync ? Promise.resolve(seededRowDoc) : initialRegistration.promise
    );
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'remote-row-id': seededRowDoc }} />
    );

    try {
      await act(async () => {
        insertRemoteRowOrder(doc, 'remote-row-id');
        await Promise.resolve();
      });

      const ensuredRow = requestRemoteRowEnsure();

      expect(createRow).toHaveBeenCalledTimes(1);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id');

      // Retry deadlines must not be consumed while IndexedDB/sync-context
      // registration is still pending.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(9_000);
      });
      expect(createRow).toHaveBeenCalledTimes(1);

      await act(async () => {
        initialRegistration.resolve(seededRowDoc);
        await ensuredRow;
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });
      expect(createRow).toHaveBeenCalledTimes(2);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id', { forceSync: true });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(3_000);
      });
      expect(createRow).toHaveBeenCalledTimes(3);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id', { forceSync: true });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      expect(createRow).toHaveBeenCalledTimes(4);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id', { forceSync: true });
    } finally {
      unmount();
      doc.destroy();
      seededRowDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('binds sync and retains reconciliation when concurrent ensures join a seed-only load', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-id');
    const seededRowDoc = createHydratedRowDoc('remote-row-id');
    const canonicalRowDoc = createHydratedRowDoc('remote-row-id');
    const seedLoad = createDeferred<YDoc>();
    const seed = { bytes: new Uint8Array([1, 2, 3]), encoderVersion: 1 };
    const createRow = jest.fn(async () => canonicalRowDoc);

    mockedPeekSeed.mockImplementation((rowKey) => (rowKey === 'database-id_rows_remote-row-id' ? seed : undefined));
    mockedOpenRowDoc.mockImplementation((rowKey) => {
      if (rowKey === 'database-id_rows_remote-row-id') return seedLoad.promise;
      throw new Error(`unexpected row key: ${rowKey}`);
    });

    const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

    try {
      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      act(() => {
        mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
      });
      await act(async () => {
        insertRemoteRowOrder(doc, 'remote-row-id');
        await Promise.resolve();
      });

      const seedRequest = requestRemoteSeedLoad();
      const firstEnsure = requestRemoteRowEnsure();
      const secondEnsure = requestRemoteRowEnsure();
      let results: Array<YDoc | undefined> = [];

      await act(async () => {
        seedLoad.resolve(seededRowDoc);
        results = await Promise.all([seedRequest, firstEnsure, secondEnsure]);
      });
      expect(createRow).toHaveBeenCalledTimes(1);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id');
      expect(results).toEqual([seededRowDoc, canonicalRowDoc, canonicalRowDoc]);
      expect(mockDatabaseContext?.rowMap?.['remote-row-id']).toBe(canonicalRowDoc);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });
      expect(createRow).toHaveBeenCalledTimes(2);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id', { forceSync: true });
    } finally {
      unmount();
      doc.destroy();
      seededRowDoc.destroy();
      canonicalRowDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('cancels remote reconciliation when the row order is removed', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-id');
    const rowDoc = createHydratedRowDoc('remote-row-id');
    const createRow = jest.fn(async () => rowDoc);
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'remote-row-id': rowDoc }} />
    );
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    try {
      await act(async () => {
        insertRemoteRowOrder(doc, 'remote-row-id');
        await Promise.resolve();
      });
      await act(async () => {
        await requestRemoteRowEnsure();
      });
      expect(createRow).toHaveBeenCalledTimes(1);

      act(() => {
        const index = rowOrders?.toArray().findIndex((row) => row.id === 'remote-row-id') ?? -1;

        if (index >= 0) rowOrders?.delete(index, 1);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });

      expect(createRow).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      doc.destroy();
      rowDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('keeps reconciliation markers isolated across database document lifecycles', async () => {
    jest.useFakeTimers();
    const firstDoc = createDatabaseDoc('database-id');
    const secondDoc = createDatabaseDoc('database-id');
    const rowDoc = createHydratedRowDoc('remote-row-id');
    const createRow = jest.fn(async () => rowDoc);
    const initialRowMap = { 'remote-row-id': rowDoc };
    const { rerender, unmount } = render(
      <Database {...databaseProps(firstDoc)} createRow={createRow} initialRowMap={initialRowMap} />
    );

    try {
      await act(async () => {
        insertRemoteRowOrder(firstDoc, 'remote-row-id');
        await Promise.resolve();
      });
      await act(async () => {
        await requestRemoteRowEnsure();
      });
      expect(createRow).toHaveBeenCalledTimes(1);

      rerender(<Database {...databaseProps(secondDoc)} createRow={createRow} initialRowMap={initialRowMap} />);
      await act(async () => {
        insertRemoteRowOrder(secondDoc, 'remote-row-id');
        await Promise.resolve();
      });
      await act(async () => {
        await requestRemoteRowEnsure();
      });
      expect(createRow).toHaveBeenCalledTimes(2);

      // The first lifecycle's timer resolves first. Its cleanup must not
      // remove the replacement lifecycle's marker for the same row id.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });
      expect(createRow).toHaveBeenCalledTimes(3);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id', { forceSync: true });
    } finally {
      unmount();
      firstDoc.destroy();
      secondDoc.destroy();
      rowDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('reconciles every remote row after the database id hydrates on the same document', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-doc-id', 'temporary-database-id');
    const rowIds = ['remote-row-a', 'remote-row-b', 'remote-row-c'];
    const rowDocs = Object.fromEntries(rowIds.map((rowId) => [rowId, createHydratedRowDoc(rowId)]));
    const createRow = jest.fn(async (rowKey: string) => {
      const rowId = rowKey.split('_rows_')[1];

      return rowDocs[rowId];
    });
    const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} initialRowMap={rowDocs} />);
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    try {
      await act(async () => {
        database?.set(YjsDatabaseKey.id, 'hydrated-database-id');
        await Promise.resolve();
      });

      await act(async () => {
        rowIds.forEach((rowId) => insertRemoteRowOrder(doc, rowId));
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.all(rowIds.map(requestNamedRemoteRowEnsure));
      });
      expect(createRow).toHaveBeenCalledTimes(3);
      expect(createRow.mock.calls.map(([rowKey]) => rowKey)).toEqual(
        rowIds.map((rowId) => `hydrated-database-id_rows_${rowId}`)
      );

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });

      expect(createRow).toHaveBeenCalledTimes(6);
      rowIds.forEach((rowId) => {
        expect(createRow).toHaveBeenCalledWith(`hydrated-database-id_rows_${rowId}`, { forceSync: true });
      });
    } finally {
      unmount();
      doc.destroy();
      Object.values(rowDocs).forEach((rowDoc) => rowDoc.destroy());
      jest.useRealTimers();
    }
  });

  it('reconciles remote rows when the database id and row orders hydrate together', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-doc-id', 'temporary-database-id');
    const rowIds = ['remote-row-a', 'remote-row-b', 'remote-row-c'];
    const rowDocs = Object.fromEntries(rowIds.map((rowId) => [rowId, createHydratedRowDoc(rowId)]));
    const createRow = jest.fn(async (rowKey: string) => {
      const rowId = rowKey.split('_rows_')[1];

      return rowDocs[rowId];
    });
    const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} initialRowMap={rowDocs} />);

    try {
      await act(async () => {
        hydrateDatabaseIdWithRemoteRowOrders(doc, 'hydrated-database-id', rowIds);
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.all(rowIds.map(requestNamedRemoteRowEnsure));
      });
      expect(createRow).toHaveBeenCalledTimes(3);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });

      expect(createRow).toHaveBeenCalledTimes(6);
      rowIds.forEach((rowId) => {
        expect(createRow).toHaveBeenCalledWith(`hydrated-database-id_rows_${rowId}`, { forceSync: true });
      });
    } finally {
      unmount();
      doc.destroy();
      Object.values(rowDocs).forEach((rowDoc) => rowDoc.destroy());
      jest.useRealTimers();
    }
  });

  it('does not schedule reconciliation for a locally inserted row', async () => {
    jest.useFakeTimers();
    const doc = createDatabaseDoc('database-id');
    const rowDoc = createHydratedRowDoc('remote-row-id');
    const createRow = jest.fn(async () => rowDoc);
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'remote-row-id': rowDoc }} />
    );
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get('view-id');
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    try {
      await act(async () => {
        rowOrders?.push([{ id: 'remote-row-id' }]);
        await Promise.resolve();
      });
      await act(async () => {
        await requestRemoteRowEnsure();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });

      expect(createRow).toHaveBeenCalledTimes(1);
      expect(createRow).toHaveBeenLastCalledWith('database-id_rows_remote-row-id');
    } finally {
      unmount();
      doc.destroy();
      rowDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('publishes the provisional seed pages of the current lifecycle at most every 250 ms', async () => {
    jest.useFakeTimers();
    const firstDoc = createDatabaseDoc('database-id');
    const secondDoc = createDatabaseDoc('database-id');
    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);
    const onProgress = jest.fn();

    try {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
      const firstWalk = mockedPrefetch.mock.calls[0][2];
      const unsubscribe = mockDatabaseContext?.subscribeToSeedsProgress?.(onProgress);

      const contextBeforeProgress = mockDatabaseContext;

      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(0);

      // The first page publishes at once; the next ones within 250 ms are
      // published together when the interval ends.
      act(() => {
        firstWalk?.onSeedsProgress?.();
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(1);
      expect(onProgress).toHaveBeenCalledTimes(1);

      act(() => {
        firstWalk?.onSeedsProgress?.();
        firstWalk?.onSeedsProgress?.();
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(249);
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(2);
      expect(onProgress).toHaveBeenCalledTimes(2);
      // Progress is not context state: the context consumers did not re-render.
      expect(mockDatabaseContext).toBe(contextBeforeProgress);
      expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(false);

      // A page staged right before the lifecycle ends is never published into the next one.
      act(() => {
        firstWalk?.onSeedsProgress?.();
      });
      unsubscribe?.();
      rerender(<Database {...databaseProps(secondDoc)} />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(mockedPrefetch).toHaveBeenCalledTimes(2);
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(0);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      act(() => {
        firstWalk?.onSeedsProgress?.();
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(0);

      act(() => {
        mockedPrefetch.mock.calls[1][2]?.onSeedsProgress?.();
      });
      expect(mockDatabaseContext?.getSeedsRevision?.()).toBe(1);
      expect(onProgress).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      firstDoc.destroy();
      secondDoc.destroy();
      jest.useRealTimers();
    }
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
      <Database {...databaseProps(secondDoc)} createRow={createRow} scheduleDeferredCleanup={scheduleDeferredCleanup} />
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

  describe('a row whose local doc has data', () => {
    const rowGuid = () => screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid');

    beforeEach(() => {
      // The walk commits at once and preloads nothing: rows pass the gate and open one by one.
      mockedPrefetch.mockImplementation(async (_workspaceId, _databaseId, options) => {
        options?.onSeedsReady?.();
      });
    });

    it('shows its local doc before its realtime sync answers, and keeps it when sync answers with it', async () => {
      const doc = createDatabaseDoc('database-id');
      const localRowDoc = createHydratedRowDoc('local-row');
      // Binding the row's realtime sync answers when the server does.
      const sync = createDeferred<YDoc>();
      const createRow = jest.fn((_rowKey: string) => sync.promise);

      mockedOpenRowDoc.mockResolvedValue(localRowDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      let settled = false;
      const ensure = requestEnsureRow();

      void Promise.resolve(ensure).then(() => {
        settled = true;
      });

      // The sync round trip is still out: the row shows its local data already.
      await waitFor(() => expect(rowGuid()).toBe('local-row'));
      expect(createRow).toHaveBeenCalledWith('database-id_rows_row-id');
      expect(settled).toBe(false);

      let ensured: YDoc | undefined;

      await act(async () => {
        sync.resolve(localRowDoc);
        ensured = await ensure;
      });
      expect(ensured).toBe(localRowDoc);
      expect(rowGuid()).toBe('local-row');

      unmount();
      doc.destroy();
      localRowDoc.destroy();
    });

    it('replaces its local doc with a different canonical doc once sync answers', async () => {
      const doc = createDatabaseDoc('database-id');
      const localRowDoc = createHydratedRowDoc('local-row');
      const canonicalRowDoc = createHydratedRowDoc('canonical-row');
      const sync = createDeferred<YDoc>();
      const createRow = jest.fn((_rowKey: string) => sync.promise);

      mockedOpenRowDoc.mockResolvedValue(localRowDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      const ensure = requestEnsureRow();

      await waitFor(() => expect(rowGuid()).toBe('local-row'));
      await act(async () => {
        sync.resolve(canonicalRowDoc);
        await ensure;
      });
      await waitFor(() => expect(rowGuid()).toBe('canonical-row'));

      unmount();
      doc.destroy();
      localRowDoc.destroy();
      canonicalRowDoc.destroy();
    });

    it('waits for sync before showing a local doc without data', async () => {
      const doc = createDatabaseDoc('database-id');
      const emptyRowDoc = new Y.Doc({ guid: 'empty-row' }) as YDoc;
      const canonicalRowDoc = createHydratedRowDoc('canonical-row');
      const sync = createDeferred<YDoc>();
      const createRow = jest.fn((_rowKey: string) => sync.promise);

      mockedOpenRowDoc.mockResolvedValue(emptyRowDoc);
      const { unmount } = render(<Database {...databaseProps(doc)} createRow={createRow} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      const ensure = requestEnsureRow();

      await waitFor(() => expect(createRow).toHaveBeenCalledWith('database-id_rows_row-id'));
      expect(rowGuid()).toBe('');
      await act(async () => {
        sync.resolve(canonicalRowDoc);
        await ensure;
      });
      await waitFor(() => expect(rowGuid()).toBe('canonical-row'));

      unmount();
      doc.destroy();
      emptyRowDoc.destroy();
      canonicalRowDoc.destroy();
    });
  });

  describe('row pass state', () => {
    it('serves seedsReady and blobPrefetchComplete without changing the database context', async () => {
      const doc = createDatabaseDoc('database-id');
      const walk = createDeferred<void>();
      let seedsReady: (() => void) | undefined;

      mockedPrefetch.mockImplementation((_workspaceId, _databaseId, options) => {
        seedsReady = options?.onSeedsReady;
        return walk.promise.then(() => undefined);
      });
      const { unmount } = render(<Database {...databaseProps(doc)} />);

      await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
      const context = mockDatabaseContext;
      const changes = jest.fn();
      const unsubscribe = context?.subscribeToRowPassState?.(changes);

      expect(context?.getRowPassState?.()).toEqual({ blobPrefetchComplete: false, seedsReady: false });

      act(() => seedsReady?.());
      expect(context?.getRowPassState?.()).toEqual({ blobPrefetchComplete: false, seedsReady: true });
      await act(async () => {
        walk.resolve();
        await walk.promise;
      });
      expect(context?.getRowPassState?.()).toEqual({ blobPrefetchComplete: true, seedsReady: true });

      // Subscribers heard both; the context every cell reads stayed the same object.
      expect(changes).toHaveBeenCalledTimes(2);
      expect(mockDatabaseContext).toBe(context);

      unsubscribe?.();
      unmount();
      doc.destroy();
    });
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

  it('deduplicates concurrent force sync requests for a registered row', async () => {
    const doc = createDatabaseDoc('database-id');
    const seedShell = createHydratedRowDoc('seed-shell');
    const canonicalRowDoc = createHydratedRowDoc('canonical-row');
    const forceSync = createDeferred<YDoc>();
    const createRow = jest.fn((_rowKey: string, options?: { forceSync?: boolean }) =>
      options?.forceSync ? forceSync.promise : Promise.resolve(seedShell)
    );
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'row-id': seedShell }} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(1));

    const firstEnsure = requestEnsureRow();
    const secondEnsure = requestEnsureRow();

    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(2));
    expect(createRow).toHaveBeenLastCalledWith('database-id_rows_row-id', { forceSync: true });

    let ensuredRows: Array<YDoc | undefined> = [];

    await act(async () => {
      forceSync.resolve(canonicalRowDoc);
      ensuredRows = await Promise.all([firstEnsure, secondEnsure]);
    });

    expect(ensuredRows).toEqual([canonicalRowDoc, canonicalRowDoc]);
    expect(createRow).toHaveBeenCalledTimes(2);

    let cachedEnsure: YDoc | undefined;

    await act(async () => {
      cachedEnsure = await requestEnsureRow();
    });

    expect(cachedEnsure).toBe(canonicalRowDoc);
    expect(createRow).toHaveBeenCalledTimes(2);

    unmount();
    doc.destroy();
    seedShell.destroy();
    canonicalRowDoc.destroy();
  });

  it('retries force sync after a settled request returns an unhydrated row', async () => {
    const doc = createDatabaseDoc('database-id');
    const seedShell = createHydratedRowDoc('seed-shell');
    const unhydratedCanonicalRowDoc = new Y.Doc({ guid: 'row-id' }) as YDoc;
    const hydratedCanonicalRowDoc = createHydratedRowDoc('row-id');
    let forceSyncAttempts = 0;
    const createRow = jest.fn(async (_rowKey: string, options?: { forceSync?: boolean }) => {
      if (!options?.forceSync) return unhydratedCanonicalRowDoc;

      forceSyncAttempts += 1;
      return forceSyncAttempts === 1 ? unhydratedCanonicalRowDoc : hydratedCanonicalRowDoc;
    });
    const { unmount } = render(
      <Database {...databaseProps(doc)} createRow={createRow} initialRowMap={{ 'row-id': seedShell }} />
    );

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(1));

    let firstEnsure: YDoc | undefined;

    await act(async () => {
      firstEnsure = await requestEnsureRow();
    });

    expect(firstEnsure).toBe(unhydratedCanonicalRowDoc);
    expect(createRow).toHaveBeenCalledTimes(2);

    let secondEnsure: YDoc | undefined;

    await act(async () => {
      secondEnsure = await requestEnsureRow();
    });

    expect(secondEnsure).toBe(hydratedCanonicalRowDoc);
    expect(createRow).toHaveBeenCalledTimes(3);
    expect(createRow).toHaveBeenLastCalledWith('database-id_rows_row-id', { forceSync: true });

    unmount();
    doc.destroy();
    seedShell.destroy();
    unhydratedCanonicalRowDoc.destroy();
    hydratedCanonicalRowDoc.destroy();
  });

  it('keeps hydrated snapshot rows local in a read-only database', async () => {
    const doc = createDatabaseDoc('database-id');
    const snapshotRowDoc = createHydratedRowDoc('snapshot-row');
    const transportRowDoc = new Y.Doc({ guid: 'empty-transport-row' }) as YDoc;
    const createRow = jest.fn().mockResolvedValue(transportRowDoc);
    const props = {
      ...databaseProps(doc),
      readOnly: true,
      createRow,
      initialRowMap: { 'row-id': snapshotRowDoc },
    };
    const { unmount } = render(<Database {...props} />);
    let ensuredRow: YDoc | undefined;

    await act(async () => {
      ensuredRow = await requestEnsureRow();
    });

    expect(ensuredRow).toBe(snapshotRowDoc);
    expect(createRow).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Load seeded row' }).getAttribute('data-row-guid')).toBe('snapshot-row');

    unmount();
    doc.destroy();
    snapshotRowDoc.destroy();
    transportRowDoc.destroy();
  });

  it('keeps a readonly embedded App row in a modal that inherits the document permission', () => {
    const doc = createDatabaseDoc('database-id');
    const onOpenRowPage = jest.fn();
    const { unmount } = render(
      <Database {...databaseProps(doc)} isDocumentBlock onOpenRowPage={onOpenRowPage} readOnly variant={UIVariant.App} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open row' }));

    expect(screen.getByTestId('database-row-modal')).not.toBeNull();
    expect(onOpenRowPage).not.toHaveBeenCalled();

    unmount();
    doc.destroy();
  });

  it('preserves route-based readonly row navigation for published databases', () => {
    const doc = createDatabaseDoc('database-id');
    const onOpenRowPage = jest.fn();
    const { unmount } = render(
      <Database
        {...databaseProps(doc)}
        isDocumentBlock
        onOpenRowPage={onOpenRowPage}
        readOnly
        variant={UIVariant.Publish}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open row' }));

    expect(onOpenRowPage).toHaveBeenCalledWith('row-id');
    expect(screen.queryByTestId('database-row-modal')).toBeNull();

    unmount();
    doc.destroy();
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
      <Database {...databaseProps(firstDoc)} createRow={createRow} scheduleDeferredCleanup={scheduleDeferredCleanup} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bind row sync' }));
    expect(createRow).toHaveBeenCalledTimes(1);

    rerender(
      <Database {...databaseProps(secondDoc)} createRow={createRow} scheduleDeferredCleanup={scheduleDeferredCleanup} />
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
