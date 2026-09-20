import { createContext, type ReactNode, useContext } from 'react';

import { useTimelineGroupingSelector } from '@/application/database-yjs';
import type { DatabaseGrouping } from '@/application/database-yjs';
import { useSyncListGroupingMetadata } from '@/components/database/list/ListGroupingContext';

const TimelineGroupingContext = createContext<DatabaseGrouping | undefined>(undefined);

export function useTimelineGrouping() {
  const grouping = useContext(TimelineGroupingContext);

  if (!grouping) throw new Error('useTimelineGrouping must be used within TimelineGroupingProvider');

  return grouping;
}

/**
 * One grouping selector shared by the timeline renderer and its settings.
 * Group metadata (ids, order, collapsed state) is stored on the view exactly
 * as the List and Grid store theirs, so their sync hook is reused.
 */
export function TimelineGroupingProvider({ children, value }: { children: ReactNode; value?: DatabaseGrouping }) {
  const selectedGrouping = useTimelineGroupingSelector();
  const grouping = value ?? selectedGrouping;

  useSyncListGroupingMetadata(grouping);

  return <TimelineGroupingContext.Provider value={grouping}>{children}</TimelineGroupingContext.Provider>;
}
