import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef } from 'react';

import { useGridGroupingSelector } from '@/application/database-yjs';
import type { GridGrouping } from '@/application/database-yjs';
import { useSyncGridGroupColumnsDispatch } from '@/application/database-yjs/dispatch';
import { consumeLocalGridGroupInitialization } from '@/application/database-yjs/group-column';

const GridGroupingContext = createContext<GridGrouping | undefined>(undefined);

export function useGridGrouping() {
  const grouping = useContext(GridGroupingContext);

  if (!grouping) throw new Error('useGridGrouping must be used within GridGroupingProvider');

  return grouping;
}

export function useSyncGridGroupingMetadata(grouping: GridGrouping) {
  const syncGroupColumns = useSyncGridGroupColumnsDispatch(grouping.groupId);
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

    // activeGroupIds may include values read only from stale seed docs. The
    // selector exposes a separate persisted-plus-live list for shared writes.
    syncGroupColumns(metadataGroupIdsRef.current);

    const initializationGroup = metadataInitializationGroupRef.current;

    if (initializationGroup) consumeLocalGridGroupInitialization(initializationGroup);
  }, [
    grouping.isGrouped,
    grouping.metadataSyncKey,
    grouping.ready,
    hasMetadataGroupIds,
    hasPendingMetadataInitialization,
    syncGroupColumns,
  ]);
}

export function GridGroupingProvider({ children }: { children: ReactNode }) {
  const grouping = useGridGroupingSelector();

  useSyncGridGroupingMetadata(grouping);

  return <GridGroupingContext.Provider value={grouping}>{children}</GridGroupingContext.Provider>;
}
