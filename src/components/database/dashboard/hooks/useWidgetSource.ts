import { useCallback, useEffect, useRef, useState } from 'react';

import { UIVariant, YDoc } from '@/application/types';
import { useDatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';

import { WIDGET_MISSING_GRACE_MS } from '../constants';
import { useDashboardSourceRegistry } from '../DashboardContext';
import { useDashboardHost, useDashboardUi } from '../DashboardUiContext';
import { getWidgetStatus, WidgetStatus } from '../widget-status';

import { useDelayedFlag, useWidgetViewSnapshot, WidgetViewSnapshot } from './useWidgetViewSnapshot';

/** A fresh doc that never receives its database is reported after this long. */
const MISSING_DATABASE_GRACE_MS = 10000;

/** The view a widget shows: stable while the widget keeps its source. */
export interface WidgetSourceIdentity {
  widgetId: string;
  viewId: string;
  databaseId: string;
}

export interface WidgetSource {
  /** The source database's doc: the host's own, the loaded one, or the one the widget showed before it moved. */
  doc: YDoc | null;
  /** What the widget shows: its database (`ready`) or the reason it cannot. */
  status: WidgetStatus;
  /** The widget shows the dashboard's own database, which is already open: nothing is loaded. */
  isHost: boolean;
  /** `doc` holds a database (false while a fresh doc is still syncing). */
  hasDatabase: boolean;
  /** The view as `doc` stores it: the view itself, its name and its layout (nothing without a doc). */
  snapshot: WidgetViewSnapshot;
  /** The widget remounted (a move) and starts from the doc it showed as ready. */
  seeded: boolean;
  /**
   * The source document load is still in flight. A placeholder decided
   * meanwhile (the trash probe answered first) ends the load only once the
   * request settles: until then the source still holds its load slot.
   */
  loadInFlight: boolean;
}

/**
 * Opens the source database of a widget and tells what the widget shows.
 * Calling it starts the load of a database other than the host's, probes
 * whether that database is in the trash, and registers the open doc with the
 * dashboard (for the global-filter editor, and for this widget's next
 * instance after a move).
 */
export function useWidgetSource({ widgetId, viewId, databaseId }: WidgetSourceIdentity): WidgetSource {
  const hostContext = useDashboardHost();
  const { hostDatabaseId, acquireSourceDoc } = useDashboardUi();
  const { markWidgetShown, getShownDoc } = useDashboardSourceRegistry();
  const { eventEmitter, workspaceId } = hostContext;
  const isHost = databaseId === hostDatabaseId;
  const isPublish = hostContext.variant === UIVariant.Publish;

  const {
    doc: loadedDoc,
    notFound: loadFailed,
    noAccess,
    offline,
    loading: loadInFlight,
    setNotFound,
  } = useDocumentLoader({
    // The host database is already open; only other databases are loaded.
    viewId: isHost ? '' : viewId,
    databaseId,
    loadView: hostContext.loadView,
    bindViewSync: hostContext.bindViewSync,
    // The widget owns one sync binding of its source and gives it back when it unmounts.
    scheduleDeferredCleanup: hostContext.scheduleDeferredCleanup,
    eventEmitter,
  });
  // A widget moved to another row remounts: until its load confirms the doc,
  // it keeps showing what it showed itself instead of flashing the loading
  // placeholder. A widget that showed a placeholder (trash, no access) starts
  // over, even if another widget holds its database's doc.
  const [seedDoc] = useState(() => (isHost ? null : getShownDoc(widgetId, viewId)));
  const doc: YDoc | null = isHost ? hostContext.databaseDoc : loadedDoc ?? seedDoc;
  // Only an opened doc can prove the view or its database missing: the load
  // may still fetch what a seeded doc lacks.
  const docOpened = Boolean(isHost ? doc : loadedDoc);
  const snapshot = useWidgetViewSnapshot(doc, viewId);
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
    viewId,
    databaseId,
    hasDatabase: trackDeletion,
    eventEmitter,
    notFound: loadFailed,
    setNotFound: setProbeNotFound,
  });
  const databaseMissing = useDelayedFlag(docOpened && !snapshot.hasDatabase, MISSING_DATABASE_GRACE_MS);
  const viewMissing = useDelayedFlag(docOpened && snapshot.hasDatabase && !snapshot.exists, WIDGET_MISSING_GRACE_MS);

  const status = getWidgetStatus({
    noAccess,
    loadFailed,
    offline,
    deletionStatus: trackDeletion ? deletionStatus : 'none',
    databaseMissing,
    viewMissing,
    hasDoc: Boolean(doc),
    hasDatabase: snapshot.hasDatabase,
    viewExists: snapshot.exists,
    layout: snapshot.layout,
    seeded: Boolean(seedDoc),
  });
  const hasDatabase = Boolean(doc) && snapshot.hasDatabase;

  // Expose the source doc to the global-filter editor while the widget shows it.
  useEffect(() => {
    if (!doc || !hasDatabase || isHost) return;
    return acquireSourceDoc(databaseId, doc);
  }, [acquireSourceDoc, databaseId, doc, hasDatabase, isHost]);

  // What this widget shows, for its next instance after a move.
  useEffect(() => {
    if (!doc || isHost || status !== 'ready') return;
    return markWidgetShown(widgetId, viewId, doc);
  }, [doc, isHost, markWidgetShown, status, viewId, widgetId]);

  return {
    doc,
    status,
    isHost,
    hasDatabase,
    snapshot,
    seeded: seedDoc !== null,
    loadInFlight: !isHost && Boolean(loadInFlight),
  };
}
