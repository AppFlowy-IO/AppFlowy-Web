import { createContext, ReactNode, useContext } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { DatabaseGrouping, useDatabaseGroupingSelector } from '@/application/database-yjs/selector';
import { DatabaseViewLayout } from '@/application/types';
import { useSyncGridGroupingMetadata } from '@/components/database/grid/GridGroupingContext';

const Context = createContext<DatabaseGrouping | undefined>(undefined);

export function TimelineGroupingProvider({ children }: { children: ReactNode }) {
  const grouping = useDatabaseGroupingSelector(DatabaseViewLayout.Timeline);
  const { readOnly, canWrite } = useDatabaseContext();

  useSyncGridGroupingMetadata(grouping, !readOnly && canWrite !== false);
  return <Context.Provider value={grouping}>{children}</Context.Provider>;
}

export function useTimelineGrouping() {
  const grouping = useContext(Context);

  if (!grouping) throw new Error('Timeline grouping provider is required');
  return grouping;
}
