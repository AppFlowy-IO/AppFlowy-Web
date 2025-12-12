import { createContext, useContext } from 'react';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateRow,
  CreateSpacePayload,
  DatabaseRelations,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  LoadView,
  LoadViewMeta,
  MentionablePerson,
  Subscription,
  TestDatabasePromptConfig,
  TextCount,
  Types,
  UIVariant,
  UpdatePagePayload,
  UpdateSpacePayload,
  View,
  ViewIconType,
  YDoc,
} from '@/application/types';

// Internal context for business layer
// This context is only used within the app provider layers
export interface BusinessInternalContextType {
  // View and navigation
  viewId?: string;
  toView: (viewId: string, blockId?: string, keepSearch?: boolean) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  loadView: LoadView;
  createRow?: CreateRow;
  bindViewSync?: (doc: YDoc) => SyncContext | null;

  // Outline and hierarchy
  outline?: View[];
  breadcrumbs?: View[];
  appendBreadcrumb?: AppendBreadcrumb;
  refreshOutline?: () => Promise<void>;
  loadedViewIds?: Set<string>;
  loadViewChildren?: (viewId: string) => Promise<View[]>;
  loadViewChildrenBatch?: (viewIds: string[]) => Promise<View[]>;
  markViewChildrenStale?: (viewId: string) => void;

  // Data views
  favoriteViews?: View[];
  recentViews?: View[];
  trashList?: View[];
  loadFavoriteViews?: () => Promise<View[] | undefined>;
  loadRecentViews?: () => Promise<View[] | undefined>;
  loadTrash?: (workspaceId: string) => Promise<void>;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;

  // Page operations
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  updatePageIcon?: (viewId: string, icon: { ty: ViewIconType; value: string }) => Promise<void>;
  updatePageName?: (viewId: string, name: string) => Promise<void>;
  movePage?: (viewId: string, parentId: string, prevViewId?: string) => Promise<void>;

  // Trash operations
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
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
  createOrphanedView?: (payload: { document_id: string }) => Promise<Uint8Array>;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  /**
   * Load a row sub-document (document content inside a database row).
   */
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  /**
   * Create a row document on the server (orphaned view).
   */
  createRowDocument?: (documentId: string) => Promise<Uint8Array | null>;

  // User operations
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  loadMentionableUsers?: () => Promise<MentionablePerson[]>;

  // UI state
  rendered?: boolean;
  onRendered?: () => void;
  notFound?: boolean;
  viewHasBeenDeleted?: boolean;
  openPageModal?: (viewId: string) => void;
  openPageModalViewId?: string;

  // Word count
  wordCount?: Record<string, TextCount>;
  setWordCount?: (viewId: string, count: TextCount) => void;

  // Collaboration history
  getCollabHistory?: (viewId: string, since?: Date | undefined) => Promise<CollabVersionRecord[]>;
  previewCollabVersion?: (viewId: string, versionId: string, collabType: Types) => Promise<YDoc | undefined>;
  revertCollabVersion?: (viewId: string, versionId: string, collabType: Types) => Promise<void>;
}

export const BusinessInternalContext = createContext<BusinessInternalContextType | null>(null);

// Hook to access business internal context
export function useBusinessInternal() {
  const context = useContext(BusinessInternalContext);

  if (!context) {
    throw new Error('useBusinessInternal must be used within a BusinessInternalProvider');
  }

  return context;
}
