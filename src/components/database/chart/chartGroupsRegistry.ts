import { useCallback, useSyncExternalStore } from 'react';

import type { ChartGroupSummary } from '@/application/database-yjs/chart-config';

/**
 * The groups each mounted chart draws, by view id: `ChartProvider` publishes
 * them and the settings panel's Groups page reads them, so the page works in
 * any host (the standalone gear menu or a dashboard widget's settings).
 */
const groupsByView = new Map<string, ChartGroupSummary[]>();
const listeners = new Map<string, Set<() => void>>();

function notify(viewId: string) {
  listeners.get(viewId)?.forEach((listener) => listener());
}

export function setChartGroups(viewId: string, groups: ChartGroupSummary[]) {
  if (groupsByView.get(viewId) === groups) return;
  groupsByView.set(viewId, groups);
  notify(viewId);
}

/** Forget a chart's groups when it unmounts, unless another chart has published since. */
export function clearChartGroups(viewId: string, groups?: ChartGroupSummary[]) {
  if (!groupsByView.has(viewId)) return;
  if (groups && groupsByView.get(viewId) !== groups) return;
  groupsByView.delete(viewId);
  notify(viewId);
}

export function getChartGroups(viewId: string | null | undefined): ChartGroupSummary[] | undefined {
  return viewId ? groupsByView.get(viewId) : undefined;
}

function subscribe(viewId: string, listener: () => void) {
  const set = listeners.get(viewId) ?? new Set();

  set.add(listener);
  listeners.set(viewId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(viewId);
  };
}

/** The groups the chart of `viewId` draws; `undefined` while no chart of it is mounted. */
export function useChartGroups(viewId: string | null | undefined): ChartGroupSummary[] | undefined {
  const subscribeToView = useCallback(
    (listener: () => void) => (viewId ? subscribe(viewId, listener) : () => undefined),
    [viewId]
  );

  return useSyncExternalStore(
    subscribeToView,
    () => getChartGroups(viewId),
    () => getChartGroups(viewId)
  );
}
