import { createContext, useContext } from 'react';

import {
  View,
  TextCount,
  AppendBreadcrumb,
  LoadView,
  LoadViewMeta,
  CreateRowDoc,
  CreatePagePayload,
  CreatePageResponse,
  UpdatePagePayload,
  ViewIconType,
  CreateSpacePayload,
  UpdateSpacePayload,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  LoadDatabasePrompts,
  TestDatabasePromptConfig,
  DatabaseRelations,
  Subscription,
  MentionablePerson,
  UIVariant,
} from '@/application/types';

// Internal context for business layer
// This context is only used within the app provider layers
export interface BusinessInternalContextType {
  // View and navigation
  viewId?: string;
  toView: (viewId: string, blockId?: string, keepSearch?: boolean) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  loadView: LoadView;
  createRowDoc?: CreateRowDoc;

  // Outline and hierarchy
  outline?: View[];
  breadcrumbs?: View[];
  appendBreadcrumb?: AppendBreadcrumb;
  refreshOutline?: () => Promise<void>;

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
  createOrphanedView?: (payload: { document_id: string }) => Promise<void>;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;

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