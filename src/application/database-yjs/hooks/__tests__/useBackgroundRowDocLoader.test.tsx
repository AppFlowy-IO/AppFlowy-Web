import { act, render, renderHook, waitFor } from '@testing-library/react';
import { startTransition, Suspense, type ReactNode, useEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import {
  type BackgroundRowDocChange,
  useBackgroundRowDocLoader,
} from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
import { openRowCollabDBWithProvider } from '@/application/db';
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
  it('adopts a sibling live reader in one batch without destroying borrowed seed snapshots', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = ['initial-row', 'second-row', 'third-row'];
    const seeds = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const canonical = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    let readable = seeds;
    let resolveLive!: () => void;
    const liveReady = new Promise<void>((resolve) => { resolveLive = resolve; });
    const ensureRow = jest.fn(async (id: string) => { await liveReady; return canonical[id]; });
    const contextValue: DatabaseContextState = {
      activeViewId: viewId, databaseDoc, databasePageId: viewId, readOnly: false,
      rowMap: {}, workspaceId: 'workspace-id', seedsReady: true, blobPrefetchComplete: true,
      ensureRow, peekRowDocFromSeed: (id) => readable[id] ?? null,
    };

    rowOrders.push(rowIds.slice(1).map((id) => ({ id, height: 44 })));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(() => ({
      cached: useBackgroundRowDocLoader(true, 'borrowed-consumer'),
      live: useBackgroundRowDocLoader(true, 'canonical-producer', 'live'),
    }), { wrapper });
    const destroyed = jest.fn();

    Object.values(seeds).forEach((doc) => doc.on('destroy', destroyed));
    try {
      await waitFor(() => expect(Object.keys(result.current.cached.cachedRowDocs)).toHaveLength(3));
      const borrowedSnapshot = result.current.cached.cachedRowDocs;
      const changes = jest.fn();
      const unsubscribe = result.current.cached.subscribeToCachedRowDocChanges(changes);

      await act(async () => {
        readable = canonical;
        resolveLive();
        await jest.advanceTimersByTimeAsync(40);
      });
      expect(result.current.cached.cachedRowDocs).toEqual(canonical);
      expect(changes).toHaveBeenCalledTimes(1);
      expect(changes).toHaveBeenCalledWith({ added: canonical, removed: seeds });
      expect(borrowedSnapshot).toEqual(seeds);
      expect(destroyed).not.toHaveBeenCalled();
      // Replacement detaches the old destroy observer and watches the current
      // borrowed document instead, even though the row id did not change.
      await act(async () => seeds['initial-row'].destroy());
      expect(result.current.cached.cachedRowDocs['initial-row']).toBe(canonical['initial-row']);
      const adopted = canonical['initial-row'];

      await act(async () => {
        delete readable['initial-row'];
        adopted.destroy();
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cached.cachedRowDocs['initial-row']).toBeUndefined();
      unsubscribe();
    } finally {
      unmount();
      Object.values(seeds).forEach((doc) => doc.destroy());
      Object.values(canonical).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('keeps the seed when a live result fails the current fence and adopts it only after commit', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, viewId } = createDatabaseFixture();
    const seed = createRowDoc('initial-row', databaseId, {});
    const canonical = createRowDoc('initial-row', databaseId, {});
    let current = seed;
    const contextValue: DatabaseContextState = {
      activeViewId: viewId, databaseDoc, databasePageId: viewId, readOnly: false,
      rowMap: {}, workspaceId: 'workspace-id', seedsReady: true, blobPrefetchComplete: true,
      ensureRow: jest.fn(async () => canonical), peekRowDocFromSeed: () => current,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={{ ...contextValue }}>{children}</DatabaseContext.Provider>
    );
    const { result, rerender, unmount } = renderHook(() => ({
      cached: useBackgroundRowDocLoader(true, 'fenced-borrower'),
      live: useBackgroundRowDocLoader(true, 'fenced-producer', 'live'),
    }), { wrapper });
    const destroyed = jest.fn();

    seed.on('destroy', destroyed);
    try {
      await act(async () => { await jest.advanceTimersByTimeAsync(80); });
      expect(result.current.cached.cachedRowDocs['initial-row']).toBe(seed);
      contextValue.seedsReady = false;
      rerender();
      current = canonical;
      contextValue.seedsReady = true;
      rerender();
      expect(result.current.cached.cachedRowDocs['initial-row']).toBe(canonical);
      expect(destroyed).not.toHaveBeenCalled();
    } finally {
      unmount();
      seed.destroy();
      canonical.destroy();
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it.each(['cached', 'live'] as const)(
    'does not load current rows for missing historical rows in %s mode',
    async (mode) => {
      const { databaseDoc, viewId } = createDatabaseFixture();
      const loadRowFromSeed = jest.fn(async () => undefined);
      const ensureRow = jest.fn(async () => undefined);
      const openLiveRow = jest.mocked(openRowCollabDBWithProvider);

      openLiveRow.mockClear();
      const contextValue: DatabaseContextState = {
        activeViewId: viewId,
        databaseDoc,
        databasePageId: viewId,
        dataSource: { type: 'history', id: 'history-with-missing-row' },
        loadRowFromSeed,
        ensureRow,
        blobPrefetchComplete: true,
        seedsReady: true,
        rowMap: {},
        readOnly: true,
        workspaceId: 'workspace-id',
      };
      const wrapper = ({ children }: { children: ReactNode }) => (
        <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
      );
      const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'missing-history-row', mode), { wrapper });

      await act(async () => {
        await Promise.resolve();
      });
      expect(loadRowFromSeed).not.toHaveBeenCalled();
      expect(ensureRow).not.toHaveBeenCalled();
      expect(openLiveRow).not.toHaveBeenCalled();
      unmount();
      databaseDoc.destroy();
    }
  );

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

  it('hydrates the pages a walk in flight delivers and drops seed docs the seed cache destroys', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = ['page-row-1', 'page-row-2', 'page-row-3'];
    const seedDocs: Record<string, YDoc> = {};
    // The Database's seeds-progress store: a revision and its subscribers.
    const seedsProgress = { revision: 0, subscribers: new Set<() => void>() };
    const publishSeedsProgress = (revision: number) => {
      seedsProgress.revision = revision;
      seedsProgress.subscribers.forEach((subscriber) => subscriber());
    };

    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => seedDocs[rowId] ?? null,
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => seedsProgress.revision,
      subscribeToSeedsProgress: (onStoreChange) => {
        seedsProgress.subscribers.add(onStoreChange);
        return () => seedsProgress.subscribers.delete(onStoreChange);
      },
      workspaceId: 'workspace-id',
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'provisional-pages').cachedRowDocs, {
      wrapper,
    });

    // A seed doc nobody announced yet is not read.
    seedDocs['page-row-1'] = createRowDoc('page-row-1', databaseId, {});
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({});
    expect(seedsProgress.subscribers.size).toBe(1);

    // The first page arrives before the walk's terminal page.
    act(() => publishSeedsProgress(1));
    await waitFor(() => expect(Object.keys(result.current)).toEqual(['page-row-1']));

    // A restart destroys the doc that page built.
    act(() => {
      seedDocs['page-row-1'].destroy();
      delete seedDocs['page-row-1'];
    });
    await waitFor(() => expect(result.current).toEqual({}));

    // The replacement walk delivers the rows again.
    seedDocs['page-row-1'] = createRowDoc('page-row-1', databaseId, {});
    seedDocs['page-row-2'] = createRowDoc('page-row-2', databaseId, {});
    act(() => publishSeedsProgress(3));
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(['page-row-1', 'page-row-2']));
    expect(result.current['page-row-1']).toBe(seedDocs['page-row-1']);

    unmount();
    expect(seedsProgress.subscribers.size).toBe(0);
    Object.values(seedDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('publishes the docs of a walk in flight at once, then a few times a second, and never a dropped one', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const seedDocs: Record<string, YDoc> = {};
    const seedsProgress = { revision: 0, subscribers: new Set<() => void>() };
    const publishSeedsProgress = () => {
      seedsProgress.revision += 1;
      seedsProgress.subscribers.forEach((subscriber) => subscriber());
    };

    let contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => seedDocs[rowId] ?? null,
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => seedsProgress.revision,
      subscribeToSeedsProgress: (onStoreChange) => {
        seedsProgress.subscribers.add(onStoreChange);
        return () => seedsProgress.subscribers.delete(onStoreChange);
      },
      workspaceId: 'workspace-id',
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(['row-1', 'row-2', 'row-3', 'row-4'].map((id) => ({ id, height: 44 })));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, rerender, unmount } = renderHook(
      () => useBackgroundRowDocLoader(true, 'provisional-publish-cadence').cachedRowDocs,
      { wrapper }
    );
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };

    try {
      // The first page is published at once.
      seedDocs['row-1'] = createRowDoc('row-1', databaseId, {});
      act(() => publishSeedsProgress());
      await advance(20);
      expect(Object.keys(result.current)).toEqual(['row-1']);

      // The next page waits for the end of the first interval.
      seedDocs['row-2'] = createRowDoc('row-2', databaseId, {});
      act(() => publishSeedsProgress());
      await advance(100);
      expect(Object.keys(result.current)).toEqual(['row-1']);
      await advance(200);
      expect(Object.keys(result.current).sort()).toEqual(['row-1', 'row-2']);

      // A restart destroys a doc before its publish: it is never published.
      seedDocs['row-3'] = createRowDoc('row-3', databaseId, {});
      act(() => publishSeedsProgress());
      await advance(100);
      expect(result.current['row-3']).toBeUndefined();
      act(() => {
        seedDocs['row-3'].destroy();
        delete seedDocs['row-3'];
      });
      await advance(1000);
      expect(Object.keys(result.current).sort()).toEqual(['row-1', 'row-2']);

      // Committed seeds are published every frame again.
      seedDocs['row-3'] = createRowDoc('row-3', databaseId, {});
      seedDocs['row-4'] = createRowDoc('row-4', databaseId, {});
      contextValue = { ...contextValue, seedsReady: true };
      rerender();
      await advance(20);
      expect(Object.keys(result.current).sort()).toEqual(['row-1', 'row-2', 'row-3', 'row-4']);
      expect(result.current['row-3']).toBe(seedDocs['row-3']);
    } finally {
      unmount();
      Object.values(seedDocs).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('hydrates the rows of a walk in flight in row order, whichever page delivered them first', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    // More rows than one frame hydrates, so the pass is still running when the next page arrives.
    const rowIds = Array.from({ length: 300 }, (_, index) => `ordered-row-${index}`);
    const seedDocs: Record<string, YDoc> = {};
    const peeked: string[] = [];
    const seedsProgress = { revision: 0, subscribers: new Set<() => void>() };
    const publishSeedsProgress = () => {
      seedsProgress.revision += 1;
      seedsProgress.subscribers.forEach((subscriber) => subscriber());
    };

    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => {
        const doc = seedDocs[rowId] ?? null;

        if (doc) peeked.push(rowId);
        return doc;
      },
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => seedsProgress.revision,
      subscribeToSeedsProgress: (onStoreChange) => {
        seedsProgress.subscribers.add(onStoreChange);
        return () => seedsProgress.subscribers.delete(onStoreChange);
      },
      workspaceId: 'workspace-id',
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'provisional-row-order').cachedRowDocs, {
      wrapper,
    });
    const nextFrame = async () => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16);
      });
    };

    try {
      // The first page holds every row but the first ten.
      rowIds.slice(10).forEach((id) => {
        seedDocs[id] = createRowDoc(id, databaseId, {});
      });
      act(() => publishSeedsProgress());
      await nextFrame();
      expect(peeked[0]).toBe('ordered-row-10');
      const firstFrame = peeked.length;

      // The next page brings the first ten rows while the pass still runs.
      rowIds.slice(0, 10).forEach((id) => {
        seedDocs[id] = createRowDoc(id, databaseId, {});
      });
      act(() => publishSeedsProgress());
      await nextFrame();

      expect(peeked.slice(firstFrame, firstFrame + 11)).toEqual([...rowIds.slice(0, 10), rowIds[10 + firstFrame]]);
    } finally {
      unmount();
      Object.values(seedDocs).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('publishes the first docs of a walk at once, even after frames that found no delivered row', async () => {
    jest.useFakeTimers();
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    // More rows than one frame scans: the first frame checks 4096 rows the page did not deliver.
    const rowIds = Array.from({ length: 4200 }, (_, index) => `late-row-${index}`);
    const seedDocs: Record<string, YDoc> = {};
    const seedsProgress = { revision: 0, subscribers: new Set<() => void>() };
    const publishSeedsProgress = () => {
      seedsProgress.revision += 1;
      seedsProgress.subscribers.forEach((subscriber) => subscriber());
    };

    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => seedDocs[rowId] ?? null,
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => seedsProgress.revision,
      subscribeToSeedsProgress: (onStoreChange) => {
        seedsProgress.subscribers.add(onStoreChange);
        return () => seedsProgress.subscribers.delete(onStoreChange);
      },
      workspaceId: 'workspace-id',
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => useBackgroundRowDocLoader(true, 'provisional-empty-frames').cachedRowDocs,
      { wrapper }
    );
    const nextFrame = async () => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16);
      });
    };

    try {
      // The page delivered only the last rows of the view.
      rowIds.slice(4150).forEach((id) => {
        seedDocs[id] = createRowDoc(id, databaseId, {});
      });
      act(() => publishSeedsProgress());
      // The first frame scans 4096 rows without finding a seed.
      await nextFrame();
      expect(result.current).toEqual({});
      // The second frame finds the delivered rows: they show at once, not an interval later.
      await nextFrame();
      await nextFrame();
      expect(Object.keys(result.current)).toHaveLength(50);
    } finally {
      unmount();
      Object.values(seedDocs).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
      jest.useRealTimers();
    }
  });

  it('rebuilds the seed queue once per page for all consumers of a view', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = ['queue-row-1', 'queue-row-2', 'queue-row-3'];
    const seedDocs: Record<string, YDoc> = {};
    const seedsProgress = { revision: 0, subscribers: new Set<() => void>() };
    const publishSeedsProgress = () => {
      seedsProgress.revision += 1;
      seedsProgress.subscribers.forEach((subscriber) => subscriber());
    };

    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: (rowId) => seedDocs[rowId] ?? null,
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => seedsProgress.revision,
      subscribeToSeedsProgress: (onStoreChange) => {
        seedsProgress.subscribers.add(onStoreChange);
        return () => seedsProgress.subscribers.delete(onStoreChange);
      },
      workspaceId: 'workspace-id',
    };

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const readRowOrders = jest.spyOn(rowOrders, 'toArray');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    // Three consumers of one view share one store, as a grid, its calculations and a chart do.
    const { result, unmount } = renderHook(
      () => {
        const first = useBackgroundRowDocLoader(true, 'shared-queue').cachedRowDocs;

        useBackgroundRowDocLoader(true, 'shared-queue');
        useBackgroundRowDocLoader(true, 'shared-queue');
        return first;
      },
      { wrapper }
    );

    readRowOrders.mockClear();
    seedDocs['queue-row-1'] = createRowDoc('queue-row-1', databaseId, {});
    act(() => publishSeedsProgress());
    await waitFor(() => expect(Object.keys(result.current)).toEqual(['queue-row-1']));
    expect(readRowOrders).toHaveBeenCalledTimes(1);

    seedDocs['queue-row-2'] = createRowDoc('queue-row-2', databaseId, {});
    act(() => publishSeedsProgress());
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(['queue-row-1', 'queue-row-2']));
    expect(readRowOrders).toHaveBeenCalledTimes(2);

    unmount();
    readRowOrders.mockRestore();
    Object.values(seedDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('keeps the docs one widget reads from the cache while another widget on the same view holds the rows itself', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = ['shared-row-1', 'shared-row-2', 'shared-row-3'];
    const seedDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const liveDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    // Two widgets on one view: each mounts its own Database, so each has its own row map.
    const baseContext = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: false,
      peekRowDocFromSeed: (id: string) => seedDocs[id] ?? null,
    };
    let firstContext = { ...baseContext, rowMap: {} } as DatabaseContextState;
    const secondContext = { ...baseContext, rowMap: {} } as DatabaseContextState;
    let firstRows: Record<string, YDoc> = {};
    let secondRows: Record<string, YDoc> = {};
    const First = () => {
      firstRows = useBackgroundRowDocLoader(true, 'two-widgets').cachedRowDocs;
      return null;
    };

    const Second = () => {
      secondRows = useBackgroundRowDocLoader(true, 'two-widgets').cachedRowDocs;
      return null;
    };

    const tree = (showFirst = true) => (
      <>
        {showFirst && (
          <DatabaseContext.Provider value={firstContext}>
            <First />
          </DatabaseContext.Provider>
        )}
        <DatabaseContext.Provider value={secondContext}>
          <Second />
        </DatabaseContext.Provider>
      </>
    );
    const { rerender, unmount } = render(tree());

    await waitFor(() => expect(Object.keys(secondRows).sort()).toEqual(rowIds));
    expect(Object.keys(firstRows).sort()).toEqual(rowIds);

    // The first widget renders two of the rows: they are now in its own row map.
    firstContext = {
      ...firstContext,
      rowMap: { 'shared-row-1': liveDocs['shared-row-1'], 'shared-row-2': liveDocs['shared-row-2'] },
    };
    rerender(tree());
    await act(async () => {
      await Promise.resolve();
    });

    // The second widget has none of them in its row map and still reads all three from the cache.
    expect(Object.keys(secondRows).sort()).toEqual(rowIds);
    expect(secondRows['shared-row-1']).toBe(seedDocs['shared-row-1']);
    expect(Object.values(seedDocs).every((doc) => !doc.isDestroyed)).toBe(true);

    // Once the first widget is gone the second one still has them.
    rerender(tree(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(Object.keys(secondRows).sort()).toEqual(rowIds);

    unmount();
    [...Object.values(seedDocs), ...Object.values(liveDocs)].forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('hydrates the rows a second widget on the view needs although the first widget already holds them', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = ['held-row-1', 'held-row-2'];
    const seedDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const liveDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    const baseContext = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: false,
      peekRowDocFromSeed: (id: string) => seedDocs[id] ?? null,
    };
    // The first widget holds every row in its own row map; the second holds none.
    const firstContext = { ...baseContext, rowMap: liveDocs } as DatabaseContextState;
    const secondContext = { ...baseContext, rowMap: {} } as DatabaseContextState;
    let secondRows: Record<string, YDoc> = {};
    const First = () => {
      useBackgroundRowDocLoader(true, 'second-widget-needs-rows');
      return null;
    };

    const Second = () => {
      secondRows = useBackgroundRowDocLoader(true, 'second-widget-needs-rows').cachedRowDocs;
      return null;
    };

    // The widget that holds the rows commits last, so its row map is the latest one the store saw.
    const { unmount } = render(
      <>
        <DatabaseContext.Provider value={secondContext}>
          <Second />
        </DatabaseContext.Provider>
        <DatabaseContext.Provider value={firstContext}>
          <First />
        </DatabaseContext.Provider>
      </>
    );

    await waitFor(() => expect(Object.keys(secondRows).sort()).toEqual(rowIds));
    expect(secondRows['held-row-1']).toBe(seedDocs['held-row-1']);

    unmount();
    [...Object.values(seedDocs), ...Object.values(liveDocs)].forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('stops loading rows one by one when the blob prefetch starts over', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const rowIds = Array.from({ length: 60 }, (_, index) => `fallback-row-${index}`);
    const rowDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));
    const loadRowFromSeed = jest.fn(async () => undefined);
    const pendingEnsures: Array<() => void> = [];
    // Each row load stays pending until the test releases it.
    const ensureRow = jest.fn(
      (id: string) =>
        new Promise<YDoc | undefined>((resolve) => {
          pendingEnsures.push(() => resolve(rowDocs[id]));
        })
    );

    rowOrders.delete(0, rowOrders.length);
    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    // A widget that opened read-only: no blob walk, the prefetch counts as complete.
    let contextValue = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: true,
      rowMap: {},
      workspaceId: 'workspace-id',
      seedsReady: true,
      blobPrefetchComplete: true,
      loadRowFromSeed,
      ensureRow,
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { rerender, unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'readonly-fallback'), { wrapper });

    // The first rows are requested one by one.
    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(12));

    // The widget turns writable: its Database starts the blob walk, so the prefetch is no longer complete.
    contextValue = { ...contextValue, readOnly: false, seedsReady: false, blobPrefetchComplete: false };
    rerender();
    await act(async () => {
      pendingEnsures.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // No further row was requested: the walk delivers the other 48.
    expect(ensureRow).toHaveBeenCalledTimes(12);

    unmount();
    Object.values(rowDocs).forEach((doc) => doc.destroy());
    databaseDoc.destroy();
  });

  it('does not follow the pages of a walk in flight while it has no conditions to evaluate', async () => {
    const { databaseDoc, databaseId, viewId } = createDatabaseFixture();
    const seedDoc = createRowDoc('initial-row', databaseId, {});
    const subscribeToSeedsProgress = jest.fn(() => () => undefined);
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: false,
      databaseDoc,
      databasePageId: viewId,
      peekRowDocFromSeed: () => seedDoc,
      readOnly: false,
      rowMap: {},
      seedsReady: false,
      getSeedsRevision: () => 4,
      subscribeToSeedsProgress,
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => useBackgroundRowDocLoader(false, 'inactive-provisional-pages').cachedRowDocs,
      { wrapper }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(subscribeToSeedsProgress).not.toHaveBeenCalled();
    expect(result.current).toEqual({});

    unmount();
    seedDoc.destroy();
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
