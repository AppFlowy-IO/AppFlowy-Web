import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { YDoc, YjsEditorKey } from '@/application/types';

import { ChartWatchedRowData, touchesChartedRowData } from './chartCompute';

/** The data section of a row doc, which the observers are attached to. */
type RowDataRoot = ReturnType<YDoc['getMap']>;

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
 * The observers follow `docs` one doc at a time: when the loader swaps a
 * seeded row's doc for its live doc, a batch at a time, only the swapped docs
 * are unobserved and observed, not every charted row.
 */
export function useChartedRowDataClock(docs: readonly YDoc[], watched: ChartWatchedRowData, enabled: boolean): number {
  const [clock, setClock] = useState(0);
  const watchedRef = useRef(watched);
  /** The observed data section per charted doc. */
  const observedRef = useRef(new Map<YDoc, RowDataRoot>());
  const frameRef = useRef<number | null>(null);

  // After commit, not during render: a render React discards (the chart is
  // lazy-loaded under Suspense) must not leave the observers reading its fields.
  useLayoutEffect(() => {
    watchedRef.current = watched;
  }, [watched]);

  // One handler for the hook's lifetime: an observer is removed with the function it was added with.
  const handleChange = useCallback((events: Y.YEvent[]) => {
    const touchesRowData = events.some((event) => touchesChartedRowData(event, watchedRef.current));

    if (!touchesRowData || frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setClock((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    const observed = observedRef.current;
    const kept = enabled ? new Set(docs) : null;

    observed.forEach((root, doc) => {
      if (kept?.has(doc)) return;
      root.unobserveDeep(handleChange);
      observed.delete(doc);
    });
    if (!kept) return;
    docs.forEach((doc) => {
      if (observed.has(doc)) return;
      const root = doc.getMap(YjsEditorKey.data_section);

      root.observeDeep(handleChange);
      observed.set(doc, root);
    });
  }, [docs, enabled, handleChange]);

  // Unmount: every observer, and a bump that is still due.
  useEffect(
    () => () => {
      const observed = observedRef.current;

      observed.forEach((root) => root.unobserveDeep(handleChange));
      observed.clear();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [handleChange]
  );

  return clock;
}

export default useChartedRowDataClock;
