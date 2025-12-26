import { sortBy, uniqBy } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { invalidToken } from '@/application/session/token';
import { DatabaseRelations, MentionablePerson, UIVariant, View, ViewLayout } from '@/application/types';
import { findView, findViewByLayout } from '@/components/_shared/outline/utils';
import { createDeduplicatedNoArgsRequest } from '@/utils/deduplicateRequest';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

const USER_NO_ACCESS_CODE = 1012;
const USER_UNAUTHORIZED_CODE = 1024;

export interface RequestAccessError {
  code: number;
  message: string;
}

// Hook for managing workspace data (outline, favorites, recent, trash)
export function useWorkspaceData() {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { eventEmitter } = useSyncInternal();
  const navigate = useNavigate();

  const [outline, setOutline] = useState<View[]>();
  const stableOutlineRef = useRef<View[]>([]);
  const [favoriteViews, setFavoriteViews] = useState<View[]>();
  const [recentViews, setRecentViews] = useState<View[]>();
  const [trashList, setTrashList] = useState<View[]>();
  const [workspaceDatabases, setWorkspaceDatabases] = useState<DatabaseRelations | undefined>(undefined);
  const workspaceDatabasesRef = useRef<DatabaseRelations | undefined>(undefined);
  const [requestAccessError, setRequestAccessError] = useState<RequestAccessError | null>(null);

  const mentionableUsersRef = useRef<MentionablePerson[]>([]);

  // Load application outline
  const loadOutline = useCallback(
    async (workspaceId: string, force = true) => {
      if (!service) return;
      try {
        const res = await service?.getAppOutline(workspaceId);

        if (!res) {
          throw new Error('App outline not found');
        }

        // Load shareWithMe data and append as hidden space
        let outlineWithShareWithMe = res;

        try {
          const shareWithMe = await service.getShareWithMe(workspaceId);

          if (shareWithMe && shareWithMe.children && shareWithMe.children.length > 0) {
            // Create a hidden space for shareWithMe
            const shareWithMeSpace: View = {
              ...shareWithMe,
              extra: {
                ...shareWithMe.extra,
                is_space: true,
                is_hidden_space: true, // Mark as hidden so it doesn't show in normal space list
              },
            };

            outlineWithShareWithMe = [...res, shareWithMeSpace];
          }
        } catch (error) {
          console.error('Failed to load shareWithMe data:', error);
          // Continue with original outline if shareWithMe fails
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

          const lastViewId = localStorage.getItem('last_view_id');

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
    [navigate, service, eventEmitter]
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
