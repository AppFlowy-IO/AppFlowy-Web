import { act, render, renderHook, waitFor } from '@testing-library/react';
import { startTransition, Suspense, type ReactNode, useEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import {
  type BackgroundRowDocChange,
  useBackgroundRowDocLoader,
} from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
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
  it('retries realtime hydration even when a detached seed is already readable', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, viewId } = createDatabaseFixture();
    const seed = createRowDoc('initial-row', databaseId, {});
    const live = new Y.Doc() as YDoc;

    Y.applyUpdate(live, Y.encodeStateAsUpdate(seed));
    const ensureRow = jest.fn().mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue(live);
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: true,
      ensureRow,
      peekRowDocFromSeed: () => seed,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'seed-sync-retry', 'live'), {
      wrapper,
    });

    try {
      await waitFor(() => expect(result.current.cachedRowDocs['initial-row']).toBe(seed));
      expect(ensureRow).toHaveBeenCalledTimes(1);

      // The default waitFor timeout equals the first retry delay. Advance the
      // backoff and the following queue yield without racing the wall clock.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ROW_SYNC_RETRY_DELAYS_MS[0] + 1);
      });
      expect(ensureRow).toHaveBeenCalledTimes(2);
      expect(ensureRow).toHaveBeenLastCalledWith('initial-row');
    } finally {
      unmount();
      live.destroy();
      seed.destroy();
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('stops connecting offscreen rows after the live consumer unmounts', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 25 }, (_, index) => `live-row-${index}`);
    const docs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    let resolveRows!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRows = resolve;
    });
    const ensureRow = jest.fn(async (id: string) => {
      await pending;
      return docs[id];
    });

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: true,
      ensureRow,
      peekRowDocFromSeed: (id) => docs[id] ?? null,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'live-unmount', 'live'), { wrapper });

    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(12));
    unmount();
    await act(async () => {
      resolveRows();
    });
    expect(ensureRow).toHaveBeenCalledTimes(12);
    Object.values(docs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('finishes bounded detached hydration before warm-mount fallback loading', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 257 }, (_, index) => `warm-row-${index}`);
    const seedDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const loadRowFromSeed = jest.fn(async (id: string) => seedDocs[id]);
    const ensureRow = jest.fn();
    const peekRowDocFromSeed = jest.fn((id: string) => seedDocs[id] ?? null);
    const changes: BackgroundRowDocChange[] = [];

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const contextValue = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: true,
      loadRowFromSeed,
      ensureRow,
      peekRowDocFromSeed,
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => {
        const { cachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(true, 'warm-detached');

        useEffect(
          () => subscribeToCachedRowDocChanges((change) => changes.push(change)),
          [subscribeToCachedRowDocChanges]
        );
        return cachedRowDocs;
      },
      { wrapper }
    );

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(257));
    expect(changes.map(({ added }) => Object.keys(added).length)).toEqual([128, 128, 1]);
    expect(peekRowDocFromSeed).toHaveBeenCalledTimes(257);
    expect(loadRowFromSeed).not.toHaveBeenCalled();
    expect(ensureRow).not.toHaveBeenCalled();
    unmount();
    expect(Object.values(seedDocs).every((doc) => !doc.isDestroyed)).toBe(true);
    Object.values(seedDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('keeps fallback loading active when an inactive consumer shares its scope', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 25 }, (_, index) => `remote-row-${index}`);
    const remoteDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const loadRowFromSeed = jest.fn(async () => undefined);
    const ensureRow = jest.fn(async (id: string) => remoteDocs[id]);

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const contextValue = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: false,
      blobPrefetchComplete: true,
      loadRowFromSeed,
      ensureRow,
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(
      () => {
        useBackgroundRowDocLoader(true, 'mixed-consumers');
        useBackgroundRowDocLoader(false, 'mixed-consumers');
      },
      { wrapper }
    );

    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(25));
    expect(new Set(ensureRow.mock.calls.map(([id]) => id)).size).toBe(25);
    unmount();
    Object.values(remoteDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('continues the shared seed pass after its initiating consumer unmounts', () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 129 }, (_, index) => `shared-row-${index}`);
    const seedDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrame = () => {
      const [id, callback] = frames.entries().next().value!;

      frames.delete(id);
      void act(() => callback(0));
    };

    let latestRows: Record<string, YDoc> = {};
    const Consumer = () => {
      latestRows = useBackgroundRowDocLoader(true, 'shared-seed-owner').cachedRowDocs;
      return null;
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const contextValue = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: false,
      peekRowDocFromSeed: (id: string) => seedDocs[id] ?? null,
    } as DatabaseContextState;
    const tree = (showOwner: boolean) => (
      <DatabaseContext.Provider value={contextValue}>
        {showOwner && <Consumer key='owner' />}
        <Consumer key='survivor' />
      </DatabaseContext.Provider>
    );
    const { rerender, unmount } = render(tree(true));

    flushFrame();
    expect(Object.keys(latestRows)).toHaveLength(128);
    rerender(tree(false));
    expect(frames.size).toBe(1);
    flushFrame();
    expect(Object.keys(latestRows)).toHaveLength(129);
    unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    expect(Object.values(seedDocs).every((doc) => !doc.isDestroyed)).toBe(true);
    Object.values(seedDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('publishes seed hydration as bounded row-document deltas', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 129 }, (_, index) => `seed-row-${index}`);
    const seedDocs = Object.fromEntries(rowIds.map((rowId) => [rowId, createRowDoc(rowId, databaseId, {})]));
    const changes: BackgroundRowDocChange[] = [];

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => seedDocs[rowId] ?? null,
      readOnly: false,
      rowMap: {},
      seedsReady: true,
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => {
        const { cachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(true, 'bounded-seed-deltas');

        useEffect(
          () => subscribeToCachedRowDocChanges((change) => changes.push(change)),
          [subscribeToCachedRowDocChanges]
        );
        return cachedRowDocs;
      },
      { wrapper }
    );

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(129));

    expect(changes.map(({ added }) => Object.keys(added).length)).toEqual([128, 1]);
    expect(changes.every(({ removed }) => Object.keys(removed).length === 0)).toBe(true);

    unmount();
    Object.values(seedDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

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
