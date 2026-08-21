import EventEmitter from 'events';

import { AxiosInstance } from 'axios';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreateRow,
  DatabaseRelations,
  DateFormat,
  DuplicatePageOperationOptions,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  LoadRowDocument,
  LoadView,
  LoadViewMeta,
  MentionSearchContext,
  RowId,
  SearchMentions,
  Subscription,
  TestDatabasePromptConfig,
  TimeFormat,
  UIVariant,
  UpdatePagePayload,
  View,
  YDatabase,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { DefaultTimeSetting, MetadataKey } from '@/application/user-metadata';
import { CalendarViewType } from '@/components/database/fullcalendar/types';
import { useCurrentUser } from '@/components/main/app.hooks';

export interface DatabaseContextState {
  readOnly: boolean;
  /**
   * Whether the current user may comment on this database's row documents.
   * Independent from [readOnly] — Read-and-comment access is read-only but
   * still permits inline comments.
   */
  canComment?: boolean;
  /** Canonical server write permission, independent from database UI state. */
  canWrite?: boolean;
  databaseDoc: YDoc;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant
   * regardless of which view tab is currently selected.
   */
  databasePageId: string;
  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Changes when the user switches between different view tabs.
   * Defaults to databasePageId when no specific tab is selected via URL.
   */
  activeViewId: string;
  rowMap: Record<RowId, YDoc> | null;
  /**
   * Set while the row-template editor edits its hidden source row. That row
   * never joins `row_orders`, so relation edits on it must not write
   * reciprocal back-links from real rows to the phantom template row.
   */
  templateEditingRowId?: RowId;
  ensureRow?: (rowId: string) => Promise<YDoc | undefined> | void;
  loadRowFromSeed?: (rowId: string) => Promise<YDoc | undefined>;
  /**
   * Synchronous shared read-only doc for filter/sort. Reuses an existing
   * row doc when cached; otherwise builds one shared in-memory Y.Doc from
   * seed bytes without touching IndexedDB or consuming the seed.
   */
  peekRowDocFromSeed?: (rowId: string) => YDoc | null;
  bindRowSync?: (rowId: string) => void;
  /**
   * Local mutation provenance used for safe, additive derived-metadata writes.
   * Realtime registration alone does not imply that a seed doc is fresh.
   */
  hasCellLocalMutation?: (rowId: string, fieldId: string) => boolean;
  markCellLocalMutation?: (rowId: string, fieldId: string) => void;
  getCellLocalMutationRevision?: (fieldId: string) => string;
  subscribeToCellLocalMutations?: (fieldId: string, onStoreChange: () => void) => () => void;
  blobPrefetchComplete?: boolean;
  /** True as soon as row seeds are cached (before IndexedDB persist completes). */
  seedsReady?: boolean;
  isDatabaseRowPage?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  isDocumentBlock?: boolean;
  embeddedHeight?: number;
  // use different view id to navigate to row
  navigateToRow?: (rowId: string, viewId?: string) => void;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  createRow?: CreateRow;
  loadViewMeta?: LoadViewMeta;
  /**
   * Load a row sub-document (document content inside a database row).
   * In app mode: loads from server via authenticated API.
   * In publish mode: loads from published cache.
   */
  loadRowDocument?: LoadRowDocument;
  /**
   * Create a row document on the server (orphaned view).
   * Only available in app mode - not provided in publish mode.
   * Returns the doc_state (Y.js update) to initialize the local document.
   */
  createRowDocument?: import('@/application/types').CreateRowDocument;
  /** Fire-and-forget: ask the server to duplicate the row document with inline DB deep copy. */
  duplicateRowDocument?: import('@/application/types').DuplicateRowDocument;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  onRendered?: () => void;
  showActions?: boolean;
  workspaceId: string;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  addPage?: (
    parentId: string,
    payload: import('@/application/types').CreatePagePayload
  ) => Promise<import('@/application/types').CreatePageResponse>;
  openPageModal?: (viewId: string) => void;
  deletePage?: (viewId: string) => Promise<void>;
  duplicatePage?: (viewId: string, options?: DuplicatePageOperationOptions) => Promise<void>;
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;
  loadDatabaseRelations?: (options?: { refresh?: boolean }) => Promise<DatabaseRelations | undefined>;
  searchMentions?: SearchMentions;
  mentionContext?: MentionSearchContext;
  loadViews?: () => Promise<View[]>;
  uploadFile?: (file: File) => Promise<string>;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  requestInstance?: AxiosInstance | null;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  eventEmitter?: EventEmitter;
  getSubscriptions?: (() => Promise<Subscription[]>) | undefined;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  variant?: UIVariant;
  // Calendar view type map: viewId -> CalendarViewType
  calendarViewTypeMap?: Map<string, CalendarViewType>;
  setCalendarViewType?: (viewId: string, viewType: CalendarViewType) => void;
  openPageModalViewId?: string;
  // Close row detail modal (when in modal context)
  closeRowDetailModal?: () => void;
}

export const DatabaseContext = createContext<DatabaseContextState | null>(null);

export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);

  if (!context) {
    throw new Error('DatabaseContext is not provided');
  }

  return context;
};

/**
 * Optional variant of useDatabaseContext that returns undefined
 * instead of throwing when used outside DatabaseContextProvider.
 * Use this in components that may render outside database context.
 */
export const useDatabaseContextOptional = (): DatabaseContextState | undefined => {
  return useContext(DatabaseContext) ?? undefined;
};

export const useDocGuid = () => {
  return useDatabaseContext().databaseDoc.guid;
};

export const useSharedRoot = () => {
  return useDatabaseContext().databaseDoc?.getMap(YjsEditorKey.data_section) as YSharedRoot;
};

export const useCreateRow = () => {
  const context = useDatabaseContext();

  return context.createRow;
};

type DatabaseExternalStore = {
  getDatabase: () => YDatabase | undefined;
  getSnapshot: () => number;
  subscribe: (onStoreChange: () => void) => () => void;
};

const databaseExternalStores = new WeakMap<YDoc, DatabaseExternalStore>();

function createDatabaseExternalStore(databaseDoc: YDoc): DatabaseExternalStore {
  const dataSection = databaseDoc.getMap(YjsEditorKey.data_section);
  const subscribers = new Set<() => void>();
  let database = dataSection.get(YjsEditorKey.database) as YDatabase | undefined;
  let revision = 0;
  let observing = false;

  const publish = () => {
    revision += 1;
    subscribers.forEach((subscriber) => subscriber());
  };

  const handleDatabaseChange = () => publish();
  const readCurrentDatabase = () => dataSection.get(YjsEditorKey.database) as YDatabase | undefined;
  const replaceObservedDatabase = (nextDatabase: YDatabase | undefined) => {
    if (nextDatabase === database) return false;

    if (observing) {
      try {
        database?.unobserveDeep(handleDatabaseChange);
      } catch {
        // The previous database map may already have been destroyed.
      }
    }

    database = nextDatabase;

    if (observing) database?.observeDeep(handleDatabaseChange);
    return true;
  };

  const handleDataSectionChange = () => {
    replaceObservedDatabase(readCurrentDatabase());
    publish();
  };

  const attach = () => {
    if (observing) return;

    database = readCurrentDatabase();
    observing = true;
    dataSection.observe(handleDataSectionChange);
    database?.observeDeep(handleDatabaseChange);

    // Close the render-to-subscribe gap with a primitive cached revision. This
    // is deliberately not an object snapshot: useSyncExternalStore requires
    // getSnapshot to stay referentially stable until the Yjs store changes.
    revision += 1;
  };

  const detach = () => {
    if (!observing) return;

    observing = false;
    dataSection.unobserve(handleDataSectionChange);
    try {
      database?.unobserveDeep(handleDatabaseChange);
    } catch {
      // Ignore teardown of an already-destroyed Yjs map.
    }
  };

  return {
    getDatabase: () => database,
    getSnapshot: () => revision,
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      if (subscribers.size === 1) attach();

      return () => {
        subscribers.delete(onStoreChange);
        if (subscribers.size === 0) detach();
      };
    },
  };
}

function getDatabaseExternalStore(databaseDoc: YDoc) {
  let store = databaseExternalStores.get(databaseDoc);

  if (!store) {
    store = createDatabaseExternalStore(databaseDoc);
    databaseExternalStores.set(databaseDoc, store);
  }

  return store;
}

export const useDatabase = () => {
  const context = useDatabaseContext();
  const databaseDoc = context.databaseDoc;
  const store = getDatabaseExternalStore(databaseDoc);

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Preserve the established hook contract. During initial hydration the
  // runtime value may still be absent (as before), but widening this return
  // type would force unrelated consumers to add guards across the codebase.
  return store.getDatabase() as YDatabase;
};

export const useNavigateToRow = () => {
  return useDatabaseContext().navigateToRow;
};

export const useRowMap = () => {
  return useDatabaseContext().rowMap;
};

export const useIsDatabaseRowPage = () => {
  return useDatabaseContext().isDatabaseRowPage;
};

/**
 * Hook to access and observe a row document.
 * Ensures the row doc is loaded and re-renders when row data changes.
 */
export const useRow = (rowId: string) => {
  const { rowMap, ensureRow } = useDatabaseContext();
  const [, forceUpdate] = useState(0);
  const rowDoc = rowMap?.[rowId];

  // Ensure row document is loaded.
  useEffect(() => {
    let cancelled = false;

    if (ensureRow && rowId) {
      const promise = ensureRow(rowId);

      if (promise) {
        promise.catch((error: unknown) => {
          if (!cancelled) {
            console.error('[useRow] Failed to ensure row doc:', error);
          }
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [ensureRow, rowId]);

  // Observe row document for changes and re-render when data updates.
  useEffect(() => {
    if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) {
      return;
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);

    let detachRowObserver: (() => void) | null = null;
    const update = () => {
      forceUpdate((prev) => prev + 1);
    };

    const attachRowObserver = () => {
      const row = rowSharedRoot.get(YjsEditorKey.database_row) as
        | { observeDeep?: (cb: () => void) => void; unobserveDeep?: (cb: () => void) => void }
        | undefined;

      if (!row?.observeDeep || !row?.unobserveDeep) return;

      const unobserve = row.unobserveDeep.bind(row);

      row.observeDeep(update);
      detachRowObserver = () => {
        try {
          unobserve(update);
        } catch {
          // Ignore errors from unobserving destroyed Yjs objects
        }
      };
    };

    const handleRootChange = (event: { keysChanged?: Set<string> }) => {
      if (!event.keysChanged?.has(YjsEditorKey.database_row)) return;
      if (detachRowObserver) {
        detachRowObserver();
        detachRowObserver = null;
      }

      attachRowObserver();
      update();
    };

    rowSharedRoot.observe(handleRootChange);
    attachRowObserver();
    update();

    return () => {
      if (detachRowObserver) {
        detachRowObserver();
      }

      rowSharedRoot.unobserve(handleRootChange);
    };
  }, [rowDoc, rowId]);

  return rowDoc?.getMap(YjsEditorKey.data_section);
};

export const useRowData = (rowId: string) => {
  return useRow(rowId)?.get(YjsEditorKey.database_row) as YDatabaseRow;
};

/**
 * Returns true once the row's collab content has been loaded into the local
 * doc (i.e. the `database_row` YMap is present in the row's data_section).
 * Useful for showing a loading indicator on rows that have no local
 * IndexedDB cache yet while their first sync arrives.
 */
export const useIsRowLoaded = (rowId: string) => {
  const dataSection = useRow(rowId);

  return Boolean(dataSection?.has(YjsEditorKey.database_row));
};

/**
 * Returns the currently active view tab ID.
 * This is the view that is currently being displayed (Grid, Board, or Calendar).
 */
export const useDatabaseViewId = () => {
  const context = useDatabaseContext();

  return context?.activeViewId;
};

export const useReadOnly = () => {
  const context = useDatabaseContext();

  return context?.readOnly === undefined ? true : context?.readOnly;
};

export const useDatabaseView = () => {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const views = database?.get(YjsDatabaseKey.views);

  return viewId ? views?.get(viewId) : undefined;
};

export function useDatabaseFields() {
  const database = useDatabase();

  return database?.get(YjsDatabaseKey.fields);
}

export const useDatabaseSelectedView = (viewId: string) => {
  const database = useDatabase();

  return database?.get(YjsDatabaseKey.views)?.get(viewId);
};

export const useDefaultTimeSetting = (): DefaultTimeSetting => {
  const currentUser = useCurrentUser();

  return {
    dateFormat: (currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local,
    timeFormat: (currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat) ?? TimeFormat.TwelveHour,
    startWeekOn: (currentUser?.metadata?.[MetadataKey.StartWeekOn] as number) ?? 0,
  };
};
