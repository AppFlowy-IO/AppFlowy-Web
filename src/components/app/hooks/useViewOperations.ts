import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { CollabService, ViewService, WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  LoadViewOptions,
  ObjectPermission,
  Types,
  View,
  ViewLayout,
  YDoc,
  YDocWithMeta,
} from '@/application/types';
import { openView } from '@/application/view-loader';
import {
  getDatabaseIdFromExtra,
  getFirstChildView,
  isDatabaseContainer,
  isDatabaseLayout,
} from '@/application/view-utils';
import { findSharedAccessLevel, findView } from '@/components/_shared/outline/utils';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { Log } from '@/utils/log';
import { getPlatform } from '@/utils/platform';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

import { useDatabaseIdentity } from './useDatabaseIdentity';

const PERMISSION_RETRY_BASE_DELAY_MS = 5_000;
const PERMISSION_RETRY_MAX_DELAY_MS = 60_000;
const PERMISSION_RETRY_MAX_ATTEMPTS = 5;

function readNumber(error: unknown, key: string): number | undefined {
  if (typeof error === 'object' && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key];

    if (typeof value === 'number') return value;
  }

  return undefined;
}

// Respect the server's `Retry-After` when present; otherwise back off
// exponentially from the base delay, capped so retries never loop too tightly.
function permissionRetryDelayMs(error: unknown, attempt: number) {
  const retryAfterSecs = readNumber(error, 'retryAfterSecs');

  if (retryAfterSecs !== undefined && retryAfterSecs > 0) {
    return Math.min(retryAfterSecs * 1000, PERMISSION_RETRY_MAX_DELAY_MS);
  }

  const backoff = PERMISSION_RETRY_BASE_DELAY_MS * 2 ** attempt;

  return Math.min(backoff, PERMISSION_RETRY_MAX_DELAY_MS);
}

function isTooManyRequests(error: unknown) {
  const code = readNumber(error, 'code');

  return code === 429 || code === ERROR_CODE.TOO_MANY_REQUESTS;
}

/**
 * Determine whether the editor should be read-only for the given view.
 *
 * `fallbackView` is the resolved view object the page hosts already have
 * (e.g. AppPage's `outlineView ?? fallbackView`, ViewModal's `resolvedView`).
 * It's checked first so that locked pages remain read-only even when the page
 * is opened before the outline branch loads — in that case `findView(outline)`
 * misses the view and a lock check against the outline alone would let edits
 * through.
 */
export function getViewReadOnlyStatus(viewId: string, outline?: View[], fallbackView?: View | null) {
  const isMobile = getPlatform().isMobile;

  if (isMobile) return true; // Mobile has highest priority - always readonly

  // Lock check uses the resolved view first, falling back to the outline so
  // direct-URL loads (before outline arrives) still honor the lock.
  if (fallbackView?.view_id === viewId && fallbackView.is_locked) return true;

  if (!outline) return false;

  // A locked page is read-only for everyone until it is unlocked. The outline
  // includes the hidden "Shared with me" space, so findView also resolves views
  // shared with the current user.
  const view = findView(outline, viewId);

  if (view?.is_locked) return true;

  // Resolve the effective shared access level, inheriting from the nearest
  // ancestor inside the "Shared with me" space. This makes pages inside a
  // View-only private space read-only even though the page itself carries no
  // explicit access level.
  const sharedAccessLevel = findSharedAccessLevel(outline, viewId);

  if (sharedAccessLevel !== undefined) {
    return sharedAccessLevel <= AccessLevel.ReadAndComment;
  }

  // If not part of the shared-with-me space, default is false (editable)
  return false;
}

function getViewLocalReadOnlyStatus(viewId: string, outline?: View[], fallbackView?: View | null) {
  const isMobile = getPlatform().isMobile;

  if (isMobile) return true;

  if (fallbackView?.view_id === viewId && fallbackView.is_locked) return true;

  if (!outline) return false;

  const view = findView(outline, viewId);

  return Boolean(view?.is_locked);
}

type PermissionReadOnlyState = {
  key: string | null;
  permission: ObjectPermission | null;
  failClosed: boolean;
};

type PermissionObjectIdentity = {
  objectId: string;
  collabType: Types;
};

function getPermissionObjectIdentity(viewId: string): PermissionObjectIdentity {
  // Page UI permission is scoped to the opened folder view. Database data still
  // syncs through the canonical database collab id, but one database can have
  // multiple folder views with different inherited access.
  return {
    objectId: viewId,
    collabType: Types.Document,
  };
}

export function useViewReadOnlyStatus(viewId: string | undefined, outline?: View[], fallbackView?: View | null) {
  const { currentWorkspaceId } = useAuthInternal();
  const { eventEmitter } = useSyncInternal();
  const [permissionState, setPermissionState] = useState<PermissionReadOnlyState>({
    key: null,
    permission: null,
    failClosed: false,
  });
  const permissionRequestSeqRef = useRef(0);
  const permissionAbortRef = useRef<AbortController | null>(null);
  const permissionRetryTimeoutRef = useRef<number | null>(null);
  const clearPermissionRetryTimeout = useCallback(() => {
    if (permissionRetryTimeoutRef.current === null) return;
    window.clearTimeout(permissionRetryTimeoutRef.current);
    permissionRetryTimeoutRef.current = null;
  }, []);
  const fallbackReadOnly = useMemo(() => {
    if (!viewId) return false;
    return getViewReadOnlyStatus(viewId, outline, fallbackView);
  }, [viewId, outline, fallbackView]);
  const localReadOnly = useMemo(() => {
    if (!viewId) return false;
    return getViewLocalReadOnlyStatus(viewId, outline, fallbackView);
  }, [viewId, outline, fallbackView]);
  const permissionIdentity = useMemo(() => {
    if (!viewId) return null;
    return getPermissionObjectIdentity(viewId);
  }, [viewId]);
  const permissionObjectId = permissionIdentity?.objectId;
  const permissionCollabType = permissionIdentity?.collabType;

  const fetchPermission = useCallback(
    async (options?: { failClosed?: boolean; attempt?: number }) => {
      if (!currentWorkspaceId || !viewId || !permissionObjectId || permissionCollabType === undefined) return;

      const attempt = options?.attempt ?? 0;

      const key = `${currentWorkspaceId}:${permissionCollabType}:${permissionObjectId}`;
      const requestSeq = permissionRequestSeqRef.current + 1;

      clearPermissionRetryTimeout();
      permissionRequestSeqRef.current = requestSeq;
      permissionAbortRef.current?.abort();

      const controller = new AbortController();

      permissionAbortRef.current = controller;
      setPermissionState({
        key,
        permission: null,
        failClosed: options?.failClosed ?? false,
      });

      try {
        const nextPermission = await CollabService.getObjectPermission(
          currentWorkspaceId,
          permissionObjectId,
          permissionCollabType,
          controller.signal
        );

        if (controller.signal.aborted || requestSeq !== permissionRequestSeqRef.current) return;
        setPermissionState({
          key,
          permission: nextPermission,
          failClosed: false,
        });
      } catch (error) {
        if (controller.signal.aborted || requestSeq !== permissionRequestSeqRef.current) return;
        Log.debug('[useViewReadOnlyStatus] failed to fetch object permission', {
          workspaceId: currentWorkspaceId,
          viewId,
          objectId: permissionObjectId,
          collabType: permissionCollabType,
          error,
        });
        setPermissionState({
          key,
          permission: null,
          failClosed: options?.failClosed ?? false,
        });

        if (isTooManyRequests(error) && attempt < PERMISSION_RETRY_MAX_ATTEMPTS) {
          const retryDelayMs = permissionRetryDelayMs(error, attempt);

          permissionRetryTimeoutRef.current = window.setTimeout(() => {
            permissionRetryTimeoutRef.current = null;
            void fetchPermission({ failClosed: options?.failClosed ?? false, attempt: attempt + 1 });
          }, retryDelayMs);
        }
      }
    },
    [clearPermissionRetryTimeout, currentWorkspaceId, permissionCollabType, permissionObjectId, viewId]
  );

  useEffect(() => {
    if (!currentWorkspaceId || !viewId || !permissionObjectId || permissionCollabType === undefined) {
      clearPermissionRetryTimeout();
      permissionAbortRef.current?.abort();
      setPermissionState({
        key: null,
        permission: null,
        failClosed: false,
      });
      return;
    }

    void fetchPermission({ failClosed: false });

    return () => {
      clearPermissionRetryTimeout();
      permissionAbortRef.current?.abort();
    };
  }, [clearPermissionRetryTimeout, currentWorkspaceId, viewId, permissionObjectId, permissionCollabType, fetchPermission]);

  const activePermissionKey =
    permissionObjectId && permissionCollabType !== undefined
      ? `${currentWorkspaceId}:${permissionCollabType}:${permissionObjectId}`
      : null;
  const activePermission = permissionState.key === activePermissionKey ? permissionState.permission : null;
  const shouldRefreshPermission = useCallback(
    (changedObjectId?: string | null) => {
      return (
        !changedObjectId ||
        changedObjectId === viewId ||
        changedObjectId === permissionObjectId ||
        changedObjectId === activePermission?.governing_view_id
      );
    },
    [activePermission?.governing_view_id, permissionObjectId, viewId]
  );

  useEffect(() => {
    if (!viewId) return;

    const handlePermissionChanged = (payload?: { objectId?: string | null }) => {
      if (!shouldRefreshPermission(payload?.objectId)) return;
      void fetchPermission({ failClosed: true });
    };

    const handleShareViewsChanged = (payload?: { viewId?: string | null }) => {
      if (!shouldRefreshPermission(payload?.viewId)) return;
      void fetchPermission({ failClosed: true });
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);

    return () => {
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
      eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    };
  }, [eventEmitter, fetchPermission, shouldRefreshPermission, viewId]);

  if (localReadOnly) return true;
  if (permissionState.key === activePermissionKey && permissionState.failClosed) return true;
  if (activePermission) return !activePermission.can_write;
  return fallbackReadOnly;
}

// Hook for managing view-related operations
export function useViewOperations() {
  const { currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { registerSyncContext, eventEmitter } = useSyncInternal();
  const navigate = useNavigate();
  const databaseStorageId = userWorkspaceInfo?.selectedWorkspace?.databaseStorageId;

  const [awarenessMap, setAwarenessMap] = useState<Record<string, Awareness>>({});
  // Ref for stable access to awarenessMap in callbacks (prevents bindViewSync recreation)
  const awarenessMapRef = useRef<Record<string, Awareness>>({});

  useEffect(() => {
    awarenessMapRef.current = { ...awarenessMapRef.current, ...awarenessMap };
  }, [awarenessMap]);

  useEffect(() => {
    const handleCollabDocReset = ({ viewId, awareness }: CollabDocResetPayload) => {
      if (!viewId || !awareness) {
        return;
      }

      awarenessMapRef.current = { ...awarenessMapRef.current, [viewId]: awareness };
      setAwarenessMap((prev) => {
        if (prev[viewId] === awareness) {
          return prev;
        }

        return { ...prev, [viewId]: awareness };
      });
    };

    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    return () => {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    };
  }, [eventEmitter]);

  const { resolveCollabObjectId, getDatabaseIdForViewId, getViewIdFromDatabaseId } = useDatabaseIdentity({
    currentWorkspaceId,
    databaseStorageId,
    registerSyncContext,
  });

  // Check if view should be readonly based on access permissions
  const getViewReadOnlyStatusFromOutline = useCallback(
    (viewId: string, outline?: View[], fallbackView?: View | null) => {
      return getViewReadOnlyStatus(viewId, outline, fallbackView);
    },
    []
  );

  /**
   * Load view document WITHOUT binding sync.
   *
   * This function:
   * 1. Opens the Y.Doc from cache (IndexedDB) or fetches from server
   * 2. Stores metadata (_collabType) on the doc for later sync binding
   * 3. Returns the doc immediately for rendering
   *
   * Call bindViewSync() AFTER render to start WebSocket sync.
   */
  const loadView = useCallback(
    async (
      viewId: string,
      isSubDocument = false,
      loadAwareness = false,
      outline?: View[],
      options?: LoadViewOptions
    ) => {
      try {
        if (!currentWorkspaceId) {
          throw new Error('Workspace not found');
        }

        let view = findView(outline || [], viewId);

        if (!view && !isSubDocument && !options?.databaseId) {
          try {
            view = await ViewService.get(currentWorkspaceId, viewId);
          } catch (e) {
            Log.debug('[useViewOperations] failed to fetch view metadata before load', {
              viewId,
              error: e,
            });
          }
        }

        // Check for AIChat early
        if (view?.layout === ViewLayout.AIChat) {
          return Promise.reject(new Error('AIChat views cannot be loaded as collab documents'));
        }

        if (loadAwareness) {
          // Add recent pages when view is loaded (fire and forget)
          void (async () => {
            try {
              await WorkspaceService.addRecentPages(currentWorkspaceId, [viewId]);
            } catch (e) {
              console.error(e);
            }
          })();
        }

        const layout = isSubDocument ? ViewLayout.Document : view?.layout;
        const databaseIdHint = !isSubDocument
          ? options?.databaseId ??
            (layout !== undefined && isDatabaseLayout(layout) ? getDatabaseIdFromExtra(view) : undefined)
          : undefined;

        // Use view-loader to open document (handles cache vs fetch)
        let { doc, collabType: detectedCollabType } = await openView(currentWorkspaceId, viewId, layout, {
          databaseId: databaseIdHint,
        });

        // Use detected collab type, or override for sub-documents
        let collabType = isSubDocument ? Types.Document : detectedCollabType;

        Log.debug('[useViewOperations] loadView complete (sync not bound)', {
          viewId,
          layout: view?.layout,
          collabType,
          databaseIdHint,
          isSubDocument,
        });

        let collabObjectId = await resolveCollabObjectId(doc, viewId, collabType, {
          databaseIdHint,
          updateDocGuid: !!databaseIdHint,
        });

        if (collabType === Types.Database && !databaseIdHint && collabObjectId !== viewId) {
          const canonical = await openView(currentWorkspaceId, viewId, layout, { databaseId: collabObjectId });

          doc = canonical.doc;
          detectedCollabType = canonical.collabType;
          collabType = isSubDocument ? Types.Document : detectedCollabType;
          collabObjectId = await resolveCollabObjectId(doc, viewId, collabType, {
            databaseIdHint: collabObjectId,
          });
        }

        // Store metadata on doc for deferred sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = collabObjectId;
        docWithMeta.view_id = viewId;
        docWithMeta._collabType = collabType;
        docWithMeta._syncBound = false;

        // For documents with awareness, create and store awareness
        if (collabType === Types.Document && loadAwareness) {
          if (!awarenessMapRef.current[viewId]) {
            const awareness = new Awareness(doc);

            awarenessMapRef.current = { ...awarenessMapRef.current, [viewId]: awareness };
            setAwarenessMap((prev) => {
              if (prev[viewId]) {
                return prev;
              }

              return { ...prev, [viewId]: awareness };
            });
          }
        }

        return doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, resolveCollabObjectId]
  );

  /**
   * Bind sync for a loaded document.
   *
   * Call this AFTER the component has rendered to start WebSocket sync.
   * This separation prevents race conditions where sync messages arrive
   * before the component finishes rendering.
   *
   * @param doc - The YDoc returned from loadView
   * @returns The sync context, or null if already bound or invalid doc
   */
  const bindViewSync = useCallback(
    (doc: YDoc) => {
      const docWithMeta = doc as YDocWithMeta;

      // Skip if already bound
      if (docWithMeta._syncBound) {
        Log.debug('[useViewOperations] bindViewSync skipped - already bound', {
          viewId: docWithMeta.view_id,
          objectId: docWithMeta.object_id,
        });
        return null;
      }

      const collabType = docWithMeta._collabType;
      const objectId = docWithMeta.object_id;
      const viewId = docWithMeta.view_id ?? objectId;

      // Use explicit undefined check so zero-valued collab types remain valid.
      if (collabType === undefined || !objectId || !viewId) {
        console.warn('[useViewOperations] bindViewSync failed - missing metadata', {
          hasCollabType: collabType !== undefined,
          hasObjectId: !!objectId,
          hasViewId: !!viewId,
        });
        return null;
      }

      // Get awareness for documents if available (use ref for stable callback)
      const awareness = collabType === Types.Document ? awarenessMapRef.current[viewId] : undefined;

      Log.debug('[useViewOperations] bindViewSync starting', {
        viewId,
        objectId,
        collabType,
        hasAwareness: !!awareness,
      });

      const syncContext = registerSyncContext({ doc, collabType, awareness });

      docWithMeta._syncBound = true;

      Log.debug('[useViewOperations] bindViewSync complete', {
        viewId,
        objectId,
        collabType,
      });

      return syncContext;
    },
    [registerSyncContext]
  );

  // Navigate to view
  const toView = useCallback(
    async (viewId: string, blockId?: string, keepSearch?: boolean, loadViewMeta?: (viewId: string) => Promise<View>) => {
      // Prefer outline/meta when available (fast), but fall back to server fetch for cases
      // where the outline does not include container children (e.g. shallow outline fetch).
      let view: View | undefined;

      if (loadViewMeta) {
        try {
          view = await loadViewMeta(viewId);
        } catch (e) {
          Log.debug('[toView] loadViewMeta failed', {
            viewId,
            error: e,
          });
        }
      }

      // If meta is unavailable (e.g. outline not loaded yet), fall back to a direct server fetch so we can
      // still resolve database containers and block routing.
      if (!view && currentWorkspaceId) {
        try {
          view = await ViewService.get(currentWorkspaceId, viewId);
        } catch (e) {
          Log.warn('[toView] Failed to fetch view from server', {
            viewId,
            error: e,
          });
        }
      }

      // Use the view's workspace_id (for shared/cross-workspace views) or fall back
      // to the current workspace. This prevents permission errors when navigating to
      // views shared from another workspace.
      const resolvedWorkspaceId = view?.workspace_id || currentWorkspaceId;

      if (!resolvedWorkspaceId) return;

      // If this is a database container, navigate to the first child view instead
      // This matches Desktop/Flutter behavior where clicking a container opens its first child
      let targetViewId = viewId;
      let targetView = view;

      if (isDatabaseContainer(view)) {
        let firstChild = getFirstChildView(view);

        // Fallback: fetch the container subtree from server to resolve first child.
        if (!firstChild) {
          try {
            const remote = await ViewService.get(resolvedWorkspaceId, viewId);

            // Update local variable so blockId routing below uses the correct layout.
            view = remote;
            targetView = remote;

            if (isDatabaseContainer(remote)) {
              firstChild = getFirstChildView(remote);
            }
          } catch (e) {
            Log.warn('[toView] Failed to fetch container view from server', {
              containerId: viewId,
              error: e,
            });
          }
        }

        if (firstChild) {
          Log.debug('[toView] Database container detected, navigating to first child', {
            containerId: viewId,
            firstChildId: firstChild.view_id,
          });
          targetViewId = firstChild.view_id;
          targetView = firstChild;
        }
      }

      let url = `/app/${resolvedWorkspaceId}/${targetViewId}`;
      const searchParams = new URLSearchParams(keepSearch ? window.location.search : undefined);

      if (blockId && targetView) {
        switch (targetView.layout) {
          case ViewLayout.Document:
            searchParams.set('blockId', blockId);
            break;
          case ViewLayout.Grid:
          case ViewLayout.Board:
          case ViewLayout.Calendar:
          case ViewLayout.Chart:
            searchParams.set('r', blockId);
            break;
          default:
            break;
        }
      }

      if (searchParams.toString()) {
        url += `?${searchParams.toString()}`;
      }

      // Avoid pushing duplicate history entries (also prevents loops when a container has no child).
      if (typeof window !== 'undefined') {
        const currentUrl = `${window.location.pathname}${window.location.search}`;

        if (currentUrl === url) {
          return;
        }
      }

      navigate(url);
    },
    [currentWorkspaceId, navigate]
  );

  const getCollabHistory = useCallback(
    async (viewId: string, since?: Date) => {
      if (!currentWorkspaceId) {
        throw new Error('Workspace not found');
      }

      try {
        const versions = await CollabService.getVersions(currentWorkspaceId, viewId, since);

        return versions;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  const previewCollabVersion = useCallback(
    async (viewId: string, versionId: string, collabType: Types) => {
      if (!currentWorkspaceId) {
        throw new Error('Workspace not found');
      }

      try {
        const docState = await CollabService.previewVersion(currentWorkspaceId, viewId, versionId, collabType);

        if (!docState) {
          return Promise.reject(new Error('No document state returned'));
        }

        if (collabType === Types.Document) {
          const doc = new Y.Doc() as YDoc;

          doc.version = versionId;

          Y.transact(doc, () => {
            try {
              Y.applyUpdate(doc, docState);
            } catch (e) {
              Log.error('Error applying Yjs update for document version preview', e);
              throw e;
            }
          });

          return doc;
        }
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId]
  );

  return {
    loadView,
    bindViewSync,
    toView,
    awarenessMap,
    getDatabaseIdForViewId,
    getViewIdFromDatabaseId,
    getViewReadOnlyStatus: getViewReadOnlyStatusFromOutline,
    getCollabHistory,
    previewCollabVersion,
  };
}
