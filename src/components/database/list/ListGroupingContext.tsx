import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef } from 'react';

import { useListGroupingSelector } from '@/application/database-yjs';
import type { DatabaseGrouping } from '@/application/database-yjs';
import { useSyncListGroupColumnsDispatch } from '@/application/database-yjs/dispatch';
import { consumeLocalDatabaseGroupInitialization } from '@/application/database-yjs/group-column';

const ListGroupingContext = createContext<DatabaseGrouping | undefined>(undefined);

export function useListGrouping() {
  const grouping = useContext(ListGroupingContext);

  if (!grouping) throw new Error('useListGrouping must be used within ListGroupingProvider');

  return grouping;
}

export function useSyncListGroupingMetadata(grouping: DatabaseGrouping) {
  const syncGroupColumns = useSyncListGroupColumnsDispatch(grouping.groupId);
  const metadataGroupIdsRef = useRef(grouping.metadataGroupIds ?? grouping.activeGroupIds);
  const metadataInitializationGroupRef = useRef(grouping.metadataInitializationGroup);
  const hasMetadataGroupIds = grouping.metadataGroupIds !== undefined;
  const hasPendingMetadataInitialization = grouping.metadataInitializationGroup !== undefined;

  useLayoutEffect(() => {
    metadataGroupIdsRef.current = grouping.metadataGroupIds ?? grouping.activeGroupIds;
    metadataInitializationGroupRef.current = grouping.metadataInitializationGroup;
  }, [grouping.activeGroupIds, grouping.metadataGroupIds, grouping.metadataInitializationGroup]);

  useEffect(() => {
    if (!grouping.isGrouped || !grouping.ready || !hasMetadataGroupIds) return;

    syncGroupColumns(metadataGroupIdsRef.current);

    const initializationGroup = metadataInitializationGroupRef.current;

    if (initializationGroup) consumeLocalDatabaseGroupInitialization(initializationGroup);
  }, [
    grouping.isGrouped,
    grouping.metadataSyncKey,
    grouping.ready,
    hasMetadataGroupIds,
    hasPendingMetadataInitialization,
    syncGroupColumns,
  ]);
}

/** Share one List grouping selector between the renderer and its settings. */
export function ListGroupingProvider({ children, value }: { children: ReactNode; value?: DatabaseGrouping }) {
  const selectedGrouping = useListGroupingSelector();
  const grouping = value ?? selectedGrouping;

  useSyncListGroupingMetadata(grouping);

  return <ListGroupingContext.Provider value={grouping}>{children}</ListGroupingContext.Provider>;
}
