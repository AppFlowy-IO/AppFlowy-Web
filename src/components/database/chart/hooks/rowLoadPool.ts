import type { YDoc } from '@/application/types';

/**
 * Cap on concurrent `ensureRow` calls. An unbounded `Promise.all` over a
 * large database (5k+ rows) floods the WebSocket layer with messages, which
 * surfaces a render-loop in `react-use-websocket`'s `setLastMessage` and
 * stalls the main thread. A small worker pool keeps the pipeline saturated
 * without the burst.
 */
export const ROW_LOAD_CONCURRENCY = 16;

export type EnsureRow = (rowId: string) => Promise<YDoc | undefined> | void;

export interface RowLoadOptions {
  /** Stops the workers from picking up more rows. */
  isCancelled: () => boolean;
  /**
   * Whether the row's doc is available although `ensureRow` handed none back:
   * a context that cannot open rows (a published page) resolves without a doc
   * for rows that are already in its row map. Without this, only a returned
   * doc counts as loaded.
   */
  hasRowDoc?: (rowId: string) => boolean;
  /** Runs for each row whose doc is available after its load. */
  onLoaded?: (rowId: string) => void;
}

export interface RowLoadResult {
  loaded: number;
  /** Rows whose load threw, or resolved without a doc. The caller retries them. */
  failedRowIds: string[];
}

/**
 * `ensureRow` every id through a pool of `ROW_LOAD_CONCURRENCY` workers.
 *
 * A row is loaded only when its doc is available afterwards. `ensureRow`
 * resolves `undefined` when it could not open the row (it swallows the
 * error), so a resolved promise alone proves nothing: such a row is reported
 * in `failedRowIds`, like a row whose load threw, and is not passed to
 * `onLoaded`.
 */
export async function ensureRowsWithConcurrency(
  rowIds: readonly string[],
  ensureRow: EnsureRow,
  { isCancelled, hasRowDoc, onLoaded }: RowLoadOptions
): Promise<RowLoadResult> {
  let cursor = 0;
  let loaded = 0;
  const failedRowIds: string[] = [];
  const worker = async () => {
    while (!isCancelled()) {
      const idx = cursor++;

      if (idx >= rowIds.length) return;
      const rowId = rowIds[idx];

      try {
        const doc = await ensureRow(rowId);

        if (doc || hasRowDoc?.(rowId)) {
          loaded += 1;
          onLoaded?.(rowId);
        } else {
          failedRowIds.push(rowId);
        }
      } catch (e) {
        failedRowIds.push(rowId);
        console.error('chart: failed to load row', rowId, e);
      }
    }
  };

  const workerCount = Math.min(ROW_LOAD_CONCURRENCY, rowIds.length);

  await Promise.all(Array.from({ length: workerCount }, worker));
  return { loaded, failedRowIds };
}
