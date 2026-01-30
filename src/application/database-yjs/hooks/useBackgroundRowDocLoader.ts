import { useEffect, useRef, useState } from 'react';

import { useDatabaseContext, useDatabaseView, useRowMap } from '@/application/database-yjs/context';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { openCollabDBWithProvider } from '@/application/db';
import { YDoc, YjsDatabaseKey } from '@/application/types';

const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_CONCURRENCY = 6;

/**
 * Hook that handles background loading of row documents for sorting/filtering.
 * When sorts or filters are active, row docs need to be loaded to apply conditions.
 * This hook manages a background queue to load missing row docs efficiently.
 *
 * @param hasConditions - Whether there are active sorts or filters
 * @returns Object containing cached row docs and merged row docs for conditions
 */
export function useBackgroundRowDocLoader(hasConditions: boolean) {
  const rows = useRowMap();
  const view = useDatabaseView();
  const { databaseDoc } = useDatabaseContext();

  const [cachedRowDocs, setCachedRowDocs] = useState<Record<string, YDoc>>({});
  const cachedRowDocsRef = useRef<Record<string, YDoc>>({});
  const cachedRowDocPendingRef = useRef<Map<string, Promise<YDoc | undefined>>>(new Map());
  const backgroundQueueRef = useRef<Set<string>>(new Set());
  const backgroundLoadingRef = useRef(false);
  const backgroundCancelledRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    cachedRowDocsRef.current = cachedRowDocs;
  }, [cachedRowDocs]);

  // Cancel background loading on unmount
  useEffect(() => {
    return () => {
      backgroundCancelledRef.current = true;
    };
  }, []);

  // Clean up cached docs that are now in the main rowMap
  useEffect(() => {
    const cached = cachedRowDocsRef.current;
    let changed = false;
    const next: Record<string, YDoc> = {};

    Object.entries(cached).forEach(([rowId, doc]) => {
      if (rows?.[rowId]) {
        doc.destroy();
        changed = true;
        return;
      }

      next[rowId] = doc;
    });

    if (changed) {
      setCachedRowDocs(next);
    }
  }, [rows]);

  // Clean up all cached docs when database changes
  useEffect(() => {
    const pendingRef = cachedRowDocPendingRef.current;

    return () => {
      Object.values(cachedRowDocsRef.current).forEach((doc) => doc.destroy());
      cachedRowDocsRef.current = {};
      pendingRef.clear();
    };
  }, [databaseDoc.guid]);

  // Background loading of row docs for sorting/filtering
  useEffect(() => {
    if (!hasConditions) return;

    const rowOrdersData = view?.get(YjsDatabaseKey.row_orders)?.toJSON() as { id: string }[] | undefined;

    if (!rowOrdersData) return;

    const rowDocsForConditions = { ...cachedRowDocsRef.current, ...(rows || {}) };

    rowOrdersData.forEach(({ id }) => {
      if (!rowDocsForConditions[id]) {
        backgroundQueueRef.current.add(id);
      }
    });

    if (backgroundQueueRef.current.size === 0 || backgroundLoadingRef.current) return;

    backgroundLoadingRef.current = true;
    backgroundCancelledRef.current = false;

    const drainQueue = async () => {
      while (!backgroundCancelledRef.current) {
        if (backgroundQueueRef.current.size === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (backgroundQueueRef.current.size === 0 || backgroundCancelledRef.current) {
            break;
          }
        }

        const batch = Array.from(backgroundQueueRef.current).slice(0, BACKGROUND_BATCH_SIZE);

        batch.forEach((rowId) => {
          backgroundQueueRef.current.delete(rowId);
        });

        for (let i = 0; i < batch.length; i += BACKGROUND_CONCURRENCY) {
          if (backgroundCancelledRef.current) break;
          const slice = batch.slice(i, i + BACKGROUND_CONCURRENCY);

          await Promise.all(
            slice.map(async (rowId) => {
              const currentRowDocs = { ...cachedRowDocsRef.current, ...(rows || {}) };

              if (currentRowDocs[rowId]) return;

              if (cachedRowDocPendingRef.current.has(rowId)) {
                await cachedRowDocPendingRef.current.get(rowId);
                return;
              }

              const rowKey = getRowKey(databaseDoc.guid, rowId);
              const pending = (async () => {
                const { doc, provider } = await openCollabDBWithProvider(rowKey);

                await provider.destroy();
                return doc;
              })();

              cachedRowDocPendingRef.current.set(rowId, pending);

              try {
                const doc = await pending;

                if (backgroundCancelledRef.current) {
                  doc.destroy();
                  return;
                }

                if (rows?.[rowId]) {
                  doc.destroy();
                  return;
                }

                setCachedRowDocs((prev) => {
                  if (prev[rowId] || rows?.[rowId]) return prev;
                  return { ...prev, [rowId]: doc };
                });
              } finally {
                cachedRowDocPendingRef.current.delete(rowId);
              }
            })
          );
        }

        if (backgroundCancelledRef.current) break;

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      backgroundLoadingRef.current = false;
    };

    void drainQueue();

    // Capture ref values for cleanup (react-hooks/exhaustive-deps)
    const queueRef = backgroundQueueRef.current;

    return () => {
      backgroundCancelledRef.current = true;
      queueRef.clear();
      backgroundLoadingRef.current = false;
    };
  }, [databaseDoc.guid, hasConditions, rows, view]);

  return {
    cachedRowDocs,
  };
}
