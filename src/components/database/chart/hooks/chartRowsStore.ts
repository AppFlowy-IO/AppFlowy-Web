import type { YEvent } from 'yjs';

import { RowId, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

/** The row data a chart reads, so edits to anything else do not recompute it. */
export interface ChartRowsWatch {
  /** Fields whose cells feed the X or Y axis. */
  fieldIds: ReadonlySet<string>;
  /** Row-level keys an axis reads: `created_at` / `last_modified`. */
  rowKeys: ReadonlySet<string>;
}

export const EMPTY_CHART_ROWS_WATCH: ChartRowsWatch = { fieldIds: new Set(), rowKeys: new Set() };

export interface ChartRowsStore {
  getSnapshot: () => number;
  subscribe: (onStoreChange: () => void) => () => void;
  /** Observe `rows`: only entries whose doc instance changed are attached or dropped. */
  replaceRows: (rows: Record<RowId, YDoc>) => void;
  /** Change what the observers react to; they stay attached. */
  setWatch: (watch: ChartRowsWatch) => void;
  /** Drop every observer and a pending publish. The store can be reused afterwards. */
  detachRows: () => void;
}

type ChartRowObserver = {
  dataSection: ReturnType<YDoc['getMap']>;
  doc: YDoc;
  observer: (events: YEvent[]) => void;
};

function yjsEventChangesKey(event: YEvent, key: string): boolean {
  const keysChanged = (event as { keysChanged?: Set<unknown> }).keysChanged;

  return keysChanged?.has(key) ?? false;
}

function yjsEventChangesAnyKey(event: YEvent, keys: ReadonlySet<string>): boolean {
  for (const key of keys) {
    if (yjsEventChangesKey(event, key)) return true;
  }

  return false;
}

/**
 * Whether an event on a row document's data section can change the chart:
 * the row data arriving in a document that opened empty, the cells map or a
 * watched row key being replaced, or a watched field's cell being set or
 * edited at any depth.
 */
export function yjsEventTouchesChartRow(event: YEvent, watch: ChartRowsWatch): boolean {
  const { path } = event;

  if (path.length === 0) return yjsEventChangesKey(event, YjsEditorKey.database_row);
  if (path[0] !== YjsEditorKey.database_row) return false;
  if (path.length === 1) {
    return yjsEventChangesKey(event, YjsDatabaseKey.cells) || yjsEventChangesAnyKey(event, watch.rowKeys);
  }

  if (path[1] !== YjsDatabaseKey.cells) return false;
  if (path.length === 2) return yjsEventChangesAnyKey(event, watch.fieldIds);

  return watch.fieldIds.has(String(path[2]));
}

/**
 * Run `callback` once in the next animation frame, so a burst of row updates
 * (a sync batch, a blob re-seed) costs one recompute. A microtask stands in
 * where there is no frame (SSR).
 */
function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback);

    return () => cancelAnimationFrame(handle);
  }

  let cancelled = false;

  queueMicrotask(() => {
    if (!cancelled) callback();
  });

  return () => {
    cancelled = true;
  };
}

/**
 * Revision clock over the loaded row documents of a chart. Row docs are
 * separate Yjs documents, so observing the database view never shows a cell
 * edit. This store keeps one `observeDeep` per row doc, re-attached only when
 * the doc instance changes, and bumps the revision when an event touches the
 * data the chart reads. Mirrors the grouping rows store in `selector.ts`.
 */
export function createChartRowsStore(initialWatch: ChartRowsWatch = EMPTY_CHART_ROWS_WATCH): ChartRowsStore {
  const subscribers = new Set<() => void>();
  const observers = new Map<RowId, ChartRowObserver>();
  let watch = initialWatch;
  let revision = 0;
  let cancelPublish: (() => void) | null = null;

  const publish = () => {
    cancelPublish = null;
    revision += 1;
    subscribers.forEach((subscriber) => subscriber());
  };

  const schedulePublish = () => {
    if (!cancelPublish) cancelPublish = scheduleFrame(publish);
  };

  const detach = ({ dataSection, observer }: ChartRowObserver) => {
    try {
      dataSection.unobserveDeep(observer);
    } catch {
      // The row document may already have been destroyed during a lifecycle reset.
    }
  };

  const attach = (rowId: RowId, doc: YDoc) => {
    const dataSection = doc.getMap(YjsEditorKey.data_section);
    const observer = (events: YEvent[]) => {
      if (events.some((event) => yjsEventTouchesChartRow(event, watch))) schedulePublish();
    };

    dataSection.observeDeep(observer);
    observers.set(rowId, { dataSection, doc, observer });
  };

  return {
    getSnapshot: () => revision,
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      return () => {
        subscribers.delete(onStoreChange);
      };
    },
    replaceRows: (rows) => {
      observers.forEach((current, rowId) => {
        if (rows[rowId] === current.doc) return;
        detach(current);
        observers.delete(rowId);
      });
      // `rowMap` is replaced per ensured row, so this runs hundreds of times
      // while a large database loads; iterate without building a pairs array.
      for (const rowId in rows) {
        const doc = rows[rowId];

        if (doc && !observers.has(rowId)) attach(rowId, doc);
      }
    },
    setWatch: (next) => {
      watch = next;
    },
    detachRows: () => {
      observers.forEach(detach);
      observers.clear();
      cancelPublish?.();
      cancelPublish = null;
    },
  };
}
