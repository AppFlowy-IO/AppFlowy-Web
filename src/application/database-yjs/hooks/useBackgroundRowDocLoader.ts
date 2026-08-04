import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import * as Y from 'yjs';

import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { useDatabaseContext, useDatabaseView, useDatabaseViewId, useRowMap } from '@/application/database-yjs/context';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { openRowCollabDBWithProvider } from '@/application/db';
import { YDatabaseRowOrders, YDoc, YjsDatabaseKey } from '@/application/types';

const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_CONCURRENCY = 12;
const SEED_HYDRATE_BATCH_SIZE = 128;

type RowDocMap = Record<string, YDoc>;
type EnsureRow = (rowId: string) => Promise<YDoc | undefined> | void;
type LoadRowFromSeed = (rowId: string) => Promise<YDoc | undefined>;

const pendingEphemeralRowDocs = new Map<string, Promise<YDoc>>();
const retainedEphemeralRowDocs = new WeakMap<YDoc, number>();

function openIndexedDB(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('updates')) {
        db.createObjectStore('updates', { autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('custom')) {
        db.createObjectStore('custom');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Failed to open IndexedDB database: ${name}`));
    request.onblocked = () => reject(new Error(`Opening IndexedDB database was blocked: ${name}`));
  });
}

function getAllStoreValues<T>(db: IDBDatabase, storeName: string) {
  return new Promise<T[]>((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }

    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Failed to read IndexedDB store: ${storeName}`));
    transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB transaction failed: ${storeName}`));
  });
}

async function openLegacyReadOnlyRowDoc(rowKey: string) {
  const db = await openIndexedDB(rowKey);

  try {
    const updates = await getAllStoreValues<Uint8Array>(db, 'updates');
    const doc = new Y.Doc({ guid: rowKey }) as YDoc;

    Y.transact(
      doc,
      () => {
        updates.forEach((update) => {
          Y.applyUpdate(doc, update);
        });
      },
      null,
      false
    );

    return doc;
  } finally {
    db.close();
  }
}

async function openReadOnlyRowDoc(rowKey: string, rowId: string) {
  const { doc, provider } = await openRowCollabDBWithProvider(rowId, { skipCache: true });

  await provider.destroy();

  if (hasRowConditionData(doc)) {
    return doc;
  }

  doc.destroy();
  return openLegacyReadOnlyRowDoc(rowKey);
}

function openEphemeralRowDoc(rowKey: string, rowId: string) {
  const pendingKey = `${rowKey}:${rowId}`;
  const pending = pendingEphemeralRowDocs.get(pendingKey);

  if (pending) return pending;

  const promise = openReadOnlyRowDoc(rowKey, rowId);

  pendingEphemeralRowDocs.set(pendingKey, promise);
  promise
    .finally(() => {
      if (pendingEphemeralRowDocs.get(pendingKey) === promise) {
        pendingEphemeralRowDocs.delete(pendingKey);
      }
    })
    .catch(() => undefined);

  return promise;
}

function retainEphemeralRowDoc(doc: YDoc) {
  retainedEphemeralRowDocs.set(doc, (retainedEphemeralRowDocs.get(doc) ?? 0) + 1);
}

function releaseOwnedRowDoc(doc: YDoc) {
  const retainCount = retainedEphemeralRowDocs.get(doc) ?? 0;

  if (retainCount > 1) {
    retainedEphemeralRowDocs.set(doc, retainCount - 1);
    return;
  }

  if (retainCount === 1) {
    retainedEphemeralRowDocs.delete(doc);
  }

  doc.destroy();
}

type LoaderStore = {
  key: string;
  refCount: number;
  cachedRowDocs: RowDocMap;
  subscribers: Set<() => void>;
  sharedCachedRowDocIds: Set<string>;
  cachedRowDocPending: Map<string, Promise<YDoc | undefined>>;
  backgroundQueue: Set<string>;
  backgroundLoading: boolean;
  backgroundCancelled: boolean;
  backgroundRun: number;
  pendingDocs: RowDocMap;
  flushHandle: number | null;
  seedHydrateFrame: number | null;
  seedHydrateRun: number;
  seedHydrateActive: boolean;
  rows: RowDocMap | null | undefined;
  rowOrders: YDatabaseRowOrders | undefined;
  ensureRow: EnsureRow | undefined;
  loadRowFromSeed: LoadRowFromSeed | undefined;
};

const loaderStores = new Map<string, LoaderStore>();

function createLoaderStore(key: string): LoaderStore {
  return {
    key,
    refCount: 0,
    cachedRowDocs: {},
    subscribers: new Set(),
    sharedCachedRowDocIds: new Set(),
    cachedRowDocPending: new Map(),
    backgroundQueue: new Set(),
    backgroundLoading: false,
    backgroundCancelled: false,
    backgroundRun: 0,
    pendingDocs: {},
    flushHandle: null,
    seedHydrateFrame: null,
    seedHydrateRun: 0,
    seedHydrateActive: false,
    rows: undefined,
    rowOrders: undefined,
    ensureRow: undefined,
    loadRowFromSeed: undefined,
  };
}

function getLoaderStore(key: string) {
  let store = loaderStores.get(key);

  if (!store) {
    store = createLoaderStore(key);
    loaderStores.set(key, store);
  }

  return store;
}

function notifyStore(store: LoaderStore) {
  store.subscribers.forEach((callback) => callback());
}

function disposeStoreDoc(store: LoaderStore, rowId: string, doc: YDoc) {
  if (store.sharedCachedRowDocIds.has(rowId) && store.cachedRowDocs[rowId] === doc) return;
  releaseOwnedRowDoc(doc);
}

function setStoreCachedRowDocs(store: LoaderStore, updater: (prev: RowDocMap) => RowDocMap) {
  const next = updater(store.cachedRowDocs);

  if (next === store.cachedRowDocs) return;
  store.cachedRowDocs = next;
  notifyStore(store);
}

function clearPendingFlush(store: LoaderStore) {
  if (store.flushHandle !== null) {
    cancelAnimationFrame(store.flushHandle);
    store.flushHandle = null;
  }

  Object.entries(store.pendingDocs).forEach(([rowId, doc]) => {
    disposeStoreDoc(store, rowId, doc);
  });
  store.pendingDocs = {};
}

function cancelBackgroundRun(store: LoaderStore, runId?: number) {
  if (runId !== undefined && store.backgroundRun !== runId) return;

  store.backgroundRun += 1;
  store.backgroundCancelled = true;
  store.backgroundQueue.clear();
  store.backgroundLoading = false;
  clearPendingFlush(store);
}

function destroyStore(store: LoaderStore) {
  cancelBackgroundRun(store);

  Object.entries(store.cachedRowDocs).forEach(([rowId, doc]) => {
    disposeStoreDoc(store, rowId, doc);
  });

  store.seedHydrateRun += 1;
  if (store.seedHydrateFrame !== null) {
    cancelAnimationFrame(store.seedHydrateFrame);
  }

  store.cachedRowDocs = {};
  store.sharedCachedRowDocIds.clear();
  store.cachedRowDocPending.clear();
  store.seedHydrateFrame = null;
  store.seedHydrateActive = false;
  loaderStores.delete(store.key);
}

/**
 * Loads row documents for consumers that need values across the complete view,
 * including sorting, filtering, and Board grouping.
 *
 * Loader state is shared per database view and consumer scope. The scope keeps
 * independently activated consumers from cancelling each other's hydration.
 *
 * @param active - Whether this consumer needs complete row data
 * @param scope - Isolates independently activated consumers sharing a view
 * @returns Cached read-only row docs that are not already in the main row map
 */
export function useBackgroundRowDocLoader(active: boolean, scope = 'conditions') {
  const rows = useRowMap();
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const { databaseDoc, ensureRow, loadRowFromSeed, peekRowDocFromSeed, blobPrefetchComplete, seedsReady } =
    useDatabaseContext();
  const storeKey = `${databaseDoc.guid}:${viewId ?? 'unknown'}:${scope}`;
  const store = useMemo(() => getLoaderStore(storeKey), [storeKey]);
  const [rowOrderRevision, setRowOrderRevision] = useState(0);

  // A background run is shared by consumers and can outlive the render that
  // started it. Publish transport-sensitive operations only after commit so an
  // interrupted render cannot replace an active run's callbacks with values
  // from a database lifecycle that never became active.
  useLayoutEffect(() => {
    store.rows = rows;
    store.rowOrders = rowOrders;
    store.ensureRow = ensureRow;
    store.loadRowFromSeed = loadRowFromSeed;
  }, [ensureRow, loadRowFromSeed, rowOrders, rows, store]);

  const cachedRowDocs = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        store.subscribers.add(onStoreChange);
        return () => {
          store.subscribers.delete(onStoreChange);
        };
      },
      [store]
    ),
    useCallback(() => store.cachedRowDocs, [store]),
    useCallback(() => store.cachedRowDocs, [store])
  );

  // Y.Array identity is stable when collaborative edits insert rows. Track a
  // primitive revision so the loading effects also process rows added after
  // the initial Board hydration pass.
  useEffect(() => {
    if (!active || !rowOrders) return;

    const handleRowOrdersChange = () => {
      setRowOrderRevision((revision) => revision + 1);
    };

    rowOrders.observeDeep(handleRowOrdersChange);
    return () => {
      rowOrders.unobserveDeep(handleRowOrdersChange);
    };
  }, [active, rowOrders]);

  const scheduleFlush = useCallback(() => {
    if (store.flushHandle !== null) return;
    store.flushHandle = requestAnimationFrame(() => {
      store.flushHandle = null;
      const pending = store.pendingDocs;

      if (Object.keys(pending).length === 0) return;
      store.pendingDocs = {};

      startTransition(() => {
        setStoreCachedRowDocs(store, (prev) => {
          let changed = false;
          const next = { ...prev };
          const currentRows = store.rows;

          Object.entries(pending).forEach(([rowId, doc]) => {
            if (
              !hasRowConditionData(doc) ||
              hasRowConditionData(next[rowId]) ||
              hasRowConditionData(currentRows?.[rowId])
            ) {
              releaseOwnedRowDoc(doc);
              return;
            }

            next[rowId] = doc;
            store.sharedCachedRowDocIds.delete(rowId);
            changed = true;
          });
          return changed ? next : prev;
        });
      });
    });
  }, [store]);

  useEffect(() => {
    store.refCount += 1;

    return () => {
      store.refCount -= 1;

      if (store.refCount <= 0) {
        destroyStore(store);
      }
    };
  }, [store]);

  // Clean up cached docs that are now in the main rowMap.
  useEffect(() => {
    const cached = store.cachedRowDocs;
    let changed = false;
    const next: RowDocMap = {};

    Object.entries(cached).forEach(([rowId, doc]) => {
      if (hasRowConditionData(rows?.[rowId])) {
        disposeStoreDoc(store, rowId, doc);
        store.sharedCachedRowDocIds.delete(rowId);
        changed = true;
        return;
      }

      next[rowId] = doc;
    });

    if (changed) {
      setStoreCachedRowDocs(store, () => next);
    }
  }, [rows, store]);

  // Fast path: as soon as seeds are cached in memory, read shared in-memory
  // row docs without IndexedDB. Hydrate in frame-sized chunks so large
  // databases do not spend one long task resolving every row.
  useEffect(() => {
    if (!active || !seedsReady || !peekRowDocFromSeed || store.seedHydrateActive) return;

    const rowOrdersData = (rowOrders?.toJSON() as { id: string; is_deleted?: boolean }[] | undefined)?.filter(
      (row) => !row.is_deleted
    );

    if (!rowOrdersData) return;

    const runId = store.seedHydrateRun + 1;
    let index = 0;
    let cancelled = false;

    store.seedHydrateRun = runId;
    store.seedHydrateActive = true;

    const processBatch = () => {
      if (cancelled || store.seedHydrateRun !== runId) return;

      const additions: RowDocMap = {};
      let processed = 0;

      while (index < rowOrdersData.length && processed < SEED_HYDRATE_BATCH_SIZE) {
        const rowId = rowOrdersData[index]?.id;

        index += 1;
        processed += 1;

        if (
          !rowId ||
          additions[rowId] ||
          hasRowConditionData(store.rows?.[rowId]) ||
          hasRowConditionData(store.cachedRowDocs[rowId]) ||
          hasRowConditionData(store.pendingDocs[rowId])
        ) {
          continue;
        }

        const doc = peekRowDocFromSeed(rowId);

        if (doc) additions[rowId] = doc;
      }

      if (Object.keys(additions).length > 0) {
        startTransition(() => {
          setStoreCachedRowDocs(store, (prev) => {
            let changed = false;
            const next = { ...prev };
            const currentRows = store.rows;

            Object.entries(additions).forEach(([rowId, doc]) => {
              if (
                hasRowConditionData(next[rowId]) ||
                hasRowConditionData(currentRows?.[rowId]) ||
                hasRowConditionData(store.pendingDocs[rowId])
              ) {
                return;
              }

              next[rowId] = doc;
              store.sharedCachedRowDocIds.add(rowId);
              changed = true;
            });
            return changed ? next : prev;
          });
        });
      }

      if (index < rowOrdersData.length) {
        store.seedHydrateFrame = requestAnimationFrame(processBatch);
      } else {
        store.seedHydrateFrame = null;
        store.seedHydrateActive = false;
      }
    };

    store.seedHydrateFrame = requestAnimationFrame(processBatch);

    return () => {
      cancelled = true;
      store.seedHydrateRun += 1;
      store.seedHydrateActive = false;

      if (store.seedHydrateFrame !== null) {
        cancelAnimationFrame(store.seedHydrateFrame);
        store.seedHydrateFrame = null;
      }
    };
  }, [active, seedsReady, peekRowDocFromSeed, store, rowOrders, rowOrderRevision]);

  useEffect(() => {
    if (active) return;
    cancelBackgroundRun(store);
  }, [active, store]);

  // Background loading of complete-view row docs.
  // Waits for blob prefetch to complete so seeds are available, then uses
  // loadRowFromSeed (fast, in-memory seed application) for each row.
  // Falls back to IndexedDB for rows without seeds.
  useEffect(() => {
    if (!active || !blobPrefetchComplete) return;

    const rowOrdersData = (rowOrders?.toJSON() as { id: string; is_deleted?: boolean }[] | undefined)?.filter(
      (row) => !row.is_deleted
    );

    if (!rowOrdersData) return;

    const hasReadyRowDoc = (rowId: string) => {
      return hasRowConditionData(store.cachedRowDocs[rowId]) || hasRowConditionData(store.rows?.[rowId]);
    };

    rowOrdersData.forEach(({ id }) => {
      if (!hasReadyRowDoc(id)) {
        store.backgroundQueue.add(id);
      }
    });

    if (store.backgroundQueue.size === 0 || store.backgroundLoading) return;

    const runId = store.backgroundRun + 1;
    const isRunActive = () => store.backgroundRun === runId && !store.backgroundCancelled;
    const retryAttempts = new Map<string, number>();
    const isRowStillOrdered = (rowId: string) =>
      (store.rowOrders?.toJSON() as { id: string; is_deleted?: boolean }[] | undefined)?.some(
        (row) => row.id === rowId && !row.is_deleted
      ) ?? false;
    const retryMissingRow = async (rowId: string) => {
      if (!store.ensureRow) return;

      const attempt = retryAttempts.get(rowId) ?? 0;

      if (attempt >= ROW_SYNC_RETRY_DELAYS_MS.length) {
        retryAttempts.delete(rowId);
        return;
      }

      const delayMs = ROW_SYNC_RETRY_DELAYS_MS[attempt];

      retryAttempts.set(rowId, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (!isRunActive() || hasReadyRowDoc(rowId) || !isRowStillOrdered(rowId)) {
        retryAttempts.delete(rowId);
        return;
      }

      store.backgroundQueue.add(rowId);
    };

    store.backgroundRun = runId;
    store.backgroundLoading = true;
    store.backgroundCancelled = false;

    const loadMissingRow = async (rowId: string) => {
      if (!isRunActive() || hasReadyRowDoc(rowId)) {
        retryAttempts.delete(rowId);
        return;
      }

      const retryAttempt = retryAttempts.get(rowId) ?? 0;

      if (store.cachedRowDocPending.has(rowId)) {
        try {
          await store.cachedRowDocPending.get(rowId);
        } catch {
          // Treat another consumer's missing-row result as transient.
        }

        if (!hasReadyRowDoc(rowId)) await retryMissingRow(rowId);
        return;
      }

      // Try fast path: use blob diff seeds via loadRowFromSeed.
      // This adds the doc directly to the main rowMap (no separate cache needed).
      const currentLoadRowFromSeed = store.loadRowFromSeed;

      if (retryAttempt === 0 && currentLoadRowFromSeed) {
        const pending = currentLoadRowFromSeed(rowId);

        store.cachedRowDocPending.set(rowId, pending);

        try {
          const doc = await pending;

          if (!isRunActive()) return;
          if (hasRowConditionData(doc)) {
            retryAttempts.delete(rowId);
            return;
          }
        } catch {
          // A new row may not be present in the database blob yet.
        } finally {
          store.cachedRowDocPending.delete(rowId);
        }
      }

      if (!isRunActive()) return;

      // A row inserted after the blob snapshot has no seed yet. Open its live
      // row document so collaborative inserts hydrate before a card mounts.
      const currentEnsureRow = store.ensureRow;

      if (currentEnsureRow) {
        try {
          const doc = await currentEnsureRow(rowId);

          if (!isRunActive()) return;
          if (doc && hasRowConditionData(doc)) {
            retryAttempts.delete(rowId);
            return;
          }
        } catch {
          // Fall through to the read-only IndexedDB path.
        }
      }

      if (!isRunActive()) return;

      // The first pass checks every local cache. Later passes only re-request
      // the live collab; repeating skip-cache opens cannot make remote data appear.
      if (retryAttempt > 0) {
        await retryMissingRow(rowId);
        return;
      }

      // Fallback: open from IndexedDB for rows without seeds. The module-level
      // pending map dedupes concurrent opens without retaining the doc globally.
      const rowKey = getRowKey(databaseDoc.guid, rowId);
      const pending = openEphemeralRowDoc(rowKey, rowId);

      store.cachedRowDocPending.set(rowId, pending);

      try {
        const doc = await pending;

        retainEphemeralRowDoc(doc);

        if (!isRunActive()) {
          releaseOwnedRowDoc(doc);
          return;
        }

        if (!hasRowConditionData(doc)) {
          releaseOwnedRowDoc(doc);
          await retryMissingRow(rowId);
          return;
        }

        if (hasReadyRowDoc(rowId) || hasRowConditionData(store.pendingDocs[rowId])) {
          releaseOwnedRowDoc(doc);
          return;
        }

        store.pendingDocs[rowId] = doc;
        retryAttempts.delete(rowId);
        scheduleFlush();
      } catch {
        // row_orders and DatabaseRow collabs are independent. A transient
        // record-not-found must remain retryable.
        await retryMissingRow(rowId);
      } finally {
        store.cachedRowDocPending.delete(rowId);
      }
    };

    const drainQueue = async () => {
      while (isRunActive()) {
        if (store.backgroundQueue.size === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (store.backgroundQueue.size === 0 || !isRunActive()) break;
        }

        const batch = Array.from(store.backgroundQueue).slice(0, BACKGROUND_BATCH_SIZE);

        batch.forEach((rowId) => store.backgroundQueue.delete(rowId));

        for (let i = 0; i < batch.length; i += BACKGROUND_CONCURRENCY) {
          if (!isRunActive()) break;
          await Promise.all(batch.slice(i, i + BACKGROUND_CONCURRENCY).map(loadMissingRow));
        }

        if (!isRunActive()) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    void drainQueue()
      .catch(() => undefined)
      .finally(() => {
        if (store.backgroundRun === runId) {
          store.backgroundLoading = false;
        }
      });

    return () => {
      if (store.refCount <= 0) {
        cancelBackgroundRun(store, runId);
      }
    };
  }, [
    databaseDoc.guid,
    active,
    blobPrefetchComplete,
    rows,
    rowOrders,
    rowOrderRevision,
    loadRowFromSeed,
    ensureRow,
    scheduleFlush,
    store,
  ]);

  return {
    cachedRowDocs,
  };
}
