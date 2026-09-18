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
import { useDashboardContext, useDashboardSourceRegistry } from './DashboardContext';
import { DashboardEmptyState } from './DashboardEmptyState';
import { DashboardGrid } from './DashboardGrid';
import { DashboardLimitMessage } from './DashboardLimitMessage';
import {
  DashboardDraggingContext,
  DashboardHostContext,
  DashboardLimitReason,
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
import { getDashboardInlinePadding, shouldOpenInEditMode } from './utils';
import { resolveAddPlacement } from './widget-moves';
import { WidgetPicker } from './WidgetPicker';

/** The Dashboard layout: global filters, then the widget grid (or its empty state). */
export function Dashboard() {
  const { paddingStart, paddingEnd, workspaceId, variant } = useDatabaseContext();
  const { rows, isEditing, canEdit, setEditing, updateRows, hostDatabaseId } = useDashboardContext();
  const { registerSourceDoc, registerSourceName } = useDashboardSourceRegistry();
  const hostServices = useDashboardHostServices();
  const editing = isEditing && canEdit;
  const [pickerRequest, setPickerRequest] = useState<WidgetPickerRequest | null>(null);
  const [limitMessage, setLimitMessage] = useState<{ reason: DashboardLimitReason; key: number } | null>(null);
  const [dndInstanceId] = useState(() => Symbol('dashboard'));
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const pickerRequestRef = useRef(pickerRequest);
  const pendingScrollWidgetIdRef = useRef<string | null>(null);

  rowsRef.current = rows;
  pickerRequestRef.current = pickerRequest;

  const getRows = useCallback(() => rowsRef.current, []);

  // A dashboard without widgets has nothing to view: editors start building
  // it right away (Notion parity). Decided once per mount (the component is
  // keyed by view), as soon as write access is known.
  const openModeDecidedRef = useRef(false);
  // Set while Edit mode is only on because the layout looked empty. The doc
  // may come from a stale local cache, so widgets that arrive with the server
  // sync (before the editor started building) switch back to View mode.
  const autoEditRef = useRef<'off' | 'requested' | 'active'>('off');

  useEffect(() => {
    if (openModeDecidedRef.current || !canEdit) return;
    openModeDecidedRef.current = true;
    if (shouldOpenInEditMode({ canEdit, rows: rowsRef.current })) {
      autoEditRef.current = 'requested';
      setEditing(true);
    }
  }, [canEdit, setEditing]);

  useEffect(() => {
    if (autoEditRef.current === 'off') return;
    if (editing) {
      if (rows.length > 0) {
        autoEditRef.current = 'off';
        setEditing(false);
        return;
      }

      autoEditRef.current = 'active';
      return;
    }

    // The editor left Edit mode themselves.
    if (autoEditRef.current === 'active') autoEditRef.current = 'off';
  }, [editing, rows, setEditing]);

  const acquireSourceDoc = useSourceDocRegistry(registerSourceDoc, hostDatabaseId);
  const { createView, canCreateInOtherDatabases, bridge } = useCreateWidgetView();
  const { databases: catalog } = useWorkspaceDatabases(workspaceId, variant !== UIVariant.Publish);

  const showLimitMessage = useCallback((reason: DashboardLimitReason) => {
    setLimitMessage((current) => ({ reason, key: (current?.key ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!limitMessage) return;
    const timeout = window.setTimeout(() => setLimitMessage(null), DASHBOARD_LIMIT_MESSAGE_DURATION);

    return () => window.clearTimeout(timeout);
  }, [limitMessage]);

  // The picker only makes sense while editing.
  useEffect(() => {
    if (!editing) setPickerRequest(null);
  }, [editing]);

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
      const element = Array.from(
        scrollRef.current?.querySelectorAll<HTMLElement>('[data-testid="dashboard-widget"]') ?? []
      ).find((candidate) => candidate.dataset.widgetId === widgetId);

      element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [rows]);

  const openPicker = useCallback(
    (request: WidgetPickerRequest) => {
      if (!canEdit) return;
      // The editor started building: keep Edit mode whatever the sync brings.
      autoEditRef.current = 'off';

      if (request.mode === 'add' && !canAddDashboardWidget(rowsRef.current, request.placement)) {
        const dashboardFull = !canAddDashboardWidget(rowsRef.current);

        showLimitMessage(dashboardFull ? 'dashboard' : 'row');
        return;
      }

      setPickerRequest(request);
    },
    [canEdit, showLimitMessage]
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
    },
    [showLimitMessage, updateRows]
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

      const viewId = await createView(createRequest);

      setPickerRequest((current) => (current === request ? null : current));
      applyPick(request, viewId, createRequest.databaseId);
      return viewId;
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
    }),
    [acquireSourceDoc, dndInstanceId, getRows, hostDatabaseId, openPicker, showLimitMessage, updateRows]
  );

  const handleAddFirstWidget = useCallback(
    () => openPicker({ mode: 'add', placement: { type: 'new_row' } }),
    [openPicker]
  );

  return (
    <DashboardHostContext.Provider value={hostServices}>
      <DashboardUiContext.Provider value={uiValue}>
        <DashboardDraggingContext.Provider value={draggingWidgetId}>
          <div
            className='relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden'
            data-dragging={draggingWidgetId ? 'true' : undefined}
            data-editing={editing ? 'true' : 'false'}
            data-testid='dashboard-view'
            ref={scrollRef}
          >
            <div
              className='flex w-full flex-col gap-3 pb-10 pt-3 max-sm:!px-6'
              style={getDashboardInlinePadding({
                paddingStart: paddingStart ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                paddingEnd: paddingEnd ?? DASHBOARD_DEFAULT_INLINE_PADDING,
                editing,
              })}
            >
              <GlobalFilterBar />
              {limitMessage ? (
                // Sticky, so the message stays in sight wherever the add was refused.
                <div className='pointer-events-none sticky top-2 z-30' key={limitMessage.key}>
                  <DashboardLimitMessage className='pointer-events-auto' reason={limitMessage.reason} />
                </div>
              ) : null}
              {rows.length === 0 ? <DashboardEmptyState onAddWidget={handleAddFirstWidget} /> : <DashboardGrid />}
            </div>
          </div>
          <WidgetPicker
            canCreateInOtherDatabases={canCreateInOtherDatabases}
            createView={handleCreateView}
            onClose={() => setPickerRequest(null)}
            onPick={handlePick}
            request={editing ? pickerRequest : null}
          />
          {bridge}
        </DashboardDraggingContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

export default Dashboard;
