import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';

import { useDatabase, useDatabaseContext, useDatabaseViewsSelector } from '@/application/database-yjs';
import { hasAdvancedFilterRoot } from '@/application/database-yjs/filter';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { type ReorderResult } from '@/components/_shared/reorder/useReorderMonitor';
import { Board } from '@/components/database/board';
import { Chart } from '@/components/database/chart';
import {
  DatabaseConditionsActionsContext,
  DatabaseConditionsContext,
} from '@/components/database/components/conditions/context';
import { DatabaseSearchProvider } from '@/components/database/components/conditions/DatabaseSearchContext';
import { DatabaseTabs } from '@/components/database/components/tabs';
import { Calendar } from '@/components/database/fullcalendar';
import { Grid } from '@/components/database/grid';
import { GridGroupingProvider } from '@/components/database/grid/GridGroupingContext';
import {
  getDatabaseViewportStyle,
  shouldAutoShrinkDatabaseViewport,
  shouldScrollEmbeddedDatabaseViewport,
  shouldUseFixedDatabaseViewport,
} from '@/components/database/layout';
import { ListGroupingProvider } from '@/components/database/list/ListGroupingContext';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';
import { cn } from '@/lib/utils';
import {
  appendViewId,
  readStoredViewOrder,
  reconcileOrderedViewIds,
  selectHydratingViewOrder,
  selectStableViewOrder,
  writeStoredViewOrder,
} from '@/utils/database-view-order';
import { Log } from '@/utils/log';

import DatabaseConditionsPanel from 'src/components/database/components/conditions/DatabaseConditions';

const List = lazy(() => import('@/components/database/list/List'));
const Gallery = lazy(() => import('@/components/database/gallery'));

function DatabaseViews({
  onChangeView,
  onViewAdded,
  activeViewId,
  databasePageId,
  viewName,
  visibleViewIds,
  fixedHeight,
  onViewIdsChanged,
  onReorderViews,
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
  /**
   * Durably persist a tab reorder by moving the view within its folder
   * container. Provided only when the database is backed by a sidebar
   * container (app mode); omitted for embedded/published databases, which
   * fall back to the local (localStorage) tab order.
   */
  onReorderViews?: (movedViewId: string, prevViewId: string | null) => void | Promise<void>;
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
  const pendingViewAppendBaseRef = useRef<string[] | null>(null);
  const tabReorderRequestSeqRef = useRef(0);
  const hasAuthoritativeVisibleOrder = Boolean(visibleViewIds && visibleViewIds.length > 0);

  const fallbackViewIds = useMemo(() => {
    if (hasAuthoritativeVisibleOrder) {
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
  }, [hasAuthoritativeVisibleOrder, viewIds, views]);

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
        : hasAuthoritativeVisibleOrder
        ? fallbackViewIds
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
  }, [databaseId, fallbackViewIds, hasAuthoritativeVisibleOrder, viewIds]);

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
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

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

    setAdvancedMode(hasAdvancedFilterRoot(filters));
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
        : hasAuthoritativeVisibleOrder
        ? fallbackViewIds
        : storedViewIds && storedViewIds.length > 0
        ? storedViewIds
        : fallbackViewIds;

    pendingViewCreationRef.current = true;
    pendingViewAppendBaseRef.current = baseViewIds;
  }, [databaseId, fallbackViewIds, hasAuthoritativeVisibleOrder]);

  const handleAfterViewAddedToDatabase = useCallback(() => {
    pendingViewCreationRef.current = false;
    pendingViewAppendBaseRef.current = null;
  }, []);

  const handleViewAddedToDatabase = useCallback(
    (newViewId: string) => {
      const storedViewIds = readStoredViewOrder(databaseId);
      const baseViewIds =
        pendingViewAppendBaseRef.current ??
        selectStableViewOrder({
          previousViewIds: orderedViewIdsRef.current,
          storedViewIds,
          fallbackViewIds,
          pendingViewId: newViewId,
        });
      const nextViewIds = appendViewId(baseViewIds, newViewId);

      pendingExpectedViewIdsRef.current = nextViewIds;
      orderedViewIdsRef.current = nextViewIds;
      writeStoredViewOrder(databaseId, nextViewIds);
      flushSync(() => {
        setOrderedViewIds(nextViewIds);
      });
      onViewAdded?.(newViewId);
    },
    [databaseId, fallbackViewIds, onViewAdded]
  );

  const handleReorderTabs = useCallback(
    ({ nextIds, movedId, prevId }: ReorderResult) => {
      const previousIds = orderedViewIdsRef.current.length > 0 ? orderedViewIdsRef.current : viewIds;
      const previousPendingExpectedViewIds = pendingExpectedViewIdsRef.current;
      const pendingCreatedViewId = previousPendingExpectedViewIds?.[previousPendingExpectedViewIds.length - 1];
      const isPendingCreationReorder = pendingCreatedViewId === movedId;
      const requestSeq = ++tabReorderRequestSeqRef.current;

      // A newly created duplicate is first appended, then moved next to its
      // source. Keep the pending creation order aligned so the next Yjs
      // reconciliation cannot restore the temporary appended order.
      if (isPendingCreationReorder) {
        pendingExpectedViewIdsRef.current = nextIds;
      }

      // Optimistically apply the new tab order and persist it locally.
      orderedViewIdsRef.current = nextIds;
      setOrderedViewIds(nextIds);
      writeStoredViewOrder(databaseId, nextIds);

      if (!onReorderViews) return;

      // For container-backed databases, also move the view within the folder so
      // the order is durable and stays in sync with the sidebar.
      void (async () => {
        try {
          await onReorderViews(movedId, prevId);
        } catch (error) {
          if (tabReorderRequestSeqRef.current !== requestSeq) return;

          if (isPendingCreationReorder) {
            pendingExpectedViewIdsRef.current = previousPendingExpectedViewIds;
          }

          orderedViewIdsRef.current = previousIds;
          setOrderedViewIds(previousIds);
          writeStoredViewOrder(databaseId, previousIds);
          toast.error('Failed to reorder database views');
          Log.error('[DatabaseViews] Failed to reorder tabs', error);
        }
      })();
    },
    [databaseId, onReorderViews, viewIds]
  );

  const displayedViewIds = orderedViewIds.length > 0 ? orderedViewIds : viewIds;

  // The database store already observes view metadata. Derive the layout from
  // the current view during render so a tab switch cannot commit the previous
  // view's component tree or providers against the next view's context.
  const effectiveLayout = activeView ? (Number(activeView.get(YjsDatabaseKey.layout)) as DatabaseViewLayout) : undefined;

  const view = useMemo(() => {
    switch (effectiveLayout) {
      case DatabaseViewLayout.Grid:
        return <Grid />;
      case DatabaseViewLayout.Board:
        return <Board />;
      case DatabaseViewLayout.Calendar:
        return <Calendar />;
      case DatabaseViewLayout.Chart:
        return <Chart />;
      case DatabaseViewLayout.List:
        return <List />;
      case DatabaseViewLayout.Gallery:
        return <Gallery key={activeViewId} />;
      default:
        return null;
    }
  }, [activeViewId, effectiveLayout]);
  const shouldUseFixedViewport = shouldUseFixedDatabaseViewport({
    embeddedHeight: fixedHeight,
    isDocumentBlock,
    variant,
  });
  const shouldAutoShrinkViewport = shouldAutoShrinkDatabaseViewport({
    embeddedHeight: fixedHeight,
    isDocumentBlock,
    layout: effectiveLayout,
  });
  const viewportStyle = getDatabaseViewportStyle({
    embeddedHeight: fixedHeight,
    isDocumentBlock,
    layout: effectiveLayout,
  });
  const shouldScrollEmbeddedViewport = shouldScrollEmbeddedDatabaseViewport({
    embeddedHeight: fixedHeight,
    isDocumentBlock,
    layout: effectiveLayout,
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
      advancedPanelOpen,
      setAdvancedPanelOpen,
      sortMenuOpen,
      setSortMenuOpen,
    }),
    [
      conditionsExpanded,
      toggleExpanded,
      setExpanded,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode,
      setAdvancedMode,
      advancedPanelOpen,
      setAdvancedPanelOpen,
      sortMenuOpen,
      setSortMenuOpen,
    ]
  );

  // Stable identity: every entry is a useState setter or an empty-deps
  // useCallback, so action-only consumers (e.g. grid column header menus)
  // never re-render on conditions state churn.
  const databaseConditionsActions = useMemo(
    () => ({
      setExpanded,
      setOpenFilterId,
      setAdvancedMode,
      setAdvancedPanelOpen,
      setSortMenuOpen,
    }),
    [setExpanded, setOpenFilterId, setAdvancedMode, setAdvancedPanelOpen, setSortMenuOpen]
  );

  const content = (
    <DatabaseSearchProvider activeViewId={activeViewId}>
      <DatabaseConditionsContext.Provider value={databaseConditionsValue}>
        <DatabaseConditionsActionsContext.Provider value={databaseConditionsActions}>
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
            onReorderTabs={handleReorderTabs}
          />

          <DatabaseConditionsPanel />

          <div
            className={cn(
              'relative flex w-full flex-col',
              shouldUseFixedViewport
                ? shouldAutoShrinkViewport
                  ? shouldScrollEmbeddedViewport
                    ? 'min-h-0 overflow-y-auto overflow-x-hidden'
                    : 'min-h-0 overflow-hidden'
                  : 'h-full min-h-0 flex-1 overflow-hidden'
                : 'overflow-visible'
            )}
            style={viewportStyle}
          >
            <div
              className={cn(
                'w-full',
                shouldUseFixedViewport &&
                  (shouldAutoShrinkViewport ? 'flex min-h-0 flex-col' : 'flex h-full min-h-0 flex-col')
              )}
              style={viewportStyle}
            >
              <Suspense fallback={null}>
                <ErrorBoundary fallbackRender={ElementFallbackRender}>{view}</ErrorBoundary>
              </Suspense>
            </div>
          </div>
        </DatabaseConditionsActionsContext.Provider>
      </DatabaseConditionsContext.Provider>
    </DatabaseSearchProvider>
  );

  switch (effectiveLayout) {
    case DatabaseViewLayout.Grid:
      return <GridGroupingProvider>{content}</GridGroupingProvider>;
    case DatabaseViewLayout.List:
      return <ListGroupingProvider>{content}</ListGroupingProvider>;
    default:
      return content;
  }
}

export default DatabaseViews;
