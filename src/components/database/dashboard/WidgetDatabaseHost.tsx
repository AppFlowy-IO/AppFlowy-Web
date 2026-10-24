import { ComponentProps, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { isDatabaseSourceResident } from '@/application/database-blob';
import { setOverlaySuspended } from '@/application/database-yjs/view-conditions-overlay';
import { getPublishedDatabaseRenderRowMap } from '@/application/publish-snapshot/database-yjs-render-bridge';
import { UIVariant, ViewLayout, YDatabaseView, YDoc, YjsDatabaseKey } from '@/application/types';
import { Database } from '@/components/database';
import {
  EmbeddedDatabasePermissions,
  EmbeddedDatabasePermissionsResolver,
  EmbeddedDatabasePermissionsStatus,
} from '@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions';

import { WIDGET_GRID_ROW_GUTTER, WIDGET_INLINE_PADDING } from './constants';
import { useDashboardFilters } from './DashboardContext';
import { useReportSourceRows } from './DashboardLoadScheduler';
import { useDashboardHost } from './DashboardUiContext';
import { useWidgetExtraFilters } from './hooks/useWidgetExtraFilters';
import { useWidgetOverlayView } from './hooks/useWidgetOverlayView';
import { useWidgetSource, WidgetSourceIdentity } from './hooks/useWidgetSource';
import { WidgetCompositionProvider } from './WidgetCompositionProvider';
import { useWidgetContext, WidgetFrame } from './WidgetContext';
import { WidgetContextProvider, WidgetPlaceholderFrame } from './WidgetFrame';
import { WidgetPlaceholder } from './WidgetPlaceholder';

import type { WidgetLoadReport } from './load-scheduler';
import type { WidgetStatus } from './widget-status';

const noop = () => undefined;

/** The host's own permissions are known: nothing to wait for. */
const SETTLED: EmbeddedDatabasePermissionsStatus = { settled: true };

/** A placeholder the widget keeps until its source changes: its load is over. */
function isUnavailable(status: WidgetStatus) {
  return status !== 'ready' && status !== 'loading';
}

// Widgets re-render for their own chrome (title, Edit mode, drag state); the
// nested database only when one of its props changes. Its views render the
// widget header this chunk provides (`WidgetCompositionProvider`).
const WidgetDatabase = memo(function WidgetDatabase(props: ComponentProps<typeof Database>) {
  return (
    <WidgetCompositionProvider>
      <Database {...props} />
    </WidgetCompositionProvider>
  );
});

/**
 * Tells the dashboard whether this widget's source is writable: "Save for
 * everybody" leaves the private conditions of a read-only source alone.
 */
function OverlayWritability({ widgetId, databaseId, viewId, canWrite }: WidgetSourceIdentity & { canWrite: boolean }) {
  const { setViewOverlayWritable } = useDashboardFilters();

  useEffect(() => {
    setViewOverlayWritable({ id: widgetId, databaseId, viewId }, canWrite);
  }, [canWrite, databaseId, setViewOverlayWritable, viewId, widgetId]);
  return null;
}

interface NestedDatabaseProps {
  doc: YDoc;
  /** The widget shows the dashboard's own database. */
  isHost: boolean;
  permissions: EmbeddedDatabasePermissions;
  viewportHeight: number;
  overlayView: YDatabaseView | undefined;
  extraFilters: DashboardExtraFilter[] | undefined;
  onLoadStateChange: ((report: WidgetLoadReport) => void) | undefined;
}

/**
 * The widget's database. Only the host's app-level services are forwarded
 * (not its row map or lifecycle-bound helpers): `DashboardHostContext` keeps
 * them stable, so host row churn never re-renders a widget's database.
 */
function NestedDatabase({
  doc,
  isHost,
  permissions,
  viewportHeight,
  overlayView,
  extraFilters,
  onLoadStateChange,
}: NestedDatabaseProps) {
  const host = useDashboardHost();
  const { viewId, name, layout, editing } = useWidgetContext();
  const { navigateToView } = host;
  const isPublish = host.variant === UIVariant.Publish;

  // The source document and the permission probe settled: the queue's source
  // load timeout no longer applies to this widget (fix B4).
  useEffect(() => {
    onLoadStateChange?.('opened');
  }, [onLoadStateChange]);
  // Edit mode configures the real view: the viewer's private conditions are
  // set aside and the overlay writes through to the real view until Done. It
  // stays the nested database's view in both modes, so the toggle re-renders
  // no cell or card (only a part whose private copy differs changes).
  useLayoutEffect(() => {
    if (overlayView) setOverlaySuspended(overlayView, editing);
  }, [editing, overlayView]);
  const visibleViewIds = useMemo(() => [viewId], [viewId]);
  const initialRowMap = useMemo(() => (isPublish ? getPublishedDatabaseRenderRowMap(doc) : undefined), [doc, isPublish]);
  const handleOpenRowPage = useCallback(
    (rowId: string) => {
      void navigateToView?.(viewId, rowId);
    },
    [navigateToView, viewId]
  );
  // A grid's rows show their hover controls in the start gutter, which the
  // widget padding cannot hold (the card would clip them): an editable grid
  // gets a gutter sized for the compact controls instead.
  const paddingStart =
    layout === ViewLayout.Grid && !permissions.readOnly ? WIDGET_GRID_ROW_GUTTER : WIDGET_INLINE_PADDING;

  return (
    <Suspense fallback={<WidgetPlaceholder reason='loading' />}>
      <WidgetDatabase
        activeViewId={viewId}
        addPage={host.addPage}
        bindViewSync={host.bindViewSync}
        canComment={isHost ? host.canComment : permissions.canWrite}
        canShare={permissions.canShare}
        canWrite={permissions.canWrite}
        checkIfRowDocumentExists={host.checkIfRowDocumentExists}
        createDatabaseView={host.createDatabaseView}
        createRow={host.createRow}
        createRowDocument={host.createRowDocument}
        databaseName={name}
        databasePageId={viewId}
        deletePage={host.deletePage}
        doc={doc}
        duplicatePage={host.duplicatePage}
        duplicateRowDocument={host.duplicateRowDocument}
        embeddedHeight={viewportHeight}
        eventEmitter={host.eventEmitter}
        extraFilters={extraFilters}
        generateAISummaryForRow={host.generateAISummaryForRow}
        generateAITranslateForRow={host.generateAITranslateForRow}
        getSubscriptions={host.getSubscriptions}
        getViewIdFromDatabaseId={host.getViewIdFromDatabaseId}
        initialRowMap={initialRowMap}
        isDashboardWidget
        isDocumentBlock
        loadDatabaseRelations={host.loadDatabaseRelations}
        loadRowDocument={host.loadRowDocument}
        loadView={host.loadView}
        loadViewMeta={host.loadViewMeta}
        loadViews={host.loadViews}
        navigateToView={navigateToView}
        onChangeView={noop}
        onLoadStateChange={onLoadStateChange}
        onOpenRowPage={handleOpenRowPage}
        openPageModal={host.openPageModal}
        paddingEnd={WIDGET_INLINE_PADDING}
        paddingStart={paddingStart}
        readOnly={permissions.readOnly}
        scheduleDeferredCleanup={host.scheduleDeferredCleanup}
        searchMentions={host.searchMentions}
        showActions
        updatePage={host.updatePage}
        uploadFile={host.uploadFile}
        variant={host.variant}
        // Published dashboards have no private conditions. In Edit mode a
        // read-only source's conditions stay read-only: no overlay there.
        viewConditionsOverlay={isPublish || (editing && permissions.readOnly) ? undefined : overlayView}
        visibleViewIds={visibleViewIds}
        workspaceId={host.workspaceId}
      />
    </Suspense>
  );
}

export interface WidgetDatabaseHostProps {
  /**
   * The frame's state from `WidgetSource` (ids, mode, menu and settings state,
   * actions). The host completes it with the view's name and layout from the
   * source database and provides it as the `WidgetContext`.
   */
  frame: WidgetFrame;
  /** Height of the card in CSS px: the viewport handed to the nested database. */
  viewportHeight: number;
  /**
   * Reports the load to the dashboard's queue: the nested database's
   * `first-data`, `complete` and `failed`, and `unavailable` when the widget
   * shows a placeholder for good (deleted, no access, offline, unsupported).
   * Stable, or the nested database re-renders.
   */
  onLoadStateChange?: (report: WidgetLoadReport) => void;
}

/**
 * Opens a widget's source database and renders it inside the widget's frame,
 * or the frame's placeholder while it cannot (loading, deleted, no access,
 * offline, a nested dashboard).
 *
 * Mounting it is what starts the work: it owns the document load
 * (`useWidgetSource`), the permission probe and the nested `Database`. A
 * widget whose load must wait renders
 * `<WidgetContextProvider frame={frame} sourceView={null}><WidgetPlaceholderFrame reason='loading' /></WidgetContextProvider>`
 * instead and mounts the host when it may start; unmounting the host drops
 * the load and releases the source doc. A widget of the host database loads
 * nothing: that doc is already open.
 */
export function WidgetDatabaseHost({ frame, viewportHeight, onLoadStateChange }: WidgetDatabaseHostProps) {
  const { widgetId, viewId, databaseId } = frame;
  const hostContext = useDashboardHost();
  const { effectiveGlobalFilters } = useDashboardFilters();
  const source = useWidgetSource({ widgetId, viewId, databaseId });
  const { doc, status, isHost } = source;
  const overlayView = useWidgetOverlayView({
    widgetId,
    viewId,
    databaseId,
    doc: source.hasDatabase ? doc : null,
    realView: source.snapshot.view,
    enabled: hostContext.variant !== UIVariant.Publish,
  });
  const extraFilters = useWidgetExtraFilters(effectiveGlobalFilters, databaseId, source.hasDatabase ? doc : null);
  const unavailable = isUnavailable(status);

  // A placeholder for good ends the load: the source's slot goes to the next
  // widget, once the document request is no longer out (a probe can call the
  // source unavailable first; its request in flight must not overlap the next
  // source's, which would put a third database on the wire).
  const loadInFlight = source.loadInFlight;

  useEffect(() => {
    if (unavailable && !loadInFlight) onLoadStateChange?.('unavailable');
  }, [loadInFlight, onLoadStateChange, unavailable]);

  // Fix B3 (LOADING-DESIGN R8): a row load that failed says so in the card
  // ("Some rows haven't loaded yet") with a retry that mounts the nested
  // database again, so it reads its rows from the start.
  const [rowsLoadFailed, setRowsLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setRowsLoadFailed(false);
  }, [databaseId, viewId]);
  // Stable while the dashboard's report callback is, or the nested database re-renders.
  const handleLoadStateChange = useCallback(
    (report: WidgetLoadReport) => {
      if (report === 'failed') setRowsLoadFailed(true);
      onLoadStateChange?.(report);
    },
    [onLoadStateChange]
  );
  const retryRowsLoad = useCallback(() => {
    setRowsLoadFailed(false);
    setRetryKey((key) => key + 1);
  }, []);
  const cardFrame = useMemo<WidgetFrame>(
    () => ({ ...frame, rowsLoadFailed, retryRowsLoad }),
    [frame, retryRowsLoad, rowsLoadFailed]
  );

  // The open source's size, for the dashboard's row budget.
  useReportSourceRows(databaseId, source.snapshot.view?.get(YjsDatabaseKey.row_orders)?.length);
  // The host's permissions are those of its database, which is the widget's.
  const hostPermissions = useMemo<EmbeddedDatabasePermissions>(
    () => ({
      readOnly: hostContext.readOnly,
      canWrite: hostContext.canWrite ?? !hostContext.readOnly,
      canShare: hostContext.canShare ?? false,
    }),
    [hostContext.canShare, hostContext.canWrite, hostContext.readOnly]
  );

  // The placeholder and the database render inside the permission resolver,
  // so the source permission probe starts with the doc load instead of after
  // it (and after the deletion probe).
  const renderContent = (permissions: EmbeddedDatabasePermissions, access = SETTLED) => {
    if (access.settled && access.canRead === false) return <WidgetPlaceholderFrame reason='no-access' />;
    if (status !== 'ready') return <WidgetPlaceholderFrame reason={status} />;
    // New sources wait for the probe; resident sources keep their verified
    // answer while it refreshes. Invalidation drops that answer immediately.
    // Mounting read-only meanwhile would load rows one by one, then restart
    // the source's shared walk once it becomes writable.
    if (!access.settled) return <WidgetPlaceholderFrame reason='loading' />;

    return (
      <>
        <OverlayWritability
          canWrite={permissions.canWrite}
          databaseId={databaseId}
          viewId={viewId}
          widgetId={widgetId}
        />
        {doc ? (
          <NestedDatabase
            key={retryKey}
            doc={doc}
            extraFilters={extraFilters}
            isHost={isHost}
            onLoadStateChange={handleLoadStateChange}
            overlayView={overlayView}
            permissions={permissions}
            viewportHeight={viewportHeight}
          />
        ) : null}
      </>
    );
  };

  return (
    <WidgetContextProvider frame={cardFrame} sourceView={doc ? source.snapshot : null}>
      {isHost ? (
        renderContent(hostPermissions)
      ) : (
        <EmbeddedDatabasePermissionsResolver
          inheritedReadOnly={hostContext.readOnly}
          publishCanShare={hostContext.canShare}
          publishCanWrite={hostContext.canWrite}
          sourceDatabaseId={databaseId}
          sourceViewId={viewId}
          variant={hostContext.variant}
          permissionOptions={{
            allowCachedPermission: source.seeded || isDatabaseSourceResident(databaseId),
            eventEmitter: hostContext.eventEmitter,
          }}
        >
          {renderContent}
        </EmbeddedDatabasePermissionsResolver>
      )}
    </WidgetContextProvider>
  );
}

export default WidgetDatabaseHost;
