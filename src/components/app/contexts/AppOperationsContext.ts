import { createContext } from 'react';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateRow,
  CreateSpacePayload,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  LoadView,
  LoadViewMeta,
  Subscription,
  TestDatabasePromptConfig,
  TextCount,
  Types,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
  YDoc,
} from '@/application/types';

// Stable operations — callbacks and infrequently-changing values
export interface AppOperationsContextType {
  // View loading / navigation
  toView: (viewId: string, blockId?: string, keepSearch?: boolean) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  loadView: LoadView;
  createRow?: CreateRow;
  bindViewSync?: (doc: YDoc) => SyncContext | null;

  // Page CRUD
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  updatePageIcon?: (viewId: string, icon: { ty: ViewIconType; value: string }) => Promise<void>;
  updatePageName?: (viewId: string, name: string) => Promise<void>;
  movePage?: (viewId: string, parentId: string, prevViewId?: string) => Promise<void>;
  deleteTrash?: (viewId?: string) => Promise<void>;
  restorePage?: (viewId?: string) => Promise<void>;

  // Space operations
  createSpace?: (payload: CreateSpacePayload) => Promise<string>;
  updateSpace?: (payload: UpdateSpacePayload) => Promise<void>;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;

  // File operations
  uploadFile?: (viewId: string, file: File, onProgress?: (n: number) => void) => Promise<string>;

  // Publishing
  getSubscriptions?: () => Promise<Subscription[]>;
  publish?: (view: View, publishName?: string, visibleViewIds?: string[]) => Promise<void>;
  unpublish?: (viewId: string) => Promise<void>;

  // AI operations
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;

  // Database operations
  createOrphanedView?: (payload: { document_id: string }) => Promise<Uint8Array>;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  createRowDocument?: (documentId: string) => Promise<Uint8Array | null>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;

  // Word count
  getWordCount?: (viewId: string) => TextCount | undefined;
  setWordCount?: (viewId: string, count: TextCount) => void;

  // Collaboration history
  getCollabHistory?: (viewId: string) => Promise<CollabVersionRecord[]>;
  previewCollabVersion?: (viewId: string, versionId: string, collabType: Types) => Promise<YDoc | undefined>;
  revertCollabVersion?: (viewId: string, versionId: string) => Promise<void>;

  // Workspace
  onChangeWorkspace?: (workspaceId: string) => Promise<void>;
}

export const AppOperationsContext = createContext<AppOperationsContextType | null>(null);
