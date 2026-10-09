import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as Y from 'yjs';

import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import {
  useDatabaseContext,
  useDatabaseView,
  useDatabaseViewId,
  useRowMap,
  useRowPassState,
} from '@/application/database-yjs/context';
import { shareEquivalentRowDocRevision } from '@/application/database-yjs/row-doc-revision';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { openRowCollabDBWithProvider } from '@/application/db';
import { YDatabaseRowOrders, YDoc, YjsDatabaseKey } from '@/application/types';

const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_CONCURRENCY = 12;
const SEED_HYDRATE_BATCH_SIZE = 128;
/**
 * Rows checked per frame. While a walk is in flight most rows have no seed
 * yet; checking them is cheap, so only rows that yield a doc use the batch.
 */
const SEED_HYDRATE_SCAN_LIMIT = 4096;
/**
 * While a walk is still in flight, each frame builds docs for at most this
 * long, so the next page's response is not starved of the main thread.
 */
const PROVISIONAL_SEED_HYDRATE_FRAME_BUDGET_MS = 8;
/**
 * While a walk is still in flight, the docs built so far are published on a
 * growing interval: the first ones at once, then after 250 ms, 500 ms and every
 * second. Each publish copies the cached-doc map, re-runs filter and sort over
 * every row and re-renders the rows found so far; doing that every frame takes
 * the main thread from the walk and its commit, which the final result waits on.
 */
const PROVISIONAL_SEED_PUBLISH_INTERVAL_MS = 250;
const PROVISIONAL_SEED_PUBLISH_MAX_INTERVAL_MS = 1000;

function provisionalSeedPublishInterval(publishCount: number) {
  if (publishCount === 0) return 0;
  return Math.min(
    PROVISIONAL_SEED_PUBLISH_INTERVAL_MS * 2 ** (publishCount - 1),
    PROVISIONAL_SEED_PUBLISH_MAX_INTERVAL_MS
  );
}

type RowDocMap = Record<string, YDoc>;
type EnsureRow = (rowId: string) => Promise<YDoc | undefined> | void;
type LoadRowFromSeed = (rowId: string) => Promise<YDoc | undefined>;
type PeekRowDocFromSeed = (rowId: string) => YDoc | null;

export type BackgroundRowDocChange = {
  added: RowDocMap;
  removed: RowDocMap;
};

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

/** What the seed pass of a store was last asked to hydrate; see `SeedHydrator.sync`. */
type SeedHydrationRequest = {
  rowOrders: YDatabaseRowOrders;
  /** The walk has not reached its terminal page: its seeds are provisional. */
  walkInFlight: boolean;
  /**
   * The rows are read again for a view that already shows them (its
   * conditions changed: a dashboard's global filter, the viewer's private
   * filter) and the source's seeds are committed. The pass then publishes its
   * docs once, when it ends: each publish recomputes the view's filter and
   * sort over every row and re-renders it, so publishing every frame showed
   * every intermediate result. A cold load keeps publishing as rows arrive.
   */
  publishOnce: boolean;
  seedsRevision: number;
  rowOrderRevision: number;
  peekRowDocFromSeed: PeekRowDocFromSeed;
  /** The consumers' row maps the request was made for (`LoaderStore.rowMaps`). */
  rowMaps: RowDocMap[];
};

/**
 * The bounded pass that builds shared, detached docs from the seeds of a blob
 * walk and publishes them to the store's cache. It belongs to the store, not to
 * a consumer, so it keeps running while any consumer is active.
 */
type SeedHydrator = {
  /** Queues the rows that still need a doc and starts a pass; once per request, whichever consumer asks. */
  sync: (request: SeedHydrationRequest) => void;
  cancel: () => void;
  /** Settles when the pass in flight has drained its queue; null while idle. */
  promise: () => Promise<void> | null;
};

type LoaderStore = {
  key: string;
  refCount: number;
  activeRefCount: number;
  cachedRowDocs: RowDocMap;
  syncedRowDocs: RowDocMap;
  subscribers: Set<() => void>;
  rowDocChangeSubscribers: Set<(change: BackgroundRowDocChange) => void>;
  sharedCachedRowDocIds: Set<string>;
  /** Unsubscribes from the `destroy` event of each shared seed doc in the cache. */
  sharedDocDestroyListeners: Map<string, () => void>;
  pendingDestroyedDocs: Map<string, YDoc>;
  cachedRowDocPending: Map<string, Promise<YDoc | undefined>>;
  backgroundQueue: Set<string>;
  backgroundLoading: boolean;
  backgroundCancelled: boolean;
  backgroundRun: number;
  pendingDocs: RowDocMap;
  flushHandle: number | null;
  seedHydrator: SeedHydrator;
  /**
   * The row map of every mounted consumer. Consumers under one `Database` share
   * one; two widgets on the same view each have their own, and a row one of
   * them holds is still missing for the other.
   */
  consumerRows: Map<symbol, RowDocMap>;
  /** The distinct row maps in `consumerRows`. */
  rowMaps: RowDocMap[];
  rowOrders: YDatabaseRowOrders | undefined;
  ensureRow: EnsureRow | undefined;
  loadRowFromSeed: LoadRowFromSeed | undefined;
  peekRowDocFromSeed: PeekRowDocFromSeed | undefined;
};

const loaderStores = new Map<string, LoaderStore>();
const NO_ROWS: RowDocMap = Object.freeze({});
const announcedCanonicalDocs = new WeakSet<YDoc>();
const pendingCanonicalDocs = new Map<string, YDoc>();
let canonicalDocsFrame: number | null = null;

function replaceSharedCachedDocs(store: LoaderStore, ready: ReadonlyMap<string, YDoc>) {
  if (store.activeRefCount === 0 || !store.peekRowDocFromSeed) return;
  setStoreCachedRowDocs(store, (previous) => {
    const added: RowDocMap = {};
    const removed: RowDocMap = {};

    ready.forEach((canonical, id) => {
      const borrowed = previous[id];

      if (
        !borrowed || borrowed === canonical || !store.sharedCachedRowDocIds.has(id) ||
        !hasRowConditionData(canonical) || store.peekRowDocFromSeed?.(id) !== canonical
      ) return;
      // The current seed accessor is also the restore/provisional fence.
      // Borrowers of the old snapshot may still be rendering it; it must
      // not be destroyed as part of adopting the live document.
      shareEquivalentRowDocRevision(borrowed, canonical);
      removed[id] = borrowed;
      added[id] = canonical;
    });
    return {
      added,
      removed,
      next: Object.keys(added).length > 0 ? { ...previous, ...added } : previous,
    };
  });
}

/**
 * A live reader has connected this row. Other scopes can now read that same
 * document instead of retaining a detached copy of its seed. Publish a whole
 * frame's arrivals together: a chart may connect thousands of rows.
 */
export function shareCanonicalRowDoc(rowId: string, doc: YDoc) {
  if (announcedCanonicalDocs.has(doc)) return;
  announcedCanonicalDocs.add(doc);
  pendingCanonicalDocs.set(rowId, doc);
  if (canonicalDocsFrame !== null) return;
  canonicalDocsFrame = requestAnimationFrame(() => {
    canonicalDocsFrame = null;
    const ready = new Map(pendingCanonicalDocs);

    pendingCanonicalDocs.clear();
    startTransition(() => {
      loaderStores.forEach((store) => replaceSharedCachedDocs(store, ready));
    });
  });
}

function createLoaderStore(key: string): LoaderStore {
  const store: LoaderStore = {
    key,
    refCount: 0,
    activeRefCount: 0,
    cachedRowDocs: {},
    syncedRowDocs: {},
    subscribers: new Set(),
    rowDocChangeSubscribers: new Set(),
    sharedCachedRowDocIds: new Set(),
    sharedDocDestroyListeners: new Map(),
    pendingDestroyedDocs: new Map(),
    cachedRowDocPending: new Map(),
    backgroundQueue: new Set(),
    backgroundLoading: false,
    backgroundCancelled: false,
    backgroundRun: 0,
    pendingDocs: {},
    flushHandle: null,
    seedHydrator: { sync: () => undefined, cancel: () => undefined, promise: () => null },
    consumerRows: new Map(),
    rowMaps: [],
    rowOrders: undefined,
    ensureRow: undefined,
    loadRowFromSeed: undefined,
    peekRowDocFromSeed: undefined,
  };

  store.seedHydrator = createSeedHydrator(store);
  return store;
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

function setConsumerRows(store: LoaderStore, consumer: symbol, rows: RowDocMap | null | undefined) {
  store.consumerRows.set(consumer, rows ?? NO_ROWS);
  store.rowMaps = Array.from(new Set(store.consumerRows.values()));
}

function removeConsumerRows(store: LoaderStore, consumer: symbol) {
  store.consumerRows.delete(consumer);
  store.rowMaps = Array.from(new Set(store.consumerRows.values()));
}

/**
 * Whether every mounted consumer already holds the row in its own row map, so
 * none of them needs it from the cache. With one consumer missing it, the row
 * is not loaded for that one, however many others hold it.
 */
function everyConsumerHasRow(store: LoaderStore, rowId: string) {
  return store.rowMaps.length > 0 && store.rowMaps.every((rows) => hasRowConditionData(rows[rowId]));
}

function disposeStoreDoc(store: LoaderStore, rowId: string, doc: YDoc) {
  if (store.sharedCachedRowDocIds.has(rowId) && store.cachedRowDocs[rowId] === doc) return;
  releaseOwnedRowDoc(doc);
}

/** Calls `onDestroy` when the doc is destroyed; the result stops watching. */
function watchDocDestroy(doc: YDoc, onDestroy: () => void) {
  doc.on('destroy', onDestroy);
  return () => doc.off('destroy', onDestroy);
}

function unwatchSharedDoc(store: LoaderStore, rowId: string) {
  store.sharedDocDestroyListeners.get(rowId)?.();
  store.sharedDocDestroyListeners.delete(rowId);
}

/** Drops shared seed docs the seed cache destroyed (a restarted walk, a reset row). */
function evictDestroyedSharedDocs(store: LoaderStore) {
  const destroyedDocs = Array.from(store.pendingDestroyedDocs);

  store.pendingDestroyedDocs.clear();
  setStoreCachedRowDocs(store, (prev) => {
    const removed: RowDocMap = {};

    destroyedDocs.forEach(([rowId, doc]) => {
      if (prev[rowId] !== doc) return;
      removed[rowId] = doc;
      store.sharedCachedRowDocIds.delete(rowId);
    });
    if (Object.keys(removed).length === 0) return { added: {}, next: prev, removed };
    const next = { ...prev };

    Object.keys(removed).forEach((rowId) => delete next[rowId]);
    return { added: {}, next, removed };
  });
}

function watchSharedDoc(store: LoaderStore, rowId: string, doc: YDoc) {
  // Re-watching removes the previous listener, so only the current one fires.
  unwatchSharedDoc(store, rowId);
  store.sharedDocDestroyListeners.set(
    rowId,
    watchDocDestroy(doc, () => {
      store.sharedDocDestroyListeners.delete(rowId);
      if (store.cachedRowDocs[rowId] !== doc) return;
      // Many docs are destroyed in one pass; evict them together.
      if (store.pendingDestroyedDocs.size === 0) queueMicrotask(() => evictDestroyedSharedDocs(store));
      store.pendingDestroyedDocs.set(rowId, doc);
    })
  );
}

function setStoreCachedRowDocs(
  store: LoaderStore,
  updater: (prev: RowDocMap) => { added: RowDocMap; next: RowDocMap; removed: RowDocMap }
) {
  const { added, next, removed } = updater(store.cachedRowDocs);

  if (next === store.cachedRowDocs) return;
  store.cachedRowDocs = next;
  Object.keys(removed).forEach((rowId) => unwatchSharedDoc(store, rowId));
  Object.entries(added).forEach(([rowId, doc]) => {
    if (store.sharedCachedRowDocIds.has(rowId)) watchSharedDoc(store, rowId, doc);
  });
  if (Object.keys(added).length > 0 || Object.keys(removed).length > 0) {
    const change = { added, removed };

    store.rowDocChangeSubscribers.forEach((subscriber) => subscriber(change));
  }

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

/** Shared seed docs belong to the database seed cache, never to this loader. */
function cacheSharedSeedDocs(store: LoaderStore, docs: RowDocMap) {
  if (Object.keys(docs).length === 0) return;
  setStoreCachedRowDocs(store, (prev) => {
    const added: RowDocMap = {};

    Object.entries(docs).forEach(([rowId, doc]) => {
      if (
        !hasRowConditionData(doc) ||
        hasRowConditionData(prev[rowId]) ||
        everyConsumerHasRow(store, rowId) ||
        hasRowConditionData(store.pendingDocs[rowId])
      )
        return;

      added[rowId] = doc;
      store.sharedCachedRowDocIds.add(rowId);
    });
    return { added, next: Object.keys(added).length > 0 ? { ...prev, ...added } : prev, removed: {} };
  });
}

function createSeedHydrator(store: LoaderStore): SeedHydrator {
  /** Rows that still need a doc, in row order. */
  const queue = new Set<string>();
  /** Docs built from a walk in flight and not published yet, and what stops watching each. */
  let pending: RowDocMap = {};
  const pendingUnwatch = new Map<string, () => void>();
  let request: SeedHydrationRequest | null = null;
  let walkInFlight = false;
  /** The pass in flight publishes once, when it ends (`SeedHydrationRequest.publishOnce`). */
  let publishOnce = false;
  let frame: number | null = null;
  let run = 0;
  let passActive = false;
  let publishedAt = Number.NEGATIVE_INFINITY;
  /** Publishes of docs from the walk in flight; 0 once its seeds are committed. */
  let publishCount = 0;
  /** Publishes the unpublished docs of a drained pass once the interval ends. */
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let passPromise: Promise<void> | null = null;
  let resolvePass: (() => void) | null = null;

  const hasPending = () => {
    for (const _rowId in pending) return true;
    return false;
  };

  /**
   * Holds a doc built from a walk in flight until the next publish. A restart
   * can destroy it before then; it is dropped instead of published.
   */
  const hold = (rowId: string, doc: YDoc) => {
    pendingUnwatch.get(rowId)?.();
    pending[rowId] = doc;
    pendingUnwatch.set(
      rowId,
      watchDocDestroy(doc, () => {
        pendingUnwatch.delete(rowId);
        if (pending[rowId] === doc) delete pending[rowId];
      })
    );
  };

  /** Takes the unpublished docs; the cache watches the ones it adds. */
  const takePending = () => {
    const docs = pending;

    if (publishTimer !== null) clearTimeout(publishTimer);
    publishTimer = null;
    pending = {};
    pendingUnwatch.forEach((unwatch) => unwatch());
    pendingUnwatch.clear();
    return docs;
  };

  const publish = () => {
    // A frame that built no doc must not use up a slot of the publish schedule:
    // the first docs of a walk are published at once.
    if (!hasPending()) return;
    const additions = takePending();

    publishedAt = performance.now();
    if (walkInFlight) publishCount += 1;
    startTransition(() => cacheSharedSeedDocs(store, additions));
  };

  const finishPass = () => {
    frame = null;
    passActive = false;
    resolvePass?.();
    resolvePass = null;
    passPromise = null;
  };

  const needsDoc = (rowId: string) =>
    !everyConsumerHasRow(store, rowId) && !hasRowConditionData(store.cachedRowDocs[rowId]);

  const processBatch = (runId: number) => {
    if (run !== runId) return;
    const frameStartedAt = performance.now();
    // A pass that publishes once shows nothing until it ends: it is bounded by
    // time only, so docs the seed cache already built (another widget of the
    // source read them) take one frame instead of one per 128 rows.
    const settledPass = publishOnce && !walkInFlight;
    // While a walk is still in flight, each frame builds docs for a bounded
    // time, so the next page's response is not starved of the main thread.
    const frameBudgetMs =
      walkInFlight || settledPass ? PROVISIONAL_SEED_HYDRATE_FRAME_BUDGET_MS : Number.POSITIVE_INFINITY;
    const batchSize = settledPass ? Number.POSITIVE_INFINITY : SEED_HYDRATE_BATCH_SIZE;
    let hydrated = 0;
    let scanned = 0;

    for (const rowId of queue) {
      if (hydrated >= batchSize || scanned >= SEED_HYDRATE_SCAN_LIMIT) break;
      if (hydrated > 0 && performance.now() - frameStartedAt > frameBudgetMs) break;
      queue.delete(rowId);
      scanned += 1;
      if (!needsDoc(rowId) || hasRowConditionData(store.pendingDocs[rowId])) continue;

      const doc = store.peekRowDocFromSeed?.(rowId);

      if (doc) {
        hold(rowId, doc);
        hydrated += 1;
      }
    }

    const publishDueAt = walkInFlight ? publishedAt + provisionalSeedPublishInterval(publishCount) : frameStartedAt;

    if (settledPass) {
      if (queue.size === 0) publish();
    } else if (frameStartedAt >= publishDueAt) {
      publish();
    } else if (queue.size === 0 && publishTimer === null && hasPending()) {
      // The pass ends here; the next page starts another one.
      publishTimer = setTimeout(() => {
        publishTimer = null;
        publish();
      }, publishDueAt - frameStartedAt);
    }

    if (run !== runId) return;
    if (queue.size > 0) {
      frame = requestAnimationFrame(() => processBatch(runId));
    } else {
      finishPass();
    }
  };

  return {
    sync: (next) => {
      const previous = request;

      // Every consumer of the store asks for the same pass on each page of a
      // walk; the queue is rebuilt once for it, not once per consumer.
      if (
        previous &&
        previous.rowOrders === next.rowOrders &&
        previous.walkInFlight === next.walkInFlight &&
        previous.publishOnce === next.publishOnce &&
        previous.seedsRevision === next.seedsRevision &&
        previous.rowOrderRevision === next.rowOrderRevision &&
        previous.peekRowDocFromSeed === next.peekRowDocFromSeed &&
        previous.rowMaps === next.rowMaps
      )
        return;

      request = next;
      walkInFlight = next.walkInFlight;
      // A new pass takes the request's mode; a pass in flight only ever turns
      // progressive (a consumer that loads cold joined it), never back.
      publishOnce = passActive ? publishOnce && next.publishOnce : next.publishOnce;
      if (!walkInFlight) {
        // Committed seeds publish every frame again, starting with what the walk left.
        publishCount = 0;
        publish();
      }

      // Rebuilt in row order: a pass drops the rows a walk in flight has not
      // delivered yet, and re-adding them at the end would hydrate later rows first.
      queue.clear();
      (next.rowOrders.toArray() as { id: string; is_deleted?: boolean }[]).forEach(({ id, is_deleted }) => {
        if (!is_deleted && needsDoc(id) && !hasRowConditionData(pending[id])) queue.add(id);
      });
      if (passActive || queue.size === 0) return;

      const runId = ++run;

      passActive = true;
      passPromise = new Promise((resolve) => {
        resolvePass = resolve;
      });
      frame = requestAnimationFrame(() => processBatch(runId));
    },
    cancel: () => {
      run += 1;
      if (frame !== null) cancelAnimationFrame(frame);
      queue.clear();
      request = null;
      // Shared seed docs belong to the seed cache: unpublished ones are only dropped.
      takePending();
      finishPass();
    },
    promise: () => passPromise,
  };
}

function destroyStore(store: LoaderStore) {
  cancelBackgroundRun(store);
  store.seedHydrator.cancel();

  Object.entries(store.cachedRowDocs).forEach(([rowId, doc]) => {
    disposeStoreDoc(store, rowId, doc);
  });

  store.cachedRowDocs = {};
  store.syncedRowDocs = {};
  store.rowDocChangeSubscribers.clear();
  store.sharedDocDestroyListeners.forEach((unwatch) => unwatch());
  store.sharedDocDestroyListeners.clear();
  store.pendingDestroyedDocs.clear();
  store.sharedCachedRowDocIds.clear();
  store.cachedRowDocPending.clear();
  loaderStores.delete(store.key);
  if (loaderStores.size === 0) {
    if (canonicalDocsFrame !== null) cancelAnimationFrame(canonicalDocsFrame);
    canonicalDocsFrame = null;
    pendingCanonicalDocs.clear();
  }
}

/**
 * Loads row documents for consumers that need values across the complete view,
 * including sorting, filtering, and Board grouping.
 *
 * Loader state is shared per database view and consumer scope. Hydration runs
 * while any consumer is active; scopes keep independently retained caches apart.
 *
 * @param requestedActive - Whether this consumer needs complete row data
 * @param scope - Isolates independently activated consumers sharing a view
 * @param mode - Live consumers also connect seed-backed rows to realtime
 * @returns Cached read-only row docs that are not already in the main row map
 */
export function useBackgroundRowDocLoader(requestedActive: boolean, scope = 'conditions', mode: 'cached' | 'live' = 'cached') {
  const rows = useRowMap();
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const databaseContext = useDatabaseContext();
  const {
    databaseDoc,
    ensureRow,
    loadRowFromSeed,
    peekRowDocFromSeed,
    getSeedsRevision,
    subscribeToSeedsProgress,
    dataSource,
  } = databaseContext;
  const isHistory = dataSource?.type === 'history';
  // Historical snapshots are complete and provide their own bounded synchronous accessor.
  const active = requestedActive && !isHistory;
  // An inactive loader (an ungrouped grid's grouping loader) reads neither.
  const { blobPrefetchComplete, seedsReady } = useRowPassState(databaseContext, active);
  // Only an active loader follows the pages of a walk in flight.
  const subscribeSeedsProgress = useCallback(
    (onStoreChange: () => void) =>
      active && subscribeToSeedsProgress ? subscribeToSeedsProgress(onStoreChange) : () => undefined,
    [active, subscribeToSeedsProgress]
  );
  const readSeedsRevision = useCallback(() => (active ? getSeedsRevision?.() ?? 0 : 0), [active, getSeedsRevision]);
  const seedsRevision = useSyncExternalStore(subscribeSeedsProgress, readSeedsRevision, readSeedsRevision);
  const storeKey = `${dataSource?.id ?? databaseDoc.guid}:${viewId ?? 'unknown'}:${scope}:${mode}`;
  const store = useMemo(() => getLoaderStore(storeKey), [storeKey]);
  const [rowOrderRevision, setRowOrderRevision] = useState(0);
  // Identifies this consumer's row map in the store for as long as the hook is mounted.
  const [consumer] = useState(() => Symbol('row-doc-consumer'));
  // The consumer was mounted inactive: once active, its view gained
  // conditions while it showed rows, and the rows are read again rather
  // than loaded cold (`SeedHydrationRequest.publishOnce`).
  const shownInactiveRef = useRef(false);

  useEffect(() => {
    if (!active) shownInactiveRef.current = true;
  }, [active]);

  // A background run is shared by consumers and can outlive the render that
  // started it. Publish transport-sensitive operations only after commit so an
  // interrupted render cannot replace an active run's callbacks with values
  // from a database lifecycle that never became active.
  useLayoutEffect(() => {
    setConsumerRows(store, consumer, rows);
    store.rowOrders = rowOrders;
    store.ensureRow = ensureRow;
    store.loadRowFromSeed = loadRowFromSeed;
    store.peekRowDocFromSeed = peekRowDocFromSeed;
  }, [consumer, ensureRow, loadRowFromSeed, peekRowDocFromSeed, rowOrders, rows, store]);

  useLayoutEffect(() => () => removeConsumerRows(store, consumer), [consumer, store]);

  const subscribeToCachedRowDocs = useCallback(
    (onStoreChange: () => void) => {
      store.subscribers.add(onStoreChange);
      return () => {
        store.subscribers.delete(onStoreChange);
      };
    },
    [store]
  );
  const getCachedRowDocs = useCallback(() => store.cachedRowDocs, [store]);
  const subscribeToCachedRowDocChanges = useCallback(
    (subscriber: (change: BackgroundRowDocChange) => void) => {
      store.rowDocChangeSubscribers.add(subscriber);
      return () => {
        store.rowDocChangeSubscribers.delete(subscriber);
      };
    },
    [store]
  );
  const cachedRowDocs = useSyncExternalStore(subscribeToCachedRowDocs, getCachedRowDocs, getCachedRowDocs);

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
          const added: RowDocMap = {};

          Object.entries(pending).forEach(([rowId, doc]) => {
            if (!hasRowConditionData(doc) || hasRowConditionData(next[rowId]) || everyConsumerHasRow(store, rowId)) {
              releaseOwnedRowDoc(doc);
              return;
            }

            next[rowId] = doc;
            added[rowId] = doc;
            store.sharedCachedRowDocIds.delete(rowId);
            changed = true;
          });
          return { added, next: changed ? next : prev, removed: {} };
        });
      });
    });
  }, [store]);

  useEffect(() => {
    if (store.refCount === 0) loaderStores.set(store.key, store);
    store.refCount += 1;

    return () => {
      store.refCount -= 1;
      if (store.refCount === 0) destroyStore(store);
    };
  }, [store]);

  useEffect(() => {
    if (!active) return;
    store.activeRefCount += 1;
    return () => {
      store.activeRefCount -= 1;
      if (store.activeRefCount === 0) {
        cancelBackgroundRun(store);
        store.seedHydrator.cancel();
      }
    };
  }, [active, store]);

  // The fallback below loads rows one at a time once the blob prefetch is
  // complete. A prefetch that starts over (a read-only widget that turned
  // writable, a view that now needs every row) brings those rows as seeds:
  // stop the run it made obsolete. The next completion starts one for the rows
  // still missing.
  const prefetchWasCompleteRef = useRef(false);

  useEffect(() => {
    const wasComplete = prefetchWasCompleteRef.current;

    prefetchWasCompleteRef.current = active && Boolean(blobPrefetchComplete);
    if (active && wasComplete && !blobPrefetchComplete) cancelBackgroundRun(store);
  }, [active, blobPrefetchComplete, store]);

  // Clean up cached docs that every consumer now has in its main rowMap. A doc
  // another consumer (a second widget on this view) still reads from the cache stays.
  useEffect(() => {
    const cached = store.cachedRowDocs;
    let changed = false;
    const next: RowDocMap = {};
    const removed: RowDocMap = {};

    Object.entries(cached).forEach(([rowId, doc]) => {
      if (everyConsumerHasRow(store, rowId)) {
        removed[rowId] = doc;
        disposeStoreDoc(store, rowId, doc);
        store.sharedCachedRowDocIds.delete(rowId);
        changed = true;
        return;
      }

      next[rowId] = doc;
    });

    if (changed) {
      setStoreCachedRowDocs(store, () => ({ added: {}, next, removed }));
    }
  }, [rows, store]);

  // The bounded seed pass belongs to the shared store. A consumer unmounting
  // must not cancel hydration while another consumer still needs these rows.
  // It also runs for each page a walk in flight delivers (`seedsRevision`),
  // so conditions can start on those rows before the terminal page.
  useEffect(() => {
    if (!active || !(seedsReady || seedsRevision > 0) || !peekRowDocFromSeed || !rowOrders) return;

    if (seedsReady) {
      // A live notification may have arrived while a replacement walk's
      // provisional fence rejected it. Recheck when that walk commits.
      const ready = new Map<string, YDoc>();

      Object.keys(store.cachedRowDocs).forEach((rowId) => {
        const current = peekRowDocFromSeed(rowId);

        if (current && current !== store.cachedRowDocs[rowId]) ready.set(rowId, current);
      });
      replaceSharedCachedDocs(store, ready);
    }

    store.seedHydrator.sync({
      rowOrders,
      walkInFlight: !seedsReady,
      publishOnce: shownInactiveRef.current,
      seedsRevision,
      rowOrderRevision,
      peekRowDocFromSeed,
      rowMaps: store.rowMaps,
    });
  }, [active, seedsReady, seedsRevision, peekRowDocFromSeed, store, rowOrders, rowOrderRevision]);

  // After detached hydration, recover rows absent from the blob through the
  // main row loader, realtime, or a read-only IndexedDB document.
  useEffect(() => {
    if (!active || !blobPrefetchComplete) return;

    const rowOrdersData = (rowOrders?.toJSON() as { id: string; is_deleted?: boolean }[] | undefined)?.filter(
      (row) => !row.is_deleted
    );

    if (!rowOrdersData) return;

    const hasReadyRowDoc = (rowId: string) => {
      if (mode === 'live' && store.ensureRow) {
        const synced = store.syncedRowDocs[rowId];

        const ready = hasRowConditionData(synced) && store.rowMaps.every((rows) => !rows[rowId] || rows[rowId] === synced);

        if (ready) shareCanonicalRowDoc(rowId, synced);
        return ready;
      }

      return hasRowConditionData(store.cachedRowDocs[rowId]) || everyConsumerHasRow(store, rowId);
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

      // Detached seeds render immediately, but only ensureRow acquires the
      // transport that keeps offscreen Timeline projections up to date.
      if (mode === 'live' && store.ensureRow) {
        try {
          const doc = await store.ensureRow(rowId);

          if (!isRunActive()) return;
          if (doc) store.syncedRowDocs[rowId] = doc;
          if (doc && hasRowConditionData(doc)) {
            shareCanonicalRowDoc(rowId, doc);
            retryAttempts.delete(rowId);
            return;
          }
        } catch {
          // Seeds remain readable while a transient sync failure is retried.
        }

        if (isRunActive()) await retryMissingRow(rowId);
        return;
      }

      // Seeds may arrive while a retry is waiting. Always prefer their shared,
      // detached document over opening an IndexedDB or live row document.
      const seedDoc = store.peekRowDocFromSeed?.(rowId);

      if (hasRowConditionData(seedDoc)) {
        cacheSharedSeedDocs(store, { [rowId]: seedDoc });
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

      // Historical data is complete and immutable. A missing historical row
      // must never be replaced with an unrelated current IndexedDB row.
      if (isHistory) return;

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
        // On a warm mount both readiness flags are already true. Give the
        // bounded detached pass priority instead of racing it with live opens.
        while (store.seedHydrator.promise() && isRunActive()) await store.seedHydrator.promise();
        if (!isRunActive()) break;
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
      if (store.activeRefCount === 0) {
        cancelBackgroundRun(store, runId);
      }
    };
  }, [
    databaseDoc.guid,
    isHistory,
    mode,
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
    getCachedRowDocs,
    subscribeToCachedRowDocChanges,
  };
}
