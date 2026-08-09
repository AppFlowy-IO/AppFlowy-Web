import EventEmitter from 'events';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { APP_EVENTS } from '@/application/constants';
import {
  getDatabaseRowDocFromSeed,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
} from '@/application/database-blob';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { hasEffectiveFilters } from '@/application/database-yjs/filter';
import { ROW_SYNC_RETRY_DELAYS_MS } from '@/application/database-yjs/row-sync';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { getCachedRowDoc, openRowDoc } from '@/application/services/js-services/cache';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  DuplicatePageOperationOptions,
  CreatePagePayload,
  CreatePageResponse,
  CreateRow,
  DatabaseRelations,
  DatabaseViewLayout,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadRowDocument,
  LoadView,
  LoadViewMeta,
  RowDocumentSourcePayload,
  RowId,
  SearchMentions,
  UIVariant,
  UpdatePagePayload,
  View,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import DatabaseViews from '@/components/database/DatabaseViews';
import { CalendarViewType } from '@/components/database/fullcalendar/types';
import { shouldUseFixedDatabaseViewport } from '@/components/database/layout';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import { DatabaseContextProvider } from './DatabaseContext';

const PRIORITY_ROW_SEED_LIMIT = 200;

function createDeferredGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

type RowSyncRegistration = {
  rowKey: string;
  status: 'pending' | 'registered' | 'release-pending' | 'released';
  revision: number;
  cleanup?: (objectId: string, delayMs?: number) => void;
  promise?: Promise<YDoc | undefined>;
  forceSyncPromise?: Promise<YDoc | undefined>;
  forceSyncedDoc?: YDoc;
  reconciliationPromise?: Promise<void>;
};

function cleanupRegisteredRowSync(registration: RowSyncRegistration) {
  const rowId = registration.rowKey.split('_rows_')[1];

  if (!rowId || !registration.cleanup) return;

  try {
    registration.cleanup(rowId);
  } catch (error) {
    console.error('[Database] row sync cleanup failed', rowId, error);
  }
}

function releaseRowSyncRegistration(registration: RowSyncRegistration) {
  registration.revision += 1;

  if (registration.status === 'pending') {
    // createRow registers the sync context before resolving. Defer the matching
    // release until that async registration has actually completed.
    registration.status = 'release-pending';
    return;
  }

  if (registration.status !== 'registered') return;

  registration.status = 'released';
  cleanupRegisteredRowSync(registration);
}

function completeRowSyncRegistration(registration: RowSyncRegistration) {
  if (registration.status === 'release-pending') {
    registration.status = 'released';
    cleanupRegisteredRowSync(registration);
    return;
  }

  if (registration.status === 'pending') {
    registration.status = 'registered';
  }
}

export interface Database2Props {
  workspaceId: string;
  doc: YDoc;
  initialRowMap?: Record<RowId, YDoc>;
  readOnly?: boolean;
  /**
   * Comment permission for the containing view. Independent from [readOnly]:
   * Read-and-comment access renders a read-only database but still allows
   * inline comments inside a row document.
   */
  canComment?: boolean;
  createRow?: CreateRow;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  /**
   * Load a row sub-document (document content inside a database row).
   * In app mode: loads from server via authenticated API.
   * In publish mode: loads from published cache.
   */
  loadRowDocument?: LoadRowDocument;
  /**
   * Create a row document on the server (orphaned view).
   * Only available in app mode - not provided in publish mode.
   */
  createRowDocument?: (documentId: string, source?: RowDocumentSourcePayload) => Promise<Uint8Array | null>;
  duplicateRowDocument?: (
    databaseId: string,
    sourceRowId: string,
    newRowId: string,
    clientDocStateB64?: string
  ) => Promise<void>;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Changes when the user switches between different view tabs.
   */
  activeViewId: string;
  databaseName: string;
  rowId?: string;
  modalRowId?: string;
  appendBreadcrumb?: AppendBreadcrumb;
  onChangeView: (viewId: string) => void;
  onViewAdded?: (viewId: string) => void;
  onOpenRowPage?: (rowId: string) => void;
  /**
   * For embedded databases: restricts which views are shown (from block data).
   * For standalone databases: should be undefined to show all non-embedded views.
   */
  visibleViewIds?: string[];
  /**
   * Durably persist a database-tab reorder by moving the view within its folder
   * container. Provided in app mode for container-backed databases; omitted for
   * publish/embedded contexts (which use the local tab order).
   */
  onReorderViews?: (movedViewId: string, prevViewId: string | null) => void | Promise<void>;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  variant?: UIVariant;
  onRendered?: () => void;
  isDocumentBlock?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  showActions?: boolean;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  loadDatabaseRelations?: (options?: { refresh?: boolean }) => Promise<DatabaseRelations | undefined>;
  searchMentions?: SearchMentions;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  embeddedHeight?: number;
  /**
   * Callback when view IDs change (views added or removed).
   * Used to update the block data in embedded database blocks.
   */
  onViewIdsChanged?: (viewIds: string[]) => void;
  /**
   * Update a page/view (name, icon, etc.) in the folder structure.
   * This is used by database tab rename to sync with the sidebar.
   */
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  openPageModal?: (viewId: string) => void;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  duplicatePage?: (viewId: string, options?: DuplicatePageOperationOptions) => Promise<void>;
  /**
   * Delete a page/view (move to trash).
   * This is used by database tab delete to sync with the sidebar.
   */
  deletePage?: (viewId: string) => Promise<void>;
  /**
   * Event emitter for app-wide events like OUTLINE_LOADED.
   * Used by DatabaseTabs to listen for outline updates after rename/delete.
   */
  eventEmitter?: EventEmitter;
  /**
   * Upload a file to storage and return the URL.
   */
  uploadFile?: (file: File) => Promise<string>;
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;
  /**
   * Schedule deferred cleanup of a sync context after a delay.
   */
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

function Database(props: Database2Props) {
  const {
    doc,
    createRow,
    activeViewId,
    databasePageId,
    databaseName,
    visibleViewIds,
    rowId,
    onChangeView,
    onViewAdded,
    onOpenRowPage,
    appendBreadcrumb,
    readOnly = true,
    canComment = false,
    loadView,
    bindViewSync,
    checkIfRowDocumentExists,
    loadRowDocument,
    createRowDocument,
    duplicateRowDocument,
    navigateToView,
    modalRowId,
    isDocumentBlock: _isDocumentBlock,
    embeddedHeight,
    onViewIdsChanged,
    onReorderViews,
    workspaceId,
    addPage,
    openPageModal,
    loadDatabaseRelations,
    searchMentions,
    loadViews,
    generateAISummaryForRow,
    generateAITranslateForRow,
  } = props;
  const shouldUseFixedViewport = shouldUseFixedDatabaseViewport({
    embeddedHeight,
    isDocumentBlock: _isDocumentBlock,
    variant: props.variant,
  });

  const [rowMap, setRowMap] = useState<Record<RowId, YDoc>>(() => props.initialRowMap ?? {});
  const rowMapRef = useRef(rowMap);
  const pendingRowDocsRef = useRef<Map<RowId, Promise<YDoc | undefined>>>(new Map());
  const prefetchPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const blobPrefetchPromiseRef = useRef<Promise<void> | null>(null);
  const localCachePrimedRef = useRef(false);
  const rowSyncRegistrationsRef = useRef<Map<string, RowSyncRegistration>>(new Map());
  const remoteRowsNeedingReconciliationRef = useRef<Set<RowId>>(new Set());
  const batchPreloadDoneRef = useRef(false);
  // Async blob work is scoped to one workspace/database lifecycle. A later
  // generation makes completions from the previous lifecycle inert.
  const blobPrefetchGenerationRef = useRef(0);
  // Gate that ensureRow awaits. Resolves after batch preload (or immediately in readOnly).
  const seedsGateRef = useRef(createDeferredGate());
  const [blobPrefetchComplete, setBlobPrefetchComplete] = useState(false);
  const [seedsReady, setSeedsReady] = useState(false);

  // Layout phase, and declared before the lifecycle-reset effect below, so that
  // in a commit where both `rowMap` and the lifecycle changed this mirror runs
  // first and the reset's `rowMapRef.current = initialRowMap` wins. As a passive
  // effect it ran *after* the reset and wrote the previous lifecycle's row docs
  // back into the ref — the one path in this file not covered by the
  // isCurrentEnsure/isCurrentLoad guards.
  useLayoutEffect(() => {
    rowMapRef.current = rowMap;
  }, [rowMap]);

  // Get the actual database ID from the Yjs doc, falling back to doc.guid
  // for legacy/incomplete metadata cases.
  const getDatabaseId = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const databaseId = database?.get(YjsDatabaseKey.id);

    return databaseId || doc.guid;
  }, [doc]);

  // Yjs mutations do not schedule a React render, so reading the id during
  // render would only refresh it as a side effect of an unrelated re-render —
  // and since it feeds `databaseLifecycleIdentity`, which drives a destructive
  // teardown, that could reset the lifecycle at an arbitrary later moment.
  // `database` is a direct key of the shared root and `id` a direct key of the
  // database map, so shallow observers cover every way the id can change
  // without waking React on unrelated row/field edits.
  const subscribeToDatabaseId = useCallback(
    (onStoreChange: () => void) => {
      const sharedRoot = doc.getMap(YjsEditorKey.data_section);
      let database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

      // The database map can be created after the first subscribe, so re-attach
      // the inner observer whenever the root swaps it.
      const handleRootChange = () => {
        const nextDatabase = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

        if (nextDatabase !== database) {
          database?.unobserve(onStoreChange);
          database = nextDatabase;
          database?.observe(onStoreChange);
        }

        onStoreChange();
      };

      sharedRoot.observe(handleRootChange);
      database?.observe(onStoreChange);

      return () => {
        sharedRoot.unobserve(handleRootChange);
        database?.unobserve(onStoreChange);
      };
    },
    [doc]
  );

  const currentDatabaseId = useSyncExternalStore(subscribeToDatabaseId, getDatabaseId, getDatabaseId);
  // A shared background loader can retain a callback and first invoke it after
  // reset, so invocation-time generation checks alone cannot identify stale work.
  const databaseLifecycleIdentity = useMemo(
    () => ({
      workspaceId,
      doc,
      databaseId: currentDatabaseId,
      hasInitialRowMap: props.initialRowMap !== undefined,
    }),
    [workspaceId, doc, currentDatabaseId, props.initialRowMap]
  );
  const activeDatabaseLifecycleRef = useRef<typeof databaseLifecycleIdentity | null>(databaseLifecycleIdentity);
  const previousDatabaseLifecycleRef = useRef(databaseLifecycleIdentity);

  const getPriorityRowIds = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders || rowOrders.length === 0) return [];

    const limit = Math.min(rowOrders.length, PRIORITY_ROW_SEED_LIMIT);
    const ids: string[] = [];

    for (let index = 0; index < limit; index += 1) {
      const row = rowOrders.get(index) as { id?: string } | undefined;
      const rowId = row?.id;

      if (rowId) {
        ids.push(rowId);
      }
    }

    return ids;
  }, [doc, activeViewId]);

  const getActiveViewNeedsFullRowData = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);
    const fields = database?.get(YjsDatabaseKey.fields);
    const isGroupedBoard =
      Number(view?.get(YjsDatabaseKey.layout)) === DatabaseViewLayout.Board &&
      (view?.get(YjsDatabaseKey.groups)?.length ?? 0) > 0;

    return (
      isGroupedBoard ||
      hasEffectiveFilters(view?.get(YjsDatabaseKey.filters), fields) ||
      (view?.get(YjsDatabaseKey.sorts)?.length ?? 0) > 0
    );
  }, [doc, activeViewId]);

  const activeViewNeedsFullRowData = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const sharedRoot = doc.getMap(YjsEditorKey.data_section);
        const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
        const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);

        if (view) {
          view.observeDeep(onStoreChange);
          return () => {
            view.unobserveDeep(onStoreChange);
          };
        }

        if (database) {
          database.observeDeep(onStoreChange);
          return () => {
            database.unobserveDeep(onStoreChange);
          };
        }

        return () => undefined;
      },
      [doc, activeViewId]
    ),
    getActiveViewNeedsFullRowData,
    getActiveViewNeedsFullRowData
  );

  const registerRowSync = useCallback(
    (rowKey: string, forceSync = false, refreshForceSync = false) => {
      if (!createRow) {
        return;
      }

      if (activeDatabaseLifecycleRef.current !== databaseLifecycleIdentity) {
        return;
      }

      const lifecycleRegistrations = rowSyncRegistrationsRef.current;
      const existingRegistration = lifecycleRegistrations.get(rowKey);

      if (existingRegistration) {
        if (forceSync && existingRegistration.status === 'registered') {
          if (!refreshForceSync && existingRegistration.forceSyncedDoc) {
            return Promise.resolve(existingRegistration.forceSyncedDoc);
          }

          if (!existingRegistration.forceSyncPromise) {
            const registrationRevision = existingRegistration.revision;
            const forceSyncPromise = createRow(rowKey, { forceSync: true }).catch((error) => {
              console.error('[Database] row sync retry failed', rowKey, error);
              return undefined;
            });

            existingRegistration.forceSyncPromise = forceSyncPromise;
            void forceSyncPromise.then((doc) => {
              if (
                lifecycleRegistrations.get(rowKey) !== existingRegistration ||
                existingRegistration.forceSyncPromise !== forceSyncPromise ||
                existingRegistration.revision !== registrationRevision
              ) {
                return;
              }

              if (doc) {
                existingRegistration.promise = Promise.resolve(doc);
                existingRegistration.forceSyncedDoc = hasRowConditionData(doc) ? doc : undefined;
              }

              existingRegistration.forceSyncPromise = undefined;
            });
          }

          return existingRegistration.forceSyncPromise;
        }

        return existingRegistration.promise;
      }

      const registration: RowSyncRegistration = {
        rowKey,
        status: 'pending',
        revision: 0,
        cleanup: props.scheduleDeferredCleanup,
      };

      lifecycleRegistrations.set(rowKey, registration);
      const promise = createRow(rowKey)
        .then((doc) => {
          completeRowSyncRegistration(registration);
          return doc;
        })
        .catch((e) => {
          registration.status = 'released';
          console.error('[Database] registerRowSync failed', rowKey, e);

          // Remove only this lifecycle's failed registration. A replacement
          // lifecycle may already own the same row key in a different Map.
          if (lifecycleRegistrations.get(rowKey) === registration) {
            lifecycleRegistrations.delete(rowKey);
          }

          return undefined;
        });

      registration.promise = promise;
      return promise;
    },
    [createRow, databaseLifecycleIdentity, props.scheduleDeferredCleanup]
  );

  const scheduleRowSyncReconciliation = useCallback(
    (rowId: string) => {
      const lifecycleReconciliationRows = remoteRowsNeedingReconciliationRef.current;

      if (!lifecycleReconciliationRows.has(rowId)) return;
      if (activeDatabaseLifecycleRef.current !== databaseLifecycleIdentity) return;

      const rowKey = getRowKey(getDatabaseId(), rowId);
      const registrations = rowSyncRegistrationsRef.current;
      const registration = registrations.get(rowKey);

      // Reconciliation is started by ensureRow after the visible row has
      // acquired its one sync owner. Off-screen rows remain seed-only.
      if (!registration || registration.status !== 'registered' || registration.reconciliationPromise) return;

      const registrationRevision = registration.revision;
      const reconciliationPromise = (async () => {
        for (const delayMs of ROW_SYNC_RETRY_DELAYS_MS) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          if (
            !lifecycleReconciliationRows.has(rowId) ||
            activeDatabaseLifecycleRef.current !== databaseLifecycleIdentity ||
            registrations.get(rowKey) !== registration ||
            registration.status !== 'registered' ||
            registration.revision !== registrationRevision
          ) {
            return;
          }

          const canonicalDoc = await registerRowSync(rowKey, true, true);

          if (
            !canonicalDoc ||
            activeDatabaseLifecycleRef.current !== databaseLifecycleIdentity ||
            registrations.get(rowKey) !== registration ||
            registration.revision !== registrationRevision
          ) {
            continue;
          }

          setRowMap((prev) => (prev[rowId] === canonicalDoc ? prev : { ...prev, [rowId]: canonicalDoc }));
        }
      })();

      registration.reconciliationPromise = reconciliationPromise;
      const clearReconciliationPromise = () => {
        if (registration.reconciliationPromise === reconciliationPromise) {
          registration.reconciliationPromise = undefined;
          lifecycleReconciliationRows.delete(rowId);
        }
      };

      void reconciliationPromise.then(clearReconciliationPromise, clearReconciliationPromise);
    },
    [databaseLifecycleIdentity, getDatabaseId, registerRowSync]
  );

  useEffect(() => {
    const eventEmitter = props.eventEmitter;

    if (!eventEmitter) return;

    const handleCollabDocReset = (payload: { objectId?: string; doc?: YDoc }) => {
      const { objectId, doc: canonicalDoc } = payload;

      if (!objectId || !canonicalDoc) return;

      setRowMap((prev) => {
        // This Database owns only the row ids already present in its map. The
        // same app-wide event also carries resets for pages and databases.
        if (!prev[objectId] || prev[objectId] === canonicalDoc) return prev;
        return { ...prev, [objectId]: canonicalDoc };
      });

      const rowKey = getRowKey(getDatabaseId(), objectId);
      const registration = rowSyncRegistrationsRef.current.get(rowKey);

      if (registration?.status === 'registered') {
        registration.revision += 1;
        registration.promise = Promise.resolve(canonicalDoc);
        registration.forceSyncPromise = undefined;
        registration.forceSyncedDoc = hasRowConditionData(canonicalDoc) ? canonicalDoc : undefined;
        registration.reconciliationPromise = undefined;
      }
    };

    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    return () => {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    };
  }, [getDatabaseId, props.eventEmitter]);

  const bindRowSync = useCallback(
    (rowId: string) => {
      if (!createRow || !rowId) return;
      const databaseId = getDatabaseId();
      const rowKey = getRowKey(databaseId, rowId);

      void registerRowSync(rowKey);
    },
    [createRow, getDatabaseId, registerRowSync]
  );

  const loadRowFromSeed = useCallback(
    async (rowId: string): Promise<YDoc | undefined> => {
      if (!rowId) return undefined;
      const loadLifecycleIdentity = databaseLifecycleIdentity;
      const loadGeneration = blobPrefetchGenerationRef.current;
      const gate = seedsGateRef.current;
      const isCurrentLoad = () =>
        activeDatabaseLifecycleRef.current === loadLifecycleIdentity &&
        getDatabaseId() === loadLifecycleIdentity.databaseId &&
        blobPrefetchGenerationRef.current === loadGeneration &&
        seedsGateRef.current === gate;

      if (!isCurrentLoad()) return undefined;
      const databaseId = loadLifecycleIdentity.databaseId;
      const rowKey = getRowKey(databaseId, rowId);
      const existing = rowMapRef.current[rowId];

      if (hasRowConditionData(existing)) return existing;

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) {
        const rowDoc = await pending;

        return isCurrentLoad() ? rowDoc : undefined;
      }

      const cachedRowDoc = getCachedRowDoc(rowKey);
      const seed = peekDatabaseRowDocSeed(rowKey);

      if (hasRowConditionData(cachedRowDoc)) {
        setRowMap((prev) => {
          if (prev[rowId]) return prev;
          return { ...prev, [rowId]: cachedRowDoc };
        });
        return cachedRowDoc;
      }

      if (!seed) return undefined;

      const promise = (async () => {
        const rowDoc = await openRowDoc(rowKey, seed);

        return rowDoc;
      })();

      pendingRowDocsRef.current.set(rowId, promise);

      try {
        const rowDoc = await promise;

        if (rowDoc && isCurrentLoad()) {
          setRowMap((prev) => {
            if (prev[rowId]) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return isCurrentLoad() ? rowDoc : undefined;
      } finally {
        if (pendingRowDocsRef.current.get(rowId) === promise) {
          pendingRowDocsRef.current.delete(rowId);
        }
      }
    },
    [databaseLifecycleIdentity, getDatabaseId]
  );

  // Synchronous shared read-only doc for filter/sort. Reuses an existing row
  // doc when cached, otherwise builds one shared in-memory Y.Doc from seed
  // bytes without touching IndexedDB or consuming the seed.
  const peekRowDocFromSeed = useCallback(
    (rowId: string): YDoc | null => {
      if (!rowId) return null;
      const databaseId = getDatabaseId();
      const rowKey = getRowKey(databaseId, rowId);

      return getDatabaseRowDocFromSeed(rowKey);
    },
    [getDatabaseId]
  );

  const runBatchPreload = useCallback(
    (prefetchGeneration: number) => {
      if (blobPrefetchGenerationRef.current !== prefetchGeneration) return;
      if (batchPreloadDoneRef.current) return;
      batchPreloadDoneRef.current = true;
      const gate = seedsGateRef.current;
      const isCurrentPreload = () =>
        blobPrefetchGenerationRef.current === prefetchGeneration && seedsGateRef.current === gate;
      const databaseId = getDatabaseId();
      const priorityRowIds = getPriorityRowIds();

      if (priorityRowIds.length === 0) {
        gate.resolve();
        return;
      }

      // Collect seeds for the first N priority rows (visible + overscan) in a single pass
      const BATCH_SIZE = 30;
      const rowsWithSeeds: {
        rowId: string;
        rowKey: string;
        seed: NonNullable<ReturnType<typeof peekDatabaseRowDocSeed>>;
      }[] = [];

      for (const rowId of priorityRowIds) {
        if (rowsWithSeeds.length >= BATCH_SIZE) break;
        if (hasRowConditionData(rowMapRef.current[rowId])) continue;

        const rowKey = getRowKey(databaseId, rowId);
        const seed = peekDatabaseRowDocSeed(rowKey);

        if (seed) {
          rowsWithSeeds.push({ rowId, rowKey, seed });
        }
      }

      if (rowsWithSeeds.length === 0) {
        gate.resolve();
        return;
      }

      Promise.all(
        rowsWithSeeds.map(async ({ rowId, rowKey, seed }) => {
          try {
            const rowDoc = await openRowDoc(rowKey, seed ?? undefined);

            return { rowId, rowDoc };
          } catch {
            return null;
          }
        })
      )
        .then((results) => {
          if (!isCurrentPreload()) return;

          const newEntries: Record<string, YDoc> = {};

          for (const result of results) {
            if (result?.rowDoc && !rowMapRef.current[result.rowId]) {
              newEntries[result.rowId] = result.rowDoc;
            }
          }

          const count = Object.keys(newEntries).length;

          if (count > 0) {
            // Keep seed-only rows local. ensureRow attaches realtime only when a
            // row is actually rendered, preserving the viewport boundary.
            setRowMap((prev) => ({ ...prev, ...newEntries }));
          }

          // Open the gate — ensureRow calls can now proceed
          gate.resolve();
        })
        .catch(() => {
          if (!isCurrentPreload()) return;

          // Ensure the gate always resolves even on unexpected errors,
          // otherwise ensureRow calls would be permanently blocked.
          gate.resolve();
        });
    },
    [getDatabaseId, getPriorityRowIds]
  );

  const ensureBlobPrefetch = useCallback(() => {
    const prefetchGeneration = blobPrefetchGenerationRef.current;
    const gate = seedsGateRef.current;
    const isCurrentPrefetch = () =>
      blobPrefetchGenerationRef.current === prefetchGeneration && seedsGateRef.current === gate;

    // Skip blob prefetch in read-only mode (publish view)
    // The publish API doesn't support blob/diff endpoint
    if (readOnly) {
      gate.resolve();
      setBlobPrefetchComplete(true);
      setSeedsReady(true);
      return null;
    }

    const databaseId = getDatabaseId();

    if (!workspaceId || !databaseId) {
      gate.resolve();
      return null;
    }

    const forceFullSync = activeViewNeedsFullRowData;
    const prefetchKey = `${databaseId}:${forceFullSync ? 'full' : 'delta'}`;
    const existingPromise = prefetchPromisesRef.current.get(prefetchKey);

    if (existingPromise) {
      blobPrefetchPromiseRef.current = existingPromise;
      return existingPromise;
    }

    const priorityRowIds = getPriorityRowIds();

    if (forceFullSync) {
      setBlobPrefetchComplete(false);
      setSeedsReady(false);
    }

    const promise = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      priorityRowIds,
      forceFullSync,
      onSeedsReady: () => {
        if (!isCurrentPrefetch()) return;

        // Seeds are cached — filter/sort can now build ephemeral docs from them
        // without waiting for IndexedDB persist.
        setSeedsReady(true);
        // Also kick off batch preload for visible rows (heavy IndexedDB path).
        runBatchPreload(prefetchGeneration);
      },
    })
      .then(() => {
        if (!isCurrentPrefetch()) return;

        setBlobPrefetchComplete(true);
      })
      .catch(() => {
        if (!isCurrentPrefetch()) return;

        prefetchPromisesRef.current.delete(prefetchKey);
        gate.resolve(); // Unblock ensureRow on failure
        setBlobPrefetchComplete(true);
        setSeedsReady(true);
      });

    prefetchPromisesRef.current.set(prefetchKey, promise);
    blobPrefetchPromiseRef.current = promise;
    return promise;
  }, [readOnly, workspaceId, getDatabaseId, getPriorityRowIds, activeViewNeedsFullRowData, runBatchPreload]);

  useEffect(() => {
    retainDatabaseRowDocSeedCache(currentDatabaseId);

    return () => {
      releaseDatabaseRowDocSeedCache(currentDatabaseId);
    };
  }, [currentDatabaseId]);

  const createNewRow = useCallback(
    async (rowKey: string) => {
      if (!createRow) {
        throw new Error('createRow function is not provided');
      }

      const createLifecycleIdentity = databaseLifecycleIdentity;
      const createGeneration = blobPrefetchGenerationRef.current;
      const isCurrentCreate = () =>
        activeDatabaseLifecycleRef.current === createLifecycleIdentity &&
        blobPrefetchGenerationRef.current === createGeneration;

      const [rowKeyDatabaseId, rowId] = rowKey.split('_rows_');
      const currentDatabaseId = getDatabaseId();

      const rowDoc = await createRow(rowKey);

      // The row exists on the server either way, so still hand it back to the
      // caller — only the local state writes belong to the old lifecycle.
      if (!isCurrentCreate()) return rowDoc;

      // Add the new row doc to rowMap so grouping logic can see it immediately
      if (rowId && rowDoc) {
        setRowMap((prev) => {
          if (prev[rowId]) return prev;
          return { ...prev, [rowId]: rowDoc };
        });
      }

      if (rowKeyDatabaseId && rowKeyDatabaseId === currentDatabaseId && !localCachePrimedRef.current) {
        localCachePrimedRef.current = true;
        void ensureBlobPrefetch();
      }

      return rowDoc;
    },
    [createRow, databaseLifecycleIdentity, getDatabaseId, ensureBlobPrefetch]
  );

  // Self-healing for a lying delta watermark: the RID cursor lives in
  // localStorage while row data lives in IndexedDB, so the two can diverge
  // (storage eviction, partial clears). The delta diff then reports "no
  // changes", no seeds exist, and a visible row opens as an empty doc whose
  // only remaining data path is per-row realtime sync — slow or never on
  // rows without a live collab. When that happens, force one full blob
  // resync per database lifecycle and re-seed the already-open row docs.
  const missingRowRecoveryLifecycleRef = useRef<unknown>(null);

  const scheduleMissingRowRecovery = useCallback(() => {
    if (readOnly) return;
    if (missingRowRecoveryLifecycleRef.current === databaseLifecycleIdentity) return;

    const databaseId = getDatabaseId();
    const recoveryGeneration = blobPrefetchGenerationRef.current;

    if (!workspaceId || !databaseId) return;
    missingRowRecoveryLifecycleRef.current = databaseLifecycleIdentity;

    Log.warn('[Database] visible row has no local data after blob prefetch; forcing full blob resync', {
      workspaceId,
      databaseId,
    });

    void prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      forceFullSync: true,
      priorityRowIds: getPriorityRowIds(),
      onSeedsReady: () => {
        if (blobPrefetchGenerationRef.current !== recoveryGeneration) return;
        if (activeDatabaseLifecycleRef.current !== databaseLifecycleIdentity) return;

        // openRowDoc reuses the cached doc entry, so applying the fresh seed
        // mutates the same Y.Doc instances the UI already observes — spinners
        // clear through the row observers without touching rowMap.
        const currentDatabaseId = getDatabaseId();

        for (const [rowId, rowDoc] of Object.entries(rowMapRef.current)) {
          if (hasRowConditionData(rowDoc)) continue;

          const rowKey = getRowKey(currentDatabaseId, rowId);
          const seed = peekDatabaseRowDocSeed(rowKey);

          if (!seed) continue;
          void openRowDoc(rowKey, seed).catch(() => undefined);
        }
      },
    }).catch((error) => {
      Log.warn('[Database] full blob resync for missing rows failed', { workspaceId, databaseId, error });
    });
  }, [readOnly, workspaceId, databaseLifecycleIdentity, getDatabaseId, getPriorityRowIds]);

  const ensureRow = useCallback(
    async (rowId: string) => {
      if (!createRow || !rowId) return;

      const ensureLifecycleIdentity = databaseLifecycleIdentity;
      const ensureGeneration = blobPrefetchGenerationRef.current;
      const gate = seedsGateRef.current;
      const isCurrentEnsure = () =>
        activeDatabaseLifecycleRef.current === ensureLifecycleIdentity &&
        getDatabaseId() === ensureLifecycleIdentity.databaseId &&
        blobPrefetchGenerationRef.current === ensureGeneration &&
        seedsGateRef.current === gate;
      const finishEnsure = (rowDoc: YDoc | undefined) => {
        if (rowDoc && isCurrentEnsure()) {
          scheduleRowSyncReconciliation(rowId);

          // The local pipeline (seed cache + IndexedDB) produced no row data —
          // the delta watermark is ahead of the local store. Trigger the
          // one-shot full resync instead of leaving the row to realtime sync.
          if (!hasRowConditionData(rowDoc)) {
            scheduleMissingRowRecovery();
          }
        }

        return rowDoc;
      };

      if (!isCurrentEnsure()) return;

      // Fast path: row already loaded (e.g. by batch preload or previous call).
      // Check before awaiting the gate to avoid blocking on already-available rows.
      const existing = rowMapRef.current[rowId];

      if (hasRowConditionData(existing)) {
        // Published JSON snapshots already contain the authoritative static
        // row docs. Opening a local transport doc would replace them with an
        // empty Y.Doc because publish pages do not establish realtime sync.
        if (readOnly && ensureLifecycleIdentity.hasInitialRowMap) return existing;

        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);
        const syncedRowDoc = await registerRowSync(rowKey, true);

        if (!isCurrentEnsure()) return;
        const canonicalRowDoc = syncedRowDoc ?? existing;

        if (canonicalRowDoc !== existing) {
          setRowMap((prev) => (prev[rowId] === canonicalRowDoc ? prev : { ...prev, [rowId]: canonicalRowDoc }));
        }

        return finishEnsure(canonicalRowDoc);
      }

      // Wait for batch preload to finish — it loads visible rows from seeds
      // in parallel. After it completes, the row may now be in rowMap.
      await gate.promise;

      if (!isCurrentEnsure()) return;

      const existingAfterGate = rowMapRef.current[rowId];

      if (hasRowConditionData(existingAfterGate)) {
        if (readOnly && ensureLifecycleIdentity.hasInitialRowMap) return existingAfterGate;

        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);
        const syncedRowDoc = await registerRowSync(rowKey, true);

        if (!isCurrentEnsure()) return;
        const canonicalRowDoc = syncedRowDoc ?? existingAfterGate;

        if (canonicalRowDoc !== existingAfterGate) {
          setRowMap((prev) => (prev[rowId] === canonicalRowDoc ? prev : { ...prev, [rowId]: canonicalRowDoc }));
        }

        return finishEnsure(canonicalRowDoc);
      }

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) {
        const rowDoc = await pending;

        return finishEnsure(isCurrentEnsure() ? rowDoc : undefined);
      }

      const promise = (async () => {
        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);
        const cachedRowDoc = getCachedRowDoc(rowKey);
        const seed = peekDatabaseRowDocSeed(rowKey);

        if (hasRowConditionData(cachedRowDoc)) {
          const syncedRowDoc = await registerRowSync(rowKey, true);

          return syncedRowDoc ?? cachedRowDoc;
        }

        try {
          const rowDoc = await openRowDoc(rowKey, seed ?? undefined);

          if (!isCurrentEnsure()) return undefined;

          // Bind sync for this row - only visible rows call ensureRow
          // Non-visible rows rely on blob diff cached data
          const syncedRowDoc = await registerRowSync(rowKey, true);

          if (!localCachePrimedRef.current) {
            localCachePrimedRef.current = true;
            void ensureBlobPrefetch();
          }

          return syncedRowDoc ?? rowDoc;
        } catch {
          if (!isCurrentEnsure()) return undefined;

          if (!localCachePrimedRef.current) {
            localCachePrimedRef.current = true;
            void ensureBlobPrefetch();
          }

          return undefined;
        }
      })();

      pendingRowDocsRef.current.set(rowId, promise);

      try {
        const rowDoc = await promise;

        if (rowDoc && isCurrentEnsure()) {
          setRowMap((prev) => {
            // A version reset may replace the sync context's Y.Doc while the
            // row map still points at the old instance. The canonical doc must
            // win so future remote updates reach selectors and Board cards.
            if (prev[rowId] === rowDoc) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return finishEnsure(isCurrentEnsure() ? rowDoc : undefined);
      } finally {
        if (pendingRowDocsRef.current.get(rowId) === promise) {
          pendingRowDocsRef.current.delete(rowId);
        }
      }
    },
    // Omitted deps are stable: setRowMap (useState setter), refs (rowMapRef, pendingRowDocsRef,
    // localCachePrimedRef), and module-level imports (openRowDoc, getCachedRowDoc, peekDatabaseRowDocSeed, getRowKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      createRow,
      databaseLifecycleIdentity,
      getDatabaseId,
      ensureBlobPrefetch,
      readOnly,
      registerRowSync,
      scheduleRowSyncReconciliation,
      scheduleMissingRowRecovery,
    ]
  );

  // Row orders and DatabaseRow collabs are independent objects. Remember
  // remote additions here, but defer all transport work to ensureRow so an
  // off-screen bulk import does not acquire thousands of sync owners.
  useEffect(() => {
    if (!createRow || readOnly) return;

    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders) return;

    let knownOrderedRowIds = new Set(
      (rowOrders.toJSON() as { id: string; is_deleted?: boolean }[])
        .filter((row) => !row.is_deleted)
        .map((row) => row.id)
    );

    const handleRowOrdersChange: Parameters<typeof rowOrders.observeDeep>[0] = (_events, transaction) => {
      const nextOrderedRowIds = new Set(
        (rowOrders.toJSON() as { id: string; is_deleted?: boolean }[])
          .filter((row) => !row.is_deleted)
          .map((row) => row.id)
      );
      const lifecycleReconciliationRows = remoteRowsNeedingReconciliationRef.current;

      if (!transaction.local) {
        nextOrderedRowIds.forEach((rowId) => {
          if (!knownOrderedRowIds.has(rowId)) {
            lifecycleReconciliationRows.add(rowId);
          }
        });
      }

      knownOrderedRowIds.forEach((rowId) => {
        if (!nextOrderedRowIds.has(rowId)) {
          lifecycleReconciliationRows.delete(rowId);
        }
      });
      knownOrderedRowIds = nextOrderedRowIds;
    };

    rowOrders.observeDeep(handleRowOrdersChange);
    return () => {
      rowOrders.unobserveDeep(handleRowOrdersChange);
    };
  }, [activeViewId, createRow, doc, readOnly]);

  useLayoutEffect(() => {
    const previousLifecycleIdentity = previousDatabaseLifecycleRef.current;
    const nextRemoteRowsNeedingReconciliation =
      previousLifecycleIdentity?.doc === databaseLifecycleIdentity.doc &&
      previousLifecycleIdentity.databaseId !== databaseLifecycleIdentity.databaseId
        ? new Set(remoteRowsNeedingReconciliationRef.current)
        : new Set<RowId>();

    previousDatabaseLifecycleRef.current = databaseLifecycleIdentity;
    activeDatabaseLifecycleRef.current = databaseLifecycleIdentity;
    const lifecycleRowSyncRegistrations = new Map<string, RowSyncRegistration>();
    const prefetchGeneration = blobPrefetchGenerationRef.current + 1;
    const previousGate = seedsGateRef.current;

    blobPrefetchGenerationRef.current = prefetchGeneration;
    previousGate.resolve();
    const initialRowMap = props.initialRowMap ?? {};

    rowMapRef.current = {};
    pendingRowDocsRef.current.clear();
    prefetchPromisesRef.current.clear();
    // A remote update can hydrate the database id and append row orders in the
    // same Yjs transaction. Carry those markers into the real-id lifecycle;
    // unrelated document/workspace lifecycle changes still start empty.
    remoteRowsNeedingReconciliationRef.current = nextRemoteRowsNeedingReconciliation;
    blobPrefetchPromiseRef.current = null;
    localCachePrimedRef.current = false;
    rowSyncRegistrationsRef.current = lifecycleRowSyncRegistrations;
    batchPreloadDoneRef.current = false;
    const lifecycleGate = createDeferredGate();

    seedsGateRef.current = lifecycleGate;
    rowMapRef.current = initialRowMap;
    setRowMap(initialRowMap);
    setBlobPrefetchComplete(false);
    setSeedsReady(false);

    return () => {
      if (activeDatabaseLifecycleRef.current === databaseLifecycleIdentity) {
        activeDatabaseLifecycleRef.current = null;
      }

      if (blobPrefetchGenerationRef.current === prefetchGeneration) {
        blobPrefetchGenerationRef.current += 1;
      }

      lifecycleRowSyncRegistrations.forEach(releaseRowSyncRegistration);
      lifecycleRowSyncRegistrations.clear();
      lifecycleGate.resolve();
    };
  }, [databaseLifecycleIdentity, props.initialRowMap]);

  // Trigger blob prefetch when database opens
  useEffect(() => {
    if (workspaceId && currentDatabaseId) {
      ensureBlobPrefetch()?.catch((error: unknown) => {
        console.error('[Database] Failed to prefetch blob:', error);
      });
    }
  }, [workspaceId, currentDatabaseId, ensureBlobPrefetch]);

  // Combined modal state to avoid multiple re-renders when updating related values
  const [modalState, setModalState] = useState<{
    rowId: string | null;
    viewId: string | null;
    databaseDoc: YDoc | null;
    rowMap: Record<RowId, YDoc> | null;
  }>(() => ({
    rowId: modalRowId || null,
    viewId: modalRowId ? activeViewId : null,
    databaseDoc: null,
    rowMap: null,
  }));

  // Calendar view type map state
  const [calendarViewTypeMap, setCalendarViewTypeMap] = useState<Map<string, CalendarViewType>>(() => new Map());

  const setCalendarViewType = useCallback((viewId: string, viewType: CalendarViewType) => {
    setCalendarViewTypeMap((prev) => {
      const newMap = new Map(prev);

      newMap.set(viewId, viewType);
      return newMap;
    });
  }, []);

  const handleOpenRow = useCallback(
    async (rowId: string, viewId?: string) => {
      if (readOnly) {
        if (viewId) {
          void navigateToView?.(viewId, rowId);
          return;
        }

        onOpenRowPage?.(rowId);
        return;
      }

      if (viewId) {
        try {
          const viewDoc = await loadView?.(viewId);

          if (!viewDoc) {
            void navigateToView?.(viewId);
            return;
          }

          const rowDoc = await createNewRow(getRowKey(viewDoc.guid, rowId));

          if (!rowDoc) {
            throw new Error('Row document not found');
          }

          // Update all modal state in a single setState call
          setModalState({
            rowId,
            viewId,
            databaseDoc: viewDoc,
            rowMap: { [rowId]: rowDoc },
          });
          return;
        } catch (e) {
          console.error(e);
        }
      }

      setModalState((prev) => ({ ...prev, rowId }));
    },
    [createNewRow, loadView, navigateToView, onOpenRowPage, readOnly]
  );

  const handleCloseRowModal = useCallback(() => {
    setModalState({
      rowId: null,
      viewId: null,
      databaseDoc: null,
      rowMap: null,
    });
  }, []);

  // Memoized callback for modal open change to avoid inline function in JSX
  const handleModalOpenChange = useCallback(
    (status: boolean) => {
      if (!status) {
        handleCloseRowModal();
      }
    },
    [handleCloseRowModal]
  );

  const loadViewsForContext = useCallback(async () => {
    return (await loadViews?.()) ?? [];
  }, [loadViews]);

  // Shared context properties - extracted to reduce duplication between main and modal contexts
  const sharedContextProps = useMemo(
    () => ({
      readOnly,
      canComment,
      ensureRow,
      loadRowFromSeed,
      peekRowDocFromSeed,
      bindRowSync,
      blobPrefetchComplete,
      seedsReady,
      paddingStart: props.paddingStart,
      paddingEnd: props.paddingEnd,
      isDocumentBlock: _isDocumentBlock,
      embeddedHeight,
      navigateToRow: handleOpenRow,
      loadView,
      bindViewSync,
      createRow: createNewRow,
      checkIfRowDocumentExists,
      loadRowDocument,
      createRowDocument,
      duplicateRowDocument,
      loadViewMeta: props.loadViewMeta,
      navigateToView,
      onRendered: props.onRendered,
      showActions: props.showActions,
      workspaceId,
      addPage,
      openPageModal,
      createDatabaseView: props.createDatabaseView,
      updatePage: props.updatePage,
      deletePage: props.deletePage,
      duplicatePage: props.duplicatePage,
      eventEmitter: props.eventEmitter,
      getViewIdFromDatabaseId: props.getViewIdFromDatabaseId,
      loadDatabaseRelations,
      searchMentions,
      loadViews: loadViews ? loadViewsForContext : undefined,
      variant: props.variant,
      calendarViewTypeMap,
      setCalendarViewType,
      uploadFile: props.uploadFile,
      generateAISummaryForRow,
      generateAITranslateForRow,
    }),
    [
      readOnly,
      canComment,
      ensureRow,
      loadRowFromSeed,
      peekRowDocFromSeed,
      bindRowSync,
      blobPrefetchComplete,
      seedsReady,
      props.paddingStart,
      props.paddingEnd,
      _isDocumentBlock,
      embeddedHeight,
      handleOpenRow,
      loadView,
      bindViewSync,
      createNewRow,
      checkIfRowDocumentExists,
      loadRowDocument,
      createRowDocument,
      duplicateRowDocument,
      props.loadViewMeta,
      navigateToView,
      props.onRendered,
      props.showActions,
      workspaceId,
      addPage,
      openPageModal,
      props.createDatabaseView,
      props.updatePage,
      props.deletePage,
      props.duplicatePage,
      props.eventEmitter,
      props.getViewIdFromDatabaseId,
      loadDatabaseRelations,
      searchMentions,
      loadViews,
      loadViewsForContext,
      props.variant,
      calendarViewTypeMap,
      setCalendarViewType,
      generateAISummaryForRow,
      generateAITranslateForRow,
      props.uploadFile,
    ]
  );

  // Memoize context value to prevent unnecessary re-renders of consumers
  const mainContextValue = useMemo(() => {
    return {
      ...sharedContextProps,
      databaseDoc: doc,
      databasePageId,
      activeViewId,
      rowMap,
      isDatabaseRowPage: !!rowId,
    };
  }, [sharedContextProps, doc, databasePageId, activeViewId, rowMap, rowId]);

  // Memoize modal context value separately - only compute when modal is open
  const modalContextValue = useMemo(
    () =>
      modalState.rowId
        ? {
            ...sharedContextProps,
            databaseDoc: modalState.databaseDoc || doc,
            databasePageId: modalState.viewId || databasePageId,
            activeViewId: modalState.viewId || activeViewId,
            rowMap: modalState.rowMap || rowMap,
            isDatabaseRowPage: false,
            closeRowDetailModal: handleCloseRowModal,
          }
        : null,
    [
      modalState.rowId,
      modalState.databaseDoc,
      modalState.viewId,
      modalState.rowMap,
      sharedContextProps,
      doc,
      databasePageId,
      activeViewId,
      rowMap,
      handleCloseRowModal,
    ]
  );

  if (!activeViewId) {
    return <div className={'min-h-[120px] w-full'} />;
  }

  return (
    <div className={'flex min-h-0 w-full flex-1 justify-center'}>
      <DatabaseContextProvider value={mainContextValue}>
        {rowId ? (
          <DatabaseRow appendBreadcrumb={appendBreadcrumb} rowId={rowId} />
        ) : (
          <div
            className={cn(
              'appflowy-database relative flex w-full select-text flex-col',
              shouldUseFixedViewport ? 'min-h-0 flex-1 overflow-hidden' : 'overflow-visible'
            )}
          >
            <DatabaseViews
              visibleViewIds={visibleViewIds}
              databasePageId={databasePageId}
              viewName={databaseName}
              onChangeView={onChangeView}
              onViewAdded={onViewAdded}
              activeViewId={activeViewId}
              fixedHeight={embeddedHeight}
              onViewIdsChanged={onViewIdsChanged}
              onReorderViews={onReorderViews}
            />
          </div>
        )}
      </DatabaseContextProvider>
      {modalState.rowId && modalContextValue && (
        <DatabaseContextProvider value={modalContextValue}>
          <DatabaseRowModal
            rowId={modalState.rowId}
            open={Boolean(modalState.rowId)}
            openPage={onOpenRowPage}
            onOpenChange={handleModalOpenChange}
          />
        </DatabaseContextProvider>
      )}
    </div>
  );
}

export default Database;
