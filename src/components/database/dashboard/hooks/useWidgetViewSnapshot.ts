import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export interface WidgetViewSnapshot {
  /** The doc holds a database (false while a fresh doc is still syncing). */
  hasDatabase: boolean;
  /** The referenced view exists in that database. */
  exists: boolean;
  /** Identity changes when a synced update replaces a view under the same id. */
  view: YDatabaseView | undefined;
  name: string;
  layout: DatabaseViewLayout | null;
}

const NO_DOC_SNAPSHOT: WidgetViewSnapshot = {
  hasDatabase: false,
  exists: false,
  view: undefined,
  name: '',
  layout: null,
};

function readSnapshot(doc: YDoc, viewId: string) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const view = views?.get(viewId);
  const layout = view?.get(YjsDatabaseKey.layout);
  const numericLayout = layout === undefined || layout === null ? null : Number(layout);
  const name = view?.get(YjsDatabaseKey.name);

  return {
    hasDatabase: Boolean(views),
    exists: Boolean(view),
    view,
    name: typeof name === 'string' ? name : '',
    // Rust-backed enum values may arrive as BigInt.
    layout: numericLayout !== null && Number.isFinite(numericLayout) ? (numericLayout as DatabaseViewLayout) : null,
  };
}

function createStore(doc: YDoc, viewId: string) {
  const section = doc.getMap(YjsEditorKey.data_section);
  let snapshot = NO_DOC_SNAPSHOT;

  return {
    getSnapshot: () => {
      const next = readSnapshot(doc, viewId);

      if (
        next.hasDatabase !== snapshot.hasDatabase ||
        next.view !== snapshot.view ||
        next.name !== snapshot.name ||
        next.layout !== snapshot.layout
      )
        snapshot = next;
      return snapshot;
    },
    subscribe: (notify: () => void) => {
      // One deep observer on the data section catches the database arriving,
      // the view being added / removed, and its name or layout changing. The
      // cached snapshot keeps unrelated edits from re-rendering.
      section.observeDeep(notify);
      return () => {
        try {
          section.unobserveDeep(notify);
        } catch {
          // The doc may already be destroyed.
        }
      };
    },
  };
}

const noopSubscribe = () => () => undefined;

/** Live existence, name and layout of `viewId` inside `doc`. */
export function useWidgetViewSnapshot(doc: YDoc | null, viewId: string): WidgetViewSnapshot {
  const store = useMemo(() => (doc ? createStore(doc, viewId) : null), [doc, viewId]);

  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? (() => NO_DOC_SNAPSHOT),
    store?.getSnapshot ?? (() => NO_DOC_SNAPSHOT)
  );
}

/**
 * `true` once `active` has stayed true for `delayMs`. Used to report a missing
 * view only after a grace period.
 */
export function useDelayedFlag(active: boolean, delayMs: number) {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }

    const timeout = window.setTimeout(() => setElapsed(true), delayMs);

    return () => window.clearTimeout(timeout);
  }, [active, delayMs]);

  return active && elapsed;
}
