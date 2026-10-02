import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import {
  memo,
  MouseEvent,
  MutableRefObject,
  RefObject,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

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
import { UIVariant, ViewLayout, YDoc } from '@/application/types';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { Database } from '@/components/database';
import { useDatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';
import {
  EmbeddedDatabasePermissions,
  EmbeddedDatabasePermissionsResolver,
} from '@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import {
  DASHBOARD_COLUMN_GAP,
  WIDGET_GRID_ROW_GUTTER,
  WIDGET_INLINE_PADDING,
  WIDGET_MISSING_GRACE_MS,
} from './constants';
import { useDashboardFilters, useDashboardSourceRegistry } from './DashboardContext';
import { useDashboardHost, useDashboardSelectedWidgetId, useDashboardUi } from './DashboardUiContext';
import { getDashboardFlexBasis } from './grid-layout';
import { useDraggableWidget, useWidgetDropTarget } from './hooks/useDashboardDnd';
import { ROW_HEIGHT_CSS_VARIABLE, RowHeightPreview } from './hooks/useRowHeightResize';
import { useWidgetExtraFilters } from './hooks/useWidgetExtraFilters';
import { useWidgetViewMeta } from './hooks/useWidgetViewMeta';
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

/**
 * Tells the dashboard whether this widget's source is writable: "Save for
 * everybody" leaves the private conditions of a read-only source alone.
 */
function OverlayWritability({
  widgetId,
  databaseId,
  viewId,
  canWrite,
}: {
  widgetId: string;
  databaseId: string;
  viewId: string;
  canWrite: boolean;
}) {
  const { setViewOverlayWritable } = useDashboardFilters();

  useEffect(() => {
    setViewOverlayWritable({ id: widgetId, databaseId, viewId }, canWrite);
  }, [canWrite, databaseId, setViewOverlayWritable, viewId, widgetId]);
  return null;
}

interface WidgetChromeProps {
  isEditing: boolean;
  canEdit: boolean;
  showWidgetTitles: boolean;
  showIconsInHeading: boolean;
  isDragging: boolean;
}

interface WidgetSourceProps extends WidgetChromeProps {
  // The ids rather than the widget object: a resize or move re-creates the
  // object, and the source has no use for the width.
  widgetId: string;
  viewId: string;
  databaseId: string;
  rowHeight: number;
  cardRef: RefObject<HTMLDivElement>;
  /** Set to "open the widget menu", for a right-click on the box. */
  openMenuRef: MutableRefObject<(() => void) | null>;
}

/**
 * Loads the widget's source database and renders it (or a placeholder).
 * Keyed by view + database so switching the view resets every loader. Reads
 * only stable dashboard contexts (and the global filters): layout changes
 * elsewhere on the dashboard never re-render it.
 */
const WidgetSource = memo(function WidgetSource({
  widgetId,
  viewId,
  databaseId,
  rowHeight,
  cardRef,
  openMenuRef,
  isDragging,
  isEditing,
  canEdit,
  showWidgetTitles,
  showIconsInHeading,
}: WidgetSourceProps) {
  const { t } = useTranslation();
  const widget = useMemo(() => ({ id: widgetId, viewId, databaseId }), [databaseId, viewId, widgetId]);
  const hostContext = useDashboardHost();
  const appOperations = useContext(AppOperationsContext);
  const { effectiveGlobalFilters, getViewOverlay } = useDashboardFilters();
  const {
    hostDatabaseId,
    openPicker,
    showLimitMessage,
    dndInstanceId,
    acquireSourceDoc,
    getRows,
    updateRows,
    selectWidget,
  } = useDashboardUi();
  const { markWidgetShown, getShownDoc } = useDashboardSourceRegistry();
  const isHost = widget.databaseId === hostDatabaseId;
  const isPublish = hostContext.variant === UIVariant.Publish;
  const editing = isEditing && canEdit;
  const { navigateToView, getViewIdFromDatabaseId, eventEmitter, workspaceId } = hostContext;

  const {
    doc: loadedDoc,
    notFound: loadFailed,
    noAccess,
    offline,
    setNotFound,
  } = useDocumentLoader({
    // The host database is already open; only other databases are loaded.
    viewId: isHost ? '' : widget.viewId,
    databaseId: widget.databaseId,
    loadView: hostContext.loadView,
    bindViewSync: hostContext.bindViewSync,
    eventEmitter,
  });
  // A widget moved to another row remounts: until its load confirms the doc,
  // it keeps showing what it showed itself instead of flashing the loading
  // placeholder. A widget that showed a placeholder (trash, no access) starts
  // over, even if another widget holds its database's doc.
  const [seedDoc] = useState(() => (isHost ? null : getShownDoc(widget.id, widget.viewId)));
  const doc: YDoc | null = isHost ? hostContext.databaseDoc : loadedDoc ?? seedDoc;
  // Only an opened doc can prove the view or its database missing: the load
  // may still fetch what a seeded doc lacks.
  const docOpened = Boolean(isHost ? doc : loadedDoc);
  const snapshot = useWidgetViewSnapshot(doc, widget.viewId);
  const meta = useWidgetViewMeta(widget.viewId);
  const trackDeletion = !isHost && !isPublish && Boolean(eventEmitter);
  // The probe runs from the ids, alongside the doc load. It may only clear
  // "not found" once the doc is open: a doc the loader gave up on stays a
  // not-found placeholder (the loader would not retry on its own).
  const loadedDocRef = useRef(loadedDoc);

  loadedDocRef.current = loadedDoc;
  const setProbeNotFound = useCallback(
    (value: boolean) => {
      if (value || loadedDocRef.current) setNotFound(value);
    },
    [setNotFound]
  );
  const deletionStatus = useDatabaseDeletionStatus({
    workspaceId,
    viewId: widget.viewId,
    databaseId: widget.databaseId,
    hasDatabase: trackDeletion,
    eventEmitter,
    notFound: loadFailed,
    setNotFound: setProbeNotFound,
  });
  const effectiveDeletionStatus = trackDeletion ? deletionStatus : 'none';
  const databaseMissing = useDelayedFlag(docOpened && !snapshot.hasDatabase, MISSING_DATABASE_GRACE_MS);
  const viewMissing = useDelayedFlag(docOpened && snapshot.hasDatabase && !snapshot.exists, WIDGET_MISSING_GRACE_MS);

  const status = getWidgetStatus({
    noAccess,
    loadFailed,
    offline,
    deletionStatus: effectiveDeletionStatus,
    databaseMissing,
    viewMissing,
    hasDoc: Boolean(doc),
    hasDatabase: snapshot.hasDatabase,
    viewExists: snapshot.exists,
    layout: snapshot.layout,
    seeded: Boolean(seedDoc),
  });

  const hasSourceDatabase = Boolean(doc) && snapshot.hasDatabase;

  // In View mode the widget's filters and sorts are the viewer's own copy
  // (Notion keeps them local until "Save for everybody"); Edit mode configures
  // the real view. Published dashboards stay read-only.
  // Resolved during render (the store is idempotent per widget id, like
  // `getDatabaseExternalStore`), so the nested database mounts with the
  // overlay instead of once without and once with it. The dashboard retains
  // private conditions across row moves and releases them only when the
  // widget is removed or points to another source.
  const realView = snapshot.view;
  const [overlayRevision, refreshOverlay] = useReducer((revision: number) => revision + 1, 0);
  const overlayView = useMemo(
    () =>
      isPublish || !doc || !hasSourceDatabase
        ? undefined
        : getViewOverlay({ id: widget.id, databaseId: widget.databaseId, viewId: widget.viewId }, realView),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayRevision re-asks the store after a StrictMode remount
    [
      doc,
      getViewOverlay,
      hasSourceDatabase,
      isPublish,
      overlayRevision,
      realView,
      widget.databaseId,
      widget.id,
      widget.viewId,
    ]
  );

  // StrictMode's simulated unmount clears the dashboard's store between this
  // render and the effects; take the store's fresh copy when it differs.
  useEffect(() => {
    if (!overlayView) return;
    const current = getViewOverlay({ id: widget.id, databaseId: widget.databaseId, viewId: widget.viewId }, realView);

    if (current !== overlayView) refreshOverlay();
  }, [getViewOverlay, overlayView, realView, widget.databaseId, widget.id, widget.viewId]);

  // Expose the source doc to the global-filter editor while the widget shows it.
  useEffect(() => {
    if (!doc || !hasSourceDatabase || isHost) return;
    return acquireSourceDoc(widget.databaseId, doc);
  }, [acquireSourceDoc, doc, hasSourceDatabase, isHost, widget.databaseId]);

  // What this widget shows, for its next instance after a move.
  useEffect(() => {
    if (!doc || isHost || status !== 'ready') return;
    return markWidgetShown(widget.id, widget.viewId, doc);
  }, [doc, isHost, markWidgetShown, status, widget.id, widget.viewId]);

  const layout: ViewLayout =
    snapshot.layout !== null ? databaseLayoutToViewLayout(snapshot.layout) : meta.layout ?? ViewLayout.Grid;
  const layoutLabel = getLayoutLabel(layout);
  const name = (meta.name || snapshot.name).trim() || t(layoutLabel.key, { defaultValue: layoutLabel.defaultValue });
  const [dragHandle, setDragHandle] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);

  // The menu and the settings host: one at a time. Opening either selects the
  // widget (an outline in Edit mode); closing it clears the selection unless
  // the other one took over.
  const [menuOpen, setMenuOpenState] = useState(false);
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const menuOpenRef = useRef(false);
  const settingsOpenRef = useRef(false);
  const setMenuOpen = useCallback(
    (open: boolean) => {
      menuOpenRef.current = open;
      setMenuOpenState(open);
      if (open) {
        settingsOpenRef.current = false;
        setSettingsOpenState(false);
        selectWidget(widget.id);
      } else if (!settingsOpenRef.current) {
        selectWidget(null, { onlyIf: widget.id });
      }
    },
    [selectWidget, widget.id]
  );
  const setSettingsOpen = useCallback(
    (open: boolean) => {
      settingsOpenRef.current = open;
      setSettingsOpenState(open);
      if (open) {
        menuOpenRef.current = false;
        setMenuOpenState(false);
        selectWidget(widget.id);
      } else if (!menuOpenRef.current) {
        selectWidget(null, { onlyIf: widget.id });
      }
    },
    [selectWidget, widget.id]
  );

  useEffect(() => {
    openMenuRef.current = () => setMenuOpen(true);
    return () => {
      openMenuRef.current = null;
    };
  }, [openMenuRef, setMenuOpen]);

  // The settings host only exists in Edit mode.
  useEffect(() => {
    if (!editing && settingsOpenRef.current) setSettingsOpen(false);
  }, [editing, setSettingsOpen]);

  const getBoxElement = useCallback(() => cardRef.current, [cardRef]);

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
      openSettings: () => setSettingsOpen(true),
    }),
    [getRows, openPicker, openView, setSettingsOpen, showLimitMessage, updateRows, widget.id]
  );

  const chrome = { showWidgetTitles };
  const headerHeight = getWidgetHeaderHeight(chrome);
  const viewportHeight = getWidgetViewportHeight(rowHeight, chrome);

  const contextValue = useMemo<WidgetContextValue>(
    () => ({
      widgetId: widget.id,
      databaseId: widget.databaseId,
      viewId: widget.viewId,
      name,
      icon: meta.icon,
      layout,
      isEditing,
      canEdit,
      editing,
      showWidgetTitles,
      showIcon: showIconsInHeading,
      headerHeight,
      isDragging,
      setDragHandle,
      menuOpen,
      setMenuOpen,
      settingsOpen,
      setSettingsOpen,
      getBoxElement,
      titleRef,
      optionsRef,
      actions,
    }),
    [
      actions,
      canEdit,
      editing,
      getBoxElement,
      headerHeight,
      isDragging,
      isEditing,
      layout,
      menuOpen,
      meta.icon,
      name,
      setMenuOpen,
      setSettingsOpen,
      settingsOpen,
      showIconsInHeading,
      showWidgetTitles,
      widget.databaseId,
      widget.id,
      widget.viewId,
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
  // The widget's layout switcher checks the workspace plan before offering
  // Timeline; without this it would report the plan as unavailable.
  const getSubscriptions = appOperations?.getSubscriptions;
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

      // A grid's rows show their hover controls in the start gutter, which
      // the widget padding cannot hold (the card would clip them): an
      // editable grid gets a gutter sized for the compact controls instead.
      const paddingStart =
        layout === ViewLayout.Grid && !permissions.readOnly ? WIDGET_GRID_ROW_GUTTER : WIDGET_INLINE_PADDING;

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
            getSubscriptions={getSubscriptions}
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
            paddingStart={paddingStart}
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
      getSubscriptions,
      getViewIdFromDatabaseId,
      handleOpenRowPage,
      initialRowMap,
      isHost,
      layout,
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
      <>
        <OverlayWritability
          canWrite={permissions.canWrite}
          databaseId={widget.databaseId}
          viewId={widget.viewId}
          widgetId={widget.id}
        />
        {renderDatabase(permissions)}
      </>
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
  /** Columns the box spans on its line: the stored width, or an equal share when the row wraps. */
  span: number;
  /** Widgets on the box's line (the flex basis subtracts their gaps). */
  lineSize: number;
  /** Persisted row height in CSS px. */
  height: number;
  /** The height being dragged, if any (see `useRowHeightResize`). */
  heightPreview: RowHeightPreview;
}

/** Editable targets keep the browser's own context menu. */
function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
  );
}

/**
 * One widget box: its place in the row track, the Edit-mode tint and
 * selection outline (colors only, never a size change), the drop target for
 * widgets dragged next to it, and the source view inside (header and card).
 * A right-click anywhere on the box opens the widget menu, unless the content
 * handles the context menu itself.
 */
export const DashboardWidget = memo(function DashboardWidget({
  widget,
  span,
  lineSize,
  height,
  heightPreview,
  isEditing,
  canEdit,
  showWidgetTitles,
  showIconsInHeading,
  isDragging,
}: DashboardWidgetProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const openMenuRef = useRef<(() => void) | null>(null);
  const { dndInstanceId, getRows } = useDashboardUi();
  const editing = isEditing && canEdit;
  const selected = useDashboardSelectedWidgetId() === widget.id && editing;
  // The box follows a row-height drag through CSS (the row's variable); the
  // nested database, whose viewport height derives from the number, catches
  // up when React has time instead of re-rendering on every pixel.
  const previewHeight = useSyncExternalStore(heightPreview.subscribe, heightPreview.get, heightPreview.get);
  const contentHeight = useDeferredValue(previewHeight ?? height);
  const indicator = useWidgetDropTarget({
    elementRef: cardRef,
    widgetId: widget.id,
    instanceId: dndInstanceId,
    enabled: editing,
    getRows,
  });
  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    event.preventDefault();
    openMenuRef.current?.();
  }, []);

  return (
    <div
      // `isolate` keeps the nested database's z-indexes (sticky headers, …)
      // below the dashboard's own chrome (handles, banners, drop indicators).
      // The outline is an inset shadow: drawn inside the box, never clipped.
      className={cn(
        'group/widget relative isolate flex min-w-0 flex-col rounded-500 px-1.5 pb-1.5',
        'transition-[background-color,box-shadow] duration-150 ease-in-out motion-reduce:transition-none',
        'group-data-[reflow=true]/row:transition-[flex-basis,background-color,box-shadow] group-data-[reflow=true]/row:duration-200',
        'data-[editing=true]:bg-dash-edit-tint data-[selected=true]:shadow-[inset_0_0_0_2px_var(--dash-accent)]',
        !showWidgetTitles && 'pt-1.5'
      )}
      data-database-id={widget.databaseId}
      data-dragging={isDragging ? 'true' : undefined}
      data-editing={editing ? 'true' : 'false'}
      data-parity-id='dash-widget-box'
      data-selected={selected ? 'true' : undefined}
      data-testid='dashboard-widget'
      data-view-id={widget.viewId}
      data-widget-id={widget.id}
      onContextMenu={handleContextMenu}
      ref={cardRef}
      style={{ flex: `1 1 ${getDashboardFlexBasis(span, lineSize)}`, height: `var(${ROW_HEIGHT_CSS_VARIABLE})` }}
    >
      <div className={cn('relative flex h-full min-h-0 w-full flex-col transition-opacity', isDragging && 'opacity-40')}>
        <WidgetSource
          canEdit={canEdit}
          cardRef={cardRef}
          databaseId={widget.databaseId}
          isDragging={isDragging}
          isEditing={isEditing}
          key={`${widget.databaseId}:${widget.viewId}`}
          openMenuRef={openMenuRef}
          rowHeight={contentHeight}
          showIconsInHeading={showIconsInHeading}
          showWidgetTitles={showWidgetTitles}
          viewId={widget.viewId}
          widgetId={widget.id}
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
          className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-500 border border-border-warning-thick bg-fill-warning-light p-4 text-center text-sm font-medium text-text-primary'
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
