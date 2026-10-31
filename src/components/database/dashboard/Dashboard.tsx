import * as liveRegion from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { ComponentProps, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import {
  classifyDashboardMove,
  dashboardSourceDatabaseIds,
  findDashboardWidget,
  moveDashboardWidget,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { UIVariant } from '@/application/types';
import { cn } from '@/lib/utils';

import { useAddWidgetFlowState } from './add-widget/add-widget-api';
import { AddWidgetFlowState } from './add-widget/add-widget-flow';
import { getCatalogDatabaseName } from './add-widget/picker-sections';
import { useAddWidgetFlow } from './add-widget/useAddWidgetFlow';
import { createDragGhostStore, createDropIndicatorStore, createRowFocusRequests } from './arrange-stores';
import { DASHBOARD_COMPACT_INSET_CLASS, DASHBOARD_DEFAULT_INLINE_PADDING } from './constants';
import { useDashboardContext, useDashboardLayout, useDashboardSourceRegistry } from './DashboardContext';
import { DashboardDragGhost } from './DashboardDragGhost';
import { DashboardEmptyState } from './DashboardEmptyState';
import { DashboardGrid, selectPendingAdd } from './DashboardGrid';
import { DashboardLoadSchedulerProvider } from './DashboardLoadScheduler';
import {
  DashboardDraggingContext,
  DashboardHostContext,
  DashboardSelectionContext,
  DashboardUiContext,
  DashboardUiContextValue,
} from './DashboardUiContext';
import { GlobalFilterBar } from './global-filters/GlobalFilterBar';
import { useDashboardDndMonitor } from './hooks/useDashboardDnd';
import { useDashboardHostServices } from './hooks/useDashboardHostServices';
import { useSourceDocRegistry } from './hooks/useSourceDocRegistry';
import { useWorkspaceDatabases } from './hooks/useWorkspaceDatabases';
import { getDashboardInlinePadding } from './utils';
import { LazyWidgetDockHost, preloadWidgetPicker } from './WidgetPicker';

const POPPER_SELECTOR = '[data-radix-popper-content-wrapper]';

/**
 * A menu, a popover or a submenu is open somewhere on the page. Tooltips use
 * the same popper wrapper and do not count: one that is open at a press (the
 * tooltip of a control that just took the focus back) must not shield it.
 */
function isLayerOpen() {
  return Array.from(document.querySelectorAll(POPPER_SELECTOR)).some(
    (wrapper) => wrapper.querySelector('[role="tooltip"]') === null
  );
}

const isFlowActive = (state: AddWidgetFlowState) => state.kind !== 'idle';

/** The Dashboard layout: global filters, then the widget grid (or its empty state). */
export function Dashboard() {
  const { paddingStart, paddingEnd, workspaceId, variant, databaseDoc, updatePage, onRendered } = useDatabaseContext();
  const { isEditing, canEdit, canEnterEdit, pinEditing, updateRows, hostDatabaseId, ownedViews } = useDashboardContext();
  const { rows } = useDashboardLayout();
  const { registerSourceDoc, registerSourceName } = useDashboardSourceRegistry();
  const hostServices = useDashboardHostServices();

  // The page header (including Share) waits for its layout to commit. Widgets
  // load independently and do not report readiness for this dashboard shell.
  useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  const editing = isEditing && canEdit;
  const [dndInstanceId] = useState(() => Symbol('dashboard'));
  // The arrange feedback stores (drop line, drag ghost, row focus): created once.
  const [arrange] = useState(() => ({
    dropIndicatorStore: createDropIndicatorStore(),
    dragGhostStore: createDragGhostStore(),
    rowFocus: createRowFocusRequests(),
  }));
  const firstPaintDone = useRef(false);
  // The selected widget (Edit mode only): its box shows the outline.
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  // The widget whose Settings › Source panel is docked beside it.
  const [sourceWidgetId, setSourceWidgetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const editingRef = useRef(editing);
  const pendingScrollWidgetIdRef = useRef<string | null>(null);

  rowsRef.current = rows;
  editingRef.current = editing;

  const getRows = useCallback(() => rowsRef.current, []);

  const selectWidget = useCallback((id: string | null, options?: { onlyIf?: string }) => {
    if (id === null) {
      setSelectedWidgetId((current) => (options?.onlyIf === undefined || current === options.onlyIf ? null : current));
      return;
    }

    if (editingRef.current) setSelectedWidgetId(id);
  }, []);

  // Refusals are told to assistive technology only: never a banner (Notion).
  const announce = useCallback((message: string) => liveRegion.announce(message), []);

  useEffect(() => () => liveRegion.cleanup(), []);

  const scrollToWidget = useCallback((widgetId: string) => {
    pendingScrollWidgetIdRef.current = widgetId;
  }, []);
  const preloadPicker = useCallback(() => preloadWidgetPicker(workspaceId, variant), [variant, workspaceId]);
  const openSourcePanel = useCallback((widgetId: string) => setSourceWidgetId(widgetId), []);
  const closeSourcePanel = useCallback(() => setSourceWidgetId(null), []);

  // The add flow (WP06): "+" inserts a selected default widget and docks the picker beside it.
  const {
    api: addWidget,
    startAddWidget,
    bindFlowView,
  } = useAddWidgetFlow({
    hostDoc: databaseDoc,
    hostDatabaseId,
    canEnterEdit,
    editing,
    canEdit,
    pinEditing,
    getRows,
    updateRows,
    ownedViews,
    selectWidget,
    announce,
    scrollToWidget,
    openSourcePanel,
    preloadPicker,
    workspaceId,
    getSubscriptions: hostServices.getSubscriptions,
    updatePage,
  });
  const pending = useAddWidgetFlowState(addWidget.flow, selectPendingAdd);
  const flowActive = useAddWidgetFlowState(addWidget.flow, isFlowActive);
  const pendingWidgetId = pending?.widgetId ?? null;

  // The selection ends with Edit mode and with its widget (the pending widget of an add counts).
  const selectionVisible =
    editing &&
    selectedWidgetId !== null &&
    (selectedWidgetId === pendingWidgetId || findDashboardWidget(rows, selectedWidgetId) !== null);

  if (selectedWidgetId !== null && !selectionVisible) setSelectedWidgetId(null);

  // The Source panel goes with Edit mode and with its widget.
  if (sourceWidgetId !== null && (!editing || findDashboardWidget(rows, sourceWidgetId) === null)) {
    setSourceWidgetId(null);
  }

  // Esc, or a press outside the selected widget while nothing is open, clears it.
  useEffect(() => {
    if (!selectionVisible || !selectedWidgetId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLayerOpen()) setSelectedWidgetId(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;

      if (!target || isLayerOpen() || target.closest(POPPER_SELECTOR)) return;
      if (target.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId === selectedWidgetId) return;
      setSelectedWidgetId(null);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectedWidgetId, selectionVisible]);

  const acquireSourceDoc = useSourceDocRegistry(registerSourceDoc, hostDatabaseId);
  // The catalog only names other databases in the global-filter editor, and it
  // is refetched on every folder change: leave it off while every widget shows
  // the host database (its name has a fallback).
  const hasOtherDatabases = rows.some((row) => row.widgets.some((widget) => widget.databaseId !== hostDatabaseId));
  const { databases: catalog } = useWorkspaceDatabases(workspaceId, variant !== UIVariant.Publish && hasOtherDatabases);

  // Widgets mounted after this (moved across rows, added) fade in.
  useEffect(() => {
    firstPaintDone.current = true;
  }, []);

  // Name every source database for the global-filter editor. Keyed by the
  // source ids, so resizing or moving widgets never walks the catalog.
  const sourceIdsKey = dashboardSourceDatabaseIds(rows, hostDatabaseId).join('\n');

  useEffect(() => {
    if (catalog.length === 0) return;
    const sourceIds = new Set(sourceIdsKey.split('\n'));

    catalog.forEach((database) => {
      if (!sourceIds.has(database.database_id)) return;
      const name = getCatalogDatabaseName(database);

      if (name) registerSourceName(database.database_id, name);
    });
  }, [catalog, registerSourceName, sourceIdsKey]);

  // Bring an added widget (or its pending slot) into view once it is rendered.
  useEffect(() => {
    const widgetId = pendingScrollWidgetIdRef.current;

    if (!widgetId || (widgetId !== pendingWidgetId && !findDashboardWidget(rows, widgetId))) return;
    pendingScrollWidgetIdRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const element = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-widget-id]') ?? []).find(
        (candidate) => candidate.dataset.widgetId === widgetId
      );

      element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pendingWidgetId, rows]);

  // Only a move that changes the layout writes (no undo step for a no-op).
  const handleMove = useCallback(
    (widgetId: string, placement: DashboardWidgetPlacement) => {
      if (classifyDashboardMove(rowsRef.current, widgetId, placement) !== 'allowed') return;
      updateRows((current) => moveDashboardWidget(current, widgetId, placement));
    },
    [updateRows]
  );

  const draggingWidgetId = useDashboardDndMonitor({
    instanceId: dndInstanceId,
    enabled: editing,
    getRows,
    onMove: handleMove,
    scrollContainerRef: scrollRef,
    announce,
    ghostStore: arrange.dragGhostStore,
    indicatorStore: arrange.dropIndicatorStore,
  });

  const uiValue = useMemo<DashboardUiContextValue>(
    () => ({
      hostDatabaseId,
      startAddWidget,
      addWidget,
      ownedViews,
      announce,
      dndInstanceId,
      dropIndicatorStore: arrange.dropIndicatorStore,
      dragGhostStore: arrange.dragGhostStore,
      requestRowFocus: arrange.rowFocus.request,
      consumeRowFocus: arrange.rowFocus.consume,
      firstPaintDone,
      getRows,
      updateRows,
      acquireSourceDoc,
      selectWidget,
    }),
    [
      acquireSourceDoc,
      addWidget,
      announce,
      arrange,
      dndInstanceId,
      getRows,
      hostDatabaseId,
      ownedViews,
      selectWidget,
      startAddWidget,
      updateRows,
    ]
  );

  const handleNewView = useCallback(() => startAddWidget({ type: 'new_row' }), [startAddWidget]);
  // The load queue starts widgets in layout order: top to bottom, left to right.
  const widgetOrder = useMemo(() => rows.flatMap((row) => row.widgets.map((widget) => widget.id)), [rows]);
  // The dock (picker, New view panel, Source panel) loads with the first add or Source.
  const dockWanted = canEdit && (flowActive || sourceWidgetId !== null);

  return (
    <DashboardHostContext.Provider value={hostServices}>
      <DashboardUiContext.Provider value={uiValue}>
        <DashboardDraggingContext.Provider value={draggingWidgetId}>
          <DashboardSelectionContext.Provider value={selectionVisible ? selectedWidgetId : null}>
            <DashboardLoadSchedulerProvider hostSourceId={hostDatabaseId} order={widgetOrder} scrollRef={scrollRef}>
              <div
                // `group/dashboard`: the handles and drop zones read `data-dragging` in CSS.
                className='group/dashboard relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden'
                data-dragging={draggingWidgetId ? 'true' : undefined}
                data-editing={editing ? 'true' : 'false'}
                data-testid='dashboard-view'
                ref={scrollRef}
              >
                {/* The same inset in View and Edit mode; the grid's first band replaces the top padding. */}
                <div
                  className={cn('flex w-full flex-col pb-10', DASHBOARD_COMPACT_INSET_CLASS)}
                  style={getDashboardInlinePadding({
                    paddingStart: paddingStart ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                    paddingEnd: paddingEnd ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                    reserveControlGutter: canEdit,
                  })}
                >
                  <GlobalFilterBar className='mt-3' />
                  {rows.length === 0 && pending === null ? (
                    <div className='pt-3'>
                      <DashboardEmptyState onNewView={handleNewView} onPreload={addWidget.preload} />
                    </div>
                  ) : (
                    <DashboardGrid />
                  )}
                </div>
              </div>
            </DashboardLoadSchedulerProvider>
            <DockHostSlot
              bindFlowView={bindFlowView}
              closeSourcePanel={closeSourcePanel}
              scrollRef={scrollRef}
              sourceWidgetId={sourceWidgetId}
              wanted={dockWanted}
            />
            <DashboardDragGhost store={arrange.dragGhostStore} />
          </DashboardSelectionContext.Provider>
        </DashboardDraggingContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

/**
 * The dock, mounted from the first add or Source panel on (the flow's later
 * panels need it mounted, and it keeps the chunk loaded).
 */
function DockHostSlot({ wanted, ...props }: { wanted: boolean } & ComponentProps<typeof LazyWidgetDockHost>) {
  const [mounted, setMounted] = useState(wanted);

  if (wanted && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <LazyWidgetDockHost {...props} />
    </Suspense>
  );
}

export default Dashboard;
