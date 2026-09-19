import { useCallback, useMemo, useSyncExternalStore } from 'react';

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

const noopSubscribe = () => () => undefined;

/** Live list of the host database's views. */
export function useHostViews(database: YDatabase | undefined): HostViewEntry[] {
  const views = database?.get(YjsDatabaseKey.views);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!views) return noopSubscribe();
      views.observeDeep(notify);
      return () => views.unobserveDeep(notify);
    },
    [views]
  );
  const getSnapshot = useCallback(() => JSON.stringify(readHostViews(views)), [views]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => JSON.parse(raw) as HostViewEntry[], [raw]);
}
