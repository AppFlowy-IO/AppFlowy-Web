import { act, render, renderHook, waitFor } from '@testing-library/react';
import { startTransition, Suspense, type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { YDatabaseRowOrders, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createRowDoc } from '../../__tests__/test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => ({
  openRowCollabDBWithProvider: jest.fn(async () => {
    throw new Error('record not found');
  }),
}));

function createDatabaseFixture() {
  const databaseId = 'database-id';
  const viewId = 'board-view-id';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;

  rowOrders.push([{ id: 'initial-row', height: 44 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return { databaseDoc, databaseId, rowOrders, viewId };
}

const neverResolvingPromise = new Promise<never>(() => undefined);

function BackgroundLoaderHarness({
  contextValue,
  scope,
  suspend = false,
}: {
  contextValue: DatabaseContextState;
  scope: string;
  suspend?: boolean;
}) {
  return (
    <DatabaseContext.Provider value={contextValue}>
      <BackgroundLoader scope={scope} suspend={suspend} />
    </DatabaseContext.Provider>
  );
}

function BackgroundLoader({ scope, suspend = false }: { scope: string; suspend?: boolean }) {
  useBackgroundRowDocLoader(true, scope);

  if (suspend) throw neverResolvingPromise;
  return null;
}

describe('useBackgroundRowDocLoader', () => {
  it('hydrates a row inserted collaboratively after the initial loading pass', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const initialRowDoc = createRowDoc('initial-row', databaseId, {});
    const insertedRowDoc = createRowDoc('inserted-row', databaseId, {});
    const loadRowFromSeed = jest.fn(async () => undefined);
    const ensureRow = jest.fn(async () => insertedRowDoc);
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: true,
      databaseDoc,
      databasePageId: viewId,
      ensureRow,
      loadRowFromSeed,
      readOnly: false,
      rowMap: { 'initial-row': initialRowDoc },
      seedsReady: false,
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'board-grouping'), { wrapper });

    await waitFor(() => {
      expect(loadRowFromSeed).not.toHaveBeenCalled();
    });

    act(() => {
      rowOrders.push([{ id: 'inserted-row', height: 44 }]);
    });

    await waitFor(() => {
      expect(loadRowFromSeed).toHaveBeenCalledWith('inserted-row');
      expect(ensureRow).toHaveBeenCalledWith('inserted-row');
    });

    unmount();
    initialRowDoc.destroy();
    insertedRowDoc.destroy();
    databaseDoc.destroy();
  });

  it('retries when row_orders arrives before the remote row collab', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const initialRowDoc = createRowDoc('initial-row', databaseId, {});
    const remoteRowDoc = createRowDoc('inserted-row', databaseId, {});
    const unresolvedRowDoc = new Y.Doc({ guid: 'inserted-row' }) as YDoc;
    const remoteRowUpdate = Y.encodeStateAsUpdate(remoteRowDoc);
    const loadRowFromSeed = jest.fn(async () => undefined);
    let ensureAttempts = 0;
    const ensureRow = jest.fn<Promise<YDoc | undefined>, [string]>(async () => {
      ensureAttempts += 1;
      if (ensureAttempts === 2) {
        // The retry's manifest request receives the DatabaseRow collab that
        // was not yet present when row_orders first arrived.
        Y.applyUpdate(unresolvedRowDoc, remoteRowUpdate);
      }

      return unresolvedRowDoc;
    });
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: true,
      databaseDoc,
      databasePageId: viewId,
      ensureRow,
      loadRowFromSeed,
      readOnly: false,
      rowMap: { 'initial-row': initialRowDoc },
      seedsReady: false,
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'board-grouping-retry'), { wrapper });

    act(() => {
      rowOrders.push([{ id: 'inserted-row', height: 44 }]);
    });

    await waitFor(
      () => {
        expect(ensureRow).toHaveBeenCalledTimes(2);
        expect(ensureRow).toHaveBeenNthCalledWith(1, 'inserted-row');
        expect(ensureRow).toHaveBeenNthCalledWith(2, 'inserted-row');
      },
      { timeout: 5_000 }
    );
    expect(unresolvedRowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.database_row)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(ensureRow).toHaveBeenCalledTimes(2);

    unmount();
    initialRowDoc.destroy();
    remoteRowDoc.destroy();
    unresolvedRowDoc.destroy();
    databaseDoc.destroy();
  });

  it('uses the latest row loader callback while a retry is pending', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const initialRowDoc = createRowDoc('initial-row', databaseId, {});
    const remoteRowDoc = createRowDoc('inserted-row', databaseId, {});
    const unresolvedRowDoc = new Y.Doc({ guid: 'inserted-row' }) as YDoc;
    const remoteRowUpdate = Y.encodeStateAsUpdate(remoteRowDoc);
    const loadRowFromSeed = jest.fn(async () => undefined);
    const firstEnsureRow = jest.fn(async () => unresolvedRowDoc);
    const nextEnsureRow = jest.fn(async () => {
      Y.applyUpdate(unresolvedRowDoc, remoteRowUpdate);
      return unresolvedRowDoc;
    });
    const baseContextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: true,
      databaseDoc,
      databasePageId: viewId,
      ensureRow: firstEnsureRow,
      loadRowFromSeed,
      readOnly: false,
      rowMap: { 'initial-row': initialRowDoc },
      seedsReady: false,
      workspaceId: 'workspace-id',
    };
    const { rerender, unmount } = render(
      <BackgroundLoaderHarness contextValue={baseContextValue} scope='board-grouping-latest-callback' />
    );

    act(() => {
      rowOrders.push([{ id: 'inserted-row', height: 44 }]);
    });

    await waitFor(() => {
      expect(firstEnsureRow).toHaveBeenCalledTimes(1);
    });

    rerender(
      <BackgroundLoaderHarness
        contextValue={{ ...baseContextValue, ensureRow: nextEnsureRow }}
        scope='board-grouping-latest-callback'
      />
    );

    await waitFor(
      () => {
        expect(firstEnsureRow).toHaveBeenCalledTimes(1);
        expect(nextEnsureRow).toHaveBeenCalledTimes(1);
      },
      { timeout: 5_000 }
    );
    expect(unresolvedRowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.database_row)).toBe(true);

    unmount();
    initialRowDoc.destroy();
    remoteRowDoc.destroy();
    unresolvedRowDoc.destroy();
    databaseDoc.destroy();
  });

  it('keeps the committed row loader callback when a replacement render suspends', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const initialRowDoc = createRowDoc('initial-row', databaseId, {});
    const unresolvedRowDoc = new Y.Doc({ guid: 'inserted-row' }) as YDoc;
    const loadRowFromSeed = jest.fn(async () => undefined);
    const committedEnsureRow = jest.fn(async () => unresolvedRowDoc);
    const uncommittedEnsureRow = jest.fn(async () => unresolvedRowDoc);
    const baseContextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: true,
      databaseDoc,
      databasePageId: viewId,
      ensureRow: committedEnsureRow,
      loadRowFromSeed,
      readOnly: false,
      rowMap: { 'initial-row': initialRowDoc },
      seedsReady: false,
      workspaceId: 'workspace-id',
    };
    const { rerender, unmount } = render(
      <Suspense fallback={null}>
        <BackgroundLoaderHarness contextValue={baseContextValue} scope='board-grouping-suspended-callback' />
      </Suspense>
    );

    act(() => {
      rowOrders.push([{ id: 'inserted-row', height: 44 }]);
    });

    await waitFor(() => {
      expect(committedEnsureRow).toHaveBeenCalledTimes(1);
    });

    act(() => {
      startTransition(() => {
        rerender(
          <Suspense fallback={null}>
            <BackgroundLoaderHarness
              contextValue={{ ...baseContextValue, ensureRow: uncommittedEnsureRow }}
              scope='board-grouping-suspended-callback'
              suspend
            />
          </Suspense>
        );
      });
    });

    await waitFor(
      () => {
        expect(committedEnsureRow).toHaveBeenCalledTimes(2);
      },
      { timeout: 5_000 }
    );
    expect(uncommittedEnsureRow).not.toHaveBeenCalled();

    unmount();
    initialRowDoc.destroy();
    unresolvedRowDoc.destroy();
    databaseDoc.destroy();
  });
});
