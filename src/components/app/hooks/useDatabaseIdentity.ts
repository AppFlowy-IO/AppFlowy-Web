import { useCallback } from 'react';

import { getDatabaseIdFromWorkspaceCatalog, getViewIdFromWorkspaceCatalog } from '@/application/services/domains/view';
import { DatabaseId, Types, ViewId, YDoc } from '@/application/types';
import { getDatabaseIdFromDoc } from '@/application/view-loader';
import { Log } from '@/utils/log';

type UseDatabaseIdentityParams = {
  currentWorkspaceId?: string;
};

type DatabaseMappings = Record<DatabaseId, ViewId[]>;

function parseDatabaseMappings(value: string): DatabaseMappings {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [DatabaseId, ViewId[]] =>
        Array.isArray(entry[1]) && entry[1].every((viewId) => typeof viewId === 'string')
    )
  );
}

function getTemplateDatabaseMappings(workspaceId: string): DatabaseMappings {
  const storageKey = `db_mappings_${workspaceId}`;
  let storedMappings: DatabaseMappings = {};

  try {
    const cachedMappings = localStorage.getItem(storageKey);

    if (cachedMappings) {
      storedMappings = parseDatabaseMappings(cachedMappings);
    }
  } catch (e) {
    console.warn('[useDatabaseIdentity] failed to read db_mappings from localStorage', e);
  }

  let urlMappings: DatabaseMappings;

  try {
    const dbMappingsParam = new URLSearchParams(window.location.search).get('db_mappings');

    if (!dbMappingsParam) {
      return storedMappings;
    }

    urlMappings = parseDatabaseMappings(dbMappingsParam);
  } catch (e) {
    console.warn('[useDatabaseIdentity] failed to parse db_mappings from URL', e);
    return storedMappings;
  }

  const mergedMappings = { ...storedMappings, ...urlMappings };

  try {
    localStorage.setItem(storageKey, JSON.stringify(mergedMappings));
    Log.debug('[useDatabaseIdentity] stored db_mappings to localStorage', mergedMappings);
  } catch (e) {
    // URL mappings are the authoritative source for this navigation. Storage
    // persistence is best-effort and must not break relation rendering when
    // localStorage is unavailable or full.
    console.warn('[useDatabaseIdentity] failed to persist db_mappings to localStorage', e);
  }

  return mergedMappings;
}

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
export function useDatabaseIdentity({ currentWorkspaceId }: UseDatabaseIdentityParams) {
  const getDatabaseIdForViewId = useCallback(
    async (viewId: string) => {
      if (!currentWorkspaceId) return;

      // Template duplication mappings are available immediately and persist
      // across reloads, so prefer them over waiting for workspace sync.
      const databaseMappings = getTemplateDatabaseMappings(currentWorkspaceId);

      for (const [databaseId, viewIds] of Object.entries(databaseMappings)) {
        if (viewIds.includes(viewId)) {
          Log.debug('[useDatabaseIdentity] found databaseId from template mappings', { viewId, databaseId });
          return databaseId;
        }
      }

      try {
        return await getDatabaseIdFromWorkspaceCatalog(currentWorkspaceId, viewId);
      } catch (error) {
        Log.warn('[useDatabaseIdentity] failed to resolve a database ID from the workspace catalog', {
          workspaceId: currentWorkspaceId,
          viewId,
          error,
        });
        return null;
      }
    },
    [currentWorkspaceId]
  );

  const getViewIdFromDatabaseId = useCallback(
    async (databaseId: string) => {
      if (!currentWorkspaceId) {
        return null;
      }

      const mappedViewId = getTemplateDatabaseMappings(currentWorkspaceId)[databaseId]?.[0];

      if (mappedViewId) {
        Log.debug('[useDatabaseIdentity] found viewId from template mappings', { databaseId, viewId: mappedViewId });
        return mappedViewId;
      }

      try {
        return await getViewIdFromWorkspaceCatalog(currentWorkspaceId, databaseId);
      } catch (error) {
        Log.warn('[useDatabaseIdentity] failed to resolve a database view from the workspace catalog', {
          workspaceId: currentWorkspaceId,
          databaseId,
          error,
        });
        return null;
      }
    },
    [currentWorkspaceId]
  );

  const resolveCollabObjectId = useCallback(
    async (
      doc: YDoc,
      viewId: string,
      collabType: Types,
      options?: { databaseIdHint?: string | null; updateDocGuid?: boolean }
    ): Promise<string> => {
      if (collabType !== Types.Database) {
        return viewId;
      }

      const databaseIdHint = options?.databaseIdHint;

      // First try getting databaseId directly from the doc (fast, synchronous).
      // This works for newly created embedded databases where the doc already has the ID.
      let databaseId = databaseIdHint || getDatabaseIdFromDoc(doc);

      if (databaseId) {
        Log.debug('[useDatabaseIdentity] databaseId resolved for view', {
          viewId,
          databaseId,
          source: databaseIdHint ? 'hint' : 'doc',
        });
      } else {
        // Fall back to the IndexedDB-backed workspace database catalog.
        databaseId = (await getDatabaseIdForViewId(viewId)) ?? null;
      }

      if (!databaseId) {
        throw new Error('Database not found');
      }

      // Database views (grid/board/calendar, etc.) share one underlying database collab object.
      // Use databaseId as guid so all layouts attach to the same sync channel and cache entry.
      if (options?.updateDocGuid !== false) {
        doc.guid = databaseId;
      }

      return databaseId;
    },
    [getDatabaseIdForViewId]
  );

  return {
    getDatabaseIdForViewId,
    resolveCollabObjectId,
    getViewIdFromDatabaseId,
  };
}
