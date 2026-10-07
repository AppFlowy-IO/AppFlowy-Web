import { lazy, memo, ReactNode, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';

import { useDatabase, useDatabaseContext, useDatabaseView, useDatabaseViewsSelector } from '@/application/database-yjs';
import { hasAdvancedFilterRoot } from '@/application/database-yjs/filter';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { type ReorderResult } from '@/components/_shared/reorder/useReorderMonitor';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import { Board } from '@/components/database/board';
import { Chart } from '@/components/database/chart';
import { usePreloadRichTextCellEditor } from '@/components/database/components/cell/text/rich-text/load';
import {
  DatabaseConditionsActionsContext,
  DatabaseConditionsContext,
} from '@/components/database/components/conditions/context';
import { DatabaseSearchProvider } from '@/components/database/components/conditions/DatabaseSearchContext';
import { DatabaseTabs } from '@/components/database/components/tabs';
import { HistoricalDashboardPlaceholder } from '@/components/database/dashboard/HistoricalDashboardPlaceholder';
import { useDashboardModeStore } from '@/components/database/dashboard/hooks/useDashboardModeStore';
import { loadDashboard } from '@/components/database/dashboard/load';
import { WidgetBody } from '@/components/database/dashboard/WidgetBody';
import { WidgetCompositionContext } from '@/components/database/dashboard/WidgetComposition';
import { useWidgetContextOptional } from '@/components/database/dashboard/WidgetContext';
import { WidgetPlaceholder } from '@/components/database/dashboard/WidgetPlaceholder';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
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
import { TimelineGroupingProvider } from '@/components/database/timeline/TimelineGroupingContext';
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
const Feed = lazy(() => import('@/components/database/feed'));
const Timeline = lazy(() => import('@/components/database/timeline'));
// The dashboard's chunk (`loadDashboard`): the layout, the page scope
// (`DashboardProvider`) its tab bar shares with it, and the widget composition.
// One import, so the tab bar of a dashboard page waits for one round trip,
// never a second one; a dashboard page starts it while its document loads.
const Dashboard = lazy(loadDashboard);
const DashboardPageScope = lazy(() => loadDashboard().then((module) => ({ default: module.DashboardProvider })));
const FormBuilderView = lazy(() =>
  import('@/components/database/form/FormBuilderView').then(({ FormBuilderView: Component }) => ({
    default: Component,
  }))
);

/*
 * Two compositions share the pieces below: a database page, a document
 * block or a row page (`PageDatabaseViews`: tabs, conditions bar, every view
 * of the database) and a dashboard widget (`WidgetDatabaseViews`: the widget
 * header from the dashboard chunk, one view in the widget card, conditions
 * in popovers).
 */

/** Where the views render: `history` is an immutable history preview, `widget` a dashboard widget. */
type DatabaseViewsHost = 'page' | 'history' | 'widget';

/** The component of a layout. Layouts that keep per-view state remount on a view switch. */
function renderDatabaseView(layout: DatabaseViewLayout | undefined, activeViewId: string, host: DatabaseViewsHost) {
  switch (layout) {
    case DatabaseViewLayout.Grid:
      return <Grid />;
    case DatabaseViewLayout.Board:
      return <Board />;
    case DatabaseViewLayout.Calendar:
      return <Calendar key={activeViewId} />;
    case DatabaseViewLayout.Chart:
      return <Chart />;
    case DatabaseViewLayout.Form:
      return <FormBuilderView key={activeViewId} />;
    case DatabaseViewLayout.List:
      return <List />;
    case DatabaseViewLayout.Gallery:
      return <Gallery key={activeViewId} />;
    case DatabaseViewLayout.Feed:
      return <Feed key={activeViewId} />;
    case DatabaseViewLayout.Timeline:
      return <Timeline key={activeViewId} />;
    case DatabaseViewLayout.Dashboard:
      // Dashboards never nest: a widget whose view became a dashboard shows
      // a placeholder rendered by the widget itself.
      if (host === 'widget') return null;
      // Widgets mount their own live databases, which would load current
      // rows and bind realtime sync inside an immutable history preview.
      if (host === 'history') return <HistoricalDashboardPlaceholder />;
      return <Dashboard key={activeViewId} />;
    default:
      // A widget's view that the database store has not produced yet (its
      // doc still settling) keeps the loading placeholder: never an empty card.
      return host === 'widget' ? <WidgetPlaceholder reason='loading' /> : null;
  }
}

/**
 * How the layout's box is sized: fixed to the embedded height (a dashboard
 * widget's card), capped at it and shrunk to the content, or as tall as the
 * content (a published page).
 */
function useDatabaseViewportGeometry(fixedHeight: number | undefined, layout: DatabaseViewLayout | undefined) {
  const { isDocumentBlock, variant } = useDatabaseContext();

  return {
    fixed: shouldUseFixedDatabaseViewport({ embeddedHeight: fixedHeight, isDocumentBlock, variant }),
    autoShrink: shouldAutoShrinkDatabaseViewport({ embeddedHeight: fixedHeight, isDocumentBlock, layout }),
    scrollEmbedded: shouldScrollEmbeddedDatabaseViewport({ embeddedHeight: fixedHeight, isDocumentBlock, layout }),
    style: getDatabaseViewportStyle({ embeddedHeight: fixedHeight, isDocumentBlock, layout }),
  };
}

type DatabaseViewportGeometry = ReturnType<typeof useDatabaseViewportGeometry>;

/** The class of the scope around a composition: it fills a fixed viewport's parent. */
function historyScopeClass(geometry: DatabaseViewportGeometry) {
  return cn('flex w-full flex-col', geometry.fixed ? 'min-h-0 flex-1' : 'overflow-visible');
}

/** The box the layout renders in; a layout that throws shows the element fallback. */
function DatabaseViewport({ geometry, children }: { geometry: DatabaseViewportGeometry; children: ReactNode }) {
  const { fixed, autoShrink, scrollEmbedded, style } = geometry;

  return (
    <div
      className={cn(
        'relative flex w-full flex-col',
        fixed
          ? autoShrink
            ? scrollEmbedded
              ? 'min-h-0 overflow-y-auto overflow-x-hidden'
              : 'min-h-0 overflow-hidden'
            : 'h-full min-h-0 flex-1 overflow-hidden'
          : 'overflow-visible'
      )}
      style={style}
    >
      <div
        className={cn('w-full', fixed && (autoShrink ? 'flex min-h-0 flex-col' : 'flex h-full min-h-0 flex-col'))}
        style={style}
      >
        <Suspense fallback={null}>
          <ErrorBoundary fallbackRender={ElementFallbackRender}>{children}</ErrorBoundary>
        </Suspense>
      </div>
    </div>
  );
}

/** Layouts whose search filters rows (WP09 §1.2); Gallery and Feed search their cards. */
const ROW_SEARCH_LAYOUTS: ReadonlySet<DatabaseViewLayout | undefined> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Board,
]);

/** Grid, List and Timeline share their grouping between the toolbar and the layout. */
function ViewGroupingProvider({ layout, children }: { layout: DatabaseViewLayout | undefined; children: ReactNode }) {
  switch (layout) {
    case DatabaseViewLayout.Grid:
      return <GridGroupingProvider>{children}</GridGroupingProvider>;
    case DatabaseViewLayout.List:
      return <ListGroupingProvider>{children}</ListGroupingProvider>;
    case DatabaseViewLayout.Timeline:
      return <TimelineGroupingProvider>{children}</TimelineGroupingProvider>;
    default:
      return <>{children}</>;
  }
}

/**
 * The conditions state both compositions keep: the filter whose editor is
 * open, and the advanced mode with its rules panel. The mode follows the
 * active view's filters (in a View-mode dashboard widget, the viewer's
 * overlay, whose filters may differ from the shared view's).
 * `onFiltersFound` (stable) runs whenever the view has filters.
 */
function useSharedConditionsState(onFiltersFound?: () => void) {
  const [openFilterId, setOpenFilterId] = useState<string>();
  const [isAdvancedMode, setAdvancedMode] = useState(false);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const conditionsView = useDatabaseView();

  // Auto-detect advanced mode on mount/view change.
  useEffect(() => {
    if (!conditionsView) return;

    const filters = conditionsView.get(YjsDatabaseKey.filters);

    if (!filters || filters.length === 0) {
      setAdvancedMode(false);
      return;
    }

    onFiltersFound?.();
    setAdvancedMode(hasAdvancedFilterRoot(filters));
  }, [conditionsView, onFiltersFound]);

  return { openFilterId, setOpenFilterId, isAdvancedMode, setAdvancedMode, advancedPanelOpen, setAdvancedPanelOpen };
}

type SharedConditionsState = ReturnType<typeof useSharedConditionsState>;

interface ConditionsProvidersProps extends Omit<SharedConditionsState, 'setAdvancedPanelOpen'> {
  /** The bar is revealed, or a widget's Filters popover is open. */
  expanded: boolean;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  setAdvancedPanelOpen: (open: boolean) => void;
  /** The sort editor (bar), or a widget's Sorts popover, is open. */
  sortMenuOpen: boolean;
  setSortMenuOpen: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Hands a conditions state to the toolbar, the column headers and the
 * conditions UI. The actions keep their identity (each one is a state setter
 * or a callback without changing dependencies), so action-only consumers
 * (every grid column header menu) never re-render on conditions state churn.
 */
function ConditionsProviders({
  expanded,
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
  children,
}: ConditionsProvidersProps) {
  const value = useMemo(
    () => ({
      expanded,
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
      expanded,
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
  const actions = useMemo(
    () => ({ setExpanded, setOpenFilterId, setAdvancedMode, setAdvancedPanelOpen, setSortMenuOpen }),
    [setExpanded, setOpenFilterId, setAdvancedMode, setAdvancedPanelOpen, setSortMenuOpen]
  );

  return (
    <DatabaseConditionsContext.Provider value={value}>
      <DatabaseConditionsActionsContext.Provider value={actions}>{children}</DatabaseConditionsActionsContext.Provider>
    </DatabaseConditionsContext.Provider>
  );
}

/**
 * The conditions of a page: the conditions bar under the tabs, revealed by
 * the toolbar (and whenever the view has filters), and the sort editor.
 */
function BarConditionsProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);
  // Filters from any source (desktop sync, a collaborator) reveal the bar.
  const revealBar = useCallback(() => setExpanded(true), []);
  const shared = useSharedConditionsState(revealBar);

  return (
    <ConditionsProviders
      {...shared}
      expanded={expanded}
      setExpanded={setExpanded}
      setSortMenuOpen={setSortMenuOpen}
      sortMenuOpen={sortMenuOpen}
      toggleExpanded={toggleExpanded}
    >
      {children}
    </ConditionsProviders>
  );
}

type WidgetConditionsPopover = 'filters' | 'sorts' | null;

/**
 * The conditions of a dashboard widget. A widget has no conditions bar: its
 * Filter and Sort tools open popovers, one at a time. The bar's "expand"
 * and the sort and advanced menus map onto them, so every entry point that
 * reveals the bar elsewhere (the column header's "Filter" and "Sort", a new
 * rule) opens the matching popover. Nothing opens by itself.
 */
function WidgetConditionsProvider({ children }: { children: ReactNode }) {
  const [popover, setPopover] = useState<WidgetConditionsPopover>(null);
  const shared = useSharedConditionsState();
  const { setAdvancedPanelOpen: setAdvancedPanelOpenState } = shared;
  const toggleExpanded = useCallback(() => setPopover((current) => (current === 'filters' ? null : 'filters')), []);
  const setExpanded = useCallback(
    (expanded: boolean) => setPopover((current) => (expanded ? 'filters' : current === 'filters' ? null : current)),
    []
  );
  const setSortMenuOpen = useCallback(
    (open: boolean) => setPopover((current) => (open ? 'sorts' : current === 'sorts' ? null : current)),
    []
  );
  // The advanced rules live in the Filters popover.
  const setAdvancedPanelOpen = useCallback(
    (open: boolean) => {
      setAdvancedPanelOpenState(open);
      if (open) setPopover('filters');
    },
    [setAdvancedPanelOpenState]
  );

  return (
    <ConditionsProviders
      {...shared}
      expanded={popover === 'filters'}
      setAdvancedPanelOpen={setAdvancedPanelOpen}
      setExpanded={setExpanded}
      setSortMenuOpen={setSortMenuOpen}
      sortMenuOpen={popover === 'sorts'}
      toggleExpanded={toggleExpanded}
    >
      {children}
    </ConditionsProviders>
  );
}

export interface DatabaseViewsProps {
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
  /**
   * Called when the active view's row search starts or ends, so the host can
   * read every row as it does for filters (WP09 §3.1).
   */
  onSearchActiveChange?: (active: boolean) => void;
}

/**
 * A database page, document block or row page: the tabs of its views with
 * the toolbar, the conditions bar and the active view.
 */
function PageDatabaseViews({
  onChangeView,
  onViewAdded,
  activeViewId,
  databasePageId,
  viewName,
  visibleViewIds,
  fixedHeight,
  onViewIdsChanged,
  onReorderViews,
  onSearchActiveChange,
}: DatabaseViewsProps) {
  const { childViews, viewIds } = useDatabaseViewsSelector(databasePageId, visibleViewIds);
  const { dataSource, readOnly } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';
  const persistViewOrder = !isHistory;

  // Text cells are editable at once; this warms their menus (toolbar,
  // mentions, links) so the first edit does not wait for them either.
  usePreloadRichTextCellEditor(!readOnly);

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
  // Each dashboard's Edit preference survives switching to another tab and back.
  const dashboardModeStore = useDashboardModeStore();
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
    const storedViewIds = persistViewOrder ? readStoredViewOrder(databaseId) : undefined;
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
    if (persistViewOrder) writeStoredViewOrder(databaseId, nextViewIds);
    setOrderedViewIds(nextViewIds);
  }, [databaseId, fallbackViewIds, hasAuthoritativeVisibleOrder, persistViewOrder, viewIds]);

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
    if (readOnly) return;

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
  }, [databaseId, fallbackViewIds, hasAuthoritativeVisibleOrder, readOnly]);

  const handleAfterViewAddedToDatabase = useCallback(() => {
    pendingViewCreationRef.current = false;
    pendingViewAppendBaseRef.current = null;
  }, []);

  const handleViewAddedToDatabase = useCallback(
    (newViewId: string) => {
      if (readOnly) return;

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
    [databaseId, fallbackViewIds, onViewAdded, readOnly]
  );

  const handleReorderTabs = useCallback(
    ({ nextIds, movedId, prevId }: ReorderResult) => {
      if (readOnly) return;

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
    [databaseId, onReorderViews, readOnly, viewIds]
  );

  const displayedViewIds = orderedViewIds.length > 0 ? orderedViewIds : viewIds;

  // The database store already observes view metadata. Derive the layout from
  // the current view during render so a tab switch cannot commit the previous
  // view's component tree or providers against the next view's context.
  const effectiveLayout = activeView ? (Number(activeView.get(YjsDatabaseKey.layout)) as DatabaseViewLayout) : undefined;
  const view = useMemo(
    () => renderDatabaseView(effectiveLayout, activeViewId, isHistory ? 'history' : 'page'),
    [activeViewId, effectiveLayout, isHistory]
  );
  const geometry = useDatabaseViewportGeometry(fixedHeight, effectiveLayout);
  const isDashboardLayout = effectiveLayout === DatabaseViewLayout.Dashboard;

  const content = (
    <>
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

      {/* A dashboard shows its global filters inside the grid instead. */}
      {isDashboardLayout ? null : <DatabaseConditionsPanel />}

      <DatabaseViewport geometry={geometry}>{view}</DatabaseViewport>
    </>
  );

  return (
    <DatabaseHistoryScope className={historyScopeClass(geometry)}>
      {/* Above the layout's providers: the bar keeps its state across a tab switch. */}
      <BarConditionsProvider>
        <DatabaseSearchProvider
          activeViewId={activeViewId}
          applyToRows={ROW_SEARCH_LAYOUTS.has(effectiveLayout)}
          onActiveChange={onSearchActiveChange}
        >
          {isDashboardLayout && !isHistory ? (
            // The tab bar's toolbar (Edit / Done, global filters) and the grid
            // share one dashboard state, from the dashboard's chunk: until it
            // is loaded (once per session) the tab bar waits with the grid,
            // behind the skeleton the page showed while its document loaded.
            <Suspense fallback={<GridSkeleton includeTitle={false} />}>
              <DashboardPageScope modeStore={dashboardModeStore} viewIds={displayedViewIds}>
                {content}
              </DashboardPageScope>
            </Suspense>
          ) : (
            <ViewGroupingProvider layout={effectiveLayout}>{content}</ViewGroupingProvider>
          )}
        </DatabaseSearchProvider>
      </BarConditionsProvider>
    </DatabaseHistoryScope>
  );
}

/**
 * A dashboard widget: its header (title, tools, menu) in place of the tabs,
 * and its one view in the widget card, which is the whole fixed slot (a
 * widget has no conditions bar to make room for). It reuses the page's
 * pieces: the search, the conditions contexts, the grouping and the viewport.
 * The header is the dashboard chunk's (`WidgetCompositionContext`), so no
 * page without a dashboard loads the widget chrome. A widget shows exactly
 * one view, so it neither orders nor persists tabs.
 */
export function WidgetDatabaseViews({
  activeViewId,
  fixedHeight,
  onSearchActiveChange,
}: {
  activeViewId: string;
  fixedHeight?: number;
  onSearchActiveChange?: (active: boolean) => void;
}) {
  const composition = useContext(WidgetCompositionContext);

  // A widget's database mounts under its dashboard (`WidgetDatabaseHost`).
  if (!composition) throw new Error('WidgetDatabaseViews renders inside WidgetCompositionProvider');
  const { Header } = composition;
  // The database store re-renders on every change of the database, so the
  // layout read here follows a conversion and a view that syncs in late.
  const view = useDatabase()?.get(YjsDatabaseKey.views)?.get(activeViewId);
  const layout = view ? (Number(view.get(YjsDatabaseKey.layout)) as DatabaseViewLayout) : undefined;
  const content = useMemo(() => renderDatabaseView(layout, activeViewId, 'widget'), [activeViewId, layout]);
  const geometry = useDatabaseViewportGeometry(fixedHeight, layout);
  // Entering (or leaving) Edit mode clears the widget's search: Edit mode hides the Search tool.
  const editing = Boolean(useWidgetContextOptional()?.editing);

  return (
    <DatabaseHistoryScope className={historyScopeClass(geometry)}>
      <WidgetConditionsProvider>
        <DatabaseSearchProvider
          activeViewId={activeViewId}
          applyToRows={ROW_SEARCH_LAYOUTS.has(layout)}
          onActiveChange={onSearchActiveChange}
          resetKey={editing}
        >
          <ViewGroupingProvider layout={layout}>
            <Header />
            <WidgetBody>
              <DatabaseViewport geometry={geometry}>
                {/* A lazily loaded view (a timeline, a list) shows the loading placeholder while its code loads. */}
                <Suspense fallback={<WidgetPlaceholder reason='loading' />}>{content}</Suspense>
              </DatabaseViewport>
            </WidgetBody>
          </ViewGroupingProvider>
        </DatabaseSearchProvider>
      </WidgetConditionsProvider>
    </DatabaseHistoryScope>
  );
}

/**
 * The views of a database: a dashboard widget's own composition inside a
 * widget (`DatabaseContext.isDashboardWidget`), the page composition
 * everywhere else.
 *
 * Memoized: its host (`Database`) renders again whenever a dashboard's global
 * filters (`extraFilters`) or the viewer's private conditions (the overlay)
 * change, and both reach the components that read them through their own
 * contexts (`DatabaseExtraFiltersContext`, `DatabaseViewOverlayContext`). The
 * headers, providers and layouts under the views have nothing new to render.
 */
const DatabaseViews = memo(function DatabaseViews(props: DatabaseViewsProps) {
  const { isDashboardWidget } = useDatabaseContext();

  if (isDashboardWidget) {
    return (
      <WidgetDatabaseViews
        activeViewId={props.activeViewId}
        fixedHeight={props.fixedHeight}
        onSearchActiveChange={props.onSearchActiveChange}
      />
    );
  }

  return <PageDatabaseViews {...props} />;
});

export default DatabaseViews;
