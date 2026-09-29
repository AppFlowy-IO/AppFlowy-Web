import { useEffect, useState, useSyncExternalStore } from 'react';

import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { createViewConditionsOverlay, ViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView } from '@/application/types';

type WidgetSource = Pick<DashboardWidget, 'id' | 'databaseId' | 'viewId'>;

export interface DashboardLocalWidgetChanges {
  /** Widgets with unsaved private filters or sorts. */
  unsaved: number;
  /** The unsaved ones whose source database the viewer can write. */
  savable: number;
}

export interface DashboardViewOverlays extends DashboardLocalWidgetChanges {
  /**
   * Called while a widget renders: creates the widget's overlay on first use
   * and never removes or notifies (stale overlays are released after commit).
   */
  getViewOverlay: (widget: WidgetSource, view: YDatabaseView | undefined) => YDatabaseView | undefined;
  /** Whether the viewer can write the widget's source; "Save for everybody" skips the others. */
  setViewOverlayWritable: (widget: WidgetSource, writable: boolean) => void;
  /** Drop private conditions and follow the shared views again. */
  resetViewOverlays: () => void;
  /** Save every writable widget's private conditions to its shared view. */
  commitViewOverlays: () => void;
}

interface Entry {
  source: WidgetSource;
  overlay: ViewConditionsOverlay;
  unsubscribe: () => void;
}

const sourceKey = ({ id, databaseId, viewId }: WidgetSource) => `${id}\n${databaseId}\n${viewId}`;

function createOverlayStore() {
  const entries = new Map<string, Entry>();
  // Unknown until the widget's permission resolves: fail closed.
  const writable = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  let unsaved = 0;
  let savable = 0;

  const recount = () => {
    let nextUnsaved = 0;
    let nextSavable = 0;

    entries.forEach(({ overlay }, key) => {
      if (!overlay.isDirty()) return;
      nextUnsaved += 1;
      if (writable.get(key)) nextSavable += 1;
    });
    if (nextUnsaved === unsaved && nextSavable === savable) return;
    unsaved = nextUnsaved;
    savable = nextSavable;
    listeners.forEach((notify) => notify());
  };

  const remove = (key: string, entry: Entry) => {
    entry.unsubscribe();
    entry.overlay.destroy();
    entries.delete(key);
    writable.delete(key);
  };

  return {
    getUnsaved: () => unsaved,
    getSavable: () => savable,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
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

      // A new overlay is clean, so the counts are unchanged.
      const overlay = createViewConditionsOverlay(view);

      entries.set(key, { source: widget, overlay, unsubscribe: overlay.subscribe(recount) });
      return overlay.view;
    },
    setViewOverlayWritable: (widget: WidgetSource, canWrite: boolean) => {
      const key = sourceKey(widget);

      if (writable.get(key) === canWrite) return;
      writable.set(key, canWrite);
      recount();
    },
    retain: (rows: DashboardRow[]) => {
      const keys = new Set(rows.flatMap((row) => row.widgets.map(sourceKey)));

      entries.forEach((entry, key) => {
        if (!keys.has(key)) remove(key, entry);
      });
      recount();
    },
    resetViewOverlays: () => entries.forEach(({ overlay }) => overlay.reset()),
    commitViewOverlays: () =>
      entries.forEach(({ overlay }, key) => {
        if (writable.get(key)) overlay.commit();
      }),
    clear: () => {
      entries.forEach((entry, key) => remove(key, entry));
      recount();
    },
  };
}

/**
 * Private conditions outlive row components, but never their dashboard or
 * widget source: a removed widget, or one pointed at another view, releases
 * its overlay once the new rows are committed.
 */
export function useDashboardViewOverlays(dashboardViewId: string, rows: DashboardRow[]): DashboardViewOverlays {
  const [scope, setScope] = useState(() => ({ dashboardViewId, store: createOverlayStore() }));

  // Each dashboard gets its own store even when the provider stays mounted.
  if (scope.dashboardViewId !== dashboardViewId) {
    setScope({ dashboardViewId, store: createOverlayStore() });
  }

  const { store } = scope;
  const unsaved = useSyncExternalStore(store.subscribe, store.getUnsaved, store.getUnsaved);
  const savable = useSyncExternalStore(store.subscribe, store.getSavable, store.getSavable);

  useEffect(() => store.retain(rows), [rows, store]);
  useEffect(() => () => store.clear(), [store]);

  return {
    unsaved,
    savable,
    getViewOverlay: store.getViewOverlay,
    setViewOverlayWritable: store.setViewOverlayWritable,
    resetViewOverlays: store.resetViewOverlays,
    commitViewOverlays: store.commitViewOverlays,
  };
}
