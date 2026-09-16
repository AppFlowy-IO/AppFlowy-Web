import { createContext, ReactNode, useContext, useMemo } from 'react';

import { YDoc } from '@/application/types';

import { useDatabaseContext, useDatabaseViewId, useRowMap } from '../context';

import { useBackgroundRowDocLoader } from './useBackgroundRowDocLoader';

import type { Row } from '../selector';

const EMPTY_ROWS: Record<string, YDoc> = {};

interface TimelineRowSource {
  scope: object;
  /** Shared filtered/sorted membership; undefined means it is still loading. */
  rowOrders: Row[] | undefined;
  rowIds: readonly string[] | undefined;
  rows: Record<string, YDoc>;
  getCachedRowDocs: ReturnType<typeof useBackgroundRowDocLoader>['getCachedRowDocs'];
  subscribeToCachedRowDocChanges: ReturnType<typeof useBackgroundRowDocLoader>['subscribeToCachedRowDocChanges'];
}

const TimelineRowSourceContext = createContext<TimelineRowSource | null>(null);

/** One loader owner for bars, property values, and complete-view calculations. */
export function TimelineRowValuesProvider({
  rowOrders,
  children,
}: {
  rowOrders: Row[] | undefined;
  children: ReactNode;
}) {
  const { databaseDoc } = useDatabaseContext();
  const viewId = useDatabaseViewId();
  const rows = useRowMap() ?? EMPTY_ROWS;
  const { getCachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(true, 'timeline');
  const scope = useMemo(() => ({ databaseDoc, viewId }), [databaseDoc, viewId]);
  const rowIds = useMemo(() => rowOrders?.map(({ id }) => id), [rowOrders]);
  const value = useMemo(
    () => ({ scope, rowOrders, rowIds, rows, getCachedRowDocs, subscribeToCachedRowDocChanges }),
    [scope, rowOrders, rowIds, rows, getCachedRowDocs, subscribeToCachedRowDocChanges]
  );

  return <TimelineRowSourceContext.Provider value={value}>{children}</TimelineRowSourceContext.Provider>;
}

export function useTimelineRowSource() {
  const source = useContext(TimelineRowSourceContext);

  if (!source) throw new Error('Timeline row values require TimelineRowValuesProvider');
  return source;
}
