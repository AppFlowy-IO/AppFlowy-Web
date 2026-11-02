import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  hasPrivateParts,
  PrivateWidgetEntry,
  sanitizePrivateWidgetEntry,
} from '@/application/database-yjs/dashboard-private';
import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { createViewConditionsOverlay, ViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

type WidgetSource = Pick<DashboardWidget, 'id' | 'databaseId' | 'viewId'>;

/** How many widgets hold private filters or sorts (WP07). */
export interface DashboardWidgetPrivateSummary {
  /** Widgets with a private (dirty) filter or sort part. */
  dirtyWidgets: number;
  /** The dirty ones whose source database the viewer can write. */
  savableWidgets: number;
}

/** One widget's private parts as the overlay store sees them. */
export interface OverlayWidgetParts {
  filters: boolean;
  sorts: boolean;
  /** The viewer can write the widget's source (unknown reads as `false`). */
  writable: boolean;
}

/** A stable per-widget view of the store: the snapshot changes only when a part or writability does. */
export interface OverlayWidgetHandle {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => OverlayWidgetParts;
}

export interface DashboardViewOverlays {
  summary: DashboardWidgetPrivateSummary;
  /**
   * Called while a widget renders: creates the widget's overlay on first use
   * (restoring this device's private parts for its view) and never removes it
   * or notifies synchronously (stale overlays are released after commit).
   */
  getViewOverlay: (widget: WidgetSource, view: YDatabaseView | undefined) => YDatabaseView | undefined;
  /** Whether the viewer can write the widget's source; "Save for everyone" skips the others. */
  setViewOverlayWritable: (widget: WidgetSource, writable: boolean) => void;
  /** The widget's parts, for its Filter / Sort dots and popover footers. */
  getWidgetPrivateHandle: (widget: WidgetSource) => OverlayWidgetHandle;
  /** Drop private conditions (one widget's, or every widget's) and follow the shared views again. */
  resetViewOverlays: (widget?: WidgetSource) => void;
  /** Save the dirty parts of writable widgets (one, or all) to their shared views. */
  commitViewOverlays: (widget?: WidgetSource) => void;
  /**
   * The private parts to keep on this device, by view id, in row order:
   * every dirty overlay, plus the restored entries of widgets that have not
   * mounted yet (an unloaded widget never loses its state).
   */
  exportPrivateWidgets: () => Record<string, PrivateWidgetEntry>;
  /** Notifies on every private edit and every part change. */
  subscribePrivateChanges: (listener: () => void) => () => void;
}

interface Entry {
  source: WidgetSource;
  overlay: ViewConditionsOverlay;
  unsubscribe: () => void;
}

const NO_SUMMARY: DashboardWidgetPrivateSummary = { dirtyWidgets: 0, savableWidgets: 0 };
const CLEAN_PARTS: OverlayWidgetParts = { filters: false, sorts: false, writable: false };
const NO_WIDGETS: Record<string, PrivateWidgetEntry> = {};

const sourceKey = ({ id, databaseId, viewId }: WidgetSource) => `${id}\n${databaseId}\n${viewId}`;

/** A source database's field types by id, read from the doc that holds the view. */
function readFieldTypes(view: YDatabaseView): Map<string, number> {
  const types = new Map<string, number>();
  const doc = view.doc as YDoc | null;
  const database = (doc?.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined)?.get(YjsEditorKey.database);

  database?.get(YjsDatabaseKey.fields)?.forEach((field, fieldId) => {
    const type = Number(field?.get(YjsDatabaseKey.type));

    if (Number.isFinite(type)) types.set(fieldId, type);
  });
  return types;
}

function sanitizedFor(view: YDatabaseView, entry: PrivateWidgetEntry | undefined) {
  if (!hasPrivateParts(entry)) return null;
  const sanitized = sanitizePrivateWidgetEntry(entry, readFieldTypes(view), {
    filters: view.get(YjsDatabaseKey.filters),
    sorts: view.get(YjsDatabaseKey.sorts),
  });

  return hasPrivateParts(sanitized) ? sanitized : null;
}

function sameParts(a: OverlayWidgetParts, b: OverlayWidgetParts) {
  return a.filters === b.filters && a.sorts === b.sorts && a.writable === b.writable;
}

export function createOverlayStore(initialWidgets: Record<string, PrivateWidgetEntry> = NO_WIDGETS) {
  const entries = new Map<string, Entry>();
  // Unknown until the widget's permission resolves: fail closed.
  const writable = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const privateListeners = new Set<() => void>();
  // This device's private parts by view id, applied when a widget's overlay
  // is created. Kept until that widget's first change after the restore, so a
  // StrictMode remount (which recreates the overlay) restores them again.
  let pending: Record<string, PrivateWidgetEntry> = { ...initialWidgets };
  let rowOrder: WidgetSource[] = [];
  let summary = NO_SUMMARY;
  const handles = new Map<
    string,
    { handle: OverlayWidgetHandle; listeners: Set<() => void>; parts: OverlayWidgetParts }
  >();

  const partsOf = (key: string): OverlayWidgetParts => {
    const dirty = entries.get(key)?.overlay.dirtyParts();
    const next = {
      filters: Boolean(dirty?.has('filters')),
      sorts: Boolean(dirty?.has('sorts')),
      writable: writable.get(key) === true,
    };

    return next.filters || next.sorts || next.writable ? next : CLEAN_PARTS;
  };

  const refreshHandle = (key: string) => {
    const record = handles.get(key);

    if (!record) return;
    const next = partsOf(key);

    if (sameParts(record.parts, next)) return;
    record.parts = next;
    record.listeners.forEach((notify) => notify());
  };

  const recount = () => {
    let dirtyWidgets = 0;
    let savableWidgets = 0;

    entries.forEach(({ overlay }, key) => {
      if (!overlay.isDirty()) return;
      dirtyWidgets += 1;
      if (writable.get(key)) savableWidgets += 1;
    });
    handles.forEach((_record, key) => refreshHandle(key));
    if (dirtyWidgets === summary.dirtyWidgets && savableWidgets === summary.savableWidgets) return;
    summary = dirtyWidgets === 0 && savableWidgets === 0 ? NO_SUMMARY : { dirtyWidgets, savableWidgets };
    listeners.forEach((notify) => notify());
  };

  const notifyPrivate = () => privateListeners.forEach((notify) => notify());

  const remove = (key: string, entry: Entry) => {
    entry.unsubscribe();
    entry.overlay.destroy();
    entries.delete(key);
    writable.delete(key);
  };

  const forWidget = (widget: WidgetSource | undefined, run: (entry: Entry, key: string) => void) => {
    if (widget) {
      const key = sourceKey(widget);
      const entry = entries.get(key);

      if (entry) run(entry, key);
      return;
    }

    entries.forEach(run);
  };

  // A widget's first change after a restore (an edit, a reset, a save, or a
  // collaborator making its copy equal to the saved view) ends the restore.
  let restoring = false;
  const settle = (viewId: string) => {
    if (!restoring && viewId in pending) {
      const next = { ...pending };

      delete next[viewId];
      pending = next;
    }
  };

  return {
    getSummary: () => summary,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribePrivateChanges: (listener: () => void) => {
      privateListeners.add(listener);
      return () => privateListeners.delete(listener);
    },
    getViewOverlay: (widget: WidgetSource, view: YDatabaseView | undefined) => {
      // A view that is briefly missing keeps the viewer's private conditions.
      if (!view) return undefined;
      const key = sourceKey(widget);
      const current = entries.get(key);

      if (current) {
        current.overlay.rebind(view);
        return current.overlay.view;
      }

      const initial = sanitizedFor(view, pending[widget.viewId]);
      const overlay = createViewConditionsOverlay(view, { initial });
      const onParts = () => {
        settle(widget.viewId);
        recount();
        notifyPrivate();
      };

      const onPrivate = () => {
        settle(widget.viewId);
        notifyPrivate();
      };

      const unsubscribeParts = overlay.subscribe(onParts);
      const unsubscribePrivate = overlay.onPrivateChange(onPrivate);

      entries.set(key, {
        source: widget,
        overlay,
        unsubscribe: () => {
          unsubscribeParts();
          unsubscribePrivate();
        },
      });
      // Created while rendering: a restored overlay changes the counts, which
      // must not notify inside a render.
      if (initial) queueMicrotask(recount);
      return overlay.view;
    },
    setViewOverlayWritable: (widget: WidgetSource, canWrite: boolean) => {
      const key = sourceKey(widget);

      if (writable.get(key) === canWrite) return;
      writable.set(key, canWrite);
      recount();
    },
    getWidgetPrivateHandle: (widget: WidgetSource): OverlayWidgetHandle => {
      const key = sourceKey(widget);
      const existing = handles.get(key);

      if (existing) return existing.handle;
      const record = {
        listeners: new Set<() => void>(),
        parts: partsOf(key),
        handle: undefined as unknown as OverlayWidgetHandle,
      };

      record.handle = {
        subscribe: (listener) => {
          record.listeners.add(listener);
          return () => record.listeners.delete(listener);
        },
        getSnapshot: () => record.parts,
      };
      handles.set(key, record);
      return record.handle;
    },
    retain: (rows: DashboardRow[]) => {
      const widgets = rows.flatMap((row) => row.widgets);
      const keys = new Set(widgets.map(sourceKey));

      rowOrder = widgets;
      entries.forEach((entry, key) => {
        if (!keys.has(key)) remove(key, entry);
      });
      handles.forEach((_record, key) => {
        if (!keys.has(key)) handles.delete(key);
      });
      // Restored entries of views no longer on the dashboard are dropped (not
      // while the rows are still unknown: an empty dashboard has nothing to restore).
      if (widgets.length > 0) {
        const viewIds = new Set(widgets.map((widget) => widget.viewId));
        const kept = Object.keys(pending).filter((viewId) => viewIds.has(viewId));

        if (kept.length !== Object.keys(pending).length) {
          pending = Object.fromEntries(kept.map((viewId) => [viewId, pending[viewId]]));
          notifyPrivate();
        }
      }

      recount();
    },
    /** This device's private parts read later (the user resolved after the first render). */
    setPending: (widgets: Record<string, PrivateWidgetEntry>) => {
      pending = { ...widgets };
      restoring = true;
      try {
        entries.forEach(({ source, overlay }) => {
          const initial = sanitizedFor(overlay.realView, pending[source.viewId]);

          if (initial) overlay.restore(initial);
        });
      } finally {
        restoring = false;
      }

      recount();
    },
    resetViewOverlays: (widget?: WidgetSource) => {
      forWidget(widget, ({ source, overlay }) => {
        settle(source.viewId);
        overlay.reset();
      });
      if (!widget) pending = {};
      notifyPrivate();
    },
    commitViewOverlays: (widget?: WidgetSource) =>
      forWidget(widget, ({ source, overlay }, key) => {
        if (!writable.get(key)) return;
        settle(source.viewId);
        overlay.commit();
      }),
    exportPrivateWidgets: () => {
      const result: Record<string, PrivateWidgetEntry> = {};
      const mounted = new Set<string>();

      // Row order: for widgets that share a view (legacy duplicates), the
      // dirty widget that comes last wins.
      rowOrder.forEach((widget) => {
        const entry = entries.get(sourceKey(widget));

        if (!entry) return;
        mounted.add(widget.viewId);
        const exported = entry.overlay.exportPrivate();

        if (exported) result[widget.viewId] = exported;
      });
      entries.forEach(({ source, overlay }) => {
        if (mounted.has(source.viewId)) return;
        mounted.add(source.viewId);
        const exported = overlay.exportPrivate();

        if (exported) result[source.viewId] = exported;
      });
      Object.entries(pending).forEach(([viewId, entry]) => {
        if (!mounted.has(viewId) && hasPrivateParts(entry)) result[viewId] = entry;
      });
      return result;
    },
    clear: () => {
      entries.forEach((entry, key) => remove(key, entry));
      recount();
    },
  };
}

/**
 * Private conditions outlive row components, but never their dashboard or
 * widget source: a removed widget, or one pointed at another view, releases
 * its overlay once the new rows are committed. `initialWidgets` are this
 * device's private parts (by view id), restored as each widget mounts.
 */
export function useDashboardViewOverlays(
  dashboardViewId: string,
  rows: DashboardRow[],
  initialWidgets: Record<string, PrivateWidgetEntry> = NO_WIDGETS
): DashboardViewOverlays {
  const [scope, setScope] = useState(() => ({
    dashboardViewId,
    initialWidgets,
    store: createOverlayStore(initialWidgets),
  }));

  // Each dashboard gets its own store even when the provider stays mounted.
  if (scope.dashboardViewId !== dashboardViewId) {
    setScope({ dashboardViewId, initialWidgets, store: createOverlayStore(initialWidgets) });
  }

  const { store } = scope;
  const summary = useSyncExternalStore(store.subscribe, store.getSummary, store.getSummary);

  // The device's entries can arrive after the store (the user resolved late).
  useEffect(() => {
    if (scope.initialWidgets === initialWidgets) return;
    setScope((current) => (current.store === store ? { ...current, initialWidgets } : current));
    store.setPending(initialWidgets);
  }, [initialWidgets, scope.initialWidgets, store]);
  useEffect(() => store.retain(rows), [rows, store]);
  useEffect(() => () => store.clear(), [store]);

  return {
    summary,
    getViewOverlay: store.getViewOverlay,
    setViewOverlayWritable: store.setViewOverlayWritable,
    getWidgetPrivateHandle: store.getWidgetPrivateHandle,
    resetViewOverlays: store.resetViewOverlays,
    commitViewOverlays: store.commitViewOverlays,
    exportPrivateWidgets: store.exportPrivateWidgets,
    subscribePrivateChanges: store.subscribePrivateChanges,
  };
}
