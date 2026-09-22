import { useMemo, useSyncExternalStore } from 'react';

import { DatabaseViewLayout, YDatabase, YDatabaseViews, YjsDatabaseKey } from '@/application/types';

import { HostViewEntry } from '../picker-options';
import { databaseLayoutToViewLayout } from '../utils';

function createdAtValue(value: unknown) {
  if (value === undefined || value === null || value === '') return Number.POSITIVE_INFINITY;
  const numeric = Number(value);

  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** Non-inline views of a database in creation order (the tab order fallback). */
export function readHostViews(views: YDatabaseViews | undefined): HostViewEntry[] {
  if (!views) return [];
  const entries: Array<HostViewEntry & { createdAt: number; order: number }> = [];
  let order = 0;

  views.forEach((view, viewId) => {
    order += 1;
    if (!view || view.get(YjsDatabaseKey.is_inline)) return;
    const layout = view.get(YjsDatabaseKey.layout);
    const name = view.get(YjsDatabaseKey.name);

    entries.push({
      viewId,
      name: typeof name === 'string' ? name : '',
      layout: databaseLayoutToViewLayout(
        layout === undefined || layout === null ? DatabaseViewLayout.Grid : (Number(layout) as DatabaseViewLayout)
      ),
      embedded: view.get(YjsDatabaseKey.embedded) === true,
      createdAt: createdAtValue(view.get(YjsDatabaseKey.created_at)),
      order,
    });
  });

  return entries
    .sort((left, right) => left.createdAt - right.createdAt || left.order - right.order)
    .map(({ viewId, name, layout, embedded }) => ({ viewId, name, layout, embedded }));
}

function sameHostViews(a: HostViewEntry[], b: HostViewEntry[]) {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];

    if (
      left.viewId !== right.viewId ||
      left.name !== right.name ||
      left.layout !== right.layout ||
      left.embedded !== right.embedded
    )
      return false;
  }

  return true;
}

const EMPTY_HOST_VIEWS: HostViewEntry[] = [];
const emptyStore = {
  subscribe: () => () => undefined,
  getSnapshot: () => EMPTY_HOST_VIEWS,
};

// The list is rebuilt when the views change, not on every render of the
// picker (which follows each keystroke of its search box); an unchanged list
// keeps its identity.
function createStore(views: YDatabaseViews) {
  let snapshot: HostViewEntry[] | null = null;
  const read = () => {
    const next = readHostViews(views);

    if (!snapshot || !sameHostViews(snapshot, next)) snapshot = next;
    return snapshot;
  };

  return {
    getSnapshot: () => snapshot ?? read(),
    subscribe: (notify: () => void) => {
      const onChange = () => {
        read();
        notify();
      };

      views.observeDeep(onChange);
      // Changes between the render and the subscription are picked up by the
      // snapshot check React runs right after subscribing.
      read();
      return () => views.unobserveDeep(onChange);
    },
  };
}

/** Live list of the host database's views. */
export function useHostViews(database: YDatabase | undefined): HostViewEntry[] {
  const views = database?.get(YjsDatabaseKey.views);
  const store = useMemo(() => (views ? createStore(views) : emptyStore), [views]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
