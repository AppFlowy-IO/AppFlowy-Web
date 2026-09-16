import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { createTimelineRowValuesStore, ParseTimelineRow } from '../timeline-row-values-store';

import { useTimelineRowSource } from './TimelineRowValuesProvider';

/** Project row values from the view's single loader; the store owns change batching. */
export function useTimelineRowValuesSnapshot<T>(parse: ParseTimelineRow<T>) {
  const { scope, rowIds, rows, getCachedRowDocs, subscribeToCachedRowDocChanges } = useTimelineRowSource();
  const store = useMemo(
    () => createTimelineRowValuesStore(parse),
    // A parser can be reused across views; its cached rows belong to this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, parse]
  );

  useLayoutEffect(() => {
    store.syncRows(rowIds, rows);
  }, [rowIds, rows, store]);
  useLayoutEffect(() => {
    const unsubscribe = subscribeToCachedRowDocChanges(store.applyCachedRowsChange);

    store.applyCachedRowsChange({ added: getCachedRowDocs(), removed: {} });
    return () => {
      unsubscribe();
      store.dispose();
    };
  }, [getCachedRowDocs, store, subscribeToCachedRowDocChanges]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useTimelineRowValues<T>(parse: ParseTimelineRow<T>): Map<string, T> {
  return useTimelineRowValuesSnapshot(parse).values;
}
