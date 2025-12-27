import EventEmitter from 'events';

import React, { createContext, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';

import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateRowDoc,
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
  UIVariant,
  UpdatePagePayload,
  UpdateSpacePayload,
  UserWorkspaceInfo,
  View,
  ViewIconType,
} from '@/application/types';
import LoadingDots from '@/components/_shared/LoadingDots';
import { findView } from '@/components/_shared/outline/utils';
import {
  DATABASE_TAB_VIEW_ID_QUERY_PARAM,
  resolveSidebarSelectedViewId,
} from '@/components/app/hooks/resolveSidebarSelectedViewId';

import { AuthInternalContext } from './contexts/AuthInternalContext';
import { AppAuthLayer } from './layers/AppAuthLayer';
import { AppBusinessLayer } from './layers/AppBusinessLayer';
import { AppSyncLayer } from './layers/AppSyncLayer';

// Main AppContext interface - kept identical to maintain backward compatibility
export interface AppContextType {
  toView: (viewId: string, blockId?: string, keepSearch?: boolean) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  createRowDoc?: CreateRowDoc;
  loadView: LoadView;
  outline?: View[];
  viewId?: string;
  wordCount?: Record<string, TextCount>;
  setWordCount?: (viewId: string, count: TextCount) => void;
  currentWorkspaceId?: string;
  onChangeWorkspace?: (workspaceId: string) => Promise<void>;
  userWorkspaceInfo?: UserWorkspaceInfo;
  breadcrumbs?: View[];
  appendBreadcrumb?: AppendBreadcrumb;
  loadFavoriteViews?: () => Promise<View[] | undefined>;
  loadRecentViews?: () => Promise<View[] | undefined>;
  loadTrash?: (workspaceId: string) => Promise<void>;
  favoriteViews?: View[];
  recentViews?: View[];
  trashList?: View[];
  rendered?: boolean;
  onRendered?: () => void;
  notFound?: boolean;
  viewHasBeenDeleted?: boolean;
  addPage?: (parentId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  updatePageIcon?: (viewId: string, icon: { ty: ViewIconType; value: string }) => Promise<void>;
  updatePageName?: (viewId: string, name: string) => Promise<void>;
  deleteTrash?: (viewId?: string) => Promise<void>;
  restorePage?: (viewId?: string) => Promise<void>;
  movePage?: (viewId: string, parentId: string, prevViewId?: string) => Promise<void>;
  openPageModal?: (viewId: string) => void;
  openPageModalViewId?: string;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  createSpace?: (payload: CreateSpacePayload) => Promise<string>;
  updateSpace?: (payload: UpdateSpacePayload) => Promise<void>;
  uploadFile?: (viewId: string, file: File, onProgress?: (n: number) => void) => Promise<string>;
  getSubscriptions?: () => Promise<Subscription[]>;
  publish?: (view: View, publishName?: string, visibleViewIds?: string[]) => Promise<void>;
  unpublish?: (viewId: string) => Promise<void>;
  refreshOutline?: () => Promise<void>;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  generateAISummaryForRow?: (payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow?: (payload: GenerateAITranslateRowPayload) => Promise<string>;
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
  createOrphanedView?: (payload: { document_id: string }) => Promise<void>;
  loadDatabasePrompts?: LoadDatabasePrompts;
  testDatabasePromptConfig?: TestDatabasePromptConfig;
  eventEmitter?: EventEmitter;
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  awarenessMap?: Record<string, Awareness>;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  loadMentionableUsers?: () => Promise<MentionablePerson[]>;
}

// Main AppContext - same as original
export const AppContext = createContext<AppContextType | null>(null);

// Internal component to conditionally render sync and business layers only when workspace ID exists
const ConditionalWorkspaceLayers = ({ children }: { children: React.ReactNode }) => {
  const authContext = useContext(AuthInternalContext);
  const { userWorkspaceInfo } = authContext || {};

  // Show loading animation while workspace ID is being loaded
  if (!userWorkspaceInfo) {
    return (
      <div className='fixed inset-0 flex items-center justify-center bg-background-primary'>
        <LoadingDots className='flex items-center justify-center' />
      </div>
    );
  }

  return (
    <AppSyncLayer>
      <AppBusinessLayer>{children}</AppBusinessLayer>
    </AppSyncLayer>
  );
};

// Refactored AppProvider using layered architecture
// External API remains identical - all changes are internal
export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <AppAuthLayer>
      <ConditionalWorkspaceLayers>{children}</ConditionalWorkspaceLayers>
    </AppAuthLayer>
  );
};

// All hooks remain identical to maintain backward compatibility

export function useViewErrorStatus() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useViewErrorStatus must be used within an AppProvider');
  }

  return {
    notFound: context.notFound,
    deleted: context.viewHasBeenDeleted,
  };
}

export function useBreadcrumb() {
  const context = useContext(AppContext);

  return context?.breadcrumbs;
}

export function useUserWorkspaceInfo() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useUserWorkspaceInfo must be used within an AppProvider');
  }

  return context.userWorkspaceInfo;
}

export function useAppOutline() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppOutline must be used within an AppProvider');
  }

  return context.outline;
}

export function useAppAwareness(viewId?: string) {
  const context = useContext(AppContext);

  if (!viewId) {
    return;
  }

  return context?.awarenessMap?.[viewId];
}

export function useAppViewId() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppViewId must be used within an AppProvider');
  }

  return context.viewId;
}

/**
 * Returns the view id that should be treated as "selected" in the sidebar.
 *
 * For database pages, the URL can encode the active database tab view id via the
 * `v` query param while keeping the route view id stable (to avoid reloading the
 * database doc on every tab switch). Desktop keeps the sidebar selection in sync
 * with the active tab; this hook provides the equivalent behavior for Web.
 */
export function useSidebarSelectedViewId() {
  const routeViewId = useAppViewId();
  const outline = useAppOutline();
  const [searchParams] = useSearchParams();
  const tabViewId = searchParams.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM);

  return useMemo(
    () =>
      resolveSidebarSelectedViewId({
        routeViewId,
        tabViewId,
        outline,
      }),
    [outline, routeViewId, tabViewId]
  );
}

export function useAppWordCount(viewId?: string | null) {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppWordCount must be used within an AppProvider');
  }

  if (!viewId) {
    return;
  }

  return context.wordCount?.[viewId];
}

export function useOpenModalViewId() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useOpenModalViewId must be used within an AppProvider');
  }

  return context.openPageModalViewId;
}

export function useAppView(viewId?: string) {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppView must be used within an AppProvider');
  }

  if (!viewId) {
    return;
  }

  return findView(context.outline || [], viewId);
}

export function useCurrentWorkspaceId() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useCurrentWorkspaceId must be used within an AppProvider');
  }

  return context.currentWorkspaceId;
}

export function useAppHandlers() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppHandlers must be used within an AppProvider');
  }

  return {
    toView: context.toView,
    loadViewMeta: context.loadViewMeta,
    createRowDoc: context.createRowDoc,
    loadView: context.loadView,
    appendBreadcrumb: context.appendBreadcrumb,
    onChangeWorkspace: context.onChangeWorkspace,
    onRendered: context.onRendered,
    addPage: context.addPage,
    openPageModal: context.openPageModal,
    openPageModalViewId: context.openPageModalViewId,
    deletePage: context.deletePage,
    deleteTrash: context.deleteTrash,
    restorePage: context.restorePage,
    updatePage: context.updatePage,
    movePage: context.movePage,
    loadViews: context.loadViews,
    setWordCount: context.setWordCount,
    createSpace: context.createSpace,
    updateSpace: context.updateSpace,
    uploadFile: context.uploadFile,
    getSubscriptions: context.getSubscriptions,
    publish: context.publish,
    unpublish: context.unpublish,
    refreshOutline: context.refreshOutline,
    createDatabaseView: context.createDatabaseView,
    generateAISummaryForRow: context.generateAISummaryForRow,
    generateAITranslateForRow: context.generateAITranslateForRow,
    loadDatabaseRelations: context.loadDatabaseRelations,
    createOrphanedView: context.createOrphanedView,
    loadDatabasePrompts: context.loadDatabasePrompts,
    testDatabasePromptConfig: context.testDatabasePromptConfig,
    eventEmitter: context.eventEmitter,
    getMentionUser: context.getMentionUser,
    awarenessMap: context.awarenessMap,
    checkIfRowDocumentExists: context.checkIfRowDocumentExists,
    updatePageIcon: context.updatePageIcon,
    updatePageName: context.updatePageName,
    getViewIdFromDatabaseId: context.getViewIdFromDatabaseId,
    loadMentionableUsers: context.loadMentionableUsers,
  };
}

export function useAppFavorites() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppFavorites must be used within an AppProvider');
  }

  return {
    loadFavoriteViews: context.loadFavoriteViews,
    favoriteViews: context.favoriteViews,
  };
}

export function useAppRecent() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppRecent must be used within an AppProvider');
  }

  return {
    loadRecentViews: context.loadRecentViews,
    recentViews: context.recentViews,
  };
}

export function useAppTrash() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppTrash must be used within an AppProvider');
  }

  return {
    loadTrash: context.loadTrash,
    trashList: context.trashList,
  };
}
