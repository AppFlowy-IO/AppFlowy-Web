import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { DatabaseViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export interface WidgetViewSnapshot {
  /** The doc holds a database (false while a fresh doc is still syncing). */
  hasDatabase: boolean;
  /** The referenced view exists in that database. */
  exists: boolean;
  name: string;
  layout: DatabaseViewLayout | null;
}

const NO_DOC_SNAPSHOT = JSON.stringify([false, false, '', null]);

function readSnapshot(doc: YDoc, viewId: string) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const view = views?.get(viewId);
  const layout = view?.get(YjsDatabaseKey.layout);
  const name = view?.get(YjsDatabaseKey.name);

  // Rust-backed enum values may arrive as BigInt; keep the snapshot primitive.
  return JSON.stringify([
    Boolean(views),
    Boolean(view),
    typeof name === 'string' ? name : '',
    layout === undefined || layout === null ? null : Number(layout),
  ]);
}

function createStore(doc: YDoc, viewId: string) {
  const section = doc.getMap(YjsEditorKey.data_section);

  return {
    getSnapshot: () => readSnapshot(doc, viewId),
    subscribe: (notify: () => void) => {
      // One deep observer on the data section catches the database arriving,
      // the view being added / removed, and its name or layout changing. The
      // primitive snapshot keeps unrelated edits from re-rendering.
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
  const raw = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? (() => NO_DOC_SNAPSHOT),
    store?.getSnapshot ?? (() => NO_DOC_SNAPSHOT)
  );

  return useMemo(() => {
    const [hasDatabase, exists, name, layout] = JSON.parse(raw) as [boolean, boolean, string, number | null];

    return {
      hasDatabase,
      exists,
      name,
      layout: layout === null ? null : (layout as DatabaseViewLayout),
    };
  }, [raw]);
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
