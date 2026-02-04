import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useDatabase, useDatabaseViewsSelector } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { Board } from '@/components/database/board';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import { DatabaseTabs } from '@/components/database/components/tabs';
import UnsupportedView from '@/components/database/components/UnsupportedView';
import { Calendar } from '@/components/database/fullcalendar';
import { Grid } from '@/components/database/grid';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';

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
  // Debug logging will be added inside the component
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
  const database = useDatabase();
  const views = database?.get(YjsDatabaseKey.views);

  const [layout, setLayout] = useState<DatabaseViewLayout | null>(null);
  // Track the previous valid layout to prevent flash when switching to a new view
  const prevLayoutRef = useRef<DatabaseViewLayout | null>(null);

  const value = useMemo(() => {
    return Math.max(
      0,
      viewIds.findIndex((id) => id === activeViewId)
    );
  }, [activeViewId, viewIds]);

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
    const fromSelector = childViews[value];

    if (fromSelector) return fromSelector;

    // Fallback: try to get view directly from Yjs map
    // This handles newly created views before useDatabaseViewsSelector updates
    return views?.get(activeViewId);
  }, [childViews, value, views, activeViewId]);

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

  return (
    <>
      <DatabaseConditionsContext.Provider
        value={{
          expanded: conditionsExpanded,
          toggleExpanded,
          setExpanded,
          openFilterId,
          setOpenFilterId,
          isAdvancedMode,
          setAdvancedMode,
        }}
      >
        <DatabaseTabs
          viewName={viewName}
          databasePageId={databasePageId}
          selectedViewId={activeViewId}
          setSelectedViewId={handleViewChange}
          viewIds={viewIds}
          onViewAddedToDatabase={onViewAdded}
          onViewIdsChanged={onViewIdsChanged}
        />

        <DatabaseConditions />

        <div
          className={'relative flex h-full w-full flex-1 flex-col overflow-hidden'}
          style={
            fixedHeight !== undefined
              ? { height: `${fixedHeight}px`, maxHeight: `${fixedHeight}px` }
              : undefined
          }
        >
          <div
            className='h-full w-full'
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
