import { useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import LoadingDots from '@/components/_shared/LoadingDots';
import { findView } from '@/components/_shared/outline/utils';
import {
  DATABASE_TAB_VIEW_ID_QUERY_PARAM,
  resolveSidebarHighlightedViewIds,
  resolveSidebarSelectedViewId,
} from '@/components/app/hooks/resolveSidebarSelectedViewId';

import { AppEventEmitterContext } from './contexts/AppEventEmitterContext';
import { AppNavigationContext } from './contexts/AppNavigationContext';
import { AppOperationsContext } from './contexts/AppOperationsContext';
import { AppOutlineContext } from './contexts/AppOutlineContext';
import { AppSyncContext } from './contexts/AppSyncContext';
import { AuthInternalContext } from './contexts/AuthInternalContext';
import { AppAuthLayer } from './layers/AppAuthLayer';
import { AppBusinessLayer } from './layers/AppBusinessLayer';
import { AppSyncLayer } from './layers/AppSyncLayer';

// Internal component to conditionally render sync and business layers only when workspace ID exists
const ConditionalWorkspaceLayers = ({ children }: { children: ReactNode }) => {
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
export const AppProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AppAuthLayer>
      <ConditionalWorkspaceLayers>{children}</ConditionalWorkspaceLayers>
    </AppAuthLayer>
  );
};

// ─── Auth-only hooks (bypass business layer entirely) ────────────────────────
// These read from AuthInternalContext, provided by AppAuthLayer.
// Available before the WebSocket or business layers initialize.

/** Returns the current workspace ID. Throws if used outside AppProvider. */
export function useCurrentWorkspaceId() {
  const context = useContext(AuthInternalContext);

  if (!context) {
    throw new Error('useCurrentWorkspaceId must be used within an AppProvider');
  }

  return context.currentWorkspaceId;
}

/** Returns the current workspace ID, or undefined if outside AppProvider. Safe for publish pages. */
export function useCurrentWorkspaceIdOptional(): string | undefined {
  const context = useContext(AuthInternalContext);

  return context?.currentWorkspaceId;
}

/** Returns the full workspace info object. Throws if used outside AppProvider. */
export function useUserWorkspaceInfo() {
  const context = useContext(AuthInternalContext);

  if (!context) {
    throw new Error('useUserWorkspaceInfo must be used within an AppProvider');
  }

  return context.userWorkspaceInfo;
}

/**
 * Returns whether page history is enabled for the current workspace plan.
 * Fails open (returns true) when outside AppProvider — e.g. on publish pages.
 */
export function usePageHistoryEnabled(): boolean {
  const context = useContext(AuthInternalContext);

  // Fail open: if context isn't available (e.g. publish pages), default to true
  return context?.enablePageHistory ?? true;
}

/**
 * Returns whether server-backed AI features are enabled.
 * Fails open to match the desktop default when server info is unavailable.
 */
export function useAIEnabled(): boolean {
  const context = useContext(AuthInternalContext);

  return context?.aiEnabled ?? true;
}

// ─── Navigation-only hooks → AppNavigationContext ────────────────────────────
// Provided by AppBusinessLayer. Available after workspace loads.

/** Whether the current view has finished rendering its main content. */
export function useAppRendered() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useAppRendered must be used within an AppProvider');
  }

  return context.rendered;
}

/** Callback to push a view onto the breadcrumb trail. */
export function useAppendBreadcrumb() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useAppendBreadcrumb must be used within an AppProvider');
  }

  return context.appendBreadcrumb;
}

/** Callback for view components to signal that rendering is complete. */
export function useOnRendered() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useOnRendered must be used within an AppProvider');
  }

  return context.onRendered;
}

/** Open a view in the modal overlay. */
export function useOpenPageModal() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useOpenPageModal must be used within an AppProvider');
  }

  return context.openPageModal;
}

/** The view ID from the current route. */
export function useAppViewId() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useAppViewId must be used within an AppProvider');
  }

  return context.viewId;
}

/** Memoized `{ notFound, deleted }` error flags for the current view. */
export function useViewErrorStatus() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useViewErrorStatus must be used within an AppProvider');
  }

  return useMemo(() => ({
    notFound: context.notFound,
    deleted: context.viewHasBeenDeleted,
  }), [context.notFound, context.viewHasBeenDeleted]);
}

/** The breadcrumb trail, or undefined if outside AppProvider. Does not throw. */
export function useBreadcrumb() {
  const context = useContext(AppNavigationContext);

  return context?.breadcrumbs;
}

/** The view ID currently displayed in the page modal, if any. */
export function useOpenModalViewId() {
  const context = useContext(AppNavigationContext);

  if (!context) {
    throw new Error('useOpenModalViewId must be used within an AppProvider');
  }

  return context.openPageModalViewId;
}

// ─── Outline-only hooks → AppOutlineContext ──────────────────────────────────
// Provided by AppBusinessLayer. Available after workspace loads.

/** The full workspace outline view tree. */
export function useAppOutline() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useAppOutline must be used within an AppProvider');
  }

  return context.outline;
}

/** Find a single view by ID in the outline tree. Returns undefined if not found. */
export function useAppView(viewId?: string) {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useAppView must be used within an AppProvider');
  }

  return useMemo(() => {
    if (!viewId) return;
    return findView(context.outline || [], viewId);
  }, [context.outline, viewId]);
}

/** Set of view IDs whose children have been fetched (for lazy-loading). */
export function useLoadedViewIds() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadedViewIds must be used within an AppProvider');
  }

  return context.loadedViewIds;
}

/** Fetch the children of a single view. */
export function useLoadViewChildren() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadViewChildren must be used within an AppProvider');
  }

  return context.loadViewChildren;
}

/** Fetch children of multiple views in one batch request. */
export function useLoadViewChildrenBatch() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadViewChildrenBatch must be used within an AppProvider');
  }

  return context.loadViewChildrenBatch;
}

/** Invalidate cached children of a view so the next access re-fetches. */
export function useMarkViewChildrenStale() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useMarkViewChildrenStale must be used within an AppProvider');
  }

  return context.markViewChildrenStale;
}

/** Memoized `{ loadFavoriteViews, favoriteViews }`. Only re-renders when favorites change. */
export function useAppFavorites() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useAppFavorites must be used within an AppProvider');
  }

  return useMemo(() => ({
    loadFavoriteViews: context.loadFavoriteViews,
    favoriteViews: context.favoriteViews,
  }), [context.loadFavoriteViews, context.favoriteViews]);
}

/** Memoized `{ loadRecentViews, recentViews }`. Only re-renders when recents change. */
export function useAppRecent() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useAppRecent must be used within an AppProvider');
  }

  return useMemo(() => ({
    loadRecentViews: context.loadRecentViews,
    recentViews: context.recentViews,
  }), [context.loadRecentViews, context.recentViews]);
}

/** Memoized `{ loadTrash, trashList }`. Only re-renders when trash changes. */
export function useAppTrash() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useAppTrash must be used within an AppProvider');
  }

  return useMemo(() => ({
    loadTrash: context.loadTrash,
    trashList: context.trashList,
  }), [context.loadTrash, context.trashList]);
}

/** Force-reload the entire outline tree from the server. */
export function useRefreshOutline() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useRefreshOutline must be used within an AppProvider');
  }

  return context.refreshOutline;
}

/** Load views with an optional UI variant filter. */
export function useLoadViews() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadViews must be used within an AppProvider');
  }

  return context.loadViews;
}

/** Resolve a user UUID to their mentionable-person profile. */
export function useGetMentionUser() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useGetMentionUser must be used within an AppProvider');
  }

  return context.getMentionUser;
}

/** Load all mentionable users in the workspace for @-mention autocomplete. */
export function useLoadMentionableUsers() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadMentionableUsers must be used within an AppProvider');
  }

  return context.loadMentionableUsers;
}

/** Load cross-database relation metadata for the workspace. */
export function useLoadDatabaseRelations() {
  const context = useContext(AppOutlineContext);

  if (!context) {
    throw new Error('useLoadDatabaseRelations must be used within an AppProvider');
  }

  return context.loadDatabaseRelations;
}

// ─── Operations-only hooks → AppOperationsContext ────────────────────────────
// Provided by AppBusinessLayer. Available after workspace loads.
// Prefer narrower hooks (useToView, useGetSubscriptions, usePublishing,
// useCollabHistory) when you only need a few fields.

/**
 * Returns the full AppOperationsContext. Use when you need 3+ operation fields.
 * For single-purpose consumers, prefer the narrower hooks instead.
 */
export function useAppOperations() {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('useAppOperations must be used within an AppProvider');
  }

  return context;
}

/** Navigate to a view by ID. Narrower alternative to `useAppOperations().toView`. */
export function useToView() {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('useToView must be used within an AppProvider');
  }

  return context.toView;
}

/** Fetch workspace subscriptions. Narrower alternative to `useAppOperations().getSubscriptions`. */
export function useGetSubscriptions() {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('useGetSubscriptions must be used within an AppProvider');
  }

  return context.getSubscriptions;
}

/** Memoized `{ publish, unpublish }`. Narrower alternative to `useAppOperations()`. */
export function usePublishing() {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('usePublishing must be used within an AppProvider');
  }

  return useMemo(() => ({
    publish: context.publish,
    unpublish: context.unpublish,
  }), [context.publish, context.unpublish]);
}

/** Memoized `{ getCollabHistory, previewCollabVersion, revertCollabVersion }`. For version history UI. */
export function useCollabHistory() {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('useCollabHistory must be used within an AppProvider');
  }

  return useMemo(() => ({
    getCollabHistory: context.getCollabHistory,
    previewCollabVersion: context.previewCollabVersion,
    revertCollabVersion: context.revertCollabVersion,
  }), [context.getCollabHistory, context.previewCollabVersion, context.revertCollabVersion]);
}

/** Get the cached word/character count for a document view. Returns undefined if no viewId. */
export function useAppWordCount(viewId?: string | null) {
  const context = useContext(AppOperationsContext);

  if (!context) {
    throw new Error('useAppWordCount must be used within an AppProvider');
  }

  if (!viewId) {
    return;
  }

  return context.getWordCount?.(viewId);
}

/** Per-view collaborator awareness (cursors/presence). Returns undefined if no viewId or outside provider. */
export function useAppAwareness(viewId?: string) {
  const context = useContext(AppSyncContext);

  if (!viewId) {
    return;
  }

  return context?.awarenessMap?.[viewId];
}

// ─── Sync hooks → AppSyncContext ─────────────────────────────────────────────
// Provided by AppBusinessLayer (reads sync state from AppSyncLayer).
// Available after workspace loads and WebSocket connects.

/** Returns the full AppSyncContext. */
export function useAppSyncContext() {
  const context = useContext(AppSyncContext);

  if (!context) {
    throw new Error('useAppSyncContext must be used within an AppProvider');
  }

  return context;
}

/** App-wide event bus for cross-component communication. */
export function useEventEmitter() {
  const context = useContext(AppEventEmitterContext);

  if (!context) {
    throw new Error('useEventEmitter must be used within an AppProvider');
  }

  return context;
}

/** Schedule deferred cleanup of a sync object (e.g. Yjs doc) after a delay. */
export function useScheduleDeferredCleanup() {
  const context = useContext(AppSyncContext);

  if (!context) {
    throw new Error('useScheduleDeferredCleanup must be used within an AppProvider');
  }

  return context.scheduleDeferredCleanup;
}

// ─── Multi-context / composite hooks ─────────────────────────────────────────

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

export function useSidebarHighlightedViewIds() {
  const routeViewId = useAppViewId();
  const outline = useAppOutline();
  const breadcrumbs = useBreadcrumb();
  const [searchParams] = useSearchParams();
  const tabViewId = searchParams.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM);

  return useMemo(
    () =>
      resolveSidebarHighlightedViewIds({
        routeViewId,
        tabViewId,
        outline,
        breadcrumbs,
      }),
    [breadcrumbs, outline, routeViewId, tabViewId]
  );
}
