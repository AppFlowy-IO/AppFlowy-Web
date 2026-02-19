import { applyPatch, type Operation, type ReplaceOperation } from 'fast-json-patch';
import { sortBy, uniqBy } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { invalidToken } from '@/application/session/token';
import { DatabaseRelations, MentionablePerson, UIVariant, View, ViewLayout } from '@/application/types';
import {
  addViewToOutline,
  mergeChildrenIntoOutline,
  removeViewFromOutline,
  reorderChildrenInOutline,
  updateViewInOutline,
} from '@/components/_shared/outline/mergeOutline';
import { findView, findViewByLayout } from '@/components/_shared/outline/utils';
import { notification } from '@/proto/messages';
import { createDeduplicatedNoArgsRequest } from '@/utils/deduplicateRequest';
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

export function preserveLoadedChildren(
  newOutline: View[],
  oldOutline: View[],
  prevLoadedIds: Set<string>,
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
    finalOutline = mergeChildrenIntoOutline(
      finalOutline,
      loadedId,
      oldView.children,
      oldView.has_children,
    );
    nextLoadedIds.add(loadedId);
  }

  return { outline: finalOutline, loadedIds: nextLoadedIds };
}

const USER_NO_ACCESS_CODE = 1012;
const USER_UNAUTHORIZED_CODE = 1024;

const FOLDER_VIEW_CHANGE_TYPE = {
  VIEW_FIELDS_CHANGED: 0,
  VIEW_ADDED: 1,
  VIEW_REMOVED: 2,
  CHILDREN_REORDERED: 3,
} as const;

export interface RequestAccessError {
  code: number;
  message: string;
}

type JsonPatchOperation = Operation;

type FolderRid = {
  timestamp: number;
  seqNo: number;
};

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

const OUTLINE_NON_VISUAL_FIELDS = new Set(['/last_edited_time', '/last_edited_by']);

function isOnlyNonVisualOutlineChange(patch: JsonPatchOperation[]): boolean {
  return patch.every((op) => {
    if (!op.path?.startsWith('/outline')) return false;
    const path = op.path;

    return Array.from(OUTLINE_NON_VISUAL_FIELDS).some((suffix) => path.endsWith(suffix));
  });
}

// Hook for managing workspace data (outline, favorites, recent, trash)
export function useWorkspaceData() {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { eventEmitter } = useSyncInternal();
  const navigate = useNavigate();

  const [outline, setOutline] = useState<View[]>();
  const stableOutlineRef = useRef<View[]>([]);
  const lastFolderRidRef = useRef<FolderRid | null>(null);
  const [favoriteViews, setFavoriteViews] = useState<View[]>();
  const [recentViews, setRecentViews] = useState<View[]>();
  const [trashList, setTrashList] = useState<View[]>();
  const [workspaceDatabases, setWorkspaceDatabases] = useState<DatabaseRelations | undefined>(undefined);
  const workspaceDatabasesRef = useRef<DatabaseRelations | undefined>(undefined);
  const [requestAccessError, setRequestAccessError] = useState<RequestAccessError | null>(null);

  const mentionableUsersRef = useRef<MentionablePerson[]>([]);

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
    const { outline: mergedOutline, loadedIds: nextLoadedIds } = preserveLoadedChildren(
      newOutline,
      prevOutline,
      prevLoadedIds,
    );

    stableOutlineRef.current = mergedOutline;
    loadedViewIdsRef.current = nextLoadedIds;
    setLoadedViewIdsRevision((r) => r + 1);
    loadingViewIdsRef.current = new Set();
    setOutline(mergedOutline);

    return mergedOutline;
  }, []);

  // Load application outline
  const updateLastFolderRid = useCallback((next: FolderRid | null) => {
    if (!next) return;
    const current = lastFolderRidRef.current;

    if (!current || compareFolderRid(next, current) > 0) {
      lastFolderRidRef.current = next;
    }
  }, []);

  const loadOutline = useCallback(
    async (workspaceId: string, force = true) => {
      if (!service) return;
      try {
        // Parallelize API calls - both are independent and can run concurrently
        const [res, shareWithMeResult] = await Promise.all([
          service.getAppOutline(workspaceId),
          service.getShareWithMe(workspaceId).catch((error) => {
            Log.error('[Outline] Failed to load shareWithMe data', error);
            return null;
          }),
        ]);

        if (!res) {
          throw new Error('App outline not found');
        }

        // Append shareWithMe data as hidden space if available
        const nextFolderRid = parseFolderRid(res.folderRid);

        updateLastFolderRid(nextFolderRid);

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

        const mergedOutline = replaceOutlinePreservingChildren(outlineWithShareWithMe);

        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, mergedOutline || []);
        }

        if (!force) return;

        try {
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
            } else if (service) {
              try {
                await service.getAppView(workspaceId, lastViewId);
                navigate(`/app/${workspaceId}/${lastViewId}${search}`);
                return;
              } catch {
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
          ]);

          if (firstView) {
            navigate(`/app/${workspaceId}/${firstView.view_id}${search}`);
            return;
          }

          // With shallow outlines, fetch all visible spaces in one batch and
          // search for a navigable child in original space order.
          const spaces = outlineWithShareWithMe.filter(
            (v) => v.extra?.is_space && !v.extra?.is_hidden_space
          );

          if (spaces.length > 0) {
            try {
              const spaceViews = await service.getAppViews(
                workspaceId,
                spaces.map((space) => space.view_id),
                1
              );
              const spaceViewMap = new Map(spaceViews.map((spaceView) => [spaceView.view_id, spaceView]));

              for (const space of spaces) {
                const spaceData = spaceViewMap.get(space.view_id);
                const firstChild = findViewByLayout(spaceData?.children ?? [], [
                  ViewLayout.Document,
                  ViewLayout.Board,
                  ViewLayout.Grid,
                  ViewLayout.Calendar,
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
        Log.error('[Outline] App outline not found', e);
        if (e.code === USER_UNAUTHORIZED_CODE) {
          invalidToken();
          navigate('/login');
          return;
        }

        if (e.code === USER_NO_ACCESS_CODE) {
          setRequestAccessError({
            code: e.code,
            message: e.message,
          });
          return;
        }
      }
    },
    [navigate, service, eventEmitter, updateLastFolderRid, userWorkspaceInfo?.userId, replaceOutlinePreservingChildren]
  );

  // Load children for a single view (lazy expand)
  const loadViewChildren = useCallback(
    async (viewId: string): Promise<View[]> => {
      if (!service || !currentWorkspaceId) return [];

      // Dedup concurrent fetches
      if (loadingViewIdsRef.current.has(viewId)) {
        Log.debug('[Outline] [loadViewChildren] skip in-flight request', {
          workspaceId: currentWorkspaceId,
          viewId,
        });
        return [];
      }

      loadingViewIdsRef.current.add(viewId);

      try {
        Log.debug('[Outline] [loadViewChildren] requesting single subtree', {
          workspaceId: currentWorkspaceId,
          viewId,
          depth: 1,
        });

        const viewData = await service.getAppView(currentWorkspaceId, viewId);

        updateLastFolderRid(parseFolderRid(viewData?.folder_rid));

        const children = viewData?.children ?? [];

        // Merge into outline
        const nextOutline = mergeChildrenIntoOutline(
          stableOutlineRef.current,
          viewId,
          children,
          viewData?.has_children
        );

        if (nextOutline !== stableOutlineRef.current) {
          stableOutlineRef.current = nextOutline;
          setOutline(nextOutline);
          if (eventEmitter) {
            eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
          }

          // Mark as loaded only when the parent exists in the current outline
          // and children were actually merged.
          loadedViewIdsRef.current.add(viewId);
          setLoadedViewIdsRevision((r) => r + 1);
        }

        return children;
      } catch (e) {
        Log.error('[Outline] [loadViewChildren] Failed to load children for', viewId, e);
        return [];
      } finally {
        loadingViewIdsRef.current.delete(viewId);
      }
    },
    [service, currentWorkspaceId, stableOutlineRef, eventEmitter, updateLastFolderRid]
  );

  const loadViewChildrenBatch = useCallback(
    async (viewIds: string[]): Promise<View[]> => {
      if (!service || !currentWorkspaceId || viewIds.length === 0) return [];

      const uniqueIds = Array.from(new Set(viewIds)).filter(
        (viewId) => !loadingViewIdsRef.current.has(viewId)
      );

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
          workspaceId: currentWorkspaceId,
          depth: 1,
          requestViewMeta,
        });

        const views = await service.getAppViews(currentWorkspaceId, uniqueIds, 1);

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
          const mergedOutline = mergeChildrenIntoOutline(
            nextOutline,
            viewId,
            children,
            viewData?.has_children
          );

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
        Log.error('[Outline] [loadViewChildrenBatch] Failed to load children for', uniqueIds, e);
        throw e;
      } finally {
        uniqueIds.forEach((viewId) => loadingViewIdsRef.current.delete(viewId));
      }
    },
    [service, currentWorkspaceId, stableOutlineRef, eventEmitter, updateLastFolderRid]
  );

  const markViewChildrenStale = useCallback((viewId: string) => {
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

    // Also invalidate the HTTP cache for the root view so the next
    // loadViewChildren call makes a fresh API request instead of
    // returning stale cached data.
    if (service && currentWorkspaceId) {
      service.invalidateViewCache?.(currentWorkspaceId, viewId);
    }

    Log.debug('[Outline] [cache] Marked view subtree stale', { viewId, clearedIds: subtreeIds.length });
    setLoadedViewIdsRevision((r) => r + 1);
  }, [stableOutlineRef, service, currentWorkspaceId]);

  useEffect(() => {
    const handleShareViewsChanged = () => {
      if (!currentWorkspaceId) return;

      void loadOutline(currentWorkspaceId, false);
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    }

    return () => {
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
      }
    };
  }, [currentWorkspaceId, eventEmitter, loadOutline]);

  useEffect(() => {
    const handleFolderOutlineChanged = (payload: notification.IFolderChanged) => {
      if (!currentWorkspaceId) return;

      // If no diff JSON provided, fall back to full outline reload
      if (!payload?.outlineDiffJson) {
        Log.debug('[Outline] [FolderOutlineChanged] No diff JSON, reloading outline');
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      let patch: JsonPatchOperation[] | null = null;

      try {
        Log.debug('[Outline] [FolderOutlineChanged] raw diff json', payload.outlineDiffJson);
        patch = JSON.parse(payload.outlineDiffJson) as JsonPatchOperation[];
      } catch (error) {
        Log.warn('[Outline] [FolderOutlineChanged] Failed to parse outline diff, reloading outline', error);
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      if (!patch || !Array.isArray(patch)) {
        void loadOutline(currentWorkspaceId, false);
        return;
      }

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

      Log.debug('[Outline] [FolderOutlineChanged] parsed patch', patch);

      const baseOutline = stableOutlineRef.current.filter((view) => !view.extra?.is_hidden_space);
      const baseDocument = { outline: baseOutline };
      let patchedOutline: View[] | null = null;

      const firstOp = patch[0];
      const fastReplace =
        patch.length === 1 && firstOp?.op === 'replace' && firstOp?.path === '/outline';

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
          Log.warn('[Outline] [FolderOutlineChanged] Failed to apply outline diff, reloading outline', error);
          void loadOutline(currentWorkspaceId, false);
          return;
        }
      }

      if (!patchedOutline) return;

      const existingShareWithMe = stableOutlineRef.current.find(
        (view) => view.extra?.is_hidden_space
      );
      const nextOutline = existingShareWithMe
        ? [...patchedOutline, existingShareWithMe]
        : patchedOutline;

      const mergedOutline = replaceOutlinePreservingChildren(nextOutline);

      updateLastFolderRid(patchRid);

      if (eventEmitter) {
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
  }, [currentWorkspaceId, eventEmitter, loadOutline, replaceOutlinePreservingChildren, stableOutlineRef, updateLastFolderRid]);

  // Handle granular FolderViewChanged notifications
  useEffect(() => {
    const handleFolderViewChanged = (payload: notification.IFolderViewChanged) => {
      if (!currentWorkspaceId) return;

      const folderRid = parseFolderRid(payload.folderRid);
      const currentRid = lastFolderRidRef.current;

      if (folderRid && currentRid && compareFolderRid(folderRid, currentRid) <= 0) {
        Log.debug('[Outline] [FolderViewChanged] skipped stale notification', {
          folderRid: payload.folderRid,
          lastRid: `${currentRid.timestamp}-${currentRid.seqNo}`,
        });
        return;
      }

      const changeType = payload.changeType ?? 0;
      let nextOutline = stableOutlineRef.current;

      switch (changeType) {
        case FOLDER_VIEW_CHANGE_TYPE.VIEW_FIELDS_CHANGED: {
          if (!payload.viewJson) break;
          try {
            const updatedView = JSON.parse(payload.viewJson) as View;

            nextOutline = updateViewInOutline(nextOutline, updatedView);
          } catch (error) {
            Log.warn('[Outline] [FolderViewChanged] Failed to parse view_json for fields changed', error);
            void loadOutline(currentWorkspaceId, false);
            return;
          }

          break;
        }

        case FOLDER_VIEW_CHANGE_TYPE.VIEW_ADDED: {
          if (!payload.viewJson || !payload.parentViewId) break;
          try {
            const newView = JSON.parse(payload.viewJson) as View;

            // addViewToOutline already sets has_children: true on the parent
            nextOutline = addViewToOutline(nextOutline, payload.parentViewId, newView);
          } catch (error) {
            Log.warn('[Outline] [FolderViewChanged] Failed to parse view_json for view added', error);
            void loadOutline(currentWorkspaceId, false);
            return;
          }

          break;
        }

        case FOLDER_VIEW_CHANGE_TYPE.VIEW_REMOVED: {
          const parentId = payload.viewId;
          const childIds = payload.childViewIds ?? [];

          if (parentId) {
            nextOutline = removeViewFromOutline(nextOutline, parentId, childIds);

            // Clean removed children (and their subtrees) from loadedViewIdsRef
            // so that preserveLoadedChildren won't re-graft them on the next
            // FOLDER_OUTLINE_CHANGED shallow refresh.
            for (const childId of childIds) {
              loadedViewIdsRef.current.delete(childId);
            }

            // If the parent has no remaining children, remove it from loaded IDs
            // so we don't re-graft stale children on the next outline refresh.
            const parentView = findView(nextOutline, parentId);

            if (parentView && (!parentView.children || parentView.children.length === 0)) {
              loadedViewIdsRef.current.delete(parentId);
            }
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
          void loadOutline(currentWorkspaceId, false);
          return;
        }
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
  }, [currentWorkspaceId, eventEmitter, loadOutline, stableOutlineRef, updateLastFolderRid]);

  // Load favorite views
  const loadFavoriteViews = useCallback(async () => {
    if (!service || !currentWorkspaceId) return;
    try {
      const res = await service?.getAppFavorites(currentWorkspaceId);

      if (!res) {
        throw new Error('Favorite views not found');
      }

      setFavoriteViews(res);
      return res;
    } catch (e) {
      console.error('Favorite views not found');
    }
  }, [currentWorkspaceId, service]);

  // Load recent views
  const loadRecentViews = useCallback(async () => {
    if (!service || !currentWorkspaceId) return;
    try {
      const res = await service?.getAppRecent(currentWorkspaceId);

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
  }, [currentWorkspaceId, service]);

  // Load trash list
  const loadTrash = useCallback(
    async (currentWorkspaceId: string) => {
      if (!service) return;
      try {
        const res = await service?.getAppTrash(currentWorkspaceId);

        if (!res) {
          throw new Error('App trash not found');
        }

        setTrashList(sortBy(uniqBy(res, 'view_id') as unknown as View[], 'last_edited_time').reverse());
      } catch (e) {
        return Promise.reject('App trash not found');
      }
    },
    [service]
  );

  // Get cached database relations (synchronous, returns immediately)
  const getCachedDatabaseRelations = useCallback(() => {
    return workspaceDatabasesRef.current;
  }, []);

  // Internal helper to fetch and update database relations
  const fetchAndUpdateDatabaseRelations = useCallback(async (silent = false) => {
    if (!currentWorkspaceId || !service) {
      return;
    }

    const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;

    if (!selectedWorkspace) return;

    try {
      const res = await service.getAppDatabaseViewRelations(currentWorkspaceId, selectedWorkspace.databaseStorageId);

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
  }, [currentWorkspaceId, service, userWorkspaceInfo?.selectedWorkspace]);

  // Load database relations (returns cached if available, fetches otherwise)
  const loadDatabaseRelations = useCallback(async () => {
    // Return cached data if already loaded to avoid unnecessary re-renders
    if (workspaceDatabasesRef.current) {
      return workspaceDatabasesRef.current;
    }

    return fetchAndUpdateDatabaseRelations(false);
  }, [fetchAndUpdateDatabaseRelations]);

  // Refresh database relations in background (doesn't block, updates cache)
  const refreshDatabaseRelationsInBackground = useCallback(() => {
    // Fire and forget - update cache when done
    void fetchAndUpdateDatabaseRelations(true);
  }, [fetchAndUpdateDatabaseRelations]);

  const enhancedLoadDatabaseRelations = useMemo(() => {
    return createDeduplicatedNoArgsRequest(loadDatabaseRelations);
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
    if (!currentWorkspaceId || !service) {
      throw new Error('No workspace or service found');
    }

    try {
      const res = await service?.getMentionableUsers(currentWorkspaceId);

      if (res) {
        mentionableUsersRef.current = res;
      }

      return res || [];
    } catch (e) {
      return Promise.reject(e);
    }
  }, [currentWorkspaceId, service]);

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
    setOutline([]);
    loadedViewIdsRef.current = new Set();
    setLoadedViewIdsRevision((r) => r + 1);
    loadingViewIdsRef.current = new Set();
    // Clear database relations cache when switching workspaces to prevent
    // cross-workspace data contamination
    workspaceDatabasesRef.current = undefined;
    setWorkspaceDatabases(undefined);
    void loadOutline(currentWorkspaceId, true);
    void (async () => {
      try {
        await loadTrash(currentWorkspaceId);
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId]);

  // Load database relations
  useEffect(() => {
    void enhancedLoadDatabaseRelations();
  }, [enhancedLoadDatabaseRelations]);


  return {
    outline,
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
  };
}
