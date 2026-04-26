import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ErrorBoundary } from 'react-error-boundary';

import { useDatabase, useDatabaseContext, useDatabaseViewsSelector } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { Board } from '@/components/database/board';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import { DatabaseTabs } from '@/components/database/components/tabs';
import UnsupportedView from '@/components/database/components/UnsupportedView';
import { Calendar } from '@/components/database/fullcalendar';
import { Grid } from '@/components/database/grid';
import { shouldUseFixedDatabaseViewport } from '@/components/database/layout';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';
import { cn } from '@/lib/utils';
import {
  insertViewIdAfter,
  readStoredViewOrder,
  reconcileOrderedViewIds,
  selectHydratingViewOrder,
  selectStableViewOrder,
  writeStoredViewOrder,
} from '@/utils/database-view-order';

import DatabaseConditions from 'src/components/database/components/conditions/DatabaseConditions';

function DatabaseViews({
  onChangeView,
  onViewAdded,
  activeViewId,
  databasePageId,
  viewName,
  visibleViewIds,
  fixedHeight,
  onViewIdsChanged,
}: {
  onChangeView: (viewId: string) => void;
  /**
   * Called when a new view is added via the + button.
   * Used by embedded databases to immediately update state before Yjs sync.
   */
  onViewAdded?: (viewId: string) => void;
  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Changes when the user switches between different view tabs.
   */
  activeViewId: string;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  viewName?: string;
  visibleViewIds?: string[];
  fixedHeight?: number;
  /**
   * Callback when view IDs change (views added or removed).
   * Used to update the block data in embedded database blocks.
   */
  onViewIdsChanged?: (viewIds: string[]) => void;
}) {
  const { childViews, viewIds } = useDatabaseViewsSelector(databasePageId, visibleViewIds);
  const { isDocumentBlock, variant } = useDatabaseContext();
  const database = useDatabase();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const [orderedViewIds, setOrderedViewIds] = useState<string[]>([]);
  const orderedViewIdsRef = useRef<string[]>([]);
  const orderedDatabaseIdRef = useRef<string | undefined>();
  const pendingViewCreationRef = useRef(false);
  const pendingExpectedViewIdsRef = useRef<string[] | null>(null);
  const pendingViewInsertionRef = useRef<{ anchorViewId: string; baseViewIds: string[] } | null>(null);

  const [layout, setLayout] = useState<DatabaseViewLayout | null>(null);
  // Track the previous valid layout to prevent flash when switching to a new view
  const prevLayoutRef = useRef<DatabaseViewLayout | null>(null);

  const fallbackViewIds = useMemo(() => {
    if (!visibleViewIds || visibleViewIds.length === 0) {
      return viewIds;
    }

    const getCreatedAtSortValue = (viewId: string): number => {
      const createdAt = views?.get(viewId)?.get(YjsDatabaseKey.created_at);

      if (!createdAt) {
        return Number.POSITIVE_INFINITY;
      }

      const numericValue = Number(createdAt);

      if (Number.isFinite(numericValue)) {
        return numericValue;
      }

      const timestampValue = Date.parse(createdAt);

      return Number.isFinite(timestampValue) ? timestampValue : Number.POSITIVE_INFINITY;
    };

    return [...viewIds].sort((left, right) => getCreatedAtSortValue(left) - getCreatedAtSortValue(right));
  }, [viewIds, views, visibleViewIds]);

  useEffect(() => {
    const isNewDatabase = orderedDatabaseIdRef.current !== databaseId;
    const storedViewIds = readStoredViewOrder(databaseId);
    const previousViewIds = orderedViewIdsRef.current;

    orderedDatabaseIdRef.current = databaseId;

    const hydratingViewIds = selectHydratingViewOrder({
      incomingViewIds: viewIds,
      previousViewIds,
      storedViewIds,
      isNewDatabase,
    });

    if (hydratingViewIds) {
      orderedViewIdsRef.current = hydratingViewIds;
      setOrderedViewIds(hydratingViewIds);
      return;
    }

    const pendingExpectedViewIds = pendingExpectedViewIdsRef.current;

    if (pendingViewCreationRef.current) {
      return;
    }

    const baseViewIds =
      pendingExpectedViewIds && pendingExpectedViewIds.every((viewId) => viewIds.includes(viewId))
        ? pendingExpectedViewIds
        : storedViewIds && storedViewIds.length > 0
        ? storedViewIds
        : isNewDatabase
        ? fallbackViewIds
        : previousViewIds.length > 0
        ? previousViewIds
        : fallbackViewIds;

    if (pendingExpectedViewIds && pendingExpectedViewIds.some((viewId) => !viewIds.includes(viewId))) {
      return;
    }

    const nextViewIds = reconcileOrderedViewIds(baseViewIds, viewIds);

    if (pendingExpectedViewIds && pendingExpectedViewIds.every((viewId) => nextViewIds.includes(viewId))) {
      pendingExpectedViewIdsRef.current = null;
    }

    orderedViewIdsRef.current = nextViewIds;
    writeStoredViewOrder(databaseId, nextViewIds);
    setOrderedViewIds(nextViewIds);
  }, [databaseId, fallbackViewIds, viewIds]);

  const [conditionsExpanded, setConditionsExpanded] = useState<boolean>(false);
  const toggleExpanded = useCallback(() => {
    setConditionsExpanded((prev) => !prev);
  }, []);
  const setExpanded = useCallback((expanded: boolean) => {
    setConditionsExpanded(expanded);
  }, []);
  const [openFilterId, setOpenFilterId] = useState<string>();

  // Advanced filter mode state
  const [isAdvancedMode, setAdvancedMode] = useState(false);

  // Auto-detect advanced mode on mount/view change and auto-expand when filters exist
  useEffect(() => {
    if (!activeViewId || !views) return;

    const view = views.get(activeViewId);

    if (!view) return;

    const filters = view.get(YjsDatabaseKey.filters);

    if (!filters || filters.length === 0) {
      setAdvancedMode(false);
      return;
    }

    // Auto-expand when filters exist (from desktop sync or any source)
    setConditionsExpanded(true);

    const rootFilter = filters.get(0);

    if (!rootFilter) {
      setAdvancedMode(false);
      return;
    }

    // Handle both Yjs Map (with .get() method) and plain object (from desktop sync)
    const isYjsMap = typeof (rootFilter as { get?: unknown }).get === 'function';
    const filterType = isYjsMap
      ? Number((rootFilter as { get: (key: string) => unknown }).get(YjsDatabaseKey.filter_type))
      : Number((rootFilter as unknown as Record<string, unknown>)[YjsDatabaseKey.filter_type]);

    if (filterType === FilterType.And || filterType === FilterType.Or) {
      setAdvancedMode(true);
    } else {
      setAdvancedMode(false);
    }
  }, [activeViewId, views]);

  // Get active view from selector state, or directly from Yjs if not yet in state
  // This handles the race condition when a new view is created but selector hasn't updated yet
  const activeView = useMemo(() => {
    const fromYjs = views?.get(activeViewId);

    if (fromYjs) return fromYjs;

    const selectorIndex = viewIds.indexOf(activeViewId);
    const fromSelector = selectorIndex === -1 ? undefined : childViews[selectorIndex];

    if (fromSelector) return fromSelector;

    // Fallback: try to get view directly from Yjs map
    // This handles newly created views before useDatabaseViewsSelector updates
    return views?.get(activeViewId);
  }, [activeViewId, childViews, viewIds, views]);

  // Update layout when active view changes
  useEffect(() => {
    if (!activeView) return;

    const observerEvent = () => {
      const newLayout = Number(activeView.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;

      setLayout(newLayout);
      prevLayoutRef.current = newLayout;
    };

    observerEvent();
    activeView.observe(observerEvent);

    return () => {
      activeView.unobserve(observerEvent);
    };
  }, [activeView]);

  const handleViewChange = useCallback(
    (newViewId: string) => {
      onChangeView(newViewId);
    },
    [onChangeView]
  );

  const handleBeforeViewAddedToDatabase = useCallback(() => {
    const storedViewIds = readStoredViewOrder(databaseId);
    const baseViewIds =
      orderedViewIdsRef.current.length > 0
        ? orderedViewIdsRef.current
        : storedViewIds && storedViewIds.length > 0
        ? storedViewIds
        : fallbackViewIds;

    pendingViewCreationRef.current = true;
    pendingViewInsertionRef.current = {
      anchorViewId: activeViewId,
      baseViewIds,
    };
  }, [activeViewId, databaseId, fallbackViewIds]);

  const handleAfterViewAddedToDatabase = useCallback(() => {
    pendingViewCreationRef.current = false;
    pendingViewInsertionRef.current = null;
  }, []);

  const handleViewAddedToDatabase = useCallback(
    (newViewId: string) => {
      const storedViewIds = readStoredViewOrder(databaseId);
      const pendingViewInsertion = pendingViewInsertionRef.current;
      const baseViewIds =
        pendingViewInsertion?.baseViewIds ??
        selectStableViewOrder({
          previousViewIds: orderedViewIdsRef.current,
          storedViewIds,
          fallbackViewIds,
          pendingViewId: newViewId,
        });
      const anchorViewId = pendingViewInsertion?.anchorViewId ?? activeViewId;
      const nextViewIds = insertViewIdAfter(baseViewIds, anchorViewId, newViewId);

      pendingExpectedViewIdsRef.current = nextViewIds;
      orderedViewIdsRef.current = nextViewIds;
      writeStoredViewOrder(databaseId, nextViewIds);
      flushSync(() => {
        setOrderedViewIds(nextViewIds);
      });
      onViewAdded?.(newViewId);
    },
    [activeViewId, databaseId, fallbackViewIds, onViewAdded]
  );

  const displayedViewIds = orderedViewIds.length > 0 ? orderedViewIds : viewIds;

  // Render the appropriate view component based on layout
  // Use previous layout as fallback to prevent flash during view transitions
  const effectiveLayout = layout ?? prevLayoutRef.current;

  const view = useMemo(() => {
    switch (effectiveLayout) {
      case DatabaseViewLayout.Grid:
        return <Grid />;
      case DatabaseViewLayout.Board:
        return <Board />;
      case DatabaseViewLayout.Calendar:
        return <Calendar />;
      case DatabaseViewLayout.Chart:
      case DatabaseViewLayout.List:
      case DatabaseViewLayout.Gallery:
        return <UnsupportedView />;
      default:
        return null;
    }
  }, [effectiveLayout]);
  const shouldUseFixedViewport = shouldUseFixedDatabaseViewport({
    embeddedHeight: fixedHeight,
    isDocumentBlock,
    variant,
  });
  const databaseConditionsValue = useMemo(
    () => ({
      expanded: conditionsExpanded,
      toggleExpanded,
      setExpanded,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode,
      setAdvancedMode,
    }),
    [
      conditionsExpanded,
      toggleExpanded,
      setExpanded,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode,
      setAdvancedMode,
    ]
  );

  return (
    <>
      <DatabaseConditionsContext.Provider value={databaseConditionsValue}>
        <DatabaseTabs
          viewName={viewName}
          databasePageId={databasePageId}
          selectedViewId={activeViewId}
          setSelectedViewId={handleViewChange}
          viewIds={displayedViewIds}
          onViewAddedToDatabase={handleViewAddedToDatabase}
          onBeforeViewAddedToDatabase={handleBeforeViewAddedToDatabase}
          onAfterViewAddedToDatabase={handleAfterViewAddedToDatabase}
          onViewIdsChanged={onViewIdsChanged}
        />

        <DatabaseConditions />

        <div
          className={cn(
            'relative flex w-full flex-col',
            shouldUseFixedViewport ? 'h-full flex-1 overflow-hidden' : 'overflow-visible'
          )}
          style={
            fixedHeight !== undefined
              ? { height: `${fixedHeight}px`, maxHeight: `${fixedHeight}px` }
              : undefined
          }
        >
          <div
            className={cn('w-full', shouldUseFixedViewport && 'h-full')}
            style={
              fixedHeight !== undefined
                ? { height: `${fixedHeight}px`, maxHeight: `${fixedHeight}px` }
                : undefined
            }
          >
            <Suspense fallback={null}>
              <ErrorBoundary fallbackRender={ElementFallbackRender}>{view}</ErrorBoundary>
            </Suspense>
          </div>
        </div>
      </DatabaseConditionsContext.Provider>
    </>
  );
}

export default DatabaseViews;
