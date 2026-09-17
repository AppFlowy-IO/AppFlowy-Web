import { YDoc, YjsEditorKey } from '@/application/types';

import { hasRowConditionData } from './condition-value-cache';
import { createLocalFirstObserver } from './local-first-observer';

import type { BackgroundRowDocChange } from './hooks/useBackgroundRowDocLoader';

type RowDocs = Record<string, YDoc>;
export type ParseTimelineRow<T> = (rowId: string, doc: YDoc) => T | undefined;

export interface TimelineRowValuesSnapshot<T> {
  values: Map<string, T>;
  /** Every ordered row has a populated document, including rows with empty cells. */
  complete: boolean;
}

/** Decode only the rows touched by a seed batch or a row-document update. */
export function createTimelineRowValuesStore<T>(parse: ParseTimelineRow<T>) {
  const cached = new Map<string, YDoc>();
  const values = new Map<string, T>();
  const effective = new Map<string, YDoc>();
  const observers = new Map<string, { live?: YDoc; seed?: YDoc; cleanups: Map<YDoc, () => void> }>();
  const subscribers = new Set<() => void>();
  let live: RowDocs = {};
  let rowIds = new Set<string>();
  let ordersReady = false;
  let snapshot: TimelineRowValuesSnapshot<T> = { values: new Map(), complete: false };
  const dirtyRows = new Set<string>();
  let observer: ReturnType<typeof createLocalFirstObserver> | undefined;
  const isComplete = () => ordersReady && effective.size === rowIds.size;

  const publish = () => {
    snapshot = { values: new Map(values), complete: isComplete() };
    subscribers.forEach((notify) => notify());
  };

  const source = (rowId: string) => {
    const seed = cached.get(rowId);
    const active = live[rowId];

    return active && (hasRowConditionData(active) || !seed) ? active : seed;
  };

  const read = (rowId: string, doc: YDoc | undefined) => {
    if (!hasRowConditionData(doc)) {
      effective.delete(rowId);
      return values.delete(rowId);
    }

    effective.set(rowId, doc);
    const value = parse(rowId, doc);

    if (value === undefined) return values.delete(rowId);
    if (values.has(rowId) && Object.is(values.get(rowId), value)) return false;
    values.set(rowId, value);
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

        // One scheduler per projection coalesces dependency cascades across
        // separate Y.Docs before copying the values map or notifying React.
        observer ??= createLocalFirstObserver(() => {
          let changed = false;

          dirtyRows.forEach((id) => {
            if (rowIds.has(id)) changed = read(id, source(id)) || changed;
          });
          dirtyRows.clear();
          if (changed || snapshot.complete !== isComplete()) publish();
        }, 150);
        const schedule = observer;
        const onChange = (...args: Parameters<typeof schedule>) => {
          const next = source(rowId);

          // An old seed cannot replace a populated live document.
          if (next !== doc && next === effective.get(rowId)) return;
          dirtyRows.add(rowId);
          schedule(...args);
        };

        root.observeDeep(onChange);
        cleanups.set(doc, () => root.unobserveDeep(onChange));
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
    syncRows: (ids: readonly string[] | undefined, rows: RowDocs) => {
      const changed = new Set([...rowIds, ...(ids ?? [])]);

      ordersReady = ids !== undefined;
      rowIds = new Set(ids);
      live = rows;
      let dirty = false;

      changed.forEach((id) => {
        dirty = reconcile(id) || dirty;
      });
      if (dirty || snapshot.complete !== isComplete()) publish();
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
      if (dirty || snapshot.complete !== isComplete()) publish();
    },
    dispose: () => {
      observer?.cancel();
      observer = undefined;
      dirtyRows.clear();
      observers.forEach(({ cleanups }) => cleanups.forEach((cleanup) => cleanup()));
      observers.clear();
      cached.clear();
      effective.clear();
      values.clear();
    },
  };
}
