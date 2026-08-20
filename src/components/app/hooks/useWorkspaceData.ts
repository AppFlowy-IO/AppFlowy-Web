import { applyPatch, type Operation, type ReplaceOperation } from 'fast-json-patch';
import { sortBy, uniqBy } from 'lodash-es';
import isEqual from 'lodash-es/isEqual';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService, WorkspaceService } from '@/application/services/domains';
import {
  captureWorkspaceViewMetadataAccessToken,
  invalidateWorkspaceViewMetadata,
  markWorkspaceViewMetadataOutlineUntrusted,
  primeWorkspaceViewMetadata,
  primeWorkspaceViewMetadataFields,
  primeWorkspaceViewMetadataFromServer,
} from '@/application/services/js-services/workspace-view-metadata';
import { invalidToken } from '@/application/session/token';
import { DatabaseRelations, MentionablePerson, UIVariant, View, ViewLayout } from '@/application/types';
import { isDatabaseLayout } from '@/application/view-utils';
import {
  addViewToOutline,
  deduplicateOutlineChildren,
  mergeChildrenIntoOutline,
  removeViewFromOutline,
  reorderChildrenInOutline,
  updateViewInOutline,
} from '@/components/_shared/outline/mergeOutline';
import { findShareWithMeSpace, findView, findViewByLayout } from '@/components/_shared/outline/utils';
import {
  limitSidebarOutlineExpandedViewIds,
  type SidebarOutlineRevalidationResult,
} from '@/components/app/outline/sidebarRevalidation';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { notification } from '@/proto/messages';
import { createDeduplicatedNoArgsRequest, createDeduplicatedRequest } from '@/utils/deduplicateRequest';
import { Log } from '@/utils/log';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

/**
 * When the outline is replaced with a new shallow tree (from loadOutline or
 * a diff patch), previously lazy-loaded deep children are lost.  This helper
 * re-attaches those children so expanded sidebar nodes don't visually collapse.
 *
 * For every view that was marked as "loaded" in the *old* tree and had
 * children, we check if the same view exists in the *new* tree with empty
 * children.  If so, we graft the old children back in and keep the view in
 * the returned `loadedIds` set.
 */
/**
 * Build a flat id→View index from a View tree for O(1) lookups.
 */
function buildViewIndex(views: View[]): Map<string, View> {
  const index = new Map<string, View>();

  const walk = (list: View[]) => {
    for (const v of list) {
      index.set(v.view_id, v);

      if (v.children && v.children.length > 0) {
        walk(v.children);
      }
    }
  };

  walk(views);
  return index;
}

function buildViewDepthIndex(views: View[]): Map<string, number> {
  const depths = new Map<string, number>();

  const walk = (list: View[], depth: number) => {
    for (const view of list) {
      depths.set(view.view_id, depth);
      if (view.children?.length) walk(view.children, depth + 1);
    }
  };

  walk(views, 0);
  return depths;
}

function isDatabaseCatalogView(view: View | null | undefined): boolean {
  return Boolean(
    view &&
      (isDatabaseLayout(view.layout) || view.extra?.is_database_container || typeof view.extra?.database_id === 'string')
  );
}

interface DatabaseCatalogViewMetadata {
  databaseId?: string;
  embedded?: boolean;
  icon: View['icon'];
  isContainer?: boolean;
  layout: ViewLayout;
  name: string;
  parentViewId?: string;
}

function getDatabaseCatalogViewMetadata(view: View | null | undefined): DatabaseCatalogViewMetadata | null {
  if (!isDatabaseCatalogView(view)) return null;

  return {
    databaseId: view?.extra?.database_id,
    embedded: view?.extra?.embedded,
    icon: view?.icon ?? null,
    isContainer: view?.extra?.is_database_container,
    layout: view?.layout ?? ViewLayout.Document,
    name: view?.name ?? '',
    parentViewId: view?.parent_view_id,
  };
}

function collectDatabaseCatalogViews(views: View[]): Map<string, DatabaseCatalogViewMetadata> {
  const entries = new Map<string, DatabaseCatalogViewMetadata>();

  const walk = (items: View[]) => {
    for (const view of items) {
      const metadata = getDatabaseCatalogViewMetadata(view);

      if (metadata) entries.set(view.view_id, metadata);

      if (view.children?.length) walk(view.children);
    }
  };

  walk(views);
  return entries;
}

function databaseCatalogChanged(previous: View[], next: View[]): boolean {
  const previousViews = collectDatabaseCatalogViews(previous);
  const nextViews = collectDatabaseCatalogViews(next);

  if (previousViews.size !== nextViews.size) return true;

  for (const [viewId, previousMetadata] of previousViews) {
    if (!isEqual(previousMetadata, nextViews.get(viewId))) return true;
  }

  return false;
}

function isOutlineSubtreeComplete(view: View, loadedViewIds: Set<string>): boolean {
  if (view.has_children === true && !loadedViewIds.has(view.view_id)) return false;

  return (view.children ?? []).every((child) => isOutlineSubtreeComplete(child, loadedViewIds));
}

function collectViewPath(root: View, targetViewId: string): View[] | null {
  const path: View[] = [];

  const walk = (view: View): boolean => {
    path.push(view);

    if (view.view_id === targetViewId) {
      return true;
    }

    for (const child of view.children ?? []) {
      if (walk(child)) {
        return true;
      }
    }

    path.pop();
    return false;
  };

  return walk(root) ? path : null;
}

function replaceViewInOutline(outline: View[], replacement: View): { outline: View[]; replaced: boolean } {
  let replaced = false;

  const nextOutline = outline.map((view) => {
    if (view.view_id === replacement.view_id) {
      replaced = true;
      return replacement;
    }

    if (view.children && view.children.length > 0) {
      const childResult = replaceViewInOutline(view.children, replacement);

      if (childResult.replaced) {
        replaced = true;
        return { ...view, children: childResult.outline };
      }
    }

    return view;
  });

  return { outline: replaced ? nextOutline : outline, replaced };
}

function upsertSiblingView(siblings: View[], replacement: View): View[] {
  const index = siblings.findIndex((view) => view.view_id === replacement.view_id);

  if (index === -1) {
    return [...siblings, replacement];
  }

  const next = [...siblings];

  next[index] = replacement;
  return next;
}

function shouldAttachNavigationRootToShareWithMe(outline: View[], navigationRoot: View): boolean {
  if (!findShareWithMeSpace(outline)) return false;
  if (navigationRoot.extra?.is_hidden_space) return false;

  return navigationRoot.access_level !== undefined || navigationRoot.is_private;
}

function upsertNavigationRoot(outline: View[], navigationRoot: View): View[] {
  const replaced = replaceViewInOutline(outline, navigationRoot);

  if (replaced.replaced) {
    return replaced.outline;
  }

  if (shouldAttachNavigationRootToShareWithMe(outline, navigationRoot)) {
    return outline.map((view) => {
      if (!view.extra?.is_hidden_space) return view;

      return {
        ...view,
        children: upsertSiblingView(view.children ?? [], navigationRoot),
        has_children: true,
      };
    });
  }

  return upsertSiblingView(outline, navigationRoot);
}

function mergeNavigationView(
  view: View,
  targetViewId: string,
  cachedById: Map<string, View>,
  loadedViewIds: Set<string>
): View {
  const cached = cachedById.get(view.view_id);
  const navigationChildren = view.children ?? [];
  const preserveCachedChildren =
    navigationChildren.length === 0 &&
    cached?.children &&
    cached.children.length > 0 &&
    (view.view_id === targetViewId || loadedViewIds.has(view.view_id));

  return {
    ...cached,
    ...view,
    children: preserveCachedChildren
      ? cached.children
      : navigationChildren.map((child) => mergeNavigationView(child, targetViewId, cachedById, loadedViewIds)),
  };
}

export function mergeNavigationTreeIntoOutline(
  outline: View[],
  navigationRoot: View,
  targetViewId: string,
  loadedViewIds: Set<string>
): View[] {
  const cachedById = buildViewIndex(outline);
  const mergedRoot = mergeNavigationView(navigationRoot, targetViewId, cachedById, loadedViewIds);

  return upsertNavigationRoot(outline, mergedRoot);
}

export function preserveLoadedChildren(
  newOutline: View[],
  oldOutline: View[],
  prevLoadedIds: Set<string>
): { outline: View[]; loadedIds: Set<string> } {
  if (prevLoadedIds.size === 0) {
    return { outline: newOutline, loadedIds: new Set() };
  }

  // Pre-index the old outline for O(1) lookups (it doesn't mutate during the loop).
  const oldIndex = buildViewIndex(oldOutline);

  let finalOutline = newOutline;
  const nextLoadedIds = new Set<string>();

  for (const loadedId of prevLoadedIds) {
    const oldView = oldIndex.get(loadedId);

    if (!oldView || !oldView.children || oldView.children.length === 0) continue;

    // finalOutline mutates after each graft, so we must search it each iteration.
    const newView = findView(finalOutline, loadedId);

    if (!newView) continue; // view was removed from tree

    // If server explicitly marks the node as empty, do not resurrect stale local children.
    if (newView.has_children === false) {
      continue;
    }

    if (newView.children && newView.children.length > 0) {
      // Children already present (e.g. restored by a parent's graft)
      nextLoadedIds.add(loadedId);
      continue;
    }

    // Graft old children back into the new shallow tree
    finalOutline = mergeChildrenIntoOutline(finalOutline, loadedId, oldView.children, oldView.has_children);
    nextLoadedIds.add(loadedId);
  }

  return { outline: finalOutline, loadedIds: nextLoadedIds };
}

const FOLDER_VIEW_CHANGE_TYPE = {
  VIEW_FIELDS_CHANGED: 0,
  VIEW_ADDED: 1,
  VIEW_REMOVED: 2,
  CHILDREN_REORDERED: 3,
} as const;

const MAX_TRACKED_NON_SIDEBAR_SELF_PARENT_VIEW_IDS = 2_000;

function isSelfParentFolderView(view: View, parentViewId = view.parent_view_id): boolean {
  return parentViewId === view.view_id || view.parent_view_id === view.view_id;
}

function rememberNonSidebarSelfParentViewId(viewIds: Set<string>, viewId: string): void {
  // Refresh insertion order so recently active row documents survive a burst
  // of registrations without letting the event-only classifier grow forever.
  viewIds.delete(viewId);
  viewIds.add(viewId);

  if (viewIds.size <= MAX_TRACKED_NON_SIDEBAR_SELF_PARENT_VIEW_IDS) return;

  const oldestViewId = viewIds.values().next().value as string | undefined;

  if (oldestViewId) viewIds.delete(oldestViewId);
}

export interface RequestAccessError {
  code: number;
  message: string;
}

type JsonPatchOperation = Operation;

type FolderRid = {
  timestamp: number;
  seqNo: number;
};

type PendingFolderViewUpdate = {
  view: View;
  folderRid: FolderRid | null;
};

const AUTHORITATIVE_VIEW_REFRESH_ERROR_CODES = new Set<number>([
  ERROR_CODE.RECORD_NOT_FOUND,
  ERROR_CODE.RECORD_DELETED,
  ERROR_CODE.NOT_LOGGED_IN,
  ERROR_CODE.NOT_HAS_PERMISSION,
  ERROR_CODE.USER_UNAUTHORIZED,
  401,
  403,
  404,
  410,
]);

// Errors that prove the current user can no longer read a view. Deliberately
// excludes auth errors (401 / not-logged-in): a token blip must not wipe the
// local copy of a page the user still has access to.
const ACCESS_REVOKED_PROBE_ERROR_CODES = new Set<number>([
  ERROR_CODE.RECORD_NOT_FOUND,
  ERROR_CODE.RECORD_DELETED,
  ERROR_CODE.NOT_HAS_PERMISSION,
  403,
  404,
  410,
]);

const PERMISSION_SUBTREE_REHYDRATE_MAX_ATTEMPTS = 2;
const NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS = 30_000;

interface NoopFolderTrashRefreshBurst {
  firstNotificationAt: number;
  lastNotificationAt: number;
  maxLatencyProbeCompleted: boolean;
  maxLatencyProbeCoveredSeq: number;
  notificationSeq: number;
  workspaceId: string;
}

function getRefreshErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const dataCode = (error as { response?: { data?: { code?: unknown } } }).response?.data?.code;

  if (typeof dataCode === 'number') return dataCode;

  const code = (error as { code?: unknown }).code;

  if (typeof code === 'number') return code;

  const status = (error as { response?: { status?: unknown } }).response?.status;

  return typeof status === 'number' ? status : undefined;
}

function isAuthoritativeViewRefreshError(error: unknown): boolean {
  const code = getRefreshErrorCode(error);

  return code !== undefined && AUTHORITATIVE_VIEW_REFRESH_ERROR_CODES.has(code);
}

function canUseFallbackForViewRefreshError(error: unknown): boolean {
  const code = getRefreshErrorCode(error);

  if (code === undefined) return false;

  return (
    code === -1 ||
    code === ERROR_CODE.REQUEST_TIMEOUT ||
    code === ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE ||
    code === ERROR_CODE.TOO_MANY_REQUESTS ||
    code === 408 ||
    code === 429 ||
    code >= 500
  );
}

function parseFolderRid(value?: string | null): FolderRid | null {
  if (!value) return null;
  const [timestampRaw, seqRaw] = value.split('-');
  const timestamp = Number(timestampRaw);
  const seqNo = Number(seqRaw);

  if (!Number.isFinite(timestamp) || !Number.isFinite(seqNo)) {
    return null;
  }

  return { timestamp, seqNo };
}

function compareFolderRid(a: FolderRid, b: FolderRid): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }

  return a.seqNo - b.seqNo;
}

function normalizeRootOutlineForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeRootOutlineForComparison);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      if (key === 'folder_rid' || source[key] === undefined) continue;

      normalized[key] = normalizeRootOutlineForComparison(source[key]);
    }

    return normalized;
  }

  return value;
}

function createRootOutlineFingerprint(views: View[]): string {
  return JSON.stringify(normalizeRootOutlineForComparison(views));
}

function collectOutlineViewIds(views: View[], ids = new Set<string>()): Set<string> {
  for (const view of views) {
    ids.add(view.view_id);
    collectOutlineViewIds(view.children ?? [], ids);
  }

  return ids;
}

function getOutlineMembershipChange(previousOutline: View[], nextOutline: View[]) {
  const previousIds = collectOutlineViewIds(previousOutline);
  const nextIds = collectOutlineViewIds(nextOutline);

  return {
    addedIds: Array.from(nextIds).filter((viewId) => !previousIds.has(viewId)),
    removedIds: Array.from(previousIds).filter((viewId) => !nextIds.has(viewId)),
  };
}

function createFolderViewFieldsFingerprint(view: View): string {
  return JSON.stringify(
    normalizeRootOutlineForComparison({
      name: view.name,
      icon: view.icon,
      extra: view.extra,
      is_private: view.is_private,
      is_favorite: view.is_favorite,
      is_locked: view.is_locked,
    })
  );
}

const OUTLINE_NON_VISUAL_FIELDS = new Set(['/last_edited_time', '/last_edited_by']);

function isOnlyNonVisualOutlineChange(patch: JsonPatchOperation[]): boolean {
  return patch.every((op) => {
    if (!op.path?.startsWith('/outline')) return false;
    const path = op.path;

    return Array.from(OUTLINE_NON_VISUAL_FIELDS).some((suffix) => path.endsWith(suffix));
  });
}

function folderOutlinePatchMayAffectFavorites(patch: JsonPatchOperation[]): boolean {
  return patch.some((op) => {
    const path = op.path ?? '';

    return path === '/outline' || path.endsWith('/is_favorite') || path.endsWith('/extra');
  });
}

// Hook for managing workspace data (outline, favorites, recent, trash)
export function useWorkspaceData() {
  const { currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { eventEmitter } = useSyncInternal();
  const currentUserEmail = useCurrentUserOptional()?.email;
  const navigate = useNavigate();

  const [outline, setOutline] = useState<View[]>();
  const stableOutlineRef = useRef<View[]>([]);
  const stableOutlineWorkspaceIdRef = useRef(currentWorkspaceId);
  const stableOutlineWorkspaceRevisionRef = useRef(0);
  // Global folder ordering can advance from lazy subtree fetches. Root polling
  // must compare against the root/sidebar outline snapshot we actually applied.
  const lastFolderRidRef = useRef<FolderRid | null>(null);
  const lastFolderViewRidRef = useRef<FolderRid | null>(null);
  const lastAppliedRootOutlineRidRef = useRef<FolderRid | null>(null);
  const lastAppliedRootOutlineFingerprintRef = useRef<string | null>(null);
  const pendingFolderViewUpdatesRef = useRef<Map<string, PendingFolderViewUpdate>>(new Map());
  const nonSidebarSelfParentViewIdsRef = useRef<Set<string>>(new Set());
  const currentWorkspaceIdRef = useRef(currentWorkspaceId);
  const workspaceRevisionRef = useRef(0);
  // Root loads and periodic revalidation share request IDs, but successful
  // responses are superseded only after a newer response is accepted. Forced
  // routing is tracked separately so a background refresh can supersede
  // outline data without leaving a root workspace URL unresolved.
  const rootOutlineRequestSeqRef = useRef(0);
  const latestAcceptedRootOutlineRequestSeqRef = useRef(0);
  const latestForcedOutlineRequestSeqRef = useRef(0);
  const [favoriteViews, setFavoriteViews] = useState<View[]>();
  const [recentViews, setRecentViews] = useState<View[]>();
  const [trashList, setTrashList] = useState<View[]>();
  const favoriteViewsRequestedRef = useRef(false);
  const favoriteViewsRequestSeqRef = useRef(0);
  const [workspaceDatabases, setWorkspaceDatabases] = useState<DatabaseRelations | undefined>(undefined);
  const workspaceDatabasesRef = useRef<DatabaseRelations | undefined>(undefined);
  const [requestAccessError, setRequestAccessError] = useState<RequestAccessError | null>(null);
  const trashRequestSeqRef = useRef(0);
  const trashLoaderInstanceId = useId();
  const trashListRef = useRef<View[] | undefined>(undefined);
  const lastTrashRefreshRidRef = useRef<FolderRid | null>(null);
  const lastAcceptedTrashRefreshRidRef = useRef<FolderRid | null>(null);
  const scheduledTrashRefreshWorkspaceIdRef = useRef<string | null>(null);
  const scheduledTrashRefreshKeyRef = useRef<string | undefined>(undefined);
  const lastTrashRequestAtRef = useRef(0);
  const noopFolderTrashRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noopFolderTrashRefreshWorkspaceIdRef = useRef<string | null>(null);
  const noopFolderTrashRefreshBurstRef = useRef<NoopFolderTrashRefreshBurst | null>(null);
  const shareAccessProbeGenerationsRef = useRef(new Map<string, number>());
  const permissionRefreshRevisionRef = useRef(0);

  const mentionableUsersRef = useRef<MentionablePerson[]>([]);

  if (currentWorkspaceIdRef.current !== currentWorkspaceId) {
    currentWorkspaceIdRef.current = currentWorkspaceId;
    nonSidebarSelfParentViewIdsRef.current.clear();
    workspaceRevisionRef.current += 1;
  }

  // The flat metadata index is session-long while this layer owns a workspace,
  // so sidebar rerenders and virtualized relation headers can reuse it. Once
  // ownership ends, folder notifications for that workspace are no longer
  // observed; clear the scope so returning cannot expose session-stale entries.
  useEffect(() => {
    if (!currentWorkspaceId) return;
    const ownedWorkspaceId = currentWorkspaceId;

    return () => {
      invalidateWorkspaceViewMetadata(ownedWorkspaceId);
      ViewService.invalidateWorkspaceMemoryCache?.(ownedWorkspaceId);
    };
  }, [currentWorkspaceId]);

  // Lazy-loading state: tracks which views have had their children fetched.
  // Uses a stable ref + revision counter to avoid creating new Set references
  // on every update (which would cause the entire outline tree to re-render).
  const loadedViewIdsRef = useRef<Set<string>>(new Set());
  const [loadedViewIdsRevision, setLoadedViewIdsRevision] = useState(0);
  const loadedViewIds = useMemo(() => loadedViewIdsRef.current, [loadedViewIdsRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadingViewIdsRef = useRef<Set<string>>(new Set());

  // Helper: replace the outline tree while preserving previously lazy-loaded
  // children so expanded sidebar nodes don't collapse.  Used by both
  // `loadOutline` and `handleFolderOutlineChanged`.
  // deps: [] is correct — all reads go through stable refs; state setters are
  // stable by React guarantee.
  const replaceOutlinePreservingChildren = useCallback((newOutline: View[]) => {
    const prevOutline = stableOutlineRef.current;
    const prevLoadedIds = new Set(loadedViewIdsRef.current);
    // Harden against duplicate sibling references in the server outline (see
    // deduplicateOutlineChildren) so they never render as two identical rows.
    const dedupedOutline = deduplicateOutlineChildren(newOutline);
    const { outline: mergedOutline, loadedIds: nextLoadedIds } = preserveLoadedChildren(
      dedupedOutline,
      prevOutline,
      prevLoadedIds
    );

    // Full-replacement notifications can carry the complete outline even when
    // nothing changed. Preserve both React and lazy-loading state identities so
    // those payloads do not rerender the entire sidebar or invalidate expanded
    // subtree bookkeeping.
    if (isEqual(prevOutline, mergedOutline)) {
      return prevOutline;
    }

    stableOutlineRef.current = mergedOutline;
    loadedViewIdsRef.current = nextLoadedIds;
    setLoadedViewIdsRevision((r) => r + 1);
    loadingViewIdsRef.current = new Set();
    setOutline(mergedOutline);

    return mergedOutline;
  }, []);

  const reconcilePendingFolderViewUpdates = useCallback((nextOutline: View[], nextFolderRid: FolderRid | null) => {
    let reconciledOutline = nextOutline;

    for (const [viewId, pendingUpdate] of pendingFolderViewUpdatesRef.current) {
      const incomingView = findView(reconciledOutline, viewId);

      if (!incomingView) continue;

      const incomingMatchesPending =
        createFolderViewFieldsFingerprint(incomingView) === createFolderViewFieldsFingerprint(pendingUpdate.view);

      if (incomingMatchesPending) {
        pendingFolderViewUpdatesRef.current.delete(viewId);
        continue;
      }

      const incomingIsNewer =
        nextFolderRid && pendingUpdate.folderRid && compareFolderRid(nextFolderRid, pendingUpdate.folderRid) > 0;

      if (incomingIsNewer) {
        pendingFolderViewUpdatesRef.current.delete(viewId);
        continue;
      }

      reconciledOutline = updateViewInOutline(reconciledOutline, pendingUpdate.view);
    }

    return reconciledOutline;
  }, []);

  const refreshFavoriteViewsForWorkspace = useCallback(async (workspaceId: string) => {
    favoriteViewsRequestedRef.current = true;
    const requestSeq = ++favoriteViewsRequestSeqRef.current;
    const workspaceRevision = workspaceRevisionRef.current;
    const permissionRevision = permissionRefreshRevisionRef.current;
    const isStaleRequest = () =>
      currentWorkspaceIdRef.current !== workspaceId ||
      workspaceRevisionRef.current !== workspaceRevision ||
      permissionRefreshRevisionRef.current !== permissionRevision ||
      favoriteViewsRequestSeqRef.current !== requestSeq;

    try {
      const res = await ViewService.getFavorites(workspaceId);

      if (isStaleRequest()) return;

      if (!res) {
        throw new Error('Favorite views not found');
      }

      setFavoriteViews(res);
      return res;
    } catch (e) {
      if (isStaleRequest()) return;
      console.error('Favorite views not found');
    }
  }, []);

  const refreshRequestedFavoriteViewsInBackground = useCallback(
    (workspaceId: string) => {
      if (!favoriteViewsRequestedRef.current) {
        return;
      }

      void refreshFavoriteViewsForWorkspace(workspaceId);
    },
    [refreshFavoriteViewsForWorkspace]
  );

  // Load application outline
  const updateLastFolderRid = useCallback((next: FolderRid | null) => {
    if (!next) return;
    const current = lastFolderRidRef.current;

    if (!current || compareFolderRid(next, current) > 0) {
      lastFolderRidRef.current = next;
    }
  }, []);

  const updateAppliedRootOutlineRid = useCallback(
    (next: FolderRid | null) => {
      if (!next) return;

      updateLastFolderRid(next);

      const current = lastAppliedRootOutlineRidRef.current;

      if (!current || compareFolderRid(next, current) > 0) {
        lastAppliedRootOutlineRidRef.current = next;
      }
    },
    [updateLastFolderRid]
  );

  const updateAppliedRootOutlineSnapshot = useCallback(
    (nextRid: FolderRid | null, nextOutline: View[]) => {
      updateAppliedRootOutlineRid(nextRid);
      lastAppliedRootOutlineFingerprintRef.current = createRootOutlineFingerprint(nextOutline);
    },
    [updateAppliedRootOutlineRid]
  );

  const isStaleWorkspaceRequest = useCallback((workspaceId: string, workspaceRevision: number) => {
    return currentWorkspaceIdRef.current !== workspaceId || workspaceRevisionRef.current !== workspaceRevision;
  }, []);

  const isStaleRootOutlineRequest = useCallback(
    (workspaceId: string, workspaceRevision: number, requestSeq: number) => {
      return (
        isStaleWorkspaceRequest(workspaceId, workspaceRevision) ||
        latestAcceptedRootOutlineRequestSeqRef.current > requestSeq
      );
    },
    [isStaleWorkspaceRequest]
  );

  const isStaleRootOutlineFailure = useCallback(
    (workspaceId: string, workspaceRevision: number, requestSeq: number) => {
      return isStaleWorkspaceRequest(workspaceId, workspaceRevision) || rootOutlineRequestSeqRef.current !== requestSeq;
    },
    [isStaleWorkspaceRequest]
  );

  const isStaleForcedOutlineNavigation = useCallback(
    (workspaceId: string, workspaceRevision: number, requestSeq: number) => {
      return (
        isStaleWorkspaceRequest(workspaceId, workspaceRevision) ||
        latestForcedOutlineRequestSeqRef.current !== requestSeq
      );
    },
    [isStaleWorkspaceRequest]
  );

  const loadOutline = useCallback(
    async (workspaceId: string, force = true) => {
      const workspaceRevision = workspaceRevisionRef.current;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const metadataAccessToken = captureWorkspaceViewMetadataAccessToken(workspaceId);
      const isStalePermissionRequest = () => permissionRefreshRevisionRef.current !== permissionRevision;
      const requestSeq = ++rootOutlineRequestSeqRef.current;

      if (force) {
        latestForcedOutlineRequestSeqRef.current = requestSeq;
      }

      try {
        // Parallelize API calls - both are independent and can run concurrently
        const [res, shareWithMeResult] = await Promise.all([
          ViewService.getOutline(workspaceId),
          AccessService.getShareWithMe(workspaceId).catch((error) => {
            if (!isStalePermissionRequest()) {
              Log.error('[Outline] Failed to load shareWithMe data', error);
            }

            return null;
          }),
        ]);

        if (isStaleWorkspaceRequest(workspaceId, workspaceRevision) || isStalePermissionRequest()) {
          return;
        }

        if (!res) {
          throw new Error('App outline not found');
        }

        // Append shareWithMe data as hidden space if available
        const nextFolderRid = parseFolderRid(res.folderRid);
        let outlineWithShareWithMe = res.outline;

        if (shareWithMeResult && shareWithMeResult.children && shareWithMeResult.children.length > 0) {
          // Create a hidden space for shareWithMe
          const shareWithMeSpace: View = {
            ...shareWithMeResult,
            extra: {
              ...shareWithMeResult.extra,
              is_space: true,
              is_hidden_space: true, // Mark as hidden so it doesn't show in normal space list
            },
          };

          outlineWithShareWithMe = [...res.outline, shareWithMeSpace];
        }

        const shouldApplyOutline = !isStaleRootOutlineRequest(workspaceId, workspaceRevision, requestSeq);
        const shouldNavigate = force && latestForcedOutlineRequestSeqRef.current === requestSeq;

        if (!shouldApplyOutline && !shouldNavigate) {
          return;
        }

        if (shouldApplyOutline) {
          latestAcceptedRootOutlineRequestSeqRef.current = requestSeq;
          const reconciledOutline = reconcilePendingFolderViewUpdates(outlineWithShareWithMe, nextFolderRid);

          primeWorkspaceViewMetadataFromServer(workspaceId, reconciledOutline, metadataAccessToken);
          const mergedOutline = replaceOutlinePreservingChildren(reconciledOutline);

          updateAppliedRootOutlineSnapshot(nextFolderRid, outlineWithShareWithMe);

          if (eventEmitter) {
            eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, mergedOutline || []);
          }
        }

        if (!shouldNavigate) return;

        try {
          if (
            isStaleForcedOutlineNavigation(workspaceId, workspaceRevision, requestSeq) ||
            isStalePermissionRequest()
          ) {
            return;
          }

          const wId = window.location.pathname.split('/')[2];
          const pageId = window.location.pathname.split('/')[3];
          const search = window.location.search;

          // Skip /app/trash and /app/*other-pages
          if (wId && !uuidValidate(wId)) {
            return;
          }

          // Skip /app/:workspaceId/:pageId
          if (pageId && uuidValidate(pageId) && wId && uuidValidate(wId) && wId === workspaceId) {
            return;
          }

          // Use workspace and user specific key to avoid cross-user/workspace conflicts
          const userId = userWorkspaceInfo?.userId;
          const lastViewKey = userId ? `last_view_id_${workspaceId}_${userId}` : null;
          const lastViewId = lastViewKey ? localStorage.getItem(lastViewKey) : null;

          // Validate stored lastViewId before routing.
          // With depth=1 this id may not be present in the shallow outline.
          if (lastViewId) {
            if (!uuidValidate(lastViewId)) {
              if (lastViewKey) {
                localStorage.removeItem(lastViewKey);
              }
            } else {
              try {
                await ViewService.get(workspaceId, lastViewId);

                if (
                  isStaleForcedOutlineNavigation(workspaceId, workspaceRevision, requestSeq) ||
                  isStalePermissionRequest()
                ) {
                  return;
                }

                navigate(`/app/${workspaceId}/${lastViewId}${search}`);
                return;
              } catch {
                if (
                  isStaleForcedOutlineNavigation(workspaceId, workspaceRevision, requestSeq) ||
                  isStalePermissionRequest()
                ) {
                  return;
                }

                if (lastViewKey) {
                  localStorage.removeItem(lastViewKey);
                }
              }
            }
          }

          // No lastViewId: try to find a navigable view.
          // First check if any child is already in the shallow outline.
          const firstView = findViewByLayout(outlineWithShareWithMe, [
            ViewLayout.Document,
            ViewLayout.Board,
            ViewLayout.Grid,
            ViewLayout.Calendar,
            ViewLayout.List,
            ViewLayout.Gallery,
          ]);

          if (firstView) {
            navigate(`/app/${workspaceId}/${firstView.view_id}${search}`);
            return;
          }

          // With shallow outlines, fetch all visible spaces in one batch and
          // search for a navigable child in original space order.
          const spaces = outlineWithShareWithMe.filter((v) => v.extra?.is_space && !v.extra?.is_hidden_space);

          if (spaces.length > 0) {
            try {
              const spaceViews = await ViewService.getMultiple(
                workspaceId,
                spaces.map((space) => space.view_id),
                1
              );

              if (
                isStaleForcedOutlineNavigation(workspaceId, workspaceRevision, requestSeq) ||
                isStalePermissionRequest()
              ) {
                return;
              }

              const spaceViewMap = new Map(spaceViews.map((spaceView) => [spaceView.view_id, spaceView]));

              for (const space of spaces) {
                const spaceData = spaceViewMap.get(space.view_id);
                const firstChild = findViewByLayout(spaceData?.children ?? [], [
                  ViewLayout.Document,
                  ViewLayout.Board,
                  ViewLayout.Grid,
                  ViewLayout.Calendar,
                  ViewLayout.List,
                  ViewLayout.Gallery,
                ]);

                if (firstChild) {
                  navigate(`/app/${workspaceId}/${firstChild.view_id}${search}`);
                  return;
                }
              }
            } catch {
              // Fall through
            }
          }
        } catch (e) {
          // Do nothing
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (isStaleRootOutlineFailure(workspaceId, workspaceRevision, requestSeq) || isStalePermissionRequest()) {
          return;
        }

        Log.error('[Outline] App outline not found', e);
        if (e.code === ERROR_CODE.USER_UNAUTHORIZED || e.code === ERROR_CODE.NOT_LOGGED_IN) {
          invalidToken();
          navigate('/login');
          return;
        }

        if (e.code === ERROR_CODE.NOT_HAS_PERMISSION) {
          setRequestAccessError({
            code: e.code,
            message: e.message,
          });
          return;
        }

        // InvalidFolderView: PG has no folder data yet.
        // The server auto-triggers a background projection. Retry once after 3s.
        if (e.code === ERROR_CODE.INVALID_FOLDER_VIEW) {
          Log.info('[Outline] Folder data not yet projected, retrying in 3s...');
          setTimeout(() => {
            if (!isStaleRootOutlineFailure(workspaceId, workspaceRevision, requestSeq) && !isStalePermissionRequest()) {
              void loadOutline(workspaceId, force);
            }
          }, 3000);
          return;
        }
      }
    },
    [
      navigate,
      eventEmitter,
      updateAppliedRootOutlineSnapshot,
      userWorkspaceInfo?.userId,
      replaceOutlinePreservingChildren,
      reconcilePendingFolderViewUpdates,
      isStaleWorkspaceRequest,
      isStaleRootOutlineRequest,
      isStaleRootOutlineFailure,
      isStaleForcedOutlineNavigation,
    ]
  );

  const mergeViewChildrenIntoOutline = useCallback(
    (
      workspaceId: string,
      workspaceRevision: number,
      viewData: View,
      options: { markLoaded: boolean; updateFolderRid: boolean }
    ): View[] => {
      const viewId = viewData.view_id;
      const children = viewData.children ?? [];

      if (isStaleWorkspaceRequest(workspaceId, workspaceRevision)) {
        return children;
      }

      if (options.updateFolderRid) {
        updateLastFolderRid(parseFolderRid(viewData.folder_rid));
      }

      const parentExists = Boolean(findView(stableOutlineRef.current, viewId));
      const nextOutline = mergeChildrenIntoOutline(stableOutlineRef.current, viewId, children, viewData.has_children);

      if (nextOutline !== stableOutlineRef.current) {
        stableOutlineRef.current = nextOutline;
        setOutline(nextOutline);
        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
        }
      }

      // Mark as loaded only after an authoritative refresh confirms the
      // subtree, even if cached fallback already rendered identical children.
      if (options.markLoaded && parentExists && !loadedViewIdsRef.current.has(viewId)) {
        loadedViewIdsRef.current.add(viewId);
        setLoadedViewIdsRevision((r) => r + 1);
      }

      return children;
    },
    [eventEmitter, isStaleWorkspaceRequest, stableOutlineRef, updateLastFolderRid]
  );

  const mergeLoadedViewChildren = useCallback(
    (workspaceId: string, workspaceRevision: number, viewData: View): View[] => {
      return mergeViewChildrenIntoOutline(workspaceId, workspaceRevision, viewData, {
        markLoaded: true,
        updateFolderRid: true,
      });
    },
    [mergeViewChildrenIntoOutline]
  );

  const mergeCachedViewChildren = useCallback(
    (workspaceId: string, workspaceRevision: number, viewData: View): View[] => {
      const currentView = findView(stableOutlineRef.current, viewData.view_id);

      if (currentView?.children && currentView.children.length > 0) {
        return currentView.children;
      }

      return mergeViewChildrenIntoOutline(workspaceId, workspaceRevision, viewData, {
        markLoaded: false,
        updateFolderRid: false,
      });
    },
    [mergeViewChildrenIntoOutline, stableOutlineRef]
  );

  const clearViewChildrenAfterAuthoritativeRefreshError = useCallback(
    (workspaceId: string, workspaceRevision: number, viewId: string) => {
      if (isStaleWorkspaceRequest(workspaceId, workspaceRevision)) return;

      const subtreeRoot = findView(stableOutlineRef.current, viewId);
      const staleViewIds = new Set<string>([viewId]);

      if (subtreeRoot) {
        const stack: View[] = [subtreeRoot];

        while (stack.length > 0) {
          const current = stack.pop();

          if (!current) continue;
          staleViewIds.add(current.view_id);
          current.children?.forEach((child) => stack.push(child));
        }
      }

      let removedLoaded = false;

      staleViewIds.forEach((staleViewId) => {
        ViewService.invalidateCache(workspaceId, staleViewId);
        invalidateWorkspaceViewMetadata(workspaceId, staleViewId);
        loadingViewIdsRef.current.delete(staleViewId);

        if (loadedViewIdsRef.current.delete(staleViewId)) {
          removedLoaded = true;
        }
      });

      if (removedLoaded) {
        setLoadedViewIdsRevision((r) => r + 1);
      }

      const nextOutline = mergeChildrenIntoOutline(stableOutlineRef.current, viewId, [], false);

      if (nextOutline !== stableOutlineRef.current) {
        stableOutlineRef.current = nextOutline;
        setOutline(nextOutline);
        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
        }
      }
    },
    [eventEmitter, isStaleWorkspaceRequest, stableOutlineRef]
  );

  // Load children for a single view (lazy expand)
  const loadViewChildren = useCallback(
    async (viewId: string): Promise<View[]> => {
      if (!currentWorkspaceId) return [];

      const workspaceId = currentWorkspaceId;
      const workspaceRevision = workspaceRevisionRef.current;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const metadataAccessToken = captureWorkspaceViewMetadataAccessToken(workspaceId);
      const isStalePermissionRequest = () => permissionRefreshRevisionRef.current !== permissionRevision;
      const cachedViewData = ViewService.getCached(workspaceId, viewId);
      const cachedChildren = cachedViewData
        ? mergeCachedViewChildren(workspaceId, workspaceRevision, cachedViewData)
        : undefined;
      let fallbackChildren = cachedChildren;
      const loadDiskCachedChildren = async (): Promise<View[] | undefined> => {
        if (cachedViewData) return cachedChildren;

        try {
          const diskCachedViewData = await ViewService.getCachedFromDisk(workspaceId, viewId);

          if (isStalePermissionRequest()) return undefined;

          return diskCachedViewData
            ? mergeCachedViewChildren(workspaceId, workspaceRevision, diskCachedViewData)
            : undefined;
        } catch (error) {
          Log.warn('[Outline] [loadViewChildren] failed to read cached subtree from disk', {
            workspaceId,
            viewId,
            error,
          });
          return undefined;
        }
      };

      // Dedup concurrent fetches, but still allow the cached merge above to make
      // the expanded row visible immediately while the existing refresh completes.
      if (loadingViewIdsRef.current.has(viewId)) {
        Log.debug('[Outline] [loadViewChildren] skip in-flight request', {
          workspaceId,
          viewId,
          usedCachedChildren: Boolean(cachedViewData),
        });
        return (await loadDiskCachedChildren()) ?? [];
      }

      loadingViewIdsRef.current.add(viewId);
      const refreshResult = ViewService.refresh(workspaceId, viewId).then(
        (viewData) => ({ status: 'fulfilled' as const, viewData }),
        (error) => ({ status: 'rejected' as const, error })
      );

      try {
        Log.debug('[Outline] [loadViewChildren] requesting single subtree', {
          workspaceId,
          viewId,
          depth: 1,
          usedCachedChildren: Boolean(cachedViewData),
        });

        fallbackChildren = (await loadDiskCachedChildren()) ?? fallbackChildren;
        const refreshed = await refreshResult;

        if (refreshed.status === 'rejected') {
          throw refreshed.error;
        }

        if (isStalePermissionRequest()) return [];

        primeWorkspaceViewMetadataFromServer(workspaceId, refreshed.viewData, metadataAccessToken);

        return mergeLoadedViewChildren(workspaceId, workspaceRevision, refreshed.viewData);
      } catch (e) {
        if (isStaleWorkspaceRequest(workspaceId, workspaceRevision) || isStalePermissionRequest()) {
          return [];
        }

        Log.error('[Outline] [loadViewChildren] Failed to load children for', viewId, e);
        if (isAuthoritativeViewRefreshError(e)) {
          clearViewChildrenAfterAuthoritativeRefreshError(workspaceId, workspaceRevision, viewId);
          return [];
        }

        return canUseFallbackForViewRefreshError(e) ? fallbackChildren ?? [] : [];
      } finally {
        if (!isStaleWorkspaceRequest(workspaceId, workspaceRevision) && !isStalePermissionRequest()) {
          loadingViewIdsRef.current.delete(viewId);
        }
      }
    },
    [
      clearViewChildrenAfterAuthoritativeRefreshError,
      currentWorkspaceId,
      isStaleWorkspaceRequest,
      mergeCachedViewChildren,
      mergeLoadedViewChildren,
    ]
  );

  const loadViewChildrenBatch = useCallback(
    async (viewIds: string[], rootRequestSeq?: number): Promise<View[]> => {
      if (!currentWorkspaceId || viewIds.length === 0) return [];

      const workspaceId = currentWorkspaceId;
      const workspaceRevision = workspaceRevisionRef.current;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const metadataAccessToken = captureWorkspaceViewMetadataAccessToken(workspaceId);
      const isStaleBatchRequest = () =>
        permissionRefreshRevisionRef.current !== permissionRevision ||
        (rootRequestSeq === undefined
          ? isStaleWorkspaceRequest(workspaceId, workspaceRevision)
          : isStaleRootOutlineRequest(workspaceId, workspaceRevision, rootRequestSeq));
      const uniqueIds = Array.from(new Set(viewIds)).filter((viewId) => !loadingViewIdsRef.current.has(viewId));

      if (uniqueIds.length === 0) return [];

      uniqueIds.forEach((viewId) => loadingViewIdsRef.current.add(viewId));

      try {
        const requestViewMeta = uniqueIds.map((viewId) => {
          const view = findView(stableOutlineRef.current, viewId);

          return {
            viewId,
            type: view?.extra?.is_space ? 'space' : 'view',
          };
        });

        Log.debug('[Outline] [loadViewChildrenBatch] requesting subtree views', {
          workspaceId,
          depth: 1,
          requestViewMeta,
        });

        const views = await ViewService.getMultiple(workspaceId, uniqueIds, 1);

        if (isStaleBatchRequest()) {
          return views;
        }

        views.forEach((view) => {
          if (view) primeWorkspaceViewMetadataFromServer(workspaceId, view, metadataAccessToken);
        });

        views.forEach((view) => {
          updateLastFolderRid(parseFolderRid(view?.folder_rid));
        });

        let nextOutline = stableOutlineRef.current;
        let outlineChanged = false;
        let loadedChanged = false;

        for (const viewData of views) {
          const viewId = viewData?.view_id;

          if (!viewId) continue;

          const children = viewData.children ?? [];
          const mergedOutline = mergeChildrenIntoOutline(nextOutline, viewId, children, viewData?.has_children);

          if (mergedOutline !== nextOutline) {
            nextOutline = mergedOutline;
            outlineChanged = true;
            loadedViewIdsRef.current.add(viewId);
            loadedChanged = true;
          }
        }

        if (outlineChanged) {
          stableOutlineRef.current = nextOutline;
          setOutline(nextOutline);
          if (eventEmitter) {
            eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
          }
        }

        if (loadedChanged) {
          setLoadedViewIdsRevision((r) => r + 1);
        }

        return views;
      } catch (e) {
        if (isStaleBatchRequest()) {
          return [];
        }

        Log.error('[Outline] [loadViewChildrenBatch] Failed to load children for', uniqueIds, e);
        throw e;
      } finally {
        if (
          !isStaleWorkspaceRequest(workspaceId, workspaceRevision) &&
          permissionRefreshRevisionRef.current === permissionRevision
        ) {
          uniqueIds.forEach((viewId) => loadingViewIdsRef.current.delete(viewId));
        }
      }
    },
    [
      currentWorkspaceId,
      stableOutlineRef,
      eventEmitter,
      isStaleWorkspaceRequest,
      isStaleRootOutlineRequest,
      updateLastFolderRid,
    ]
  );

  const markViewChildrenStale = useCallback(
    (viewId: string) => {
      const subtreeRoot = findView(stableOutlineRef.current, viewId);
      const subtreeIds: string[] = [];

      if (subtreeRoot) {
        const stack: View[] = [subtreeRoot];

        while (stack.length > 0) {
          const current = stack.pop();

          if (!current) continue;
          subtreeIds.push(current.view_id);
          current.children?.forEach((child) => stack.push(child));
        }
      } else {
        subtreeIds.push(viewId);
      }

      let changed = false;

      subtreeIds.forEach((id) => {
        if (loadedViewIdsRef.current.delete(id)) {
          changed = true;
        }

        loadingViewIdsRef.current.delete(id);
      });

      if (!changed) return;

      Log.debug('[Outline] [cache] Marked view subtree stale', { viewId, clearedIds: subtreeIds.length });
      setLoadedViewIdsRevision((r) => r + 1);
    },
    [stableOutlineRef]
  );

  const ensureViewVisibleInOutline = useCallback(
    async (viewId: string): Promise<string[]> => {
      if (!currentWorkspaceId) return [];

      const workspaceId = currentWorkspaceId;
      const workspaceRevision = workspaceRevisionRef.current;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const metadataAccessToken = captureWorkspaceViewMetadataAccessToken(workspaceId);
      const navigationRoot = await ViewService.getNavigation(workspaceId, viewId, 0);
      const path = collectViewPath(navigationRoot, viewId);

      if (
        !path ||
        isStaleWorkspaceRequest(workspaceId, workspaceRevision) ||
        permissionRefreshRevisionRef.current !== permissionRevision
      ) {
        return [];
      }

      primeWorkspaceViewMetadataFromServer(workspaceId, navigationRoot, metadataAccessToken);

      updateLastFolderRid(parseFolderRid(navigationRoot.folder_rid));

      const nextOutline = mergeNavigationTreeIntoOutline(
        stableOutlineRef.current,
        navigationRoot,
        viewId,
        loadedViewIdsRef.current
      );

      if (nextOutline !== stableOutlineRef.current) {
        stableOutlineRef.current = nextOutline;
        setOutline(nextOutline);
        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
        }
      }

      const ancestorIds = path.slice(0, -1).map((view) => view.view_id);
      let loadedChanged = false;

      for (const ancestorId of ancestorIds) {
        if (!loadedViewIdsRef.current.has(ancestorId)) {
          loadedViewIdsRef.current.add(ancestorId);
          loadedChanged = true;
        }
      }

      if (loadedChanged) {
        setLoadedViewIdsRevision((r) => r + 1);
      }

      return ancestorIds;
    },
    [currentWorkspaceId, eventEmitter, isStaleWorkspaceRequest, updateLastFolderRid]
  );

  const markCachedFolderSubtreesStale = useCallback(
    (workspaceId: string, staleViewIds = Array.from(loadedViewIdsRef.current), resetLoadedState = true) => {
      if (staleViewIds.length === 0) return 0;

      for (const viewId of staleViewIds) {
        ViewService.invalidateCache(workspaceId, viewId);
        loadingViewIdsRef.current.delete(viewId);
      }

      if (resetLoadedState) {
        loadedViewIdsRef.current = new Set();
        setLoadedViewIdsRevision((r) => r + 1);
      }

      Log.debug('[Outline] [periodic-revalidate] marked cached subtrees stale', {
        workspaceId,
        staleCount: staleViewIds.length,
      });

      return staleViewIds.length;
    },
    []
  );

  const requestTrash = useCallback(
    async (workspaceId: string, refresh: boolean, freshnessKey?: string | null) => {
      const requestSeq = ++trashRequestSeqRef.current;

      lastTrashRequestAtRef.current = Date.now();

      try {
        const res = refresh
          ? await ViewService.refreshTrash(
              workspaceId,
              freshnessKey === null
                ? undefined
                : freshnessKey ??
                    `manual:${trashLoaderInstanceId}:${workspaceRevisionRef.current}:${requestSeq}`
            )
          : await ViewService.getTrashCached(workspaceId);

        if (!res) {
          throw new Error('App trash not found');
        }

        // A response from the previous workspace or an older request must not
        // update app state or wake embedded database blocks.
        if (requestSeq !== trashRequestSeqRef.current || currentWorkspaceIdRef.current !== workspaceId) {
          return false;
        }

        lastTrashRequestAtRef.current = Date.now();

        const nextTrashList = sortBy(uniqBy(res, 'view_id') as unknown as View[], 'last_edited_time').reverse();
        const acceptedTrashList = isEqual(trashListRef.current, nextTrashList)
          ? (trashListRef.current as View[])
          : nextTrashList;

        if (acceptedTrashList !== trashListRef.current) {
          trashListRef.current = acceptedTrashList;
          setTrashList(acceptedTrashList);
        }

        eventEmitter?.emit(APP_EVENTS.TRASH_UPDATED, {
          workspaceId,
          trashItems: acceptedTrashList,
        });
        return true;
      } catch (e) {
        return Promise.reject('App trash not found');
      }
    },
    [eventEmitter, trashLoaderInstanceId]
  );

  // Public loads always bypass the TTL. Read-only mounts share an active
  // request; mutation callers opt into one trailing request when an older read
  // was already active, preserving freshness while bounding concurrency.
  const loadTrash = useCallback(
    async (workspaceId: string, options: { ensureFreshAfterInFlight?: boolean } = {}) => {
      await requestTrash(workspaceId, true, options.ensureFreshAfterInFlight ? undefined : null);
    },
    [requestTrash]
  );

  // Remote delete/restore arrives as folder changes. Keep the app-level trash
  // state fresh because deleted-page routing is derived from `trashList`.
  const refreshTrashListInBackground = useCallback(
    (folderRidValue?: string | null) => {
      if (!currentWorkspaceId) return;

      const folderRid = parseFolderRid(folderRidValue);
      const lastTrashRefreshRid = lastTrashRefreshRidRef.current;

      // FolderViewChanged and FolderChanged can arrive in separate websocket
      // frames for the same folder revision. Refresh once for that revision.
      if (folderRid && lastTrashRefreshRid && compareFolderRid(folderRid, lastTrashRefreshRid) <= 0) {
        return;
      }

      if (folderRid) {
        lastTrashRefreshRidRef.current = folderRid;
      }

      const workspaceId = currentWorkspaceId;
      const freshnessKey = folderRidValue
        ? `folder:${folderRidValue}`
        : `legacy:${trashLoaderInstanceId}:${workspaceId}:${trashRequestSeqRef.current + 1}`;

      // Same-tick callers without a RID are a fallback path for legacy server
      // notifications. Newer frames arriving after the request starts are
      // handled by the coordinator's single trailing refresh.
      if (scheduledTrashRefreshWorkspaceIdRef.current === workspaceId) {
        scheduledTrashRefreshKeyRef.current = freshnessKey;
        return;
      }

      scheduledTrashRefreshWorkspaceIdRef.current = workspaceId;
      scheduledTrashRefreshKeyRef.current = freshnessKey;
      queueMicrotask(() => {
        if (scheduledTrashRefreshWorkspaceIdRef.current !== workspaceId) return;

        const scheduledFreshnessKey = scheduledTrashRefreshKeyRef.current;

        scheduledTrashRefreshWorkspaceIdRef.current = null;
        scheduledTrashRefreshKeyRef.current = undefined;
        if (currentWorkspaceIdRef.current !== workspaceId) return;

        const scheduledFolderRid = scheduledFreshnessKey?.startsWith('folder:')
          ? parseFolderRid(scheduledFreshnessKey.slice('folder:'.length))
          : null;

        void requestTrash(workspaceId, true, scheduledFreshnessKey)
          .then((accepted) => {
            if (!accepted || !scheduledFolderRid) return;

            const lastAcceptedRid = lastAcceptedTrashRefreshRidRef.current;

            if (!lastAcceptedRid || compareFolderRid(scheduledFolderRid, lastAcceptedRid) > 0) {
              lastAcceptedTrashRefreshRidRef.current = scheduledFolderRid;
            }
          })
          .catch((error) => {
            const lastTrashRefreshRid = lastTrashRefreshRidRef.current;

            // Allow a redelivered revision to retry after terminal failure,
            // but never roll the watermark back past a newer scheduled RID.
            if (
              scheduledFolderRid &&
              lastTrashRefreshRid &&
              compareFolderRid(scheduledFolderRid, lastTrashRefreshRid) === 0
            ) {
              lastTrashRefreshRidRef.current = lastAcceptedTrashRefreshRidRef.current;
            }

            Log.warn('[Trash] Failed to refresh trash list after folder change', error);
          });
      });
    },
    [currentWorkspaceId, requestTrash, trashLoaderInstanceId]
  );

  const scheduleNoopFolderTrashRefresh = useCallback(() => {
    if (!currentWorkspaceId) return;

    const workspaceId = currentWorkspaceId;
    const now = Date.now();
    const existingBurst = noopFolderTrashRefreshBurstRef.current;
    const burst =
      existingBurst?.workspaceId === workspaceId
        ? existingBurst
        : {
            firstNotificationAt: now,
            lastNotificationAt: now,
            maxLatencyProbeCompleted: false,
            maxLatencyProbeCoveredSeq: 0,
            notificationSeq: 0,
            workspaceId,
          };

    burst.lastNotificationAt = now;
    burst.notificationSeq += 1;
    noopFolderTrashRefreshBurstRef.current = burst;

    if (noopFolderTrashRefreshTimerRef.current !== null) {
      clearTimeout(noopFolderTrashRefreshTimerRef.current);
    }

    noopFolderTrashRefreshWorkspaceIdRef.current = workspaceId;

    const clearBurst = () => {
      if (noopFolderTrashRefreshBurstRef.current?.workspaceId === workspaceId) {
        noopFolderTrashRefreshBurstRef.current = null;
      }

      if (noopFolderTrashRefreshWorkspaceIdRef.current === workspaceId) {
        noopFolderTrashRefreshTimerRef.current = null;
        noopFolderTrashRefreshWorkspaceIdRef.current = null;
      }
    };

    const runWhenReady = () => {
      const activeBurst = noopFolderTrashRefreshBurstRef.current;

      if (currentWorkspaceIdRef.current !== workspaceId || activeBurst?.workspaceId !== workspaceId) {
        clearBurst();
        return;
      }

      const now = Date.now();

      const remainingRequestCooldown = Math.max(
        0,
        NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (now - lastTrashRequestAtRef.current)
      );
      const remainingQuietPeriod = Math.max(
        0,
        NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (now - activeBurst.lastNotificationAt)
      );
      const remainingMaxLatency = activeBurst.maxLatencyProbeCompleted
        ? Number.POSITIVE_INFINITY
        : Math.max(0, NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (now - activeBurst.firstNotificationAt));
      const remainingPhaseDelay = activeBurst.maxLatencyProbeCompleted
        ? remainingQuietPeriod
        : Math.min(remainingQuietPeriod, remainingMaxLatency);
      const remainingDelay = Math.max(remainingRequestCooldown, remainingPhaseDelay);

      if (remainingDelay > 0) {
        noopFolderTrashRefreshTimerRef.current = setTimeout(runWhenReady, remainingDelay);
        return;
      }

      if (!activeBurst.maxLatencyProbeCompleted) {
        // One bounded probe prevents a real permanent delete at the start of a
        // long noisy burst from remaining stale forever. Further notifications
        // only move the trailing quiet-period check; they never create polling.
        activeBurst.maxLatencyProbeCompleted = true;
        activeBurst.maxLatencyProbeCoveredSeq = activeBurst.notificationSeq;
        refreshTrashListInBackground();

        const postProbeQuietPeriod = Math.max(
          0,
          NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (Date.now() - activeBurst.lastNotificationAt)
        );

        if (postProbeQuietPeriod > 0) {
          noopFolderTrashRefreshTimerRef.current = setTimeout(runWhenReady, postProbeQuietPeriod);
        } else {
          clearBurst();
        }

        return;
      }

      const shouldRunTrailingProbe = activeBurst.notificationSeq > activeBurst.maxLatencyProbeCoveredSeq;

      clearBurst();
      if (shouldRunTrailingProbe) refreshTrashListInBackground();
    };

    const remainingRequestCooldown = Math.max(
      0,
      NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (now - lastTrashRequestAtRef.current)
    );
    const remainingQuietPeriod = NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS;
    const remainingMaxLatency = burst.maxLatencyProbeCompleted
      ? Number.POSITIVE_INFINITY
      : Math.max(0, NOOP_FOLDER_TRASH_REFRESH_COOLDOWN_MS - (now - burst.firstNotificationAt));
    const remainingPhaseDelay = burst.maxLatencyProbeCompleted
      ? remainingQuietPeriod
      : Math.min(remainingQuietPeriod, remainingMaxLatency);

    noopFolderTrashRefreshTimerRef.current = setTimeout(
      runWhenReady,
      Math.max(remainingRequestCooldown, remainingPhaseDelay)
    );
  }, [currentWorkspaceId, refreshTrashListInBackground]);

  const revalidateSidebarOutline = useCallback(
    async (expandedViewIds: string[] = []): Promise<SidebarOutlineRevalidationResult> => {
      if (!currentWorkspaceId) return 'unchanged';

      const workspaceId = currentWorkspaceId;
      const workspaceRevision = workspaceRevisionRef.current;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const metadataAccessToken = captureWorkspaceViewMetadataAccessToken(workspaceId);
      const isStalePermissionRequest = () => permissionRefreshRevisionRef.current !== permissionRevision;
      const requestSeq = ++rootOutlineRequestSeqRef.current;
      const outlineRequest = ViewService.getOutline(workspaceId);
      let res: Awaited<typeof outlineRequest>;

      try {
        res = await outlineRequest;
      } catch (error) {
        if (isStaleRootOutlineFailure(workspaceId, workspaceRevision, requestSeq) || isStalePermissionRequest()) {
          return 'unchanged';
        }

        throw error;
      }

      if (isStaleRootOutlineRequest(workspaceId, workspaceRevision, requestSeq) || isStalePermissionRequest()) {
        Log.debug('[Outline] [periodic-revalidate] skipped stale root response', {
          workspaceId,
        });
        return 'unchanged';
      }

      if (!res) {
        throw new Error('App outline not found');
      }

      primeWorkspaceViewMetadataFromServer(workspaceId, res.outline, metadataAccessToken);

      latestAcceptedRootOutlineRequestSeqRef.current = requestSeq;

      const nextFolderRid = parseFolderRid(res.folderRid);
      const currentRid = lastAppliedRootOutlineRidRef.current;

      if (nextFolderRid && currentRid && compareFolderRid(nextFolderRid, currentRid) <= 0) {
        Log.debug('[Outline] [periodic-revalidate] skipped unchanged outline', {
          workspaceId,
          folderRid: res.folderRid,
        });
        return 'unchanged';
      }

      const existingShareWithMe = stableOutlineRef.current.find((view) => view.extra?.is_hidden_space);
      const nextOutline = existingShareWithMe ? [...res.outline, existingShareWithMe] : res.outline;
      const nextRootOutlineFingerprint = createRootOutlineFingerprint(nextOutline);

      if (!nextFolderRid && lastAppliedRootOutlineFingerprintRef.current === nextRootOutlineFingerprint) {
        Log.debug('[Outline] [periodic-revalidate] skipped unchanged outline without folder rid', {
          workspaceId,
        });
        return 'unchanged';
      }

      const staleLoadedViewIds = Array.from(loadedViewIdsRef.current);

      markCachedFolderSubtreesStale(workspaceId, staleLoadedViewIds, false);

      const mergedOutline = replaceOutlinePreservingChildren(nextOutline);

      if (staleLoadedViewIds.length > 0) {
        loadedViewIdsRef.current = new Set();
        setLoadedViewIdsRevision((r) => r + 1);
      }

      refreshTrashListInBackground();

      if (eventEmitter) {
        eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, mergedOutline || []);
      }

      const refreshViewIds = limitSidebarOutlineExpandedViewIds(expandedViewIds);

      if (refreshViewIds.length === 0 || !loadViewChildrenBatch) {
        updateAppliedRootOutlineSnapshot(nextFolderRid, nextOutline);
        return 'changed';
      }

      try {
        await loadViewChildrenBatch(refreshViewIds, requestSeq);
      } catch (error) {
        if (isStaleRootOutlineRequest(workspaceId, workspaceRevision, requestSeq) || isStalePermissionRequest()) {
          Log.debug('[Outline] [periodic-revalidate] skipped stale expanded refresh error', {
            workspaceId,
            refreshViewIds,
          });
          return 'unchanged';
        }

        Log.warn('[Outline] [periodic-revalidate] failed to refresh expanded sidebar roots', {
          workspaceId,
          refreshViewIds,
          error,
        });
        throw error;
      }

      if (isStaleRootOutlineRequest(workspaceId, workspaceRevision, requestSeq) || isStalePermissionRequest()) {
        Log.debug('[Outline] [periodic-revalidate] skipped stale expanded refresh response', {
          workspaceId,
          refreshViewIds,
        });
        return 'unchanged';
      }

      updateAppliedRootOutlineSnapshot(nextFolderRid, nextOutline);
      return 'changed';
    },
    [
      currentWorkspaceId,
      eventEmitter,
      isStaleRootOutlineFailure,
      isStaleRootOutlineRequest,
      loadViewChildrenBatch,
      markCachedFolderSubtreesStale,
      replaceOutlinePreservingChildren,
      refreshTrashListInBackground,
      stableOutlineRef,
      updateAppliedRootOutlineSnapshot,
    ]
  );

  useEffect(() => {
    let cancelled = false;

    const refreshPermissionDerivedState = () => {
      if (!currentWorkspaceId) return;

      // Access details and the sidebar outline are both permission-derived.
      // Keep this refresh in the always-mounted workspace layer so permission
      // notifications are handled even while the share panel is closed.
      AccessService.invalidateShareDetailCache(currentWorkspaceId);
      void loadOutline(currentWorkspaceId, false);
    };

    const evictAccessDerivedSubtrees = () => {
      if (!currentWorkspaceId) return { staleSubtreeIds: [], viewDepths: new Map<string, number>() };

      const viewDepths = buildViewDepthIndex(stableOutlineRef.current);
      const staleSubtreeIds = Array.from(
        new Set([...loadedViewIdsRef.current, ...loadingViewIdsRef.current])
      );
      let evictedOutline = stableOutlineRef.current;

      for (const viewId of staleSubtreeIds) {
        const subtreeRoot = findView(evictedOutline, viewId);

        evictedOutline = mergeChildrenIntoOutline(
          evictedOutline,
          viewId,
          [],
          subtreeRoot?.has_children ?? Boolean(subtreeRoot?.children?.length)
        );
      }

      if (evictedOutline !== stableOutlineRef.current) {
        stableOutlineRef.current = evictedOutline;
        setOutline(evictedOutline);
        eventEmitter?.emit(APP_EVENTS.OUTLINE_LOADED, evictedOutline);
      }

      // Clear both loaded and in-flight markers before any replacement root or
      // subtree request starts. A stale request's finally handler deliberately
      // cannot clear the marker of a newer request.
      markCachedFolderSubtreesStale(currentWorkspaceId, staleSubtreeIds);

      return { staleSubtreeIds, viewDepths };
    };

    const handleShareViewsChanged = (payload?: { emails?: string[] | null; viewId?: string | null }) => {
      if (!currentWorkspaceId) return;

      const changedViewId = payload?.viewId;
      const normalizedCurrentEmail = currentUserEmail?.toLowerCase();
      const payloadEmails = payload?.emails;
      const hasOnlyValidEmails =
        Array.isArray(payloadEmails) &&
        payloadEmails.length > 0 &&
        payloadEmails.every((email) => typeof email === 'string' && email.trim().length > 0);
      const affectsCurrentUser =
        normalizedCurrentEmail !== undefined &&
        payloadEmails?.some((email) => email?.toLowerCase() === normalizedCurrentEmail);
      const accessMayAffectCurrentUser =
        !normalizedCurrentEmail || !hasOnlyValidEmails || Boolean(affectsCurrentUser);

      const shouldProbeAccess = Boolean(changedViewId && affectsCurrentUser);
      const cachedNavigation =
        shouldProbeAccess && changedViewId ? ViewService.getCached(currentWorkspaceId, changedViewId) : undefined;
      const changedView =
        shouldProbeAccess && changedViewId
          ? findView(stableOutlineRef.current, changedViewId) ??
            (cachedNavigation ? findView([cachedNavigation], changedViewId) : null)
          : null;

      // A lazy/depth-truncated outline may not contain the route metadata, and
      // its memory cache may already have expired. Start the disk lookup before
      // any permission-derived cache invalidation; only await it if a
      // definitive denial requires local collab eviction.
      const diskCachedNavigationPromise =
        shouldProbeAccess && changedViewId && !changedView
          ? ViewService.getCachedFromDisk(currentWorkspaceId, changedViewId).catch((error) => {
              Log.warn('[Outline] failed to read cached view metadata after share change', {
                workspaceId: currentWorkspaceId,
                viewId: changedViewId,
                error,
              });
              return undefined;
            })
          : undefined;

      // Database folder/view UUIDs are metadata identifiers. Their Y.Doc and
      // IndexedDB collab are stored under the backing database UUID instead.
      // Capture it before the workspace-wide memory invalidation can discard
      // the only available identity for an off-outline view.
      const cachedDatabaseId = changedView?.extra?.database_id;

      if (accessMayAffectCurrentUser) {
        // Fence root/lazy responses that started before this share event.
        // Sharing an ancestor can alter inherited descendant access.
        permissionRefreshRevisionRef.current += 1;
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
        ViewService.invalidateWorkspaceMemoryCache?.(currentWorkspaceId);
        markWorkspaceViewMetadataOutlineUntrusted(currentWorkspaceId);
      }

      if (accessMayAffectCurrentUser) evictAccessDerivedSubtrees();
      refreshPermissionDerivedState();

      if (!changedViewId || !affectsCurrentUser) return;

      // The notification fires for grants and revokes alike, so probe the
      // server. If this user lost read access, evict the locally cached
      // collab so the page cannot keep rendering from IndexedDB, and tell
      // the app shell in case the page is currently on screen.
      const workspaceId = currentWorkspaceId;
      const probeKey = `${normalizedCurrentEmail}:${workspaceId}:${changedViewId}`;
      const probeGeneration = (shareAccessProbeGenerationsRef.current.get(probeKey) ?? 0) + 1;
      const isCurrentProbe = () =>
        !cancelled && shareAccessProbeGenerationsRef.current.get(probeKey) === probeGeneration;

      shareAccessProbeGenerationsRef.current.set(probeKey, probeGeneration);

      void ViewService.getNavigation(workspaceId, changedViewId, 0)
        .then(() => {
          if (!isCurrentProbe()) return;
          eventEmitter?.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: changedViewId });
        })
        .catch(async (error: unknown) => {
          if (!isCurrentProbe()) return;

          const code = getRefreshErrorCode(error);

          if (code === undefined || !ACCESS_REVOKED_PROBE_ERROR_CODES.has(code)) return;

          const diskCachedNavigation = await diskCachedNavigationPromise;

          if (!isCurrentProbe()) return;

          const diskChangedView = diskCachedNavigation ? findView([diskCachedNavigation], changedViewId) : null;
          const databaseId = cachedDatabaseId ?? diskChangedView?.extra?.database_id;

          ViewService.invalidateCache(workspaceId, changedViewId);
          invalidateWorkspaceViewMetadata(workspaceId, changedViewId);
          const collabIds = new Set([changedViewId, databaseId].filter((id): id is string => Boolean(id)));

          collabIds.forEach((collabId) => {
            void deleteCollabDB(collabId, { destroyDoc: true });
          });
          eventEmitter?.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: changedViewId });
        });
    };

    const handlePermissionChanged = () => {
      if (!currentWorkspaceId) return;

      ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
      ViewService.invalidateWorkspaceMemoryCache?.(currentWorkspaceId);
      markWorkspaceViewMetadataOutlineUntrusted(currentWorkspaceId);

      // AppBusinessLayer handles the same event separately because it owns the
      // active route/modal IDs and can re-probe and purge either rendered view.
      // `objectId` can identify a workspace group rather than a view, so a
      // targeted branch refresh is not reliable. Invalidate every subtree
      // that could otherwise be grafted onto the depth-limited root response,
      // and supersede lazy-load responses that started before this event.
      permissionRefreshRevisionRef.current += 1;
      const permissionRevision = permissionRefreshRevisionRef.current;
      const workspaceId = currentWorkspaceId;
      const { staleSubtreeIds, viewDepths } = evictAccessDerivedSubtrees();
      const staleSubtreeWaves = new Map<number, string[]>();

      for (const viewId of staleSubtreeIds) {
        const depth = viewDepths.get(viewId) ?? Number.MAX_SAFE_INTEGER;
        const wave = staleSubtreeWaves.get(depth) ?? [];

        wave.push(viewId);
        staleSubtreeWaves.set(depth, wave);
      }

      refreshRequestedFavoriteViewsInBackground(currentWorkspaceId);
      refreshPermissionDerivedState();

      // Restore still-authorized expanded branches from the server. Fetch each
      // root independently so one revoked branch cannot suppress its siblings,
      // and process parents before descendants so nested expansions can merge.
      void (async () => {
        const isCurrentPermissionRefresh = () =>
          currentWorkspaceIdRef.current === workspaceId &&
          permissionRefreshRevisionRef.current === permissionRevision;
        const rehydrateView = async (viewId: string) => {
          for (let attempt = 0; attempt < PERMISSION_SUBTREE_REHYDRATE_MAX_ATTEMPTS; attempt += 1) {
            if (!isCurrentPermissionRefresh()) return;

            try {
              await loadViewChildrenBatch([viewId]);
              return;
            } catch (error) {
              // A definitive denial is the expected revoke path. Retry only
              // transient/unknown failures so expanded authorized roots do not
              // remain blank after a temporary transport error.
              if (isAuthoritativeViewRefreshError(error)) return;
            }
          }
        };

        const waves = Array.from(staleSubtreeWaves.entries()).sort(
          ([leftDepth], [rightDepth]) => leftDepth - rightDepth
        );

        for (const [, viewIds] of waves) {
          if (!isCurrentPermissionRefresh()) return;

          await Promise.all(viewIds.map(rehydrateView));
        }
      })();
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
      eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    }

    return () => {
      cancelled = true;
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
        eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
      }
    };
  }, [
    currentWorkspaceId,
    currentUserEmail,
    eventEmitter,
    loadViewChildrenBatch,
    loadOutline,
    markCachedFolderSubtreesStale,
    refreshRequestedFavoriteViewsInBackground,
    stableOutlineRef,
  ]);

  useEffect(() => {
    const handleFolderOutlineChanged = (payload: notification.IFolderChanged) => {
      if (!currentWorkspaceId) return;

      // If no diff JSON provided, fall back to full outline reload
      if (!payload?.outlineDiffJson) {
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
        Log.debug('[Outline] [FolderOutlineChanged] No diff JSON, reloading outline');
        refreshTrashListInBackground(payload.folderRid);
        refreshRequestedFavoriteViewsInBackground(currentWorkspaceId);
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      let patch: JsonPatchOperation[] | null = null;

      try {
        patch = JSON.parse(payload.outlineDiffJson) as JsonPatchOperation[];
      } catch (error) {
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
        Log.warn('[Outline] [FolderOutlineChanged] Failed to parse outline diff, reloading outline', error);
        refreshTrashListInBackground(payload.folderRid);
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      if (!patch || !Array.isArray(patch)) {
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
        refreshTrashListInBackground(payload.folderRid);
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      Log.debug('[Outline] [FolderOutlineChanged] parsed patch', {
        folderRid: payload.folderRid ?? null,
        byteLength: payload.outlineDiffJson.length,
        operationCount: patch.length,
        operations: patch.slice(0, 10).map(({ op, path }) => ({ op, path })),
        operationsTruncated: patch.length > 10,
      });

      const patchRid = parseFolderRid(payload.folderRid);
      const currentRid = lastFolderRidRef.current;

      if (patchRid && currentRid && compareFolderRid(patchRid, currentRid) <= 0) {
        Log.debug('[Outline] [FolderOutlineChanged] skipped stale patch', {
          patchRid: payload.folderRid,
          lastRid: `${currentRid.timestamp}-${currentRid.seqNo}`,
        });
        return;
      }

      if (isOnlyNonVisualOutlineChange(patch)) {
        updateLastFolderRid(patchRid);
        return;
      }

      const baseOutline = stableOutlineRef.current.filter((view) => !view.extra?.is_hidden_space);
      const baseDocument = { outline: baseOutline };
      let patchedOutline: View[] | null = null;
      let usedRelaxedPatch = false;

      const firstOp = patch[0];
      const fastReplace = patch.length === 1 && firstOp?.op === 'replace' && firstOp?.path === '/outline';

      if (fastReplace && firstOp?.op === 'replace') {
        const replaceOp = firstOp as ReplaceOperation<View[]>;

        if (Array.isArray(replaceOp.value)) {
          patchedOutline = replaceOp.value;
        }
      } else {
        try {
          const result = applyPatch(baseDocument, patch, true, false);
          const nextDocument = result?.newDocument ?? baseDocument;
          const nextOutline = (nextDocument as { outline?: unknown }).outline;

          if (!Array.isArray(nextOutline)) return;
          patchedOutline = nextOutline as View[];
        } catch (error) {
          // Strict validation fails when server patches target lazy-loaded children
          // arrays (empty locally, populated on server). Retry without validation —
          // Array.splice() clamps out-of-bounds indices, appending the new view.
          // The follow-up loadOutline (from addPage) corrects any positional inaccuracy.
          Log.debug('[Outline] [FolderOutlineChanged] Strict patch failed, retrying without validation', error);
          try {
            const relaxed = applyPatch(baseDocument, patch, false, false);
            const nextDoc = relaxed?.newDocument ?? baseDocument;
            const nextOutline = (nextDoc as { outline?: unknown }).outline;

            if (Array.isArray(nextOutline)) {
              patchedOutline = nextOutline as View[];
              usedRelaxedPatch = true;
            }
          } catch (retryError) {
            Log.warn('[Outline] [FolderOutlineChanged] Relaxed patch also failed, reloading outline', retryError);
            void loadOutline(currentWorkspaceId, false);
            return;
          }

          if (!patchedOutline) {
            void loadOutline(currentWorkspaceId, false);
            return;
          }
        }
      }

      if (!patchedOutline) return;

      // Deduplicate children that may have been inserted twice.
      // FOLDER_VIEW_CHANGED (VIEW_ADDED) and FOLDER_OUTLINE_CHANGED arrive as
      // separate notifications (protobuf oneof).  If VIEW_ADDED was processed
      // first, the local outline already contains the new view; the incremental
      // JSON-patch (computed against the old server state) then inserts it again.
      patchedOutline = deduplicateOutlineChildren(patchedOutline);

      const existingShareWithMe = stableOutlineRef.current.find((view) => view.extra?.is_hidden_space);
      const nextOutline = existingShareWithMe ? [...patchedOutline, existingShareWithMe] : patchedOutline;
      const previousOutline = stableOutlineRef.current;

      const mergedOutline = replaceOutlinePreservingChildren(reconcilePendingFolderViewUpdates(nextOutline, patchRid));
      const { addedIds, removedIds } = getOutlineMembershipChange(previousOutline, mergedOutline);

      // This is an accepted folder mutation diff, not an ordinary shallow root
      // snapshot. IDs that were materialized before the patch and are absent
      // afterward are explicit removal evidence, so their flat metadata must
      // not survive when an older server omits the granular VIEW_REMOVED frame.
      removedIds.forEach((removedViewId) => {
        invalidateWorkspaceViewMetadata(currentWorkspaceId, removedViewId);
        ViewService.invalidateCache(currentWorkspaceId, removedViewId);
      });

      if (databaseCatalogChanged(previousOutline, mergedOutline)) {
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
      }

      if (mergedOutline !== previousOutline && folderOutlinePatchMayAffectFavorites(patch)) {
        refreshRequestedFavoriteViewsInBackground(currentWorkspaceId);
      }

      const knownTrashIds = trashListRef.current
        ? new Set(trashListRef.current.map((view) => view.view_id))
        : undefined;
      const mayRestoreKnownTrash =
        knownTrashIds !== undefined && addedIds.some((viewId) => knownTrashIds.has(viewId));
      const hasUnknownRestoreEvidence = addedIds.length > 0 && knownTrashIds === undefined;

      if (removedIds.length > 0 || mayRestoreKnownTrash) {
        // A view leaving the outline may have moved to trash. An added view is
        // a restore only when it was previously known to be in trash; while the
        // initial trash read is pending, refresh conservatively.
        refreshTrashListInBackground(payload.folderRid);
      } else if (hasUnknownRestoreEvidence || (!payload.folderRid && mergedOutline === previousOutline)) {
        // Direct permanent-delete operations and unrelated PG-first writes both
        // arrive as an indistinguishable no-RID, no-op full-outline replacement.
        // An added view is similarly ambiguous while the initial trash read is
        // unavailable. Keep these cases eventually correct with one bounded
        // max-latency probe and, when needed, one trailing quiet-period probe.
        // Continuous row registration noise therefore never becomes polling.
        scheduleNoopFolderTrashRefresh();
      }

      if (usedRelaxedPatch) {
        updateLastFolderRid(patchRid);
      } else {
        updateAppliedRootOutlineSnapshot(patchRid, nextOutline);
      }

      if (eventEmitter && mergedOutline !== previousOutline) {
        eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, mergedOutline || []);
      }
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);
    }

    return () => {
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);
      }
    };
  }, [
    currentWorkspaceId,
    eventEmitter,
    loadOutline,
    refreshRequestedFavoriteViewsInBackground,
    refreshTrashListInBackground,
    reconcilePendingFolderViewUpdates,
    replaceOutlinePreservingChildren,
    scheduleNoopFolderTrashRefresh,
    stableOutlineRef,
    updateAppliedRootOutlineSnapshot,
    updateLastFolderRid,
  ]);

  // Handle granular FolderViewChanged notifications
  useEffect(() => {
    const handleFolderViewChanged = (payload: notification.IFolderViewChanged) => {
      if (!currentWorkspaceId) return;

      const folderRid = parseFolderRid(payload.folderRid);
      const currentRid = lastFolderRidRef.current;
      const lastFolderViewRid = lastFolderViewRidRef.current;

      // FolderChanged and FolderViewChanged are complementary notifications
      // emitted with the same revision. Reject older revisions globally, but
      // deduplicate equal revisions only within this notification stream.
      if (folderRid && currentRid && compareFolderRid(folderRid, currentRid) < 0) {
        Log.debug('[Outline] [FolderViewChanged] skipped stale notification', {
          folderRid: payload.folderRid,
          lastRid: `${currentRid.timestamp}-${currentRid.seqNo}`,
        });
        return;
      }

      if (folderRid && lastFolderViewRid && compareFolderRid(folderRid, lastFolderViewRid) <= 0) {
        Log.debug('[Outline] [FolderViewChanged] skipped duplicate notification', {
          folderRid: payload.folderRid,
          lastFolderViewRid: `${lastFolderViewRid.timestamp}-${lastFolderViewRid.seqNo}`,
        });
        return;
      }

      const changeType = payload.changeType ?? 0;
      let nextOutline = stableOutlineRef.current;
      let shouldRefreshTrash = false;
      let shouldScheduleNoopTrashRefresh = false;
      let shouldInvalidateDatabaseCatalog = false;

      switch (changeType) {
        case FOLDER_VIEW_CHANGE_TYPE.VIEW_FIELDS_CHANGED: {
          if (!payload.viewJson) break;
          try {
            const updatedView = JSON.parse(payload.viewJson) as View;
            const previousView = findView(nextOutline, updatedView.view_id);
            const isNonSidebarSelfParentView =
              (nonSidebarSelfParentViewIdsRef.current.has(updatedView.view_id) ||
                isSelfParentFolderView(updatedView)) &&
              !isDatabaseCatalogView(updatedView) &&
              !isDatabaseCatalogView(previousView);

            if (!isNonSidebarSelfParentView) {
              nonSidebarSelfParentViewIdsRef.current.delete(updatedView.view_id);

              // A field-change payload does not carry authoritative children.
              // Merge only the supplied fields into the flat metadata entry.
              ViewService.invalidateCache(currentWorkspaceId, updatedView.view_id);
              primeWorkspaceViewMetadataFields(currentWorkspaceId, updatedView);

              // Compare only fields represented by WorkspaceDatabaseViewItem.
              // Favorite, publish, lock, and timestamp notifications must not
              // evict the global catalog and trigger a later offset request.
              shouldInvalidateDatabaseCatalog = !isEqual(
                getDatabaseCatalogViewMetadata(previousView),
                getDatabaseCatalogViewMetadata(updatedView)
              );
            }

            if (previousView) {
              pendingFolderViewUpdatesRef.current.set(updatedView.view_id, {
                view: updatedView,
                folderRid,
              });
            }

            eventEmitter?.emit(APP_EVENTS.VIEW_META_CHANGED, updatedView);
            nextOutline = updateViewInOutline(nextOutline, updatedView);
            if (previousView?.is_favorite !== updatedView.is_favorite) {
              refreshRequestedFavoriteViewsInBackground(currentWorkspaceId);
            }
          } catch (error) {
            Log.warn('[Outline] [FolderViewChanged] Failed to parse view_json for fields changed', error);
            void loadOutline(currentWorkspaceId, false);
            return;
          }

          break;
        }

        case FOLDER_VIEW_CHANGE_TYPE.VIEW_ADDED: {
          if (!payload.viewJson || !payload.parentViewId) {
            shouldScheduleNoopTrashRefresh = true;
            break;
          }

          try {
            const newView = JSON.parse(payload.viewJson) as View;
            const isNonSidebarSelfParentRegistration =
              isSelfParentFolderView(newView, payload.parentViewId) && !isDatabaseCatalogView(newView);

            // Row-document registrations use the document itself as the
            // parent. They are not sidebar metadata and can arrive in large
            // bursts, so do not retain every row in the process-global index.
            if (isNonSidebarSelfParentRegistration) {
              rememberNonSidebarSelfParentViewId(nonSidebarSelfParentViewIdsRef.current, newView.view_id);
            } else {
              nonSidebarSelfParentViewIdsRef.current.delete(newView.view_id);
              ViewService.invalidateCache(currentWorkspaceId, newView.view_id);
              primeWorkspaceViewMetadataFields(currentWorkspaceId, newView);
            }

            // VIEW_ADDED is used for both new pages/row-document registrations
            // and restores. A known trash ID is definite restore evidence and
            // refreshes immediately. If the initial trash request failed, the
            // evidence is unknown; use the bounded retry lane so a burst of row
            // registrations cannot retry /trash once per notification.
            shouldRefreshTrash = Boolean(
              trashListRef.current?.some((trashView) => trashView.view_id === newView.view_id)
            );
            shouldScheduleNoopTrashRefresh = trashListRef.current === undefined;

            // addViewToOutline already sets has_children: true on the parent
            nextOutline = addViewToOutline(nextOutline, payload.parentViewId, newView);
            // A real database may be added below a parent whose children have
            // not been loaded yet. Its parsed metadata is still authoritative
            // catalog evidence even when the outline insertion is a no-op.
            shouldInvalidateDatabaseCatalog = isDatabaseCatalogView(newView);
          } catch (error) {
            Log.warn('[Outline] [FolderViewChanged] Failed to parse view_json for view added', error);
            scheduleNoopFolderTrashRefresh();
            void loadOutline(currentWorkspaceId, false);
            return;
          }

          break;
        }

        case FOLDER_VIEW_CHANGE_TYPE.VIEW_REMOVED: {
          const parentId = payload.viewId;
          const childIds = payload.childViewIds ?? [];
          const knownTrashIds = trashListRef.current
            ? new Set(trashListRef.current.map((view) => view.view_id))
            : undefined;

          // Self-parent row documents never participate in the sidebar or
          // workspace database catalog. Consume only IDs learned from an
          // explicit self-parent add; an unknown lazy parent remains
          // conservative because its omitted child could be a real database.
          if (parentId && nonSidebarSelfParentViewIdsRef.current.delete(parentId)) {
            break;
          }

          // The payload contains the remaining children, not the removed ID.
          // Invalidate even when the parent itself is absent from a lazy local
          // outline. This is memory-only; the next catalog consumer performs
          // the single shared refresh.
          shouldInvalidateDatabaseCatalog = true;

          if (parentId) {
            const previousParent = findView(nextOutline, parentId);
            const remainingChildIds = new Set(childIds);
            const visiblyRemovedChildren =
              previousParent?.children.filter((child) => !remainingChildIds.has(child.view_id)) ?? [];

            if (visiblyRemovedChildren.length > 0) {
              // A visible removed subtree gives us enough metadata to avoid
              // evicting the database catalog for complete document-only
              // subtrees. A visible document may still hide lazy descendants,
              // so preserve the conservative default until every removed
              // branch is known complete.
              const containsDatabase = visiblyRemovedChildren.some(
                (child) => collectDatabaseCatalogViews([child]).size > 0
              );
              const removedSubtreesAreComplete = visiblyRemovedChildren.every((child) =>
                isOutlineSubtreeComplete(child, loadedViewIdsRef.current)
              );

              shouldInvalidateDatabaseCatalog = containsDatabase || !removedSubtreesAreComplete;

              if (shouldInvalidateDatabaseCatalog) {
                // Database or lazy descendants may exist in the flat index but
                // not in the materialized sidebar subtree, so their IDs cannot
                // be invalidated individually.
                invalidateWorkspaceViewMetadata(currentWorkspaceId);
                ViewService.invalidateWorkspaceMemoryCache?.(currentWorkspaceId);
              } else {
                collectOutlineViewIds(visiblyRemovedChildren).forEach((removedViewId) => {
                  invalidateWorkspaceViewMetadata(currentWorkspaceId, removedViewId);
                  ViewService.invalidateCache(currentWorkspaceId, removedViewId);
                });
              }
            } else {
              // The protocol names only the parent plus its remaining children.
              // Without a visible removed child, the removed ID is unknowable.
              invalidateWorkspaceViewMetadata(currentWorkspaceId);
              ViewService.invalidateWorkspaceMemoryCache?.(currentWorkspaceId);
            }

            const hasSemanticTrashEvidence =
              visiblyRemovedChildren.length > 0 ||
              Boolean(
                knownTrashIds?.has(parentId) || childIds.some((childId) => knownTrashIds?.has(childId))
              );

            // A revisioned no-op can still be a remote permanent delete: the
            // protocol sends remaining children and omits the deleted ID. The
            // RID gives the request coordinator a safe deduplication key.
            shouldRefreshTrash = hasSemanticTrashEvidence || Boolean(payload.folderRid);
            shouldScheduleNoopTrashRefresh = !hasSemanticTrashEvidence && !payload.folderRid;
            nextOutline = removeViewFromOutline(nextOutline, parentId, childIds);

            // Clean removed children (and their subtrees) from loadedViewIdsRef
            // so that preserveLoadedChildren won't re-graft them on the next
            // FOLDER_OUTLINE_CHANGED shallow refresh.
            for (const removedChild of visiblyRemovedChildren) {
              loadedViewIdsRef.current.delete(removedChild.view_id);
              pendingFolderViewUpdatesRef.current.delete(removedChild.view_id);
            }

            // If the parent has no remaining children, remove it from loaded IDs
            // so we don't re-graft stale children on the next outline refresh.
            const parentView = findView(nextOutline, parentId);

            if (parentView && (!parentView.children || parentView.children.length === 0)) {
              loadedViewIdsRef.current.delete(parentId);
            }
          } else {
            shouldScheduleNoopTrashRefresh = !payload.folderRid;
          }

          break;
        }

        case FOLDER_VIEW_CHANGE_TYPE.CHILDREN_REORDERED: {
          const parentId = payload.viewId;
          const childIds = payload.childViewIds ?? [];

          if (parentId) {
            nextOutline = reorderChildrenInOutline(nextOutline, parentId, childIds);
          }

          break;
        }

        default: {
          // Unknown change type — fall back to full reload
          Log.debug('[Outline] [FolderViewChanged] Unknown change_type, reloading outline', changeType);
          refreshTrashListInBackground(payload.folderRid);
          void loadOutline(currentWorkspaceId, false);
          return;
        }
      }

      if (shouldRefreshTrash) {
        refreshTrashListInBackground(payload.folderRid);
      } else if (shouldScheduleNoopTrashRefresh) {
        // The granular payload carries the parent's remaining children, not the
        // removed ID. Once the visible outline already reflects the removal, a
        // duplicate no-RID frame is indistinguishable from legacy trash/purge
        // notification traffic. Share the same bounded burst fallback as no-op
        // full replacements instead of issuing periodic requests.
        scheduleNoopFolderTrashRefresh();
      }

      if (shouldInvalidateDatabaseCatalog) {
        ViewService.invalidateDatabaseCatalog?.(currentWorkspaceId);
      }

      if (folderRid) {
        lastFolderViewRidRef.current = folderRid;
      }

      if (nextOutline !== stableOutlineRef.current) {
        stableOutlineRef.current = nextOutline;
        setOutline(nextOutline);
        updateLastFolderRid(folderRid);

        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
        }
      } else {
        updateLastFolderRid(folderRid);
      }
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.FOLDER_VIEW_CHANGED, handleFolderViewChanged);
    }

    return () => {
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.FOLDER_VIEW_CHANGED, handleFolderViewChanged);
      }
    };
  }, [
    currentWorkspaceId,
    eventEmitter,
    loadOutline,
    refreshRequestedFavoriteViewsInBackground,
    refreshTrashListInBackground,
    scheduleNoopFolderTrashRefresh,
    stableOutlineRef,
    updateLastFolderRid,
  ]);

  // Load favorite views
  const loadFavoriteViews = useCallback(async () => {
    if (!currentWorkspaceId) return;
    return refreshFavoriteViewsForWorkspace(currentWorkspaceId);
  }, [currentWorkspaceId, refreshFavoriteViewsForWorkspace]);

  // Load recent views
  const loadRecentViews = useCallback(async () => {
    if (!currentWorkspaceId) return;
    try {
      const res = await ViewService.getRecent(currentWorkspaceId);

      if (!res) {
        throw new Error('Recent views not found');
      }

      const views = uniqBy(res, 'view_id') as unknown as View[];

      // With lazy loading, don't filter by outline presence since most views
      // won't be loaded in the shallow tree. Recent views come from a dedicated
      // server endpoint and are already valid.
      setRecentViews(views.filter((item: View) => !item.extra?.is_space));
      return views;
    } catch (e) {
      console.error('Recent views not found');
    }
  }, [currentWorkspaceId]);

  // Get cached database relations (synchronous, returns immediately)
  const getCachedDatabaseRelations = useCallback(() => {
    return workspaceDatabasesRef.current;
  }, []);

  // Internal helper to fetch and update database relations
  const fetchAndUpdateDatabaseRelations = useCallback(
    async (silent = false) => {
      if (!currentWorkspaceId) {
        return;
      }

      const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;

      if (!selectedWorkspace) return;

      try {
        const res = await ViewService.getDatabaseRelations(currentWorkspaceId, selectedWorkspace.databaseStorageId);

        if (res) {
          workspaceDatabasesRef.current = res;
          setWorkspaceDatabases(res);
        }

        return res;
      } catch (e) {
        if (!silent) {
          console.error(e);
        }
      }
    },
    [currentWorkspaceId, userWorkspaceInfo?.selectedWorkspace]
  );

  // Load database relations (returns cached if available, fetches otherwise).
  // Pass `{ refresh: true }` to bypass the cache — needed by flows like the
  // relation creation dialog where a database created earlier in the session
  // would otherwise be missing from the cached map.
  const loadDatabaseRelations = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!options.refresh && workspaceDatabasesRef.current) {
        return workspaceDatabasesRef.current;
      }

      return fetchAndUpdateDatabaseRelations(false);
    },
    [fetchAndUpdateDatabaseRelations]
  );

  // Refresh database relations in background (doesn't block, updates cache)
  const refreshDatabaseRelationsInBackground = useCallback(() => {
    // Fire and forget - update cache when done
    void fetchAndUpdateDatabaseRelations(true);
  }, [fetchAndUpdateDatabaseRelations]);

  const enhancedLoadDatabaseRelations = useMemo(() => {
    // `createDeduplicatedRequest` keys by argument JSON, so a `{ refresh: true }`
    // call doesn't share a pending promise with cached `()` calls.
    return createDeduplicatedRequest(loadDatabaseRelations);
  }, [loadDatabaseRelations]);

  // Load views based on variant
  const loadViews = useCallback(
    async (variant?: UIVariant) => {
      if (!variant) {
        return outline || [];
      }

      if (variant === UIVariant.Favorite) {
        if (favoriteViews && favoriteViews.length > 0) {
          return favoriteViews || [];
        } else {
          return loadFavoriteViews();
        }
      }

      if (variant === UIVariant.Recent) {
        if (recentViews && recentViews.length > 0) {
          return recentViews || [];
        } else {
          return loadRecentViews();
        }
      }

      return [];
    },
    [favoriteViews, loadFavoriteViews, loadRecentViews, outline, recentViews]
  );

  // Load mentionable users
  const _loadMentionableUsers = useCallback(async () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace found');
    }

    try {
      const res = await WorkspaceService.getMentionableUsers(currentWorkspaceId);

      if (res) {
        mentionableUsersRef.current = res;
      }

      return res || [];
    } catch (e) {
      return Promise.reject(e);
    }
  }, [currentWorkspaceId]);

  const loadMentionableUsers = useMemo(() => {
    return createDeduplicatedNoArgsRequest(_loadMentionableUsers);
  }, [_loadMentionableUsers]);

  // Get mention user
  const getMentionUser = useCallback(
    async (uuid: string) => {
      if (mentionableUsersRef.current.length > 0) {
        const user = mentionableUsersRef.current.find((user) => user.person_id === uuid);

        if (user) {
          return user;
        }
      }

      try {
        const res = await loadMentionableUsers();

        return res.find((user: MentionablePerson) => user.person_id === uuid);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [loadMentionableUsers]
  );

  // Load data when workspace changes
  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (noopFolderTrashRefreshTimerRef.current !== null) {
      clearTimeout(noopFolderTrashRefreshTimerRef.current);
      noopFolderTrashRefreshTimerRef.current = null;
    }

    noopFolderTrashRefreshWorkspaceIdRef.current = null;
    noopFolderTrashRefreshBurstRef.current = null;
    lastTrashRequestAtRef.current = 0;
    trashRequestSeqRef.current += 1;
    lastTrashRefreshRidRef.current = null;
    lastAcceptedTrashRefreshRidRef.current = null;
    scheduledTrashRefreshWorkspaceIdRef.current = null;
    scheduledTrashRefreshKeyRef.current = undefined;
    lastFolderRidRef.current = null;
    lastFolderViewRidRef.current = null;
    lastAppliedRootOutlineRidRef.current = null;
    lastAppliedRootOutlineFingerprintRef.current = null;
    pendingFolderViewUpdatesRef.current.clear();
    stableOutlineWorkspaceIdRef.current = currentWorkspaceId;
    stableOutlineWorkspaceRevisionRef.current = workspaceRevisionRef.current;
    stableOutlineRef.current = [];
    setOutline([]);
    loadedViewIdsRef.current = new Set();
    setLoadedViewIdsRevision((r) => r + 1);
    loadingViewIdsRef.current = new Set();
    // Clear workspace-scoped lists when switching workspaces to prevent
    // cross-workspace data contamination. Resetting favorites/recents back to
    // `undefined` (the unloaded state) also lets lazy consumers — e.g. the
    // header FavoriteButton — detect the stale state and refetch for the new
    // workspace instead of rendering the previous workspace's favorites.
    favoriteViewsRequestedRef.current = false;
    setFavoriteViews(undefined);
    setRecentViews(undefined);
    // Deleted-page routing derives from `trashList` — without this reset the
    // previous workspace's trash stays live until the new loadTrash resolves.
    trashListRef.current = undefined;
    setTrashList(undefined);
    // Clear database relations cache when switching workspaces to prevent
    // cross-workspace data contamination
    workspaceDatabasesRef.current = undefined;
    setWorkspaceDatabases(undefined);
    void loadOutline(currentWorkspaceId, true);
    // Warm the shared user/workspace database catalog once. Relation cells,
    // property menus, and linked-database pickers all reuse this same snapshot
    // instead of independently requesting the workspace-wide list.
    void ViewService.getDatabaseCatalog?.(currentWorkspaceId).catch((error) => {
      Log.warn('[WorkspaceDatabaseCatalog] failed to warm the workspace catalog', error);
    });
    void (async () => {
      try {
        // Always revalidate on workspace mount. The unkeyed refresh shares a
        // simultaneous DatabaseBlock cache miss instead of adding a trailing
        // request; mutation-driven loads use keyed freshness below.
        await requestTrash(currentWorkspaceId, true, null);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      if (noopFolderTrashRefreshTimerRef.current !== null) {
        clearTimeout(noopFolderTrashRefreshTimerRef.current);
        noopFolderTrashRefreshTimerRef.current = null;
      }

      noopFolderTrashRefreshWorkspaceIdRef.current = null;
      noopFolderTrashRefreshBurstRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId]);

  // Reload the outline after the server-side selected workspace catches up
  // to the URL workspace (post auto-switch). This matters for guests opening
  // a shared direct link: the initial outline call may return limited data
  // because the server hadn't yet recognised the user as operating on this
  // workspace. Once WorkspaceService.open() resolves and userWorkspaceInfo
  // refreshes, refetch so the sidebar populates. Skip on initial render
  // (`undefined → defined`) — that's already handled by the effect above.
  const selectedWorkspaceId = userWorkspaceInfo?.selectedWorkspace.id;
  const prevSelectedWorkspaceIdRef = useRef<string | undefined>(selectedWorkspaceId);
  const workspaceAwaitingSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSelectedWorkspaceIdRef.current;

    if (!selectedWorkspaceId || !currentWorkspaceId) return;

    if (selectedWorkspaceId !== currentWorkspaceId) {
      // A stable selection with a new URL is the direct-link/auto-switch path.
      // Record it for one follow-up load after the server selection catches up.
      // The inverse direction is a manual switch and the workspace-change
      // effect will load the target once its URL changes.
      workspaceAwaitingSelectionRef.current = !prev || selectedWorkspaceId === prev ? currentWorkspaceId : null;
      prevSelectedWorkspaceIdRef.current = selectedWorkspaceId;
      return;
    }

    const shouldReload = workspaceAwaitingSelectionRef.current === currentWorkspaceId;

    workspaceAwaitingSelectionRef.current = null;
    prevSelectedWorkspaceIdRef.current = selectedWorkspaceId;
    if (!shouldReload) return;

    void loadOutline(selectedWorkspaceId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId, currentWorkspaceId]);

  // Load database relations
  useEffect(() => {
    void enhancedLoadDatabaseRelations();
  }, [enhancedLoadDatabaseRelations]);

  // Workspace reset effects run after commit. Gate the returned outline during
  // render so a workspace change can never expose the previous workspace state.
  const currentWorkspaceOutline =
    stableOutlineWorkspaceIdRef.current === currentWorkspaceId &&
    stableOutlineWorkspaceRevisionRef.current === workspaceRevisionRef.current
      ? outline
      : undefined;

  useEffect(() => {
    if (!currentWorkspaceId || !currentWorkspaceOutline) return;
    primeWorkspaceViewMetadata(currentWorkspaceId, currentWorkspaceOutline);
  }, [currentWorkspaceId, currentWorkspaceOutline]);

  return {
    outline: currentWorkspaceOutline,
    favoriteViews,
    recentViews,
    trashList,
    workspaceDatabases,
    requestAccessError,
    loadOutline,
    loadFavoriteViews,
    loadRecentViews,
    loadTrash,
    loadDatabaseRelations: enhancedLoadDatabaseRelations,
    getCachedDatabaseRelations,
    refreshDatabaseRelationsInBackground,
    loadViews,
    getMentionUser,
    loadMentionableUsers,
    stableOutlineRef,
    loadedViewIds,
    loadViewChildren,
    loadViewChildrenBatch,
    markViewChildrenStale,
    ensureViewVisibleInOutline,
    revalidateSidebarOutline,
  };
}
