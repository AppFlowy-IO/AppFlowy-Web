import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { peekDatabaseRowDocSeed, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import type { DatabaseContextState } from '@/application/database-yjs';
import { getCachedRowDoc, openRowDoc } from '@/application/services/js-services/cache';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import Database, { Database2Props } from '@/components/database/Database';

let mockDatabaseContext: DatabaseContextState | undefined;

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

// The dashboard itself: each of its widgets mounts its own `Database`, so the host renders no row.
jest.mock('@/components/database/DatabaseViews', () => {
  const { useDatabaseContext } = jest.requireActual<typeof import('@/application/database-yjs/context')>(
    '@/application/database-yjs/context'
  );

  return function MockDatabaseViews() {
    mockDatabaseContext = useDatabaseContext();
    return null;
  };
});

const mockedPrefetch = prefetchDatabaseBlobDiff as jest.MockedFunction<typeof prefetchDatabaseBlobDiff>;
const mockedPeekSeed = peekDatabaseRowDocSeed as jest.MockedFunction<typeof peekDatabaseRowDocSeed>;
const mockedGetCachedRowDoc = getCachedRowDoc as jest.MockedFunction<typeof getCachedRowDoc>;
const mockedOpenRowDoc = openRowDoc as jest.MockedFunction<typeof openRowDoc>;

const DASHBOARD_VIEW_ID = 'dashboard-view';
const GRID_VIEW_ID = 'grid-view';
const ROW_COUNT = 40;

/** A database with 40 rows, shown by a Dashboard view and by a Grid view. */
function createHostDoc() {
  const doc = new Y.Doc({ guid: 'host-database' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const createView = (layout: DatabaseViewLayout) => {
    const view = new Y.Map();
    const rowOrders = new Y.Array();

    rowOrders.push(Array.from({ length: ROW_COUNT }, (_, index) => ({ id: `row-${index}` })));
    view.set(YjsDatabaseKey.layout, layout);
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    return view;
  };

  views.set(DASHBOARD_VIEW_ID, createView(DatabaseViewLayout.Dashboard));
  views.set(GRID_VIEW_ID, createView(DatabaseViewLayout.Grid));
  database.set(YjsDatabaseKey.id, 'host-database');
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function hostProps(doc: YDoc, activeViewId: string): Database2Props {
  return {
    workspaceId: 'workspace-id',
    doc,
    readOnly: false,
    createRow: jest.fn(),
    activeViewId,
    databaseName: '',
    databasePageId: DASHBOARD_VIEW_ID,
    onChangeView: jest.fn(),
  };
}

describe('Database hosting a Dashboard layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseContext = undefined;
    mockedGetCachedRowDoc.mockReturnValue(undefined);
    mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
  });

  it('starts no blob walk and opens no row doc', async () => {
    const doc = createHostDoc();
    const onLoadStateChange = jest.fn();
    const { unmount } = render(
      <Database {...hostProps(doc, DASHBOARD_VIEW_ID)} onLoadStateChange={onLoadStateChange} />
    );

    // The host has nothing to wait for.
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));
    expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(mockedPrefetch).not.toHaveBeenCalled();
    // Neither a seed lookup nor a row doc: the 30-row preload did not run.
    expect(mockedPeekSeed).not.toHaveBeenCalled();
    expect(mockedOpenRowDoc).not.toHaveBeenCalled();
    expect(mockDatabaseContext?.rowMap).toEqual({});
    expect(onLoadStateChange).not.toHaveBeenCalledWith('failed');

    unmount();
    doc.destroy();
  });

  it('opens a row it is asked for (a row detail) without waiting for a walk', async () => {
    const doc = createHostDoc();
    const rowDoc = new Y.Doc({ guid: 'host-database_rows_row-3' }) as YDoc;

    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, new Y.Map());
    mockedOpenRowDoc.mockResolvedValue(rowDoc);
    const { unmount } = render(
      <Database {...hostProps(doc, DASHBOARD_VIEW_ID)} createRow={jest.fn(async () => rowDoc)} />
    );

    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));
    await act(async () => {
      await mockDatabaseContext?.ensureRow?.('row-3');
    });

    expect(mockedOpenRowDoc).toHaveBeenCalledWith('host-database_rows_row-3', undefined);
    expect(mockDatabaseContext?.rowMap['row-3']).toBe(rowDoc);
    expect(mockedPrefetch).not.toHaveBeenCalled();

    unmount();
    doc.destroy();
    rowDoc.destroy();
  });

  it('starts no second walk once a later update makes the view a dashboard, and lets the first one finish', async () => {
    const doc = createHostDoc();
    const views = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database).get(YjsDatabaseKey.views);
    let finishWalk: () => void = () => undefined;

    mockedPrefetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWalk = resolve;
        })
    );
    // The layout arrives with a later update: until then the view looks like a plain one.
    doc.transact(() => views.get(DASHBOARD_VIEW_ID).delete(YjsDatabaseKey.layout));
    const { unmount } = render(<Database {...hostProps(doc, DASHBOARD_VIEW_ID)} />);

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));

    act(() => {
      doc.transact(() => views.get(DASHBOARD_VIEW_ID).set(YjsDatabaseKey.layout, DatabaseViewLayout.Dashboard));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    // No second walk for the dashboard, and the first one is not reported done before it is.
    expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(false);

    await act(async () => {
      finishWalk();
    });
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));
    expect(mockedPrefetch).toHaveBeenCalledTimes(1);

    unmount();
    doc.destroy();
  });

  it('walks the rows once the active tab is a view that shows them, and its rows wait for that walk', async () => {
    const doc = createHostDoc();
    const rowDoc = new Y.Doc({ guid: 'host-database_rows_row-0' }) as YDoc;

    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, new Y.Map());
    mockedOpenRowDoc.mockResolvedValue(rowDoc);
    const { rerender, unmount } = render(<Database {...hostProps(doc, DASHBOARD_VIEW_ID)} />);

    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(true));
    expect(mockedPrefetch).not.toHaveBeenCalled();

    // The user switches from the Dashboard tab to the Grid tab of the same database.
    rerender(<Database {...hostProps(doc, GRID_VIEW_ID)} />);

    await waitFor(() => expect(mockedPrefetch).toHaveBeenCalledTimes(1));
    expect(mockedPrefetch.mock.calls[0][0]).toBe('workspace-id');
    expect(mockedPrefetch.mock.calls[0][1]).toBe('host-database');
    expect(mockedPrefetch.mock.calls[0][2]?.priorityRowIds).toHaveLength(ROW_COUNT);
    // The grid waits for the walk's seeds: nothing was fetched while the dashboard was shown.
    await waitFor(() => expect(mockDatabaseContext?.getRowPassState?.().blobPrefetchComplete).toBe(false));
    expect(mockDatabaseContext?.getRowPassState?.().seedsReady).toBe(false);

    // A row the grid renders now waits for the walk instead of opening without its seed.
    let ensured = false;

    void mockDatabaseContext?.ensureRow?.('row-0').then(() => {
      ensured = true;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(ensured).toBe(false);
    expect(mockedOpenRowDoc).not.toHaveBeenCalled();

    // The walk commits its seeds: the gate opens and the row loads.
    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });
    await waitFor(() => expect(ensured).toBe(true));
    expect(mockedOpenRowDoc).toHaveBeenCalledWith('host-database_rows_row-0', undefined);

    unmount();
    doc.destroy();
    rowDoc.destroy();
  });
});
