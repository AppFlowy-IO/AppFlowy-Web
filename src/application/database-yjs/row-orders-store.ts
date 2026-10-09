import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import type { Row } from '@/application/database-yjs/selector';
import type { YDoc } from '@/application/types';

type RowOrdersSnapshot = { rows: Row[] | undefined };

function createRowOrdersSource() {
  const publishers = new Map<symbol, RowOrdersSnapshot>();
  const listeners = new Set<() => void>();
  let snapshot: RowOrdersSnapshot | undefined;

  const notify = () => {
    // Several view features can compute orders. Follow one mounted owner so
    // their independent updates cannot make the peek oscillate between them.
    const next = publishers.values().next().value as RowOrdersSnapshot | undefined;

    if (snapshot === next) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (owner: symbol, rows: Row[] | undefined) => {
      if (publishers.has(owner) && publishers.get(owner)?.rows === rows) return;
      publishers.set(owner, { rows });
      notify();
    },
    remove: (owner: symbol) => {
      publishers.delete(owner);
      notify();
    },
  };
}

/** Shares mounted view results with its peek, without retaining row documents after unmount. */
export function createRowOrdersStore() {
  const databases = new WeakMap<YDoc, Map<string, ReturnType<typeof createRowOrdersSource>>>();

  return {
    get: (doc: YDoc, viewId: string) => {
      let views = databases.get(doc);

      if (!views) {
        views = new Map();
        databases.set(doc, views);
      }

      let source = views.get(viewId);

      if (!source) {
        source = createRowOrdersSource();
        views.set(viewId, source);
      }

      return source;
    },
  };
}

export type RowOrdersStore = ReturnType<typeof createRowOrdersStore>;

function useRowOrdersSource() {
  const context = useDatabaseContextOptional();

  // Historical scopes must always derive orders from their own immutable rows.
  if (!context || context.dataSource?.type === 'history') return;
  return context.rowOrdersStore?.get(context.databaseDoc, context.activeViewId || context.databasePageId);
}

export function usePublishRowOrders(rows: Row[] | undefined, enabled: boolean) {
  const availableSource = useRowOrdersSource();
  const source = enabled ? availableSource : undefined;
  const owner = useRef(Symbol('row-orders-owner')).current;

  useLayoutEffect(() => {
    source?.publish(owner, rows);
  }, [source, owner, rows]);
  useLayoutEffect(() => () => source?.remove(owner), [source, owner]);
}

const getEmptySnapshot = () => undefined;
const subscribeEmpty = () => () => undefined;

export function usePublishedRowOrders() {
  const source = useRowOrdersSource();

  return useSyncExternalStore(
    source?.subscribe ?? subscribeEmpty,
    source?.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot
  );
}
