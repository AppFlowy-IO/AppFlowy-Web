import { startTransition, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { useDatabaseContext, useDatabaseView, useDatabaseViewId, useRowMap } from '@/application/database-yjs/context';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { openRowCollabDBWithProvider } from '@/application/db';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDoc, YjsDatabaseKey } from '@/application/types';

const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_CONCURRENCY = 12;
const SEED_HYDRATE_BATCH_SIZE = 128;

type RowDocMap = Record<string, YDoc>;

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

    Y.transact(doc, () => {
      updates.forEach((update) => {
        Y.applyUpdate(doc, update);
      });
    }, null, false);

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
  promise.finally(() => {
    if (pendingEphemeralRowDocs.get(pendingKey) === promise) {
      pendingEphemeralRowDocs.delete(pendingKey);
    }
  }).catch(() => undefined);

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
  const {
    databaseDoc,
    ensureRow,
    loadRowFromSeed,
    peekRowDocFromSeed,
    blobPrefetchComplete,
    seedsReady,
  } = useDatabaseContext();
  const storeKey = `${databaseDoc.guid}:${viewId ?? 'unknown'}:${scope}`;
  const store = useMemo(() => getLoaderStore(storeKey), [storeKey]);
  const [rowOrderRevision, setRowOrderRevision] = useState(0);

  store.rows = rows;

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

    store.backgroundRun = runId;
    store.backgroundLoading = true;
    store.backgroundCancelled = false;

    const drainQueue = async () => {
      while (isRunActive()) {
        if (store.backgroundQueue.size === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (store.backgroundQueue.size === 0 || !isRunActive()) {
            break;
          }
        }

        const batch = Array.from(store.backgroundQueue).slice(0, BACKGROUND_BATCH_SIZE);

        batch.forEach((rowId) => {
          store.backgroundQueue.delete(rowId);
        });

        for (let i = 0; i < batch.length; i += BACKGROUND_CONCURRENCY) {
          if (!isRunActive()) break;
          const slice = batch.slice(i, i + BACKGROUND_CONCURRENCY);

          await Promise.all(
            slice.map(async (rowId) => {
              if (!isRunActive() || hasReadyRowDoc(rowId)) return;

              if (store.cachedRowDocPending.has(rowId)) {
                await store.cachedRowDocPending.get(rowId);
                return;
              }

              // Try fast path: use blob diff seeds via loadRowFromSeed.
              // This adds the doc directly to the main rowMap (no separate cache needed).
              if (loadRowFromSeed) {
                const pending = loadRowFromSeed(rowId);

                store.cachedRowDocPending.set(rowId, pending);

                try {
                  const doc = await pending;

                  if (!isRunActive()) return;
                  if (hasRowConditionData(doc)) return;
                } finally {
                  store.cachedRowDocPending.delete(rowId);
                }
              }

              if (!isRunActive()) return;

              // A row inserted after the blob snapshot has no seed yet. Open
              // its live row document so collaborative inserts can hydrate
              // even though no card was mounted to call ensureRow itself.
              if (ensureRow) {
                try {
                  const doc = await ensureRow(rowId);

                  if (!isRunActive()) return;
                  if (doc && hasRowConditionData(doc)) return;
                } catch {
                  // Fall through to the read-only IndexedDB path.
                }
              }

              if (!isRunActive()) return;

              // Fallback: open from IndexedDB for rows without seeds. The
              // module-level pending map dedupes concurrent opens across views
              // without retaining the doc in the process-wide row cache.
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
                  return;
                }

                if (hasReadyRowDoc(rowId) || hasRowConditionData(store.pendingDocs[rowId])) {
                  releaseOwnedRowDoc(doc);
                  return;
                }

                store.pendingDocs[rowId] = doc;
                scheduleFlush();
              } finally {
                store.cachedRowDocPending.delete(rowId);
              }
            })
          );
        }

        if (!isRunActive()) break;

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (store.backgroundRun === runId) {
        store.backgroundLoading = false;
      }
    };

    void drainQueue();

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
