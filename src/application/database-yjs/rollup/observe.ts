import { subscribeFormulaClock } from '@/application/database-yjs/formula/clock';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { YDoc, YjsEditorKey } from '@/application/types';

import { inspectRollupCell, invalidateRollupCell, RollupComputeContext } from './cache';

/** Observe the documents evaluation actually reads, including nested computed dependencies. */
export function observeRollupCell(context: RollupComputeContext, changed: () => void): () => void {
  const controller = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 250;
  let disposed = false;
  let running = false;
  let dirty = false;
  let needsClock = false;
  let needsPeople = false;
  let lastPeopleRefresh = Date.now();
  let clockCleanup: (() => void) | undefined;
  let observers = new Map<YDoc, () => void>();
  const loadedRows = new Map<string, Promise<YDoc>>();
  const loadedViews = new Map<string, Promise<YDoc | null>>();
  const observedContext: RollupComputeContext = {
    ...context,
    loadSourceDocumentsDirectly: true,
    getViewIdFromDatabaseId: async (databaseId) => {
      const viewId = await context.getViewIdFromDatabaseId?.(databaseId);

      if (!viewId) throw new Error('Related database is not available yet');
      return viewId;
    },
    createRow: context.createRow
      ? (key) => {
          let promise = loadedRows.get(key);

          if (!promise) {
            promise = context.createRow!(key).catch((error: unknown) => {
              loadedRows.delete(key);
              throw error;
            });
            loadedRows.set(key, promise);
          }

          return promise;
        }
      : undefined,
    loadView: context.loadView
      ? (...args) => {
          const key = `${args[0]}:${args[3]?.databaseId ?? ''}`;
          let promise = loadedViews.get(key);

          if (!promise) {
            promise = context.loadView!(...args).then(
              (doc) => {
                if (!doc) {
                  loadedViews.delete(key);
                  throw new Error('Related database is not available yet');
                }

                return doc;
              },
              (error: unknown) => {
                loadedViews.delete(key);
                throw error;
              }
            );
            loadedViews.set(key, promise);
          }

          return promise;
        }
      : undefined,
  };
  const cellId = `${context.rowId}:${context.fieldId}`;
  const notify = () => {
    if (disposed) return;
    invalidateRollupCell(cellId);
    changed();
  };

  const refresh = () => {
    if (disposed) return;
    dirty = true;
    invalidateRollupCell(cellId);
    void run();
  };

  const run = async () => {
    if (disposed || running) return;
    running = true;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    try {
      do {
        dirty = false;
        const readDocuments = new Set<YDoc>();
        let usesClock = false;
        let usesPeople = false;

        const pass = new AbortController();
        const abortPass = () => pass.abort();

        controller.signal.addEventListener('abort', abortPass);
        try {
          await inspectRollupCell(observedContext, {
            signal: pass.signal,
            path: new Set(),
            now: Date.now(),
            observe: (doc) => {
              if (disposed || pass.signal.aborted) return;
              readDocuments.add(doc);
              if (!observers.has(doc)) {
                observers.set(doc, subscribeSharedYjsDeep(doc.getMap(YjsEditorKey.data_section), refresh));
              }
            },
            usesClock: () => {
              usesClock = true;
            },
            usesPeople: () => {
              usesPeople = true;
            },
          });
        } finally {
          // A failed parallel dependency must not attach observers after this pass.
          pass.abort();
          controller.signal.removeEventListener('abort', abortPass);
        }

        if (disposed) return;
        observers.forEach((cleanup, doc) => {
          if (!readDocuments.has(doc)) {
            cleanup();
            observers.delete(doc);
          }
        });
        loadedRows.forEach((promise, key) => {
          void promise.then(
            (doc) => {
              if (!readDocuments.has(doc)) loadedRows.delete(key);
            },
            () => undefined
          );
        });
        loadedViews.forEach((promise, key) => {
          void promise.then(
            (doc) => {
              if (!doc || !readDocuments.has(doc)) loadedViews.delete(key);
            },
            () => undefined
          );
        });
        needsClock = usesClock;
        needsPeople = usesPeople;
        if ((needsClock || needsPeople) && !clockCleanup)
          clockCleanup = subscribeFormulaClock(() => {
            const refreshPeople = needsPeople && Date.now() - lastPeopleRefresh >= 30_000;

            if (refreshPeople) lastPeopleRefresh = Date.now();
            if (needsClock || refreshPeople) refresh();
          });
        if (!needsClock && !needsPeople && clockCleanup) {
          clockCleanup();
          clockCleanup = undefined;
        }
      } while (dirty && !disposed);

      retryDelay = 250;
      // Close the interval between a display read and attaching every source observer.
      notify();
    } catch (error) {
      if (!disposed) {
        console.error('[Database] Failed to observe computed rollup sources', error);
        notify();
        retryTimer = setTimeout(() => {
          void run();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    } finally {
      running = false;
    }
  };

  void run();
  return () => {
    disposed = true;
    controller.abort();
    clearTimeout(retryTimer);
    observers.forEach((cleanup) => cleanup());
    observers = new Map();
    clockCleanup?.();
  };
}
