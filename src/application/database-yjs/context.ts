import EventEmitter from 'events';

import { AxiosInstance } from 'axios';
import { createContext, useContext, useEffect } from 'react';

import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreateRowDoc,
  DatabaseRelations,
  DateFormat,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  LoadView,
  LoadViewMeta,
  RowId,
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
  rowDocMap: Record<RowId, YDoc> | null;
  ensureRowDoc?: (rowId: string) => Promise<YDoc | undefined> | void;
  isDatabaseRowPage?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  isDocumentBlock?: boolean;
  // use different view id to navigate to row
  navigateToRow?: (rowId: string, viewId?: string) => void;
  loadView?: LoadView;
  createRowDoc?: CreateRowDoc;
  loadViewMeta?: LoadViewMeta;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  onRendered?: () => void;
  showActions?: boolean;
  workspaceId: string;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  deletePage?: (viewId: string) => Promise<void>;
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
  loadViews?: () => Promise<View[]>;
  uploadFile?: (file: File) => Promise<string>;
  createOrphanedView?: (payload: { document_id: string }) => Promise<void>;
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

export const useDocGuid = () => {
  return useDatabaseContext().databaseDoc.guid;
};

export const useSharedRoot = () => {
  return useDatabaseContext().databaseDoc?.getMap(YjsEditorKey.data_section) as YSharedRoot;
};

export const useCreateRow = () => {
  const context = useDatabaseContext();

  return context.createRowDoc;
};

export const useDatabase = () => {
  const database = useDatabaseContext()
    .databaseDoc?.getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database) as YDatabase;

  return database;
};

export const useNavigateToRow = () => {
  return useDatabaseContext().navigateToRow;
};

export const useRowDocMap = () => {
  return useDatabaseContext().rowDocMap;
};

export const useIsDatabaseRowPage = () => {
  return useDatabaseContext().isDatabaseRowPage;
};

export const useRow = (rowId: string) => {
  const { rowDocMap, ensureRowDoc } = useDatabaseContext();

  useEffect(() => {
    void ensureRowDoc?.(rowId);
  }, [ensureRowDoc, rowId]);

  return rowDocMap?.[rowId]?.getMap(YjsEditorKey.data_section);
};

export const useRowData = (rowId: string) => {
  return useRow(rowId)?.get(YjsEditorKey.database_row) as YDatabaseRow;
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

  return viewId ? database?.get(YjsDatabaseKey.views)?.get(viewId) : undefined;
};

export function useDatabaseFields() {
  const database = useDatabase();

  return database.get(YjsDatabaseKey.fields);
}

export const useDatabaseSelectedView = (viewId: string) => {
  const database = useDatabase();

  return database.get(YjsDatabaseKey.views).get(viewId);
};

export const useDefaultTimeSetting = (): DefaultTimeSetting => {
  const currentUser = useCurrentUser();

  
  return {
    dateFormat: currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat ?? DateFormat.Local,
    timeFormat: currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat ?? TimeFormat.TwelveHour,
    startWeekOn: currentUser?.metadata?.[MetadataKey.StartWeekOn] as number ?? 0,
  }
}
