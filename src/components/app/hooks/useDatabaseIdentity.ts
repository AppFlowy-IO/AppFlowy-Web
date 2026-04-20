import { useCallback, useRef } from 'react';

import { DatabaseId, DatabaseRelations, Types, ViewId, YDoc } from '@/application/types';
import { getDatabaseIdFromDoc } from '@/application/view-loader';
import { Log } from '@/utils/log';

type UseDatabaseIdentityParams = {
  currentWorkspaceId?: string;
  /** Synchronous lookup: viewId → databaseId (from the cached reverse map). */
  getDatabaseIdForViewId?: (viewId: string) => string | undefined;
  /** Synchronous lookup: returns the cached DatabaseRelations map. */
  getCachedDatabaseRelations?: () => DatabaseRelations | undefined;
  /**
   * Async loader: ensures the database relations are fetched, returns the map.
   * Pass `forceRefresh=true` to bypass the workspace-level cache, which is
   * required when retrying a lookup after a cache miss — the cached snapshot
   * could have been warmed before a newly-created database existed, and the
   * HTTP endpoint has no push-update channel to invalidate it.
   */
  loadDatabaseRelations?: (forceRefresh?: boolean) => Promise<DatabaseRelations | undefined>;
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
 *
 * The mapping data comes from the server `GET /database-views` endpoint,
 * cached in `useWorkspaceData`.
 */
export function useDatabaseIdentity({
  currentWorkspaceId,
  getDatabaseIdForViewId,
  getCachedDatabaseRelations,
  loadDatabaseRelations,
}: UseDatabaseIdentityParams) {
  const databaseIdViewIdMapRef = useRef<Map<DatabaseId, ViewId>>(new Map());

  const resolveDatabaseIdForView = useCallback(
    async (viewId: string): Promise<string | null> => {
      if (!currentWorkspaceId) return null;

      // 1. Check URL params for database mappings (passed from template duplication)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const dbMappingsParam = urlParams.get('db_mappings');

        if (dbMappingsParam) {
          const dbMappings: Record<string, string[]> = JSON.parse(decodeURIComponent(dbMappingsParam));
          const storageKey = `db_mappings_${currentWorkspaceId}`;
          const existingMappings = JSON.parse(localStorage.getItem(storageKey) || '{}');
          const mergedMappings = { ...existingMappings, ...dbMappings };

          localStorage.setItem(storageKey, JSON.stringify(mergedMappings));

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

      // 2. Check localStorage for cached database mappings
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

      // 3. Primary: use cached reverse map from the /database-views endpoint
      const cachedId = getDatabaseIdForViewId?.(viewId);

      if (cachedId) {
        Log.debug('[useDatabaseIdentity] found databaseId from cached map', { viewId, databaseId: cachedId });
        return cachedId;
      }

      // 4. Cache miss: force a fresh fetch with retry.  The server populates
      // `af_folder_view.extra.database_id` via an event-driven backfill, so a
      // just-created database may not appear in the HTTP response immediately.
      // Retry up to 3 times with backoff (matching the old Yjs observer's
      // tolerance for propagation delay).
      if (loadDatabaseRelations) {
        const RETRY_DELAYS = [0, 2000, 3000, 5000]; // ~10s total, matching old Yjs observer timeout

        for (const delay of RETRY_DELAYS) {
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }

          await loadDatabaseRelations(true);
          const freshId = getDatabaseIdForViewId?.(viewId);

          if (freshId) {
            Log.debug('[useDatabaseIdentity] found databaseId after loading relations', { viewId, databaseId: freshId });
            return freshId;
          }
        }
      }

      console.warn('[useDatabaseIdentity] databaseId not found for view', { viewId });
      return null;
    },
    [currentWorkspaceId, getDatabaseIdForViewId, loadDatabaseRelations]
  );

  const getViewIdFromDatabaseId = useCallback(
    async (databaseId: string): Promise<string | null> => {
      if (!currentWorkspaceId) {
        return null;
      }

      // Check local cache first
      if (databaseIdViewIdMapRef.current.has(databaseId)) {
        return databaseIdViewIdMapRef.current.get(databaseId) || null;
      }

      // Try the cached relations map (database_id → primary view_id)
      const cached = getCachedDatabaseRelations?.();

      if (cached?.[databaseId]) {
        databaseIdViewIdMapRef.current.set(databaseId, cached[databaseId]);
        return cached[databaseId];
      }

      // Cache miss: force-refresh with retry to tolerate the event-driven
      // backfill propagation delay on the server.
      if (loadDatabaseRelations) {
        const RETRY_DELAYS = [0, 1500, 3000];

        for (const delay of RETRY_DELAYS) {
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }

          const fresh = await loadDatabaseRelations(true);

          if (fresh?.[databaseId]) {
            databaseIdViewIdMapRef.current.set(databaseId, fresh[databaseId]);
            return fresh[databaseId];
          }
        }
      }

      return null;
    },
    [currentWorkspaceId, getCachedDatabaseRelations, loadDatabaseRelations]
  );

  const resolveCollabObjectId = useCallback(
    async (doc: YDoc, viewId: string, collabType: Types): Promise<string> => {
      if (collabType !== Types.Database) {
        return viewId;
      }

      // First try getting databaseId directly from the doc (fast, synchronous).
      let databaseId = getDatabaseIdFromDoc(doc);

      if (databaseId) {
        Log.debug('[useDatabaseIdentity] databaseId loaded from Yjs document', {
          viewId,
          databaseId,
        });
      } else {
        // Fallback to server-side mapping lookup.
        databaseId = await resolveDatabaseIdForView(viewId);
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
    [resolveDatabaseIdForView]
  );

  return {
    resolveCollabObjectId,
    getViewIdFromDatabaseId,
  };
}
