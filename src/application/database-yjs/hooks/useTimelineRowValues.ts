import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { YDoc, YjsEditorKey } from '@/application/types';

import { hasRowConditionData } from '../condition-value-cache';
import { useDatabaseContext, useDatabaseViewId, useRowMap } from '../context';
import { createLocalFirstObserver } from '../local-first-observer';
import { useRowOrdersSelector } from '../selector';

import { BackgroundRowDocChange, useBackgroundRowDocLoader } from './useBackgroundRowDocLoader';

type RowDocs = Record<string, YDoc>;
type ParseRow<T> = (rowId: string, doc: YDoc) => T | undefined;

/** Decode only the rows touched by a seed batch or a row-document update. */
export function createTimelineRowValuesStore<T>(parse: ParseRow<T>) {
  const cached = new Map<string, YDoc>();
  const values = new Map<string, T>();
  const effective = new Map<string, YDoc>();
  const observers = new Map<string, { live?: YDoc; seed?: YDoc; cleanups: Map<YDoc, () => void> }>();
  const subscribers = new Set<() => void>();
  let live: RowDocs = {};
  let rowIds = new Set<string>();
  let snapshot = new Map<string, T>();

  const publish = () => {
    snapshot = new Map(values);
    subscribers.forEach((notify) => notify());
  };

  const source = (rowId: string) => {
    const seed = cached.get(rowId);
    const active = live[rowId];

    return active && (hasRowConditionData(active) || !seed) ? active : seed;
  };

  const read = (rowId: string, doc: YDoc | undefined) => {
    if (!doc) {
      effective.delete(rowId);
      return values.delete(rowId);
    }

    effective.set(rowId, doc);
    const value = parse(rowId, doc);

    if (value === undefined) values.delete(rowId);
    else values.set(rowId, value);
    return true;
  };

  const reconcile = (rowId: string) => {
    const previous = observers.get(rowId);
    const active = rowIds.has(rowId) ? live[rowId] : undefined;
    const seed = rowIds.has(rowId) ? cached.get(rowId) : undefined;

    if (previous?.live === active && previous?.seed === seed) return false;
    const docs = new Set([active, seed].filter((doc): doc is YDoc => Boolean(doc)));
    const cleanups = previous?.cleanups ?? new Map<YDoc, () => void>();

    cleanups.forEach((cleanup, doc) => {
      if (docs.has(doc)) return;
      cleanup();
      cleanups.delete(doc);
    });
    if (docs.size > 0) {
      docs.forEach((doc) => {
        if (cleanups.has(doc)) return;
        const root = doc.getMap(YjsEditorKey.data_section);
        const observer = createLocalFirstObserver(() => {
          const next = source(rowId);

          // A stale seed cannot replace a mounted row, but an initially empty
          // mounted document must take over once its cells arrive.
          if (next !== doc && next === effective.get(rowId)) return;
          read(rowId, next);
          publish();
        }, 150);

        root.observeDeep(observer);
        cleanups.set(doc, () => {
          observer.cancel();
          root.unobserveDeep(observer);
        });
      });

      observers.set(rowId, { live: active, seed, cleanups });
    } else {
      observers.delete(rowId);
    }

    const next = rowIds.has(rowId) ? source(rowId) : undefined;

    return next !== effective.get(rowId) ? read(rowId, next) : false;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    syncRows: (ids: string[], rows: RowDocs) => {
      const changed = new Set([...rowIds, ...ids]);

      rowIds = new Set(ids);
      live = rows;
      let dirty = false;

      changed.forEach((id) => {
        dirty = reconcile(id) || dirty;
      });
      if (dirty) publish();
    },
    applyCachedRowsChange: ({ added, removed }: BackgroundRowDocChange) => {
      const changed = new Set<string>();

      Object.entries(removed).forEach(([id, doc]) => {
        if (cached.get(id) !== doc) return;
        cached.delete(id);
        changed.add(id);
      });
      Object.entries(added).forEach(([id, doc]) => {
        if (cached.get(id) === doc) return;
        cached.set(id, doc);
        changed.add(id);
      });
      let dirty = false;

      changed.forEach((id) => {
        dirty = reconcile(id) || dirty;
      });
      if (dirty) publish();
    },
    dispose: () => {
      observers.forEach(({ cleanups }) => cleanups.forEach((cleanup) => cleanup()));
      observers.clear();
      cached.clear();
      effective.clear();
      values.clear();
    },
  };
}

/** Seed-backed offscreen rows use detached docs; missing seeds retain the loader's fallback. */
export function useTimelineRowValues<T>(parse: ParseRow<T>): Map<string, T> {
  const { databaseDoc } = useDatabaseContext();
  const viewId = useDatabaseViewId();
  const rows = useRowMap();
  const rowOrders = useRowOrdersSelector();
  // All consumers stay active, including an unbound optional property: an
  // inactive loader sharing the scope would cancel the other consumers' run.
  const { getCachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(true, 'timeline');
  const store = useMemo(() => {
    // Optional fields can keep the same parser while switching databases/views.
    void databaseDoc;
    void viewId;
    return createTimelineRowValuesStore(parse);
  }, [databaseDoc, viewId, parse]);

  useLayoutEffect(() => {
    store.syncRows(
      (rowOrders ?? []).map((row) => row.id),
      rows ?? {}
    );
  }, [rowOrders, rows, store]);
  useLayoutEffect(() => {
    const unsubscribe = subscribeToCachedRowDocChanges(store.applyCachedRowsChange);

    store.applyCachedRowsChange({ added: getCachedRowDocs(), removed: {} });
    return () => {
      unsubscribe();
      store.dispose();
    };
  }, [getCachedRowDocs, store, subscribeToCachedRowDocChanges]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
