import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useBackgroundRowDocLoader, useDatabaseContext, useRowPassState } from '@/application/database-yjs';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
import { RowId, YDoc } from '@/application/types';
import { Log } from '@/utils/log';

import { ensureRowsWithConcurrency, ROW_LOAD_CONCURRENCY } from './rowLoadPool';

/**
 * Grace period before declaring a chart "empty" when `rowOrders` is `[]` at
 * mount. Yjs typically delivers an empty array first and then populates rows
 * from the server; without this delay the chart briefly flashes "No data"
 * before the bars appear on a populated grid.
 */
const EMPTY_ROW_ORDERS_GRACE_MS = 300;

/**
 * How long the chart waits for the next page of row seeds before it loads the
 * rows that still have no doc one by one. A walk that keeps delivering pages
 * is never cut short; this only ends a wait nothing would end otherwise.
 */
export const SEED_WAIT_TIMEOUT_MS = 10_000;

/** One slice of the seed check runs this long before it yields the main thread. */
const SEED_CHECK_SLICE_MS = 8;

const NO_FAILED_ROWS: ReadonlySet<string> = new Set();
const NO_ROW_IDS: readonly string[] = [];

type RowDocs = Record<RowId, YDoc>;

/**
 * How the chart gets the docs of rows it has none for:
 * - `ensure`: the context has no row seeds, so every row is loaded with
 *   `ensureRow` (a published page, or a database without the blob walk);
 * - `wait`: seeds are still arriving, and the loader publishes them;
 * - `seeds`: every seed has arrived: seeded rows come from the loader, and
 *   only a row without a seed is loaded with `ensureRow`;
 * - `timeout`: the walk went quiet before it finished, so the rows that still
 *   have no doc are loaded with `ensureRow` instead of waiting forever.
 */
type RowSource = 'ensure' | 'wait' | 'seeds' | 'timeout';

/** A row set of a view: what a load, its retries and the loaded flag belong to. `rowIdsKey` compares by reference first, so this is cheap. */
interface RetryScope {
  viewId: string;
  rowIdsKey: string;
}

function sameRetryScope(a: RetryScope | null, b: RetryScope) {
  return a !== null && a.viewId === b.viewId && a.rowIdsKey === b.rowIdsKey;
}

/**
 * The doc a chart reads for a row: the live doc when it holds the row (a row
 * that is open in any widget keeps its realtime updates), otherwise the shared
 * detached doc built from the row's seed.
 */
export function resolveChartRowDoc(
  rowId: RowId,
  liveRows: RowDocs | null | undefined,
  cachedRowDocs: RowDocs
): YDoc | undefined {
  const live = liveRows?.[rowId];

  return hasRowConditionData(live) ? live : cachedRowDocs[rowId] ?? live;
}

/**
 * Splits `rowIds` into rows whose seed the loader will publish and rows with
 * no seed. Peeking builds the shared doc of a seed nobody read yet, so the
 * pass yields between slices instead of building thousands of docs in a task.
 */
async function splitBySeed(
  rowIds: readonly string[],
  {
    hasDoc,
    peekRowDocFromSeed,
    isCancelled,
  }: {
    hasDoc: (rowId: string) => boolean;
    peekRowDocFromSeed: (rowId: string) => YDoc | null;
    isCancelled: () => boolean;
  }
) {
  const seeded: string[] = [];
  const unseeded: string[] = [];
  let sliceStartedAt = performance.now();

  for (const rowId of rowIds) {
    if (isCancelled()) break;
    // Published while an earlier slice yielded.
    if (hasDoc(rowId)) continue;
    if (hasRowConditionData(peekRowDocFromSeed(rowId))) seeded.push(rowId);
    else unseeded.push(rowId);

    if (performance.now() - sliceStartedAt > SEED_CHECK_SLICE_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStartedAt = performance.now();
    }
  }

  return { seeded, unseeded };
}

export interface UseChartRowHydrationOptions {
  /** The charted rows; the array keeps its identity while the ids are the same. */
  rowOrders: ReadonlyArray<{ id: string }> | undefined;
  /** The joined row ids: the effect key (`rowOrders` is a new array after unrelated changes). */
  rowIdsKey: string;
  /** The database's live row map. */
  liveRows: RowDocs | null;
  /** False for a Number chart that only counts rows: it needs no row doc. */
  needsRowDocs: boolean;
}

export interface ChartRowHydration {
  /** Every charted row has its doc, or its load failed. */
  rowsLoaded: boolean;
  /** Some rows have no doc after loading; they are retried with a backoff. */
  hasFailedRows: boolean;
  /** Load the failed rows again now, behind the loading state. */
  retry: () => void;
  /** The shared detached row docs of rows that are not in the live row map. */
  cachedRowDocs: RowDocs;
}

/**
 * Gets the row docs a chart reads and keeps them connected to realtime.
 *
 * A row-reading chart needs every row of its view. The blob walk already
 * delivers each row as a seed, and `useBackgroundRowDocLoader` turns the seeds
 * into shared detached docs, a bounded batch per frame. The chart can render
 * those before IndexedDB opens and sync handshakes finish. After the walk
 * completes, the loader connects every row through `ensureRow` in bounded
 * batches, including filtered-out rows whose remote edits can change filter
 * membership. Rows without a seed also load through a small worker pool.
 *
 * The chart is all or nothing: it stays in the loading state until every row
 * has its doc, so a partial aggregate is never shown as the result. The one
 * exception keeps a mounted chart mounted: a few rows added to an already
 * loaded view load behind it and count once their doc arrives.
 *
 * Failures: a row whose load throws or resolves without a doc is failed, kept
 * out of the loaded set and retried with a backoff. The caller decides what a
 * failure means for the chart (an error only when it has no rows to show).
 */
export function useChartRowHydration({
  rowOrders,
  rowIdsKey,
  liveRows,
  needsRowDocs,
}: UseChartRowHydrationOptions): ChartRowHydration {
  const databaseContext = useDatabaseContext();
  const { ensureRow, databaseDoc, workspaceId, dataSource, activeViewId, peekRowDocFromSeed, getSeedsRevision, subscribeToSeedsProgress } =
    databaseContext;
  const { seedsReady, blobPrefetchComplete } = useRowPassState(databaseContext);
  const isHistory = dataSource?.type === 'history';
  const rowOrdersReady = Boolean(rowOrders);
  const canReadSeeds = Boolean(peekRowDocFromSeed) && !isHistory;
  // Each Database instance owns its row sync registrations. A sibling chart
  // of the same view must not become the only owner of this chart's live rows.
  // Seed and canonical docs remain shared by the underlying row caches.
  const loaderId = useId();
  const [loaderOwner, setLoaderOwner] = useState(() => ({ databaseDoc, workspaceId, ensureRow, generation: 0 }));

  // A database reset can keep its guid while releasing all sync owners. Start
  // a new loader so its old synced-row cache cannot skip reacquiring them.
  if (loaderOwner.databaseDoc !== databaseDoc || loaderOwner.workspaceId !== workspaceId || loaderOwner.ensureRow !== ensureRow) {
    setLoaderOwner({ databaseDoc, workspaceId, ensureRow, generation: loaderOwner.generation + 1 });
  }

  const { cachedRowDocs, getCachedRowDocs } = useBackgroundRowDocLoader(
    canReadSeeds && needsRowDocs,
    `chart:${loaderId}:${loaderOwner.generation}`,
    'live'
  );

  // --- Which source the missing rows come from ---
  const seedsSettled = Boolean(seedsReady || blobPrefetchComplete);
  const waitingForSeeds = canReadSeeds && needsRowDocs && rowOrdersReady && !seedsSettled;
  const subscribeToSeeds = useCallback(
    (onStoreChange: () => void) =>
      waitingForSeeds && subscribeToSeedsProgress ? subscribeToSeedsProgress(onStoreChange) : () => undefined,
    [waitingForSeeds, subscribeToSeedsProgress]
  );
  const readSeedsRevision = useCallback(
    () => (waitingForSeeds ? getSeedsRevision?.() ?? 0 : 0),
    [waitingForSeeds, getSeedsRevision]
  );
  const seedsRevision = useSyncExternalStore(subscribeToSeeds, readSeedsRevision, readSeedsRevision);
  const [seedWaitTimedOut, setSeedWaitTimedOut] = useState(false);

  // Each page of the walk restarts the wait; only a walk that went quiet times out.
  useEffect(() => {
    if (!waitingForSeeds) {
      setSeedWaitTimedOut(false);
      return;
    }

    const timer = setTimeout(() => setSeedWaitTimedOut(true), SEED_WAIT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [waitingForSeeds, seedsRevision]);

  let rowSource: RowSource = 'ensure';

  if (canReadSeeds) rowSource = seedsSettled ? 'seeds' : seedWaitTimedOut ? 'timeout' : 'wait';

  // --- Loading state ---
  // The row set whose rows finished loading (their docs arrived, or no rows
  // arrived within a short grace period): `null` until the first finish, and
  // after an explicit retry. The loaded flag is derived from it below, in the
  // render itself: a changed row set whose load is a bulk one is in the
  // loading state in that same render, so a partial aggregate is never built
  // or painted.
  const [loadedScope, setLoadedScope] = useState<RetryScope | null>(null);
  const [failedRowIds, setFailedRowIds] = useState<ReadonlySet<string>>(NO_FAILED_ROWS);
  // Bumped to load the failed rows again: by `retry`, and by the automatic backoff.
  const [retryClock, setRetryClock] = useState(0);

  /** Rows `ensureRow` delivered. Seeded rows are not listed: their doc is the proof. */
  const ensuredRowIdsRef = useRef<Set<string>>(new Set());
  /** Automatic retries spent on the row set in `retryScopeRef`. */
  const retryAttemptRef = useRef(0);
  const retryScopeRef = useRef<RetryScope | null>(null);
  const retry = useCallback(() => {
    retryAttemptRef.current = 0;
    setFailedRowIds(NO_FAILED_ROWS);
    setLoadedScope(null);
    setRetryClock((clock) => clock + 1);
  }, []);

  // The async load reads the newest row sources through this ref, and a load
  // that waits for the loader is woken when they change.
  const sourcesRef = useRef({ liveRows, getCachedRowDocs, peekRowDocFromSeed });
  const wakeLoadRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    sourcesRef.current = { liveRows, getCachedRowDocs, peekRowDocFromSeed };
    wakeLoadRef.current?.();
  }, [liveRows, cachedRowDocs, getCachedRowDocs, peekRowDocFromSeed]);

  useEffect(() => {
    const scope: RetryScope = { viewId: activeViewId, rowIdsKey };
    // Every path that finishes sets both: the loaded row set and the failed rows.
    // A finish without failures therefore always clears an earlier error.
    const finish = (failed: readonly string[]) => {
      setFailedRowIds(failed.length > 0 ? new Set(failed) : NO_FAILED_ROWS);
      setLoadedScope((previous) => (sameRetryScope(previous, scope) ? previous : scope));
    };

    if (isHistory) {
      // History snapshots are complete: their rows decode on read.
      if (rowOrders) finish(NO_ROW_IDS);
      return;
    }

    if (!rowOrders || !ensureRow) {
      // Inputs not yet available — keep the loading state up.
      return;
    }

    if (rowOrders.length === 0) {
      // Defer the "no data" determination. Yjs often delivers an empty
      // `rowOrders` first and then populates it from the server; if rows
      // arrive within the grace window this effect re-runs (rowIdsKey
      // changes) and the timer is cancelled.
      const timer = setTimeout(() => finish(NO_ROW_IDS), EMPTY_ROW_ORDERS_GRACE_MS);

      return () => clearTimeout(timer);
    }

    if (!needsRowDocs) {
      finish(NO_ROW_IDS);
      return;
    }

    const hasDoc = (rowId: string) => {
      const sources = sourcesRef.current;

      return hasRowConditionData(sources.liveRows?.[rowId]) || Boolean(sources.getCachedRowDocs()[rowId]);
    };

    const ensuredRowIds = ensuredRowIdsRef.current;
    // Without seeds every row goes through `ensureRow` once, as it always did.
    const isHydrated =
      rowSource === 'ensure'
        ? (rowId: string) => ensuredRowIds.has(rowId)
        : (rowId: string) => ensuredRowIds.has(rowId) || hasDoc(rowId);
    const pendingRowIds = rowOrders.filter((row) => !isHydrated(row.id)).map((row) => row.id);

    if (pendingRowIds.length === 0) {
      finish(NO_ROW_IDS);
      return;
    }

    // A few new rows (one added in a neighbouring grid, a collaborator's row)
    // load behind the mounted chart, which leaves them out until their doc
    // arrives. A view's first load or a bulk change (an import, a widened
    // filter) is in the loading state (`rowsLoaded` below): streaming it in
    // would chart partial data and recompute and re-observe every row per
    // arrival.

    // The loader publishes each seed as its page arrives; asking for row docs
    // now would open a live doc for every row the walk is about to deliver.
    if (rowSource === 'wait') return;

    if (!sameRetryScope(retryScopeRef.current, scope)) {
      retryScopeRef.current = scope;
      retryAttemptRef.current = 0;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const isCancelled = () => cancelled;

    /** Resolves once the loader (or the live row map) has a doc for every id. */
    const untilPublished = (rowIds: readonly string[]) =>
      new Promise<void>((resolve) => {
        let remaining = rowIds;
        const check = () => {
          remaining = remaining.filter((rowId) => !hasDoc(rowId));
          if (remaining.length > 0 && !cancelled) return;
          if (wakeLoadRef.current === check) wakeLoadRef.current = null;
          resolve();
        };

        wakeLoadRef.current = check;
        check();
      });

    const loadPending = async () => {
      const peek = sourcesRef.current.peekRowDocFromSeed;
      const { seeded, unseeded } =
        rowSource === 'seeds' && peek
          ? await splitBySeed(pendingRowIds, { hasDoc, peekRowDocFromSeed: peek, isCancelled })
          : { seeded: NO_ROW_IDS, unseeded: pendingRowIds };

      if (cancelled) return;
      const { failedRowIds: failed } = await ensureRowsWithConcurrency(unseeded, ensureRow, {
        isCancelled,
        // `ensureRow` may resolve without a doc for a row the row map already holds.
        hasRowDoc: (rowId) => Boolean(sourcesRef.current.liveRows?.[rowId]) || hasDoc(rowId),
        // Only a row whose doc arrived is marked: a failed row is retried by the next run.
        onLoaded: (rowId) => ensuredRowIds.add(rowId),
      });

      if (cancelled) return;
      await untilPublished(seeded);
      if (cancelled) return;

      finish(failed);
      if (failed.length === 0) {
        retryAttemptRef.current = 0;
        return;
      }

      const attempt = retryAttemptRef.current;

      if (attempt >= ROW_SYNC_RETRY_DELAYS_MS.length) {
        Log.warn('[Chart] rows left out: their documents could not be loaded', {
          viewId: activeViewId,
          rows: failed.length,
        });
        return;
      }

      retryAttemptRef.current = attempt + 1;
      // The same row set stays loaded through its automatic retry: it runs behind whatever the chart shows.
      retryTimer = setTimeout(() => setRetryClock((clock) => clock + 1), ROW_SYNC_RETRY_DELAYS_MS[attempt]);
    };

    void loadPending();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      // A load waiting for the loader ends here.
      wakeLoadRef.current?.();
    };
    // `rowOrders` is read through `rowIdsKey`: the array is replaced after unrelated changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrdersReady, rowIdsKey, ensureRow, needsRowDocs, isHistory, activeViewId, retryClock, rowSource]);

  // --- The loaded flag, derived in render ---
  // Whether this row set's load is a bulk one, judged when the row set
  // arrives: another view, which a chart tab switch shows through this same
  // hook, or more rows without a doc than one round of loads. The docs that
  // arrive for it later finish its load instead (`finish` above).
  const isBulkPending = useMemo(() => {
    if (!rowOrders || isHistory || !needsRowDocs) return false;
    if (loadedScope === null || loadedScope.viewId !== activeViewId) return true;
    let pending = 0;

    for (const row of rowOrders) {
      if (hasRowConditionData(liveRows?.[row.id]) || cachedRowDocs[row.id]) continue;
      pending += 1;
      if (pending > ROW_LOAD_CONCURRENCY) return true;
    }

    return false;
    // Once per row set: `rowOrders` is read through `rowIdsKey`, and the docs are the ones it arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdsKey, activeViewId, isHistory, needsRowDocs]);
  const rowsLoaded =
    rowOrdersReady &&
    loadedScope !== null &&
    (sameRetryScope(loadedScope, { viewId: activeViewId, rowIdsKey }) || !isBulkPending);

  return {
    rowsLoaded,
    hasFailedRows: failedRowIds.size > 0,
    retry,
    cachedRowDocs,
  };
}

export default useChartRowHydration;
