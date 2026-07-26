import EventEmitter from 'events';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  getDatabaseRowDocFromSeed,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
} from '@/application/database-blob';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { hasEffectiveFilters } from '@/application/database-yjs/filter';
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
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadRowDocument,
  LoadView,
  LoadViewMeta,
  RowId,
  RowDocumentSourcePayload,
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

import { DatabaseContextProvider } from './DatabaseContext';

const PRIORITY_ROW_SEED_LIMIT = 200;

function createDeferredGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

export interface Database2Props {
  workspaceId: string;
  doc: YDoc;
  initialRowMap?: Record<RowId, YDoc>;
  readOnly?: boolean;
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
  const syncedRowKeysRef = useRef<Set<string>>(new Set());
  const batchPreloadDoneRef = useRef(false);
  // Async blob work is scoped to one workspace/database lifecycle. A later
  // generation makes completions from the previous lifecycle inert.
  const blobPrefetchGenerationRef = useRef(0);
  // Gate that ensureRow awaits. Resolves after batch preload (or immediately in readOnly).
  const seedsGateRef = useRef(createDeferredGate());
  const [blobPrefetchComplete, setBlobPrefetchComplete] = useState(false);
  const [seedsReady, setSeedsReady] = useState(false);

  useEffect(() => {
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
  const currentDatabaseId = getDatabaseId();
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

  const getActiveViewHasConditions = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);
    const fields = database?.get(YjsDatabaseKey.fields);

    return (
      hasEffectiveFilters(view?.get(YjsDatabaseKey.filters), fields) ||
      (view?.get(YjsDatabaseKey.sorts)?.length ?? 0) > 0
    );
  }, [doc, activeViewId]);

  const activeViewHasConditions = useSyncExternalStore(
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
    getActiveViewHasConditions,
    getActiveViewHasConditions
  );

  const registerRowSync = useCallback(
    (rowKey: string) => {
      if (!createRow) {
        return;
      }

      if (syncedRowKeysRef.current.has(rowKey)) {
        return;
      }

      syncedRowKeysRef.current.add(rowKey);
      void createRow(rowKey).catch((e) => {
        console.error('[Database] registerRowSync failed', rowKey, e);
        // Remove from set so it can be retried
        syncedRowKeysRef.current.delete(rowKey);
      });
    },
    [createRow]
  );

  const bindRowSync = useCallback(
    (rowId: string) => {
      if (!createRow || !rowId) return;
      const databaseId = getDatabaseId();
      const rowKey = getRowKey(databaseId, rowId);

      registerRowSync(rowKey);
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

  const runBatchPreload = useCallback((prefetchGeneration: number) => {
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
  }, [getDatabaseId, getPriorityRowIds]);

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

    const forceFullSync = activeViewHasConditions;
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
  }, [readOnly, workspaceId, getDatabaseId, getPriorityRowIds, activeViewHasConditions, runBatchPreload]);

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

      const [rowKeyDatabaseId, rowId] = rowKey.split('_rows_');
      const currentDatabaseId = getDatabaseId();

      const rowDoc = await createRow(rowKey);

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
    [createRow, getDatabaseId, ensureBlobPrefetch]
  );

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

      if (!isCurrentEnsure()) return;

      // Fast path: row already loaded (e.g. by batch preload or previous call).
      // Check before awaiting the gate to avoid blocking on already-available rows.
      const existing = rowMapRef.current[rowId];

      if (hasRowConditionData(existing)) {
        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);

        registerRowSync(rowKey);
        return existing;
      }

      // Wait for batch preload to finish — it loads visible rows from seeds
      // in parallel. After it completes, the row may now be in rowMap.
      await gate.promise;

      if (!isCurrentEnsure()) return;

      const existingAfterGate = rowMapRef.current[rowId];

      if (hasRowConditionData(existingAfterGate)) {
        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);

        registerRowSync(rowKey);
        return existingAfterGate;
      }

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) {
        const rowDoc = await pending;

        return isCurrentEnsure() ? rowDoc : undefined;
      }

      const promise = (async () => {
        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);
        const cachedRowDoc = getCachedRowDoc(rowKey);
        const seed = peekDatabaseRowDocSeed(rowKey);

        if (hasRowConditionData(cachedRowDoc)) {
          registerRowSync(rowKey);
          return cachedRowDoc;
        }

        try {
          const rowDoc = await openRowDoc(rowKey, seed ?? undefined);

          if (!isCurrentEnsure()) return undefined;

          // Bind sync for this row - only visible rows call ensureRow
          // Non-visible rows rely on blob diff cached data
          registerRowSync(rowKey);

          if (!localCachePrimedRef.current) {
            localCachePrimedRef.current = true;
            void ensureBlobPrefetch();
          }

          return rowDoc;
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
            if (prev[rowId]) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return isCurrentEnsure() ? rowDoc : undefined;
      } finally {
        if (pendingRowDocsRef.current.get(rowId) === promise) {
          pendingRowDocsRef.current.delete(rowId);
        }
      }
    },
    // Omitted deps are stable: setRowMap (useState setter), refs (rowMapRef, pendingRowDocsRef,
    // localCachePrimedRef), and module-level imports (openRowDoc, getCachedRowDoc, peekDatabaseRowDocSeed, getRowKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createRow, databaseLifecycleIdentity, getDatabaseId, ensureBlobPrefetch, registerRowSync]
  );

  useLayoutEffect(() => {
    activeDatabaseLifecycleRef.current = databaseLifecycleIdentity;
    const prefetchGeneration = blobPrefetchGenerationRef.current + 1;
    const previousGate = seedsGateRef.current;

    blobPrefetchGenerationRef.current = prefetchGeneration;
    previousGate.resolve();
    const initialRowMap = props.initialRowMap ?? {};

    rowMapRef.current = {};
    pendingRowDocsRef.current.clear();
    prefetchPromisesRef.current.clear();
    blobPrefetchPromiseRef.current = null;
    localCachePrimedRef.current = false;
    syncedRowKeysRef.current.clear();
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

  // Schedule deferred cleanup for all row sync contexts on unmount
  useEffect(() => {
    const syncedKeys = syncedRowKeysRef;
    const cleanup = props.scheduleDeferredCleanup;

    return () => {
      if (!cleanup) return;
      syncedKeys.current.forEach((rowKey) => {
        const rowId = rowKey.split('_rows_')[1];

        if (rowId) {
          cleanup(rowId);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scheduleDeferredCleanup]);

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
