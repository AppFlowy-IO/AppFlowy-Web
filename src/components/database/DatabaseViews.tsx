import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useDatabase, useDatabaseViewsSelector } from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { Board } from '@/components/database/board';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import { DatabaseTabs } from '@/components/database/components/tabs';
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
  const [openFilterId, setOpenFilterId] = useState<string>();

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
          openFilterId,
          setOpenFilterId,
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
