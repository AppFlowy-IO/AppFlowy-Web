import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';

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
} from '@/application/types';
import { getFirstChildView, isDatabaseContainer } from '@/application/view-utils';
import { getDatabaseIdFromDoc, openView } from '@/application/view-loader';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { Log } from '@/utils/log';
import { getPlatform } from '@/utils/platform';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

/**
 * Extended YDoc with metadata for deferred sync binding.
 * These properties are set during loadView and used by bindViewSync.
 */
export interface YDocWithMeta extends YDoc {
  /** The view ID this doc belongs to */
  object_id?: string;
  /** The collab type for sync binding */
  _collabType?: Types;
  /** Whether sync has been bound for this doc */
  _syncBound?: boolean;
}

// Hook for managing view-related operations
export function useViewOperations() {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { registerSyncContext } = useSyncInternal();
  const navigate = useNavigate();

  const [awarenessMap, setAwarenessMap] = useState<Record<string, Awareness>>({});
  // Ref for stable access to awarenessMap in callbacks (prevents bindViewSync recreation)
  const awarenessMapRef = useRef<Record<string, Awareness>>({});

  useEffect(() => {
    awarenessMapRef.current = { ...awarenessMapRef.current, ...awarenessMap };
  }, [awarenessMap]);
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
        let resolved = false;
        let warningLogged = false;
        let observerRegistered = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          if (observerRegistered && sharedRoot) {
            try {
              sharedRoot.unobserveDeep(observeEvent);
            } catch {
              // Ignore if already unobserved
            }

            observerRegistered = false;
          }
        };

        const observeEvent = () => {
          if (resolved) return;

          const databases = sharedRoot?.toJSON()?.databases;

          const databaseId = databases?.find((database: { database_id: string; views: string[] }) =>
            database.views.find((view) => view === id)
          )?.database_id;

          if (databaseId) {
            resolved = true;
            Log.debug('[useViewOperations] mapped view to database', { viewId: id, databaseId });
            cleanup();
            resolve(databaseId);
            return;
          }

          // Only log warning once, not on every observe event
          if (!warningLogged) {
            warningLogged = true;
            Log.debug('[useViewOperations] databaseId not found for view yet, waiting for sync', { viewId: id });
          }
        };

        observeEvent();
        if (sharedRoot && !resolved) {
          sharedRoot.observeDeep(observeEvent);
          observerRegistered = true;
        }

        // Add timeout to prevent hanging forever
        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            console.warn('[useViewOperations] databaseId lookup timed out for view', { viewId: id });
            resolve(null);
          }
        }, 10000); // 10 second timeout
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
    async (id: string, isSubDocument = false, loadAwareness = false, outline?: View[]) => {
      try {
        if (!service || !currentWorkspaceId) {
          throw new Error('Service or workspace not found');
        }

        const view = findView(outline || [], id);

        // Check for AIChat early
        if (view?.layout === ViewLayout.AIChat) {
          return Promise.reject(new Error('AIChat views cannot be loaded as collab documents'));
        }

        if (loadAwareness) {
          // Add recent pages when view is loaded (fire and forget)
          void (async () => {
            try {
              await service.addRecentPages(currentWorkspaceId, [id]);
            } catch (e) {
              console.error(e);
            }
          })();
        }

        // Use view-loader to open document (handles cache vs fetch)
        const { doc, collabType: detectedCollabType } = await openView(
          currentWorkspaceId,
          id,
          isSubDocument ? ViewLayout.Document : view?.layout
        );

        // Use detected collab type, or override for sub-documents
        const collabType = isSubDocument ? Types.Document : detectedCollabType;

        Log.debug('[useViewOperations] loadView complete (sync not bound)', {
          viewId: id,
          layout: view?.layout,
          collabType,
          isSubDocument,
        });

        // For databases, ensure guid is set to databaseId for sync
        if (collabType === Types.Database) {
          // First try getting databaseId directly from the doc (fast, synchronous)
          // This works for newly created embedded databases where the doc already has the ID
          let databaseId = getDatabaseIdFromDoc(doc);

          if (databaseId) {
            Log.debug('[useViewOperations] databaseId loaded from Yjs document', {
              viewId: id,
              databaseId,
            });
            databaseIdViewIdMapRef.current.set(databaseId, id);
          } else {
            // Fallback to workspace database mapping lookup (async, may timeout)
            databaseId = (await getDatabaseId(id)) ?? null;
          }

          if (!databaseId) {
            throw new Error('Database not found');
          }

          doc.guid = databaseId;
        }

        // Store metadata on doc for deferred sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = id;
        docWithMeta._collabType = collabType;
        docWithMeta._syncBound = false;

        // For documents with awareness, create and store awareness
        if (collabType === Types.Document && loadAwareness) {
          if (!awarenessMapRef.current[id]) {
            const awareness = new Awareness(doc);

            awarenessMapRef.current = { ...awarenessMapRef.current, [id]: awareness };
            setAwarenessMap((prev) => {
              if (prev[id]) {
                return prev;
              }

              return { ...prev, [id]: awareness };
            });
          }
        }

        return doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [service, currentWorkspaceId, getDatabaseId]
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
          viewId: docWithMeta.object_id,
        });
        return null;
      }

      const collabType = docWithMeta._collabType;
      const viewId = docWithMeta.object_id;

      // Use explicit undefined check for collabType since Types.Document = 0 is falsy
      if (collabType === undefined || !viewId) {
        console.warn('[useViewOperations] bindViewSync failed - missing metadata', {
          hasCollabType: collabType !== undefined,
          hasViewId: !!viewId,
        });
        return null;
      }

      // Get awareness for documents if available (use ref for stable callback)
      const awareness = collabType === Types.Document ? awarenessMapRef.current[viewId] : undefined;

      Log.debug('[useViewOperations] bindViewSync starting', {
        viewId,
        collabType,
        hasAwareness: !!awareness,
      });

      const syncContext = registerSyncContext({ doc, collabType, awareness });

      docWithMeta._syncBound = true;

      Log.debug('[useViewOperations] bindViewSync complete', {
        viewId,
        collabType,
      });

      return syncContext;
    },
    [registerSyncContext]
  );

  // Create row document
  const createRow = useCallback(
    async (rowKey: string): Promise<YDoc> => {
      if (!currentWorkspaceId || !service) {
        throw new Error('Failed to create row doc');
      }

      try {
        const doc = await service?.createRow(rowKey);

        if (!doc) {
          throw new Error('Failed to create row doc');
        }

        const [databaseId, rowId] = rowKey.split('_rows_');

        if (!rowId) {
          throw new Error('Failed to create row doc');
        }

        doc.guid = rowId;

        Log.debug('[Database] row sync bind start', {
          rowKey,
          rowId,
          databaseId,
        });
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
        service?.deleteRow(rowKey);
      } catch (e) {
        console.error(e);
      }
    });
  }, [service, currentWorkspaceId]); // Changed from viewId to currentWorkspaceId

  return {
    loadView,
    bindViewSync,
    createRow,
    toView,
    awarenessMap,
    getViewIdFromDatabaseId,
    getViewReadOnlyStatus,
  };
}
