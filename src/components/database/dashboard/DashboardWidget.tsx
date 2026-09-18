import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import {
  memo,
  RefObject,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import {
  duplicateDashboardWidget,
  moveDashboardWidget,
  removeDashboardWidget,
} from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardWidget as DashboardWidgetData,
} from '@/application/database-yjs/dashboard.type';
import { getPublishedDatabaseRenderRowMap } from '@/application/publish-snapshot/database-yjs-render-bridge';
import { UIVariant, View, ViewIcon, ViewLayout, YDatabaseView, YDoc } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { Database } from '@/components/database';
import { useDatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';
import {
  EmbeddedDatabasePermissions,
  EmbeddedDatabasePermissionsResolver,
} from '@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions';
import { useViewMeta } from '@/components/editor/components/blocks/database/hooks/useViewMeta';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import { DASHBOARD_COLUMN_GAP, WIDGET_INLINE_PADDING, WIDGET_MISSING_GRACE_MS } from './constants';
import { useDashboardFilters } from './DashboardContext';
import { useDashboardHost, useDashboardUi } from './DashboardUiContext';
import { useDraggableWidget, useWidgetDropTarget } from './hooks/useDashboardDnd';
import { useWidgetExtraFilters } from './hooks/useWidgetExtraFilters';
import { useDelayedFlag, useWidgetViewSnapshot } from './hooks/useWidgetViewSnapshot';
import { databaseLayoutToViewLayout, getLayoutLabel, getWidgetHeaderHeight, getWidgetViewportHeight } from './utils';
import { canDuplicateWidget, getWidgetMoveTargets, WidgetMoveDirection } from './widget-moves';
import { getWidgetStatus } from './widget-status';
import { WidgetBody } from './WidgetBody';
import { WidgetActions, WidgetContext, WidgetContextValue } from './WidgetContext';
import { WidgetHeaderFrame } from './WidgetHeader';
import { WidgetPlaceholder } from './WidgetPlaceholder';

/** A fresh doc that never receives its database is reported after this long. */
const MISSING_DATABASE_GRACE_MS = 10000;

const noop = () => undefined;

// Widgets re-render for their own chrome (title, Edit mode, drag state); the
// nested database only when one of its props changes.
const WidgetDatabase = memo(Database);

interface MetaOverride {
  name: string;
  icon: ViewIcon | null;
}

function sameIcon(a: ViewIcon | null, b: ViewIcon | null) {
  return a === b || (a !== null && b !== null && a.ty === b.ty && a.value === b.value);
}

/** Folder name / icon of the widget's view, following renames. */
function useWidgetViewMeta(viewId: string) {
  const { loadViewMeta, eventEmitter } = useDashboardHost();
  const { viewMeta } = useViewMeta({ viewId, loadViewMeta, ignoreMetaErrors: true });
  const [override, setOverride] = useState<MetaOverride | null>(null);

  useEffect(() => {
    if (!eventEmitter) return;

    // The outline reloads on every sidebar expand and folder sync: keep the
    // current override unless the name or icon really changed.
    const apply = (view: View) => {
      const icon = view.icon ?? null;

      setOverride((current) =>
        current && current.name === view.name && sameIcon(current.icon, icon) ? current : { name: view.name, icon }
      );
    };

    const handleViewChanged = (view: View) => {
      if (view.view_id === viewId) apply(view);
    };

    const handleOutlineLoaded = (outline: View[]) => {
      const view = findView(outline, viewId);

      if (view) apply(view);
    };

    eventEmitter.on(APP_EVENTS.VIEW_META_CHANGED, handleViewChanged);
    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    return () => {
      eventEmitter.off(APP_EVENTS.VIEW_META_CHANGED, handleViewChanged);
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    };
  }, [eventEmitter, viewId]);

  return {
    name: override?.name ?? viewMeta?.name ?? '',
    icon: override ? override.icon : viewMeta?.icon ?? null,
    layout: viewMeta?.layout,
  };
}

interface WidgetChromeProps {
  isEditing: boolean;
  canEdit: boolean;
  showWidgetTitles: boolean;
  isDragging: boolean;
}

interface WidgetSourceProps extends WidgetChromeProps {
  widget: DashboardWidgetData;
  rowHeight: number;
  cardRef: RefObject<HTMLDivElement>;
}

/**
 * Loads the widget's source database and renders it (or a placeholder).
 * Keyed by view + database so switching the view resets every loader. Reads
 * only stable dashboard contexts (and the global filters): layout changes
 * elsewhere on the dashboard never re-render it.
 */
const WidgetSource = memo(function WidgetSource({
  widget,
  rowHeight,
  cardRef,
  isDragging,
  isEditing,
  canEdit,
  showWidgetTitles,
}: WidgetSourceProps) {
  const { t } = useTranslation();
  const hostContext = useDashboardHost();
  const appOperations = useContext(AppOperationsContext);
  const { effectiveGlobalFilters, getViewOverlay } = useDashboardFilters();
  const { hostDatabaseId, openPicker, showLimitMessage, dndInstanceId, acquireSourceDoc, getRows, updateRows } =
    useDashboardUi();
  const isHost = widget.databaseId === hostDatabaseId;
  const isPublish = hostContext.variant === UIVariant.Publish;
  const editing = isEditing && canEdit;
  const { navigateToView, getViewIdFromDatabaseId, eventEmitter, workspaceId } = hostContext;

  const {
    doc: loadedDoc,
    notFound: loadFailed,
    noAccess,
    setNotFound,
  } = useDocumentLoader({
    // The host database is already open; only other databases are loaded.
    viewId: isHost ? '' : widget.viewId,
    databaseId: widget.databaseId,
    loadView: hostContext.loadView,
    bindViewSync: hostContext.bindViewSync,
    eventEmitter,
  });
  const doc: YDoc | null = isHost ? hostContext.databaseDoc : loadedDoc;
  const snapshot = useWidgetViewSnapshot(doc, widget.viewId);
  const meta = useWidgetViewMeta(widget.viewId);
  const trackDeletion = !isHost && !isPublish && Boolean(eventEmitter);
  const deletionStatus = useDatabaseDeletionStatus({
    workspaceId,
    viewId: widget.viewId,
    databaseId: widget.databaseId,
    // The probe only needs the ids: it runs alongside the doc load.
    hasDatabase: trackDeletion,
    eventEmitter,
    notFound: loadFailed,
    setNotFound,
  });
  const effectiveDeletionStatus = trackDeletion ? deletionStatus : 'none';
  const databaseMissing = useDelayedFlag(Boolean(doc) && !snapshot.hasDatabase, MISSING_DATABASE_GRACE_MS);
  const viewMissing = useDelayedFlag(Boolean(doc) && snapshot.hasDatabase && !snapshot.exists, WIDGET_MISSING_GRACE_MS);

  const status = getWidgetStatus({
    noAccess,
    loadFailed,
    deletionStatus: effectiveDeletionStatus,
    databaseMissing,
    viewMissing,
    hasDoc: Boolean(doc),
    hasDatabase: snapshot.hasDatabase,
    viewExists: snapshot.exists,
    layout: snapshot.layout,
  });

  const hasSourceDatabase = Boolean(doc) && snapshot.hasDatabase;

  // In View mode the widget's filters and sorts are the viewer's own copy
  // (Notion keeps them local until "Save for everybody"); Edit mode configures
  // the real view. Published dashboards stay read-only.
  const realView = snapshot.view;
  const [overlayView, setOverlayView] = useState<YDatabaseView>();

  useEffect(() => {
    if (isPublish || !doc || !hasSourceDatabase) return;
    setOverlayView(getViewOverlay({ id: widget.id, databaseId: widget.databaseId, viewId: widget.viewId }, realView));
    // The dashboard retains private conditions across row moves and releases
    // them only when the widget is removed or points to another source.
  }, [doc, getViewOverlay, hasSourceDatabase, isPublish, realView, widget.databaseId, widget.id, widget.viewId]);

  // Expose the source doc to the global-filter editor while the widget shows it.
  useEffect(() => {
    if (!doc || !hasSourceDatabase || isHost) return;
    return acquireSourceDoc(widget.databaseId, doc);
  }, [acquireSourceDoc, doc, hasSourceDatabase, isHost, widget.databaseId]);

  const layout: ViewLayout =
    snapshot.layout !== null ? databaseLayoutToViewLayout(snapshot.layout) : meta.layout ?? ViewLayout.Grid;
  const layoutLabel = getLayoutLabel(layout);
  const name = (meta.name || snapshot.name).trim() || t(layoutLabel.key, { defaultValue: layoutLabel.defaultValue });
  const [dragHandle, setDragHandle] = useState<HTMLElement | null>(null);

  useDraggableWidget({
    handle: dragHandle,
    widgetId: widget.id,
    instanceId: dndInstanceId,
    enabled: editing,
    label: name,
    getCardElement: () => cardRef.current,
  });

  const openView = useCallback(async () => {
    if (!navigateToView) return;

    try {
      await navigateToView(widget.viewId);
      return;
    } catch (error) {
      Log.warn('[Dashboard] failed to open the widget view, opening its database instead', error);
    }

    try {
      const fallbackViewId = await getViewIdFromDatabaseId?.(widget.databaseId);

      if (fallbackViewId) await navigateToView(fallbackViewId);
    } catch (error) {
      Log.error('[Dashboard] failed to open the widget database', error);
    }
  }, [getViewIdFromDatabaseId, navigateToView, widget.databaseId, widget.viewId]);

  // What the menu can do is computed by the menu while it is open, so the
  // actions never change with the layout.
  const actions = useMemo<WidgetActions>(
    () => ({
      open: () => void openView(),
      changeView: () => openPicker({ mode: 'replace', widgetId: widget.id }),
      duplicate: () => {
        if (!canDuplicateWidget(getRows(), widget.id)) {
          showLimitMessage('dashboard');
          return;
        }

        updateRows((current) => duplicateDashboardWidget(current, widget.id));
      },
      remove: () => updateRows((current) => removeDashboardWidget(current, widget.id)),
      move: (direction: WidgetMoveDirection) =>
        updateRows((current) => {
          const placement = getWidgetMoveTargets(current, widget.id)[direction];

          return placement ? moveDashboardWidget(current, widget.id, placement) : current;
        }),
    }),
    [getRows, openPicker, openView, showLimitMessage, updateRows, widget.id]
  );

  const chrome = { isEditing: editing, showWidgetTitles };
  const headerHeight = getWidgetHeaderHeight(chrome);
  const viewportHeight = getWidgetViewportHeight(rowHeight, chrome);

  const contextValue = useMemo<WidgetContextValue>(
    () => ({
      widgetId: widget.id,
      name,
      icon: meta.icon,
      layout,
      isEditing,
      canEdit,
      showTitle: editing || showWidgetTitles,
      headerHeight,
      isDragging,
      setDragHandle,
      actions,
    }),
    [
      actions,
      canEdit,
      editing,
      headerHeight,
      isDragging,
      isEditing,
      layout,
      meta.icon,
      name,
      showWidgetTitles,
      widget.id,
    ]
  );

  // The host's permissions are those of its database, which is the widget's.
  const hostPermissions = useMemo<EmbeddedDatabasePermissions>(
    () => ({
      readOnly: hostContext.readOnly,
      canWrite: hostContext.canWrite ?? !hostContext.readOnly,
      canShare: hostContext.canShare ?? false,
    }),
    [hostContext.canShare, hostContext.canWrite, hostContext.readOnly]
  );
  const extraFilters = useWidgetExtraFilters(effectiveGlobalFilters, widget.databaseId);
  const visibleViewIds = useMemo(() => [widget.viewId], [widget.viewId]);
  const createRow = appOperations?.createRow ?? hostContext.createRow;
  const initialRowMap = useMemo(() => (isPublish ? getPublishedDatabaseRenderRowMap(doc) : undefined), [doc, isPublish]);
  const handleOpenRowPage = useCallback(
    (rowIdToOpen: string) => {
      void navigateToView?.(widget.viewId, rowIdToOpen);
    },
    [navigateToView, widget.viewId]
  );

  const {
    canComment,
    variant,
    loadView,
    bindViewSync,
    checkIfRowDocumentExists,
    loadRowDocument,
    createRowDocument,
    duplicateRowDocument,
    loadViewMeta,
    createDatabaseView,
    loadDatabaseRelations,
    searchMentions,
    loadViews,
    addPage,
    openPageModal,
    updatePage,
    duplicatePage,
    deletePage,
    uploadFile,
    generateAISummaryForRow,
    generateAITranslateForRow,
    scheduleDeferredCleanup,
  } = hostContext;

  // Only the host's app-level services are forwarded (not its row map or
  // lifecycle-bound helpers): `DashboardHostContext` keeps them stable, so
  // host row churn never re-renders widgets.
  const renderDatabase = useCallback(
    (permissions: EmbeddedDatabasePermissions) => {
      if (!doc) return null;

      return (
        <Suspense fallback={<WidgetPlaceholder reason='loading' />}>
          <WidgetDatabase
            activeViewId={widget.viewId}
            addPage={addPage}
            bindViewSync={bindViewSync}
            canComment={isHost ? canComment : permissions.canWrite}
            canShare={permissions.canShare}
            canWrite={permissions.canWrite}
            checkIfRowDocumentExists={checkIfRowDocumentExists}
            createDatabaseView={createDatabaseView}
            createRow={createRow}
            createRowDocument={createRowDocument}
            databaseName={name}
            databasePageId={widget.viewId}
            deletePage={deletePage}
            doc={doc}
            duplicatePage={duplicatePage}
            duplicateRowDocument={duplicateRowDocument}
            embeddedHeight={viewportHeight}
            eventEmitter={eventEmitter}
            extraFilters={extraFilters}
            generateAISummaryForRow={generateAISummaryForRow}
            generateAITranslateForRow={generateAITranslateForRow}
            getViewIdFromDatabaseId={getViewIdFromDatabaseId}
            initialRowMap={initialRowMap}
            isDashboardWidget
            isDocumentBlock
            loadDatabaseRelations={loadDatabaseRelations}
            loadRowDocument={loadRowDocument}
            loadView={loadView}
            loadViewMeta={loadViewMeta}
            loadViews={loadViews}
            navigateToView={navigateToView}
            onChangeView={noop}
            onOpenRowPage={handleOpenRowPage}
            openPageModal={openPageModal}
            paddingEnd={WIDGET_INLINE_PADDING}
            paddingStart={WIDGET_INLINE_PADDING}
            readOnly={permissions.readOnly}
            scheduleDeferredCleanup={scheduleDeferredCleanup}
            searchMentions={searchMentions}
            showActions
            updatePage={updatePage}
            uploadFile={uploadFile}
            variant={variant}
            viewConditionsOverlay={editing || isPublish ? undefined : overlayView}
            visibleViewIds={visibleViewIds}
            workspaceId={workspaceId}
          />
        </Suspense>
      );
    },
    [
      addPage,
      bindViewSync,
      canComment,
      checkIfRowDocumentExists,
      createDatabaseView,
      createRow,
      createRowDocument,
      deletePage,
      doc,
      duplicatePage,
      duplicateRowDocument,
      eventEmitter,
      extraFilters,
      generateAISummaryForRow,
      generateAITranslateForRow,
      getViewIdFromDatabaseId,
      handleOpenRowPage,
      initialRowMap,
      isHost,
      loadDatabaseRelations,
      loadRowDocument,
      loadView,
      loadViewMeta,
      loadViews,
      name,
      navigateToView,
      openPageModal,
      overlayView,
      editing,
      isPublish,
      scheduleDeferredCleanup,
      searchMentions,
      updatePage,
      uploadFile,
      variant,
      viewportHeight,
      visibleViewIds,
      widget.viewId,
      workspaceId,
    ]
  );

  // The placeholder and the database render inside the permission resolver,
  // so the source permission probe starts with the doc load instead of after
  // it (and after the deletion probe): the nested database then mounts with
  // its real permissions and starts its row prefetch at once.
  const renderContent = (permissions: EmbeddedDatabasePermissions) =>
    status === 'ready' ? (
      renderDatabase(permissions)
    ) : (
      <>
        <WidgetHeaderFrame />
        <WidgetBody>
          <WidgetPlaceholder onRemove={editing && status !== 'loading' ? actions.remove : undefined} reason={status} />
        </WidgetBody>
      </>
    );

  return (
    <WidgetContext.Provider value={contextValue}>
      {isHost ? (
        renderContent(hostPermissions)
      ) : (
        <EmbeddedDatabasePermissionsResolver
          inheritedReadOnly={hostContext.readOnly}
          publishCanShare={hostContext.canShare}
          publishCanWrite={hostContext.canWrite}
          sourceDatabaseId={widget.databaseId}
          sourceViewId={widget.viewId}
          variant={hostContext.variant}
        >
          {renderContent}
        </EmbeddedDatabasePermissionsResolver>
      )}
    </WidgetContext.Provider>
  );
});

interface DashboardWidgetProps extends WidgetChromeProps {
  widget: DashboardWidgetData;
  /** Grid columns the card spans (12 when the dashboard is stacked). */
  span: number;
  /** Row height in CSS px (includes a live resize preview). */
  height: number;
}

/**
 * One widget card: grid placement, Edit-mode chrome, drop target for widgets
 * dragged next to it, and the source view inside.
 */
export const DashboardWidget = memo(function DashboardWidget({
  widget,
  span,
  height,
  isEditing,
  canEdit,
  showWidgetTitles,
  isDragging,
}: DashboardWidgetProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const { dndInstanceId, getRows } = useDashboardUi();
  const editing = isEditing && canEdit;
  // The card follows a row-height drag on every pointer move; the nested
  // database (whose viewport height derives from it) catches up when React
  // has time, instead of re-rendering on every pixel.
  const contentHeight = useDeferredValue(height);
  const indicator = useWidgetDropTarget({
    elementRef: cardRef,
    widgetId: widget.id,
    instanceId: dndInstanceId,
    enabled: editing,
    getRows,
  });

  return (
    <div
      // `isolate` keeps the nested database's z-indexes (sticky headers, …)
      // below the dashboard's own chrome (handles, banners, drop indicators).
      className='group/widget relative isolate flex min-w-0 flex-col'
      data-database-id={widget.databaseId}
      data-dragging={isDragging ? 'true' : undefined}
      data-testid='dashboard-widget'
      data-view-id={widget.viewId}
      data-widget-id={widget.id}
      ref={cardRef}
      style={{ gridColumn: `span ${span} / span ${span}`, height }}
    >
      <div
        className={cn(
          'relative flex h-full min-h-0 w-full flex-col transition-opacity',
          editing &&
            'overflow-hidden rounded-400 border border-border-primary bg-background-primary shadow-card transition-shadow hover:ring-1 hover:ring-border-theme-thick',
          isDragging && 'opacity-40'
        )}
      >
        <WidgetSource
          canEdit={canEdit}
          cardRef={cardRef}
          isDragging={isDragging}
          isEditing={isEditing}
          key={`${widget.databaseId}:${widget.viewId}`}
          rowHeight={contentHeight}
          showWidgetTitles={showWidgetTitles}
          widget={widget}
        />
      </div>
      {indicator ? (
        <DropIndicator
          appearance={indicator.blocked ? 'warning' : 'default'}
          edge={indicator.edge}
          gap={`${DASHBOARD_COLUMN_GAP}px`}
        />
      ) : null}
      {indicator?.blocked ? (
        <div
          className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-400 border border-border-warning-thick bg-fill-warning-light p-4 text-center text-sm font-medium text-text-primary'
          data-testid='dashboard-drop-not-allowed'
          role='status'
        >
          {t('dashboard.rowLimit', {
            count: DASHBOARD_MAX_WIDGETS_PER_ROW,
            defaultValue: 'A row holds up to {{count}} widgets.',
          })}
        </div>
      ) : null}
    </div>
  );
});

export default DashboardWidget;
