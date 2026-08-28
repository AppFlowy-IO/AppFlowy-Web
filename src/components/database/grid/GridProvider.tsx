import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import type { GridGrouping } from '@/application/database-yjs';
import {
  EMBEDDED_GRID_INITIAL_ROW_LIMIT,
  EMBEDDED_GRID_LOAD_MORE_INCREMENT,
  useRenderRows,
} from '@/components/database/components/grid/grid-row';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import { useDatabaseHistoryScope } from '@/components/database/databaseHistoryScopeCoordinator';
import { useDatabaseHistoryScopeContext } from '@/components/database/DatabaseHistoryScope';
import {
  createGridInteractionStore,
  createGridRowResizeStore,
  GridContext,
  GridInteractionContext,
} from '@/components/database/grid/useGridContext';

type GridProviderProps = {
  children: ReactNode;
  grouping: GridGrouping;
};

type GridProviderContentProps = GridProviderProps & {
  activateHistoryScope: () => void;
  clearHistoryScope?: () => void;
  historyScopeId: string;
  ownsHistoryScope: boolean;
};

export const GridProvider = (props: GridProviderProps) => {
  const inheritedHistoryScope = useDatabaseHistoryScopeContext();

  if (inheritedHistoryScope) {
    return (
      <GridProviderContent
        {...props}
        activateHistoryScope={inheritedHistoryScope.activateHistoryScope}
        historyScopeId={inheritedHistoryScope.historyScopeId}
        ownsHistoryScope={false}
      />
    );
  }

  return <StandaloneGridProvider {...props} />;
};

function StandaloneGridProvider(props: GridProviderProps) {
  const { readOnly } = useDatabaseContext();
  const { activateHistoryScope, clearHistoryScope, historyScopeId } = useDatabaseHistoryScope({ enabled: !readOnly });

  return (
    <GridProviderContent
      {...props}
      activateHistoryScope={activateHistoryScope}
      clearHistoryScope={clearHistoryScope}
      historyScopeId={historyScopeId}
      ownsHistoryScope
    />
  );
}

function GridProviderContent({
  activateHistoryScope,
  children,
  clearHistoryScope,
  grouping,
  historyScopeId,
  ownsHistoryScope,
}: GridProviderContentProps) {
  const { rowOrders } = grouping;
  const [activePropertyId, setActivePropertyId] = useState<string | undefined>();
  const { isDocumentBlock, activeViewId } = useDatabaseContext();
  // Each database view owns independent transient interaction state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const interactionStore = useMemo(() => createGridInteractionStore(), [activeViewId]);
  // Discard buffered measurements when switching views.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowResizeStore = useMemo(() => createGridRowResizeStore(), [activeViewId]);
  const [visibleRowLimit, setVisibleRowLimit] = useState(EMBEDDED_GRID_INITIAL_ROW_LIMIT);
  const embeddedVisibleRowLimit = isDocumentBlock ? visibleRowLimit : undefined;
  const {
    rows: initialRows,
    remainingRowCount,
    lastVisibleRowId,
  } = useRenderRows(rowOrders, {
    grouping,
    visibleRowLimit: embeddedVisibleRowLimit,
  });
  const initialRowsRef = useRef(initialRows);

  // Publish the latest committed render rows for DnD callbacks. Updating this
  // ref during render would expose data from an interrupted concurrent render.
  useLayoutEffect(() => {
    initialRowsRef.current = initialRows;
  }, [initialRows]);
  const [optimisticRows, setOptimisticRows] = useState<{ base: RenderRow[]; value: RenderRow[] } | null>(null);
  const rows = grouping.isGrouped || optimisticRows?.base !== initialRows ? initialRows : optimisticRows.value;
  const setRows = useCallback((value: RenderRow[]) => {
    setOptimisticRows({ base: initialRowsRef.current, value });
  }, []);
  const isWheelingRef = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleRowLimit(EMBEDDED_GRID_INITIAL_ROW_LIMIT);
    clearHistoryScope?.();
  }, [activeViewId, clearHistoryScope, isDocumentBlock]);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    let timeoutId: NodeJS.Timeout | null = null;

    const onWheel = () => {
      timeoutId && clearTimeout(timeoutId);
      isWheelingRef.current = true;
      interactionStore.setHoverRowKey(undefined);

      timeoutId = setTimeout(() => {
        isWheelingRef.current = false;
      }, 300);
    };

    const listenerOptions: AddEventListenerOptions = { passive: true };

    element.addEventListener('wheel', onWheel, listenerOptions);

    return () => {
      element.removeEventListener('wheel', onWheel, listenerOptions);
      if (timeoutId) clearTimeout(timeoutId);
      isWheelingRef.current = false;
    };
  }, [interactionStore]);

  const handleHoverRowStart = useCallback(
    (rowKey?: string) => {
      if (isWheelingRef.current) {
        return;
      }

      interactionStore.setHoverRowKey(rowKey);
    },
    [interactionStore]
  );

  const handleSetActiveCell = useCallback(
    (nextActiveCell: ReturnType<typeof interactionStore.getActiveCell>) => {
      interactionStore.setActiveCell(nextActiveCell);

      if (nextActiveCell) activateHistoryScope();
    },
    [activateHistoryScope, interactionStore]
  );
  const restoreHistoryFocus = activateHistoryScope;

  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((prev) => prev + EMBEDDED_GRID_LOAD_MORE_INCREMENT);
  }, []);

  const revealCreatedRow = useCallback(() => {
    if (!isDocumentBlock) return;

    setVisibleRowLimit((prev) => prev + 1);
  }, [isDocumentBlock]);

  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const contextValue = useMemo(
    () => ({
      rowOrders,
      rows,
      setRows,
      activePropertyId,
      setActivePropertyId,
      rowResizeStore,
      remainingRowCount,
      lastVisibleRowId,
      loadMoreRows,
      revealCreatedRow,
      showStickyHeader,
      setShowStickyHeader,
      isGrouped: grouping.isGrouped,
    }),
    [
      rowOrders,
      rows,
      setRows,
      activePropertyId,
      rowResizeStore,
      remainingRowCount,
      lastVisibleRowId,
      loadMoreRows,
      revealCreatedRow,
      showStickyHeader,
      grouping.isGrouped,
    ]
  );
  const interactionContextValue = useMemo(
    () => ({
      historyScopeId,
      restoreHistoryFocus,
      setActiveCell: handleSetActiveCell,
      setHoverRowKey: handleHoverRowStart,
      store: interactionStore,
    }),
    [handleHoverRowStart, handleSetActiveCell, historyScopeId, interactionStore, restoreHistoryFocus]
  );

  return (
    <GridContext.Provider value={contextValue}>
      <GridInteractionContext.Provider value={interactionContextValue}>
        <div
          ref={ref}
          data-database-history-scope={ownsHistoryScope ? historyScopeId : undefined}
          className={'flex min-h-0 flex-1 flex-col'}
        >
          {children}
        </div>
      </GridInteractionContext.Provider>
    </GridContext.Provider>
  );
}
