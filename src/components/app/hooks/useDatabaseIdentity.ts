import { useCallback, useRef } from 'react';

import { openCollabDB } from '@/application/db';
import { DatabaseId, Types, ViewId, YDoc, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromDoc } from '@/application/view-loader';
import type { SyncContextType } from '@/components/ws/useSync';
import { Log } from '@/utils/log';

type UseDatabaseIdentityParams = {
  currentWorkspaceId?: string;
  databaseStorageId?: string;
  registerSyncContext: SyncContextType['registerSyncContext'];
};

/**
 * Encapsulates database-specific collab identity mapping.
 *
 * View domain code uses:
 * - `viewId` as route/render identity
 * - `objectId` as sync/persistence identity
 *
 * For database layouts those two differ:
 * - `viewId` = database-view id (grid/board/calendar layout)
 * - `objectId` = shared database id
 */
export function useDatabaseIdentity({
  currentWorkspaceId,
  databaseStorageId,
  registerSyncContext,
}: UseDatabaseIdentityParams) {
  const workspaceDatabaseDocMapRef = useRef<Map<string, YDoc>>(new Map());
  const databaseIdViewIdMapRef = useRef<Map<DatabaseId, ViewId>>(new Map());

  const registerWorkspaceDatabaseDoc = useCallback(
    async (workspaceId: string, workspaceDatabaseStorageId: string) => {
      const doc = await openCollabDB(workspaceDatabaseStorageId);

      // Workspace-database sync is keyed by `databaseStorageId` (not workspaceId).
      // Keep guid aligned with the collab object id used by providers and sync routing.
      doc.guid = workspaceDatabaseStorageId;
      const { doc: workspaceDatabaseDoc } = registerSyncContext({
        doc,
        collabType: Types.WorkspaceDatabase,
      });

      workspaceDatabaseDocMapRef.current.clear();
      workspaceDatabaseDocMapRef.current.set(workspaceId, workspaceDatabaseDoc);
    },
    [registerSyncContext]
  );

  const getDatabaseIdForViewId = useCallback(
    async (viewId: string) => {
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
          Log.debug('[useDatabaseIdentity] stored db_mappings to localStorage', mergedMappings);

          // Find the database ID that contains this view
          for (const [databaseId, viewIds] of Object.entries(dbMappings)) {
            if (viewIds.includes(viewId)) {
              Log.debug('[useDatabaseIdentity] found databaseId from URL params', { viewId, databaseId });
              return databaseId;
            }
          }
        }
      } catch (e) {
        console.warn('[useDatabaseIdentity] failed to parse db_mappings from URL', e);
      }

      // Check localStorage for cached database mappings (persists across page refreshes)
      try {
        const storageKey = `db_mappings_${currentWorkspaceId}`;
        const cachedMappings = localStorage.getItem(storageKey);

        if (cachedMappings) {
          const dbMappings: Record<string, string[]> = JSON.parse(cachedMappings);

          for (const [databaseId, viewIds] of Object.entries(dbMappings)) {
            if (viewIds.includes(viewId)) {
              Log.debug('[useDatabaseIdentity] found databaseId from localStorage', { viewId, databaseId });
              return databaseId;
            }
          }
        }
      } catch (e) {
        console.warn('[useDatabaseIdentity] failed to read db_mappings from localStorage', e);
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
            database.views.find((view) => view === viewId)
          )?.database_id;

          if (databaseId) {
            resolved = true;
            Log.debug('[useDatabaseIdentity] mapped view to database', { viewId, databaseId });
            cleanup();
            resolve(databaseId);
            return;
          }

          // Only log warning once, not on every observe event
          if (!warningLogged) {
            warningLogged = true;
            Log.debug('[useDatabaseIdentity] databaseId not found for view yet, waiting for sync', { viewId });
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
            console.warn('[useDatabaseIdentity] databaseId lookup timed out for view', { viewId });
            resolve(null);
          }
        }, 10000); // 10 second timeout
      });
    },
    [currentWorkspaceId, databaseStorageId, registerWorkspaceDatabaseDoc]
  );

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

  const resolveCollabObjectId = useCallback(
    async (doc: YDoc, viewId: string, collabType: Types): Promise<string> => {
      if (collabType !== Types.Database) {
        return viewId;
      }

      // First try getting databaseId directly from the doc (fast, synchronous).
      // This works for newly created embedded databases where the doc already has the ID.
      let databaseId = getDatabaseIdFromDoc(doc);

      if (databaseId) {
        Log.debug('[useDatabaseIdentity] databaseId loaded from Yjs document', {
          viewId,
          databaseId,
        });
      } else {
        // Fallback to workspace database mapping lookup (async, may timeout).
        databaseId = (await getDatabaseIdForViewId(viewId)) ?? null;
      }

      if (!databaseId) {
        throw new Error('Database not found');
      }

      databaseIdViewIdMapRef.current.set(databaseId, viewId);

      // Database views (grid/board/calendar, etc.) share one underlying database collab object.
      // Use databaseId as guid so all layouts attach to the same sync channel and cache entry.
      doc.guid = databaseId;
      return databaseId;
    },
    [getDatabaseIdForViewId]
  );

  return {
    resolveCollabObjectId,
    getViewIdFromDatabaseId,
  };
}
