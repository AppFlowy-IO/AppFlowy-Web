import { startTransition, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
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
 * Hook that handles background loading of row documents for sorting/filtering.
 * When sorts or filters are active, row docs need to be loaded to apply conditions.
 *
 * The loader state is shared per database view because useRowOrdersSelector is
 * consumed by several grid subcomponents. Without this store, each consumer
 * starts its own row hydration pass.
 *
 * @param hasConditions - Whether there are active sorts or filters
 * @returns Object containing cached row docs and merged row docs for conditions
 */
export function useBackgroundRowDocLoader(hasConditions: boolean) {
  const rows = useRowMap();
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const { databaseDoc, loadRowFromSeed, peekRowDocFromSeed, blobPrefetchComplete, seedsReady } = useDatabaseContext();
  const storeKey = `${databaseDoc.guid}:${viewId ?? 'unknown'}`;
  const store = useMemo(() => getLoaderStore(storeKey), [storeKey]);

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
  // row docs without IndexedDB. Hydrate in frame-sized chunks so large filtered
  // databases do not spend one long task resolving every row.
  useEffect(() => {
    if (!hasConditions || !seedsReady || !peekRowDocFromSeed || store.seedHydrateActive) return;

    const rowOrdersData = view?.get(YjsDatabaseKey.row_orders)?.toJSON() as { id: string }[] | undefined;

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
  }, [hasConditions, seedsReady, peekRowDocFromSeed, store, view, viewId]);

  useEffect(() => {
    if (hasConditions) return;
    cancelBackgroundRun(store);
  }, [hasConditions, store]);

  // Background loading of row docs for sorting/filtering.
  // Waits for blob prefetch to complete so seeds are available, then uses
  // loadRowFromSeed (fast, in-memory seed application) for each row.
  // Falls back to IndexedDB for rows without seeds.
  useEffect(() => {
    if (!hasConditions || !blobPrefetchComplete) return;

    const rowOrdersData = view?.get(YjsDatabaseKey.row_orders)?.toJSON() as { id: string }[] | undefined;

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
  }, [databaseDoc.guid, hasConditions, blobPrefetchComplete, rows, view, viewId, loadRowFromSeed, scheduleFlush, store]);

  return {
    cachedRowDocs,
  };
}
