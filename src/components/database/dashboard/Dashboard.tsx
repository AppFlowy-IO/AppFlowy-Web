import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import {
  addDashboardWidget,
  canAddDashboardWidget,
  createDashboardWidget,
  dashboardSourceDatabaseIds,
  findDashboardWidget,
  moveDashboardWidget,
  replaceDashboardWidgetView,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { UIVariant } from '@/application/types';

import { DASHBOARD_DEFAULT_INLINE_PADDING, DASHBOARD_LIMIT_MESSAGE_DURATION } from './constants';
import { useDashboardContext, useDashboardLayout, useDashboardSourceRegistry } from './DashboardContext';
import { DashboardEmptyState } from './DashboardEmptyState';
import { DashboardGrid } from './DashboardGrid';
import { DashboardLimitMessage } from './DashboardLimitMessage';
import {
  DashboardDraggingContext,
  DashboardHostContext,
  DashboardLimitReason,
  DashboardSelectionContext,
  DashboardUiContext,
  DashboardUiContextValue,
  WidgetPickerRequest,
} from './DashboardUiContext';
import { GlobalFilterBar } from './global-filters/GlobalFilterBar';
import { CreateWidgetViewRequest, useCreateWidgetView } from './hooks/useCreateWidgetView';
import { useDashboardDndMonitor } from './hooks/useDashboardDnd';
import { useDashboardHostServices } from './hooks/useDashboardHostServices';
import { useSourceDocRegistry } from './hooks/useSourceDocRegistry';
import { useWorkspaceDatabases } from './hooks/useWorkspaceDatabases';
import { getCatalogDatabaseName } from './picker-options';
import { getDashboardInlinePadding } from './utils';
import { resolveAddPlacement } from './widget-moves';
import { WidgetPicker } from './WidgetPicker';

/** The Dashboard layout: global filters, then the widget grid (or its empty state). */
export function Dashboard() {
  const { paddingStart, paddingEnd, workspaceId, variant } = useDatabaseContext();
  const { isEditing, canEdit, canEnterEdit, pinEditing, updateRows, hostDatabaseId } = useDashboardContext();
  const { rows } = useDashboardLayout();
  const { registerSourceDoc, registerSourceName } = useDashboardSourceRegistry();
  const hostServices = useDashboardHostServices();
  const editing = isEditing && canEdit;
  const [pickerRequest, setPickerRequest] = useState<WidgetPickerRequest | null>(null);
  // The request whose view is being created from the picker.
  const [creatingRequest, setCreatingRequest] = useState<WidgetPickerRequest | null>(null);
  const [limitMessage, setLimitMessage] = useState<{ reason: DashboardLimitReason; key: number } | null>(null);
  const [dndInstanceId] = useState(() => Symbol('dashboard'));
  // The selected widget (Edit mode only): its box shows the outline.
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const editingRef = useRef(editing);
  const pickerRequestRef = useRef(pickerRequest);
  const pendingScrollWidgetIdRef = useRef<string | null>(null);

  rowsRef.current = rows;
  editingRef.current = editing;
  pickerRequestRef.current = pickerRequest;

  const getRows = useCallback(() => rowsRef.current, []);

  const selectWidget = useCallback((id: string | null, options?: { onlyIf?: string }) => {
    if (id === null) {
      setSelectedWidgetId((current) => (options?.onlyIf === undefined || current === options.onlyIf ? null : current));
      return;
    }

    if (editingRef.current) setSelectedWidgetId(id);
  }, []);

  // The selection ends with Edit mode and with its widget.
  const selectionVisible = editing && selectedWidgetId !== null && findDashboardWidget(rows, selectedWidgetId) !== null;

  if (selectedWidgetId !== null && (!editing || findDashboardWidget(rows, selectedWidgetId) === null)) {
    setSelectedWidgetId(null);
  }

  // Esc, or a press outside the selected widget while nothing is open, clears it.
  useEffect(() => {
    if (!selectionVisible || !selectedWidgetId) return;
    const layerOpen = () => document.querySelector('[data-radix-popper-content-wrapper]') !== null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !layerOpen()) setSelectedWidgetId(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;

      if (!target || layerOpen() || target.closest('[data-radix-popper-content-wrapper]')) return;
      if (target.closest(`[data-widget-id="${CSS.escape(selectedWidgetId)}"]`)) return;
      setSelectedWidgetId(null);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectedWidgetId, selectionVisible]);

  // The picker only makes sense while editing (Edit mode itself, including
  // the automatic one of an empty dashboard, is derived by DashboardProvider).
  // Leaving Edit mode (Done, or a window narrowed to a mobile context) drops
  // it; write access that is only being re-checked (back on the tab, a
  // reconnect) hides it until Edit mode returns.
  if (canEdit && !isEditing && pickerRequest) setPickerRequest(null);

  const acquireSourceDoc = useSourceDocRegistry(registerSourceDoc, hostDatabaseId);
  const { createView, canCreateInOtherDatabases, bridge } = useCreateWidgetView();
  // The catalog only names other databases in the global-filter editor, and it
  // is refetched on every folder change: leave it off while every widget shows
  // the host database (its name has a fallback).
  const hasOtherDatabases = rows.some((row) => row.widgets.some((widget) => widget.databaseId !== hostDatabaseId));
  const { databases: catalog } = useWorkspaceDatabases(workspaceId, variant !== UIVariant.Publish && hasOtherDatabases);

  const showLimitMessage = useCallback((reason: DashboardLimitReason) => {
    setLimitMessage((current) => ({ reason, key: (current?.key ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!limitMessage) return;
    const timeout = window.setTimeout(() => setLimitMessage(null), DASHBOARD_LIMIT_MESSAGE_DURATION);

    return () => window.clearTimeout(timeout);
  }, [limitMessage]);

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

  // Bring a freshly added widget into view once it is rendered.
  useEffect(() => {
    const widgetId = pendingScrollWidgetIdRef.current;

    if (!widgetId || !findDashboardWidget(rows, widgetId)) return;
    pendingScrollWidgetIdRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      // By widget id, not by `data-testid`: production builds strip test ids.
      const element = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-widget-id]') ?? []).find(
        (candidate) => candidate.dataset.widgetId === widgetId
      );

      element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [rows]);

  const openPicker = useCallback(
    (request: WidgetPickerRequest) => {
      if (!canEnterEdit) return;
      // The editor started building: keep Edit mode whatever the sync brings.
      pinEditing();

      if (request.mode === 'add' && !canAddDashboardWidget(rowsRef.current, request.placement)) {
        const dashboardFull = !canAddDashboardWidget(rowsRef.current);

        showLimitMessage(dashboardFull ? 'dashboard' : 'row');
        return;
      }

      setPickerRequest(request);
    },
    [canEnterEdit, pinEditing, showLimitMessage]
  );

  const applyPick = useCallback(
    (request: WidgetPickerRequest, viewId: string, databaseId: string) => {
      if (request.mode === 'replace') {
        updateRows((current) => replaceDashboardWidgetView(current, request.widgetId, viewId, databaseId));
        return;
      }

      const placement = resolveAddPlacement(rowsRef.current, request.placement);

      if (!placement) {
        showLimitMessage('dashboard');
        return;
      }

      const widget = createDashboardWidget(viewId, databaseId);

      pendingScrollWidgetIdRef.current = widget.id;
      updateRows((current) => addDashboardWidget(current, widget, resolveAddPlacement(current, placement) ?? placement));
      // A new widget starts selected.
      selectWidget(widget.id);
    },
    [selectWidget, showLimitMessage, updateRows]
  );

  const handlePick = useCallback(
    (viewId: string, databaseId: string) => {
      const request = pickerRequestRef.current;

      setPickerRequest(null);
      if (request) applyPick(request, viewId, databaseId);
    },
    [applyPick]
  );

  // A view created from the picker always gets its widget: the request is
  // captured before the (slow) creation, the picker cannot be dismissed
  // meanwhile, and a full dashboard is refused before anything is created.
  const handleCreateView = useCallback(
    async (createRequest: CreateWidgetViewRequest) => {
      const request = pickerRequestRef.current;

      if (!request) return null;
      if (request.mode === 'add' && !resolveAddPlacement(rowsRef.current, request.placement)) {
        setPickerRequest(null);
        showLimitMessage('dashboard');
        return null;
      }

      setCreatingRequest(request);
      try {
        const viewId = await createView(createRequest);

        setPickerRequest((current) => (current === request ? null : current));
        applyPick(request, viewId, createRequest.databaseId);
        return viewId;
      } finally {
        setCreatingRequest((current) => (current === request ? null : current));
      }
    },
    [applyPick, createView, showLimitMessage]
  );

  const handleMove = useCallback(
    (widgetId: string, placement: DashboardWidgetPlacement) => {
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
  });

  const uiValue = useMemo<DashboardUiContextValue>(
    () => ({
      hostDatabaseId,
      openPicker,
      showLimitMessage,
      dndInstanceId,
      getRows,
      updateRows,
      acquireSourceDoc,
      selectWidget,
    }),
    [acquireSourceDoc, dndInstanceId, getRows, hostDatabaseId, openPicker, selectWidget, showLimitMessage, updateRows]
  );

  const handleAddFirstWidget = useCallback(
    () => openPicker({ mode: 'add', placement: { type: 'new_row' } }),
    [openPicker]
  );

  // Kept mounted mid-creation even without Edit mode: a remount would unlock
  // the picker and let a second view be created for the same request.
  const visiblePickerRequest = editing || pickerRequest === creatingRequest ? pickerRequest : null;

  return (
    <DashboardHostContext.Provider value={hostServices}>
      <DashboardUiContext.Provider value={uiValue}>
        <DashboardDraggingContext.Provider value={draggingWidgetId}>
          <DashboardSelectionContext.Provider value={selectionVisible ? selectedWidgetId : null}>
            <div
              className='relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden'
              data-dragging={draggingWidgetId ? 'true' : undefined}
              data-editing={editing ? 'true' : 'false'}
              data-testid='dashboard-view'
              ref={scrollRef}
            >
              {/* The same inset in View and Edit mode; the grid's first band replaces the top padding. */}
              <div
                className='flex w-full flex-col pb-10 max-sm:!px-6'
                style={getDashboardInlinePadding({
                  paddingStart: paddingStart ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                  paddingEnd: paddingEnd ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                  reserveControlGutter: canEdit,
                })}
              >
                <GlobalFilterBar className='mt-3' />
                {limitMessage ? (
                  // Sticky, so the message stays in sight wherever the add was refused.
                  <div className='pointer-events-none sticky top-2 z-30 mt-3' key={limitMessage.key}>
                    <DashboardLimitMessage className='pointer-events-auto' reason={limitMessage.reason} />
                  </div>
                ) : null}
                {rows.length === 0 ? (
                  <div className='pt-3'>
                    <DashboardEmptyState onAddWidget={handleAddFirstWidget} />
                  </div>
                ) : (
                  <DashboardGrid />
                )}
              </div>
            </div>
            <WidgetPicker
              canCreateInOtherDatabases={canCreateInOtherDatabases}
              createView={handleCreateView}
              onClose={() => setPickerRequest(null)}
              onPick={handlePick}
              request={visiblePickerRequest}
            />
            {bridge}
          </DashboardSelectionContext.Provider>
        </DashboardDraggingContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

export default Dashboard;
