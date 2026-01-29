import { applyPatch, type Operation, type ReplaceOperation } from 'fast-json-patch';
import { sortBy, uniqBy } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { invalidToken } from '@/application/session/token';
import { DatabaseRelations, MentionablePerson, UIVariant, View, ViewLayout } from '@/application/types';
import { findView, findViewByLayout } from '@/components/_shared/outline/utils';
import { notification } from '@/proto/messages';
import { createDeduplicatedNoArgsRequest } from '@/utils/deduplicateRequest';
import { Log } from '@/utils/log';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

const USER_NO_ACCESS_CODE = 1012;
const USER_UNAUTHORIZED_CODE = 1024;

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
            console.error('Failed to load shareWithMe data:', error);
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

        stableOutlineRef.current = outlineWithShareWithMe;
        setOutline(outlineWithShareWithMe);

        if (eventEmitter) {
          eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, outlineWithShareWithMe || []);
        }

        if (!force) return;

        const firstView = findViewByLayout(outlineWithShareWithMe, [
          ViewLayout.Document,
          ViewLayout.Board,
          ViewLayout.Grid,
          ViewLayout.Calendar,
        ]);


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

          if (lastViewId && findView(outlineWithShareWithMe, lastViewId)) {
            navigate(`/app/${workspaceId}/${lastViewId}${search}`);
          } else if (firstView) {
            navigate(`/app/${workspaceId}/${firstView.view_id}${search}`);
          }
        } catch (e) {
          // Do nothing
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        console.error('App outline not found');
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
    [navigate, service, eventEmitter, updateLastFolderRid, userWorkspaceInfo?.userId]
  );

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
        Log.debug('[FolderOutlineChanged] No diff JSON, reloading outline');
        void loadOutline(currentWorkspaceId, false);
        return;
      }

      let patch: JsonPatchOperation[] | null = null;

      try {
        Log.debug('[FolderOutlineChanged] raw diff json', payload.outlineDiffJson);
        patch = JSON.parse(payload.outlineDiffJson) as JsonPatchOperation[];
      } catch (error) {
        console.warn('Failed to parse folder outline diff, reloading outline:', error);
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
        Log.debug('[FolderOutlineChanged] skipped stale patch', {
          patchRid: payload.folderRid,
          lastRid: `${currentRid.timestamp}-${currentRid.seqNo}`,
        });
        return;
      }

      if (isOnlyNonVisualOutlineChange(patch)) {
        updateLastFolderRid(patchRid);
        return;
      }

      Log.debug('[FolderOutlineChanged] parsed patch', patch);

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
          console.warn('Failed to apply folder outline diff, reloading outline:', error);
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

      stableOutlineRef.current = nextOutline;
      setOutline(nextOutline);
      updateLastFolderRid(patchRid);

      if (eventEmitter) {
        eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, nextOutline || []);
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

      setRecentViews(
        views.filter((item: View) => {
          return !item.extra?.is_space && findView(outline || [], item.view_id);
        })
      );
      return views;
    } catch (e) {
      console.error('Recent views not found');
    }
  }, [currentWorkspaceId, service, outline]);

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
  };
}
