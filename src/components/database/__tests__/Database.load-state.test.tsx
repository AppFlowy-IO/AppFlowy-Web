import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { prefetchDatabaseBlobDiff } from '@/application/database-blob';
import type { DatabaseContextState } from '@/application/database-yjs';
import type { RowOrdersLoadReport, RowOrdersLoadReporter } from '@/application/database-yjs/selector';
import { getCachedRowDoc, openRowDoc } from '@/application/services/js-services/cache';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import Database, { Database2Props, DatabaseLoadState } from '@/components/database/Database';

let mockDatabaseContext: DatabaseContextState | undefined;
let mockLoadReporter: RowOrdersLoadReporter | undefined;
let mockRendersViews = true;

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

// Stands for the view: the test reports for its row-orders result through the reporter the Database provides.
jest.mock('@/components/database/DatabaseViews', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { useDatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );
  const { RowOrdersLoadReporterContext } = jest.requireActual<typeof import('@/application/database-yjs/selector')>(
    '@/application/database-yjs/selector'
  );

  return function MockDatabaseViews() {
    const loadReporter = React.useContext(RowOrdersLoadReporterContext);

    mockDatabaseContext = useDatabaseContext();
    mockLoadReporter = mockRendersViews ? loadReporter : undefined;
    return null;
  };
});

const mockedPrefetch = prefetchDatabaseBlobDiff as jest.MockedFunction<typeof prefetchDatabaseBlobDiff>;
const mockedGetCachedRowDoc = getCachedRowDoc as jest.MockedFunction<typeof getCachedRowDoc>;
const mockedOpenRowDoc = openRowDoc as jest.MockedFunction<typeof openRowDoc>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createDatabaseDoc(rowIds: string[] = ['row-id']) {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array();

  rowOrders.push(rowIds.map((id) => ({ id })));
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function createHydratedRowDoc(guid: string) {
  const doc = new Y.Doc({ guid }) as YDoc;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, new Y.Map());
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

/** Renders a Database and records every load state it reports, in order. */
function renderDatabase(props: Database2Props) {
  const states: DatabaseLoadState[] = [];
  const onLoadStateChange = (state: DatabaseLoadState) => states.push(state);
  const rendered = render(<Database {...props} onLoadStateChange={onLoadStateChange} />);

  return { ...rendered, states };
}

/** What a row-orders result of the view reports. */
function report(source: object, state: RowOrdersLoadReport) {
  act(() => {
    mockLoadReporter?.report(source, state);
  });
}

describe('Database onLoadStateChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseContext = undefined;
    mockLoadReporter = undefined;
    mockRendersViews = true;
    mockedGetCachedRowDoc.mockReturnValue(undefined);
    mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
  });

  it('reports first-data with the first matches and complete once the pass and the result are complete', async () => {
    const doc = createDatabaseDoc();
    const walk = createDeferred<void>();

    mockedPrefetch.mockImplementation((() => walk.promise) as unknown as typeof prefetchDatabaseBlobDiff);
    const { states, unmount } = renderDatabase(databaseProps(doc));
    const result = {};

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    // A filtered view still reading its rows: nothing to report yet.
    report(result, { complete: false, hasMatches: false });
    expect(states).toEqual([]);

    // Its first matches show.
    report(result, { complete: false, hasMatches: true });
    expect(states).toEqual(['first-data']);
    report(result, { complete: false, hasMatches: true });
    expect(states).toEqual(['first-data']);

    // The terminal page arrives; the result still reads the last rows.
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    expect(states).toEqual(['first-data']);

    // The result is final: the load is complete, once.
    report(result, { complete: true, hasMatches: true });
    expect(states).toEqual(['first-data', 'complete']);

    await act(async () => {
      walk.resolve();
      await walk.promise;
    });
    report(result, { complete: true, hasMatches: true });
    expect(states).toEqual(['first-data', 'complete']);

    unmount();
    doc.destroy();
  });

  it('waits for the row pass when the result is final before it', async () => {
    const doc = createDatabaseDoc();
    const { states, unmount } = renderDatabase(databaseProps(doc));
    const result = {};

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    // A plain grid lists its rows at once, without their data.
    report(result, { complete: true, hasMatches: false });
    expect(states).toEqual([]);

    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    // Nothing was reported as shown before: first-data comes with complete, in that order.
    expect(states).toEqual(['first-data', 'complete']);

    unmount();
    doc.destroy();
  });

  it('waits for every result mounted under the database', async () => {
    const doc = createDatabaseDoc();
    const { states, unmount } = renderDatabase(databaseProps(doc));
    const grid = {};
    const calculation = {};

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    report(grid, { complete: false, hasMatches: true });
    report(calculation, { complete: false, hasMatches: false });
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    report(grid, { complete: true, hasMatches: true });
    expect(states).toEqual(['first-data']);

    report(calculation, { complete: true, hasMatches: true });
    expect(states).toEqual(['first-data', 'complete']);

    unmount();
    doc.destroy();
  });

  it('reports first-data when a row with data is in the row map', async () => {
    const doc = createDatabaseDoc();
    const rowDoc = createHydratedRowDoc('row-id');
    const createRow = jest.fn(async () => rowDoc);

    mockedOpenRowDoc.mockResolvedValue(rowDoc);
    const { states, unmount } = renderDatabase({ ...databaseProps(doc), createRow });

    const result = {};

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    // A sorted view: it lists nothing until every row was read.
    report(result, { complete: false, hasMatches: false });
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    expect(states).toEqual([]);

    // A row opens with its data, for a cell that renders it.
    await act(async () => {
      await mockDatabaseContext?.ensureRow?.('row-id');
    });
    expect(mockDatabaseContext?.rowMap?.['row-id']).toBe(rowDoc);
    expect(states).toEqual(['first-data']);

    report(result, { complete: true, hasMatches: true });
    expect(states).toEqual(['first-data', 'complete']);

    unmount();
    doc.destroy();
    rowDoc.destroy();
  });

  it('reports failed when the row download fails, and no complete after it', async () => {
    const doc = createDatabaseDoc();
    const walk = createDeferred<void>();

    mockedPrefetch.mockImplementation((() => walk.promise) as unknown as typeof prefetchDatabaseBlobDiff);
    const { states, unmount } = renderDatabase(databaseProps(doc));
    const result = {};

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    report(result, { complete: false, hasMatches: false });

    await act(async () => {
      walk.reject(new Error('blob diff failed'));
      await walk.promise.catch(() => undefined);
    });
    await waitFor(() => expect(states).toEqual(['failed']));

    // Rows then load one by one; what they show is still reported, but the load did not complete.
    report(result, { complete: false, hasMatches: true });
    report(result, { complete: true, hasMatches: true });
    expect(states).toEqual(['failed', 'first-data']);

    unmount();
    doc.destroy();
  });

  it('is complete at once for a read-only database, which has no pass to wait for', async () => {
    const doc = createDatabaseDoc();
    const snapshotRowDoc = createHydratedRowDoc('snapshot-row');
    const { states, unmount } = renderDatabase({
      ...databaseProps(doc),
      readOnly: true,
      initialRowMap: { 'row-id': snapshotRowDoc },
    });

    await waitFor(() => expect(states).toEqual(['first-data']));
    report({}, { complete: true, hasMatches: false });
    expect(states).toEqual(['first-data', 'complete']);
    expect(mockedPrefetch).not.toHaveBeenCalled();

    unmount();
    doc.destroy();
    snapshotRowDoc.destroy();
  });

  it('counts the empty result of a view without rows as complete before the pass ends', async () => {
    const doc = createDatabaseDoc([]);
    const { states, unmount } = renderDatabase(databaseProps(doc));

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    // No row to wait for: the empty result is the final one.
    report({}, { complete: true, hasMatches: false });
    expect(states).toEqual(['first-data', 'complete']);

    unmount();
    doc.destroy();
  });

  it('completes on the pass alone when no view reports within the grace period', async () => {
    jest.useFakeTimers();
    mockRendersViews = false;
    const doc = createDatabaseDoc();
    const { states, unmount } = renderDatabase(databaseProps(doc));

    try {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
      act(() => {
        mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
      });
      // The view may still be mounting.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(999);
      });
      expect(states).toEqual([]);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(states).toEqual(['first-data', 'complete']);
    } finally {
      unmount();
      doc.destroy();
      jest.useRealTimers();
    }
  });

  it('reports nothing after it unmounts', async () => {
    jest.useFakeTimers();
    mockRendersViews = false;
    const doc = createDatabaseDoc();
    const { states, unmount } = renderDatabase(databaseProps(doc));

    try {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      act(() => {
        mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
      });
      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(states).toEqual([]);
    } finally {
      doc.destroy();
      jest.useRealTimers();
    }
  });
});
