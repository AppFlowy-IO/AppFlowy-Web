import { useEffect, useState, useSyncExternalStore } from 'react';

import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { createViewConditionsOverlay, ViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView } from '@/application/types';

type WidgetSource = Pick<DashboardWidget, 'id' | 'databaseId' | 'viewId'>;

export interface DashboardViewOverlays {
  /** Widgets with unsaved private filters or sorts. */
  localWidgetChanges: number;
  /** Called from a widget effect; the dashboard owns the returned view's lifetime. */
  getViewOverlay: (widget: WidgetSource, view: YDatabaseView | undefined) => YDatabaseView | undefined;
  /** Drop private conditions and follow the shared views again. */
  resetViewOverlays: () => void;
  /** Save every widget's private conditions to its shared view. */
  commitViewOverlays: () => void;
}

interface Entry {
  source: WidgetSource;
  overlay: ViewConditionsOverlay;
  unsubscribe: () => void;
}

function sameSource(a: WidgetSource, b: WidgetSource) {
  return a.databaseId === b.databaseId && a.viewId === b.viewId;
}

function createOverlayStore() {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let dirtyCount = 0;

  const recount = () => {
    let next = 0;

    entries.forEach(({ overlay }) => {
      if (overlay.isDirty()) next += 1;
    });
    if (next === dirtyCount) return;
    dirtyCount = next;
    listeners.forEach((notify) => notify());
  };

  const remove = (id: string, entry: Entry) => {
    entry.unsubscribe();
    entry.overlay.destroy();
    entries.delete(id);
  };

  return {
    getSnapshot: () => dirtyCount,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getViewOverlay: (widget: WidgetSource, view: YDatabaseView | undefined) => {
      const current = entries.get(widget.id);

      if (current && view && sameSource(current.source, widget)) {
        current.overlay.rebind(view);
        return current.overlay.view;
      }

      if (current) remove(widget.id, current);
      if (!view) {
        recount();
        return undefined;
      }

      const overlay = createViewConditionsOverlay(view);

      entries.set(widget.id, { source: widget, overlay, unsubscribe: overlay.subscribe(recount) });
      recount();
      return overlay.view;
    },
    retain: (rows: DashboardRow[]) => {
      const widgets = new Map(rows.flatMap((row) => row.widgets.map((widget) => [widget.id, widget] as const)));

      entries.forEach((entry, id) => {
        const widget = widgets.get(id);

        if (!widget || !sameSource(entry.source, widget)) remove(id, entry);
      });
      recount();
    },
    resetViewOverlays: () => entries.forEach(({ overlay }) => overlay.reset()),
    commitViewOverlays: () => entries.forEach(({ overlay }) => overlay.commit()),
    clear: () => {
      entries.forEach((entry, id) => remove(id, entry));
      recount();
    },
  };
}

/** Private conditions outlive row components, but never their dashboard or widget source. */
export function useDashboardViewOverlays(dashboardViewId: string, rows: DashboardRow[]): DashboardViewOverlays {
  const [scope, setScope] = useState(() => ({ dashboardViewId, store: createOverlayStore() }));

  // Each dashboard gets its own store even when the provider stays mounted.
  if (scope.dashboardViewId !== dashboardViewId) {
    setScope({ dashboardViewId, store: createOverlayStore() });
  }

  const { store } = scope;
  const localWidgetChanges = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => store.retain(rows), [rows, store]);
  useEffect(() => () => store.clear(), [store]);

  return {
    localWidgetChanges,
    getViewOverlay: store.getViewOverlay,
    resetViewOverlays: store.resetViewOverlays,
    commitViewOverlays: store.commitViewOverlays,
  };
}
