import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';

import { Log } from '@/utils/log';
import { openCollabDB } from '@/application/db';
import {
  AccessLevel,
  DatabaseId,
  Types,
  View,
  ViewId,
  ViewLayout,
  YDoc,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { getFirstChildView, isDatabaseContainer } from '@/application/view-utils';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { getPlatform } from '@/utils/platform';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

// Hook for managing view-related operations
export function useViewOperations() {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { registerSyncContext } = useSyncInternal();
  const navigate = useNavigate();

  const [awarenessMap, setAwarenessMap] = useState<Record<string, Awareness>>({});
  const workspaceDatabaseDocMapRef = useRef<Map<string, YDoc>>(new Map());
  const createdRowKeys = useRef<string[]>([]);
  const databaseIdViewIdMapRef = useRef<Map<DatabaseId, ViewId>>(new Map());

  const databaseStorageId = userWorkspaceInfo?.selectedWorkspace?.databaseStorageId;

  // Register workspace database document for sync
  const registerWorkspaceDatabaseDoc = useCallback(
    async (workspaceId: string, databaseStorageId: string) => {
      const doc = await openCollabDB(databaseStorageId);

      doc.guid = databaseStorageId;
      const { doc: workspaceDatabaseDoc } = registerSyncContext({ doc, collabType: Types.WorkspaceDatabase });

      workspaceDatabaseDocMapRef.current.clear();
      workspaceDatabaseDocMapRef.current.set(workspaceId, workspaceDatabaseDoc);
    },
    [registerSyncContext]
  );

  // Get database ID for a view
  const getDatabaseId = useCallback(
    async (id: string) => {
      if (!currentWorkspaceId) return;

      // First check URL params for database mappings (passed from template duplication)
      // This allows immediate lookup without waiting for workspace database sync
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const dbMappingsParam = urlParams.get('db_mappings');

        if (dbMappingsParam) {
          const dbMappings: Record<string, string[]> = JSON.parse(decodeURIComponent(dbMappingsParam));
          // Store in localStorage for persistence across page refreshes
          const storageKey = `db_mappings_${currentWorkspaceId}`;
          const existingMappings = JSON.parse(localStorage.getItem(storageKey) || '{}');
          const mergedMappings = { ...existingMappings, ...dbMappings };

          localStorage.setItem(storageKey, JSON.stringify(mergedMappings));
          Log.debug('[useViewOperations] stored db_mappings to localStorage', mergedMappings);

          // Find the database ID that contains this view
          for (const [databaseId, viewIds] of Object.entries(dbMappings)) {
            if (viewIds.includes(id)) {
              Log.debug('[useViewOperations] found databaseId from URL params', { viewId: id, databaseId });
              return databaseId;
            }
          }
        }
      } catch (e) {
        console.warn('[useViewOperations] failed to parse db_mappings from URL', e);
      }

      // Check localStorage for cached database mappings (persists across page refreshes)
      try {
        const storageKey = `db_mappings_${currentWorkspaceId}`;
        const cachedMappings = localStorage.getItem(storageKey);

        if (cachedMappings) {
          const dbMappings: Record<string, string[]> = JSON.parse(cachedMappings);

          for (const [databaseId, viewIds] of Object.entries(dbMappings)) {
            if (viewIds.includes(id)) {
              Log.debug('[useViewOperations] found databaseId from localStorage', { viewId: id, databaseId });
              return databaseId;
            }
          }
        }
      } catch (e) {
        console.warn('[useViewOperations] failed to read db_mappings from localStorage', e);
      }

      if (databaseStorageId && !workspaceDatabaseDocMapRef.current.has(currentWorkspaceId)) {
        await registerWorkspaceDatabaseDoc(currentWorkspaceId, databaseStorageId);
      }

      return new Promise<string | null>((resolve) => {
        const sharedRoot = workspaceDatabaseDocMapRef.current.get(currentWorkspaceId)?.getMap(YjsEditorKey.data_section);
        const observeEvent = () => {
          const databases = sharedRoot?.toJSON()?.databases;

          const databaseId = databases?.find((database: { database_id: string; views: string[] }) =>
            database.views.find((view) => view === id)
          )?.database_id;

          if (databaseId) {
            Log.debug('[useViewOperations] mapped view to database', { viewId: id, databaseId });
            resolve(databaseId);
            return;
          }

          console.warn('[useViewOperations] databaseId not found for view', { viewId: id });
        };

        observeEvent();
        sharedRoot?.observeDeep(observeEvent);

        return () => {
          sharedRoot?.unobserveDeep(observeEvent);
        };
      });
    },
    [currentWorkspaceId, databaseStorageId, registerWorkspaceDatabaseDoc]
  );

  // Check if view should be readonly based on access permissions
  const getViewReadOnlyStatus = useCallback((viewId: string, outline?: View[]) => {
    const isMobile = getPlatform().isMobile;

    if (isMobile) return true; // Mobile has highest priority - always readonly

    if (!outline) return false;

    // Check if view exists in shareWithMe
    const shareWithMeView = findViewInShareWithMe(outline, viewId);

    if (shareWithMeView?.access_level !== undefined) {
      // If found in shareWithMe, check access level
      return shareWithMeView.access_level <= AccessLevel.ReadAndComment;
    }

    // If not found in shareWithMe, default is false (editable)
    return false;
  }, []);

  const getViewIdFromDatabaseId = useCallback(
    async (databaseId: string) => {
      if (!currentWorkspaceId) {
        return null;
      }

      if (databaseIdViewIdMapRef.current.has(databaseId)) {
        return databaseIdViewIdMapRef.current.get(databaseId) || null;
      }

      const workspaceDatabaseDoc = workspaceDatabaseDocMapRef.current.get(currentWorkspaceId);

      if (!workspaceDatabaseDoc) {
        return null;
      }

      const sharedRoot = workspaceDatabaseDoc.getMap(YjsEditorKey.data_section);

      const databases = sharedRoot?.toJSON()?.databases;

      const database = databases?.find((db: { database_id: string; views: string[] }) => db.database_id === databaseId);

      if (database) {
        databaseIdViewIdMapRef.current.set(databaseId, database.views[0]);
      }

      return databaseIdViewIdMapRef.current.get(databaseId) || null;
    },
    [currentWorkspaceId]
  );

  // Load view document
  const loadView = useCallback(
    async (id: string, isSubDocument = false, loadAwareness = false, outline?: View[]) => {
      try {
        if (!service || !currentWorkspaceId) {
          throw new Error('Service or workspace not found');
        }

        const res = await service?.getPageDoc(currentWorkspaceId, id);

        if (!res) {
          throw new Error('View not found');
        }

        if (loadAwareness) {
          // Add recent pages when view is loaded
          void (async () => {
            try {
              await service.addRecentPages(currentWorkspaceId, [id]);
            } catch (e) {
              console.error(e);
            }
          })();
        }

        const view = findView(outline || [], id);

        let collabType = isSubDocument ? Types.Document : null;

        switch (view?.layout) {
          case ViewLayout.Document:
            collabType = Types.Document;
            break;
          case ViewLayout.Grid:
          case ViewLayout.Board:
          case ViewLayout.Calendar:
            collabType = Types.Database;
            break;
          case ViewLayout.AIChat:
            // AIChat views don't have a collab document type
            return Promise.reject(new Error('AIChat views cannot be loaded as collab documents'));
        }

        // Fallback: If view not found in outline yet (e.g., newly created view),
        // try to determine type from the Yjs document itself
        if (collabType === null) {
          console.warn('[useViewOperations] View not found in outline, checking Yjs document', { viewId: id });

          // Check if the document has a database section (database views)
          const sharedRoot = res.getMap(YjsEditorKey.data_section) as YSharedRoot;
          const hasDatabase = sharedRoot?.has(YjsEditorKey.database);
          const hasDocument = sharedRoot?.has(YjsEditorKey.document);

          if (hasDatabase) {
            collabType = Types.Database;
          } else if (hasDocument) {
            collabType = Types.Document;
          } else {
            console.error('[useViewOperations] Could not determine view type', {
              viewId: id,
              viewLayout: view?.layout,
              hasDatabase,
              hasDocument,
            });
            return Promise.reject(new Error(`Invalid view layout: ${view?.layout}`));
          }
        }

        Log.debug('[useViewOperations] loadView resolved layout', { viewId: id, layout: view?.layout, collabType });

        if (collabType === Types.Document) {
          let awareness: Awareness | undefined;

          if (loadAwareness) {
            setAwarenessMap((prev) => {
              if (prev[id]) {
                awareness = prev[id];
                return prev;
              }

              awareness = new Awareness(res);
              return { ...prev, [id]: awareness };
            });
          }

          const { doc } = registerSyncContext({ doc: res, collabType, awareness });

          // Set the view ID on the doc for React state tracking
          doc.object_id = id;
          return doc;
        }

        const databaseId = await getDatabaseId(id);

        if (!databaseId) {
          throw new Error('Database not found');
        }

        res.guid = databaseId;
        const { doc } = registerSyncContext({ doc: res, collabType });

        // Set the view ID on the doc for React state tracking
        doc.object_id = id;
        return doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [service, currentWorkspaceId, getDatabaseId, registerSyncContext] // Add dependencies to prevent re-creation of functions
  );

  // Create row document
  const createRowDoc = useCallback(
    async (rowKey: string): Promise<YDoc> => {
      if (!currentWorkspaceId || !service) {
        throw new Error('Failed to create row doc');
      }

      try {
        const doc = await service?.createRowDoc(rowKey);

        if (!doc) {
          throw new Error('Failed to create row doc');
        }

        const rowId = rowKey.split('_rows_')[1];

        if (!rowId) {
          throw new Error('Failed to create row doc');
        }

        doc.guid = rowId;
        const syncContext = registerSyncContext({
          doc,
          collabType: Types.DatabaseRow,
        });

        createdRowKeys.current.push(rowKey);
        return syncContext.doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service, registerSyncContext]
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
      if (!view && currentWorkspaceId && service) {
        try {
          view = await service.getAppView(currentWorkspaceId, viewId);
        } catch (e) {
          Log.warn('[toView] Failed to fetch view from server', {
            viewId,
            error: e,
          });
        }
      }

      // If this is a database container, navigate to the first child view instead
      // This matches Desktop/Flutter behavior where clicking a container opens its first child
      let targetViewId = viewId;
      let targetView = view;

      if (isDatabaseContainer(view)) {
        let firstChild = getFirstChildView(view);

        // Fallback: fetch the container subtree from server to resolve first child.
        if (!firstChild && currentWorkspaceId && service) {
          try {
            const remote = await service.getAppView(currentWorkspaceId, viewId);

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

      let url = `/app/${currentWorkspaceId}/${targetViewId}`;
      const searchParams = new URLSearchParams(keepSearch ? window.location.search : undefined);

      if (blockId && targetView) {
        switch (targetView.layout) {
          case ViewLayout.Document:
            searchParams.set('blockId', blockId);
            break;
          case ViewLayout.Grid:
          case ViewLayout.Board:
          case ViewLayout.Calendar:
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
    [currentWorkspaceId, navigate, service]
  );

  // Clean up created row documents when view changes
  useEffect(() => {
    const rowKeys = createdRowKeys.current;

    createdRowKeys.current = [];

    if (!rowKeys.length) return;

    rowKeys.forEach((rowKey) => {
      try {
        service?.deleteRowDoc(rowKey);
      } catch (e) {
        console.error(e);
      }
    });
  }, [service, currentWorkspaceId]); // Changed from viewId to currentWorkspaceId

  return {
    loadView,
    createRowDoc,
    toView,
    awarenessMap,
    getViewIdFromDatabaseId,
    getViewReadOnlyStatus,
  };
}
