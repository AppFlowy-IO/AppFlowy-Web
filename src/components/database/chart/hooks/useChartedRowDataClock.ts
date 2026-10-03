import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { YDoc, YjsEditorKey } from '@/application/types';

import { ChartWatchedRowData, touchesChartedRowData } from './chartCompute';

/**
 * A clock that bumps when a cell the chart reads changes in a charted row.
 *
 * Row docs are mutated in place: editing a cell the chart reads (a value typed
 * into a table next to this chart on a dashboard, or a collaborator's edit)
 * changes neither the row orders nor the row map. This observes the row data
 * and bumps at most once per frame. Only the cells in `watched` count (edits
 * in other columns, row height or the last-modified stamp do not); `watched`
 * is read through a ref, so a settings change never re-subscribes.
 *
 * `docs` must keep its identity while the charted docs are the same, or every
 * row is unobserved and observed again.
 */
export function useChartedRowDataClock(docs: readonly YDoc[], watched: ChartWatchedRowData, enabled: boolean): number {
  const [clock, setClock] = useState(0);
  const watchedRef = useRef(watched);

  // After commit, not during render: a render React discards (the chart is
  // lazy-loaded under Suspense) must not leave the observers reading its fields.
  useLayoutEffect(() => {
    watchedRef.current = watched;
  }, [watched]);

  useEffect(() => {
    if (!enabled) return;
    let frame: number | null = null;
    const handleChange = (events: Y.YEvent[]) => {
      const touchesRowData = events.some((event) => touchesChartedRowData(event, watchedRef.current));

      if (!touchesRowData || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setClock((value) => value + 1);
      });
    };

    const roots = docs.map((doc) => doc.getMap(YjsEditorKey.data_section));

    roots.forEach((root) => root.observeDeep(handleChange));
    return () => {
      roots.forEach((root) => root.unobserveDeep(handleChange));
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [docs, enabled]);

  return clock;
}

export default useChartedRowDataClock;
