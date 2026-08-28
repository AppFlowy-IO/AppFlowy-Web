import { useCallback } from 'react';

import { getDatabaseIdFromWorkspaceCatalog, getViewIdFromWorkspaceCatalog } from '@/application/services/domains/view';
import { DatabaseId, DatabaseRelations, Types, ViewId, YDoc } from '@/application/types';
import { getDatabaseIdFromDoc } from '@/application/view-loader';
import { Log } from '@/utils/log';

type UseDatabaseIdentityParams = {
  currentWorkspaceId?: string;
  loadDatabaseRelations?: (options?: { refresh?: boolean }) => Promise<DatabaseRelations | undefined>;
};

type DatabaseMappings = Record<DatabaseId, ViewId[]>;

const LEGACY_RELATION_LOOKUP_MISS_TTL_MS = 30 * 1000;

type LegacyRelationLookupState = {
  misses: Map<DatabaseId, number>;
  pending: Map<DatabaseId, Promise<ViewId | null>>;
};

// `loadDatabaseRelations` is owned by the mounted workspace layer. Keying the
// compatibility cache by that function shares work across every database
// consumer while allowing the entire scope to be garbage-collected when the
// workspace/session owner is replaced.
const legacyRelationLookupStates = new WeakMap<
  NonNullable<UseDatabaseIdentityParams['loadDatabaseRelations']>,
  LegacyRelationLookupState
>();

function resolveLegacyRelationViewId(
  loadDatabaseRelations: NonNullable<UseDatabaseIdentityParams['loadDatabaseRelations']>,
  databaseId: DatabaseId
): Promise<ViewId | null> {
  const existingState = legacyRelationLookupStates.get(loadDatabaseRelations);
  const state: LegacyRelationLookupState = existingState ?? { misses: new Map(), pending: new Map() };

  if (!existingState) {
    legacyRelationLookupStates.set(loadDatabaseRelations, state);
  }

  const retryAt = state.misses.get(databaseId);

  if (retryAt !== undefined) {
    if (retryAt > Date.now()) return Promise.resolve(null);
    state.misses.delete(databaseId);
  }

  const pending = state.pending.get(databaseId);

  if (pending) return pending;

  const request = (async () => {
    let databaseRelations = await loadDatabaseRelations();
    let relatedViewId = databaseRelations?.[databaseId];

    if (!relatedViewId && databaseRelations) {
      databaseRelations = await loadDatabaseRelations({ refresh: true });
      relatedViewId = databaseRelations?.[databaseId];
    }

    if (relatedViewId) {
      state.misses.delete(databaseId);
      return relatedViewId;
    }

    state.misses.set(databaseId, Date.now() + LEGACY_RELATION_LOOKUP_MISS_TTL_MS);
    return null;
  })()
    .catch((error: unknown) => {
      state.misses.set(databaseId, Date.now() + LEGACY_RELATION_LOOKUP_MISS_TTL_MS);
      throw error;
    })
    .finally(() => {
      if (state.pending.get(databaseId) === request) {
        state.pending.delete(databaseId);
      }
    });

  state.pending.set(databaseId, request);
  return request;
}

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
export function useDatabaseIdentity({ currentWorkspaceId, loadDatabaseRelations }: UseDatabaseIdentityParams) {
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
        const catalogViewId = await getViewIdFromWorkspaceCatalog(currentWorkspaceId, databaseId);

        if (catalogViewId) {
          return catalogViewId;
        }
      } catch (error) {
        Log.warn('[useDatabaseIdentity] failed to resolve a database view from the workspace catalog', {
          workspaceId: currentWorkspaceId,
          databaseId,
          error,
        });
      }

      // Legacy and recently duplicated workspaces can have a complete
      // WorkspaceDatabase collab before the server's folder projection has
      // been backfilled. Keep that metadata as a compatibility fallback so a
      // catalog miss does not get presented to the user as an access failure.
      if (loadDatabaseRelations) {
        try {
          const relatedViewId = await resolveLegacyRelationViewId(loadDatabaseRelations, databaseId);

          if (relatedViewId) {
            Log.debug('[useDatabaseIdentity] found viewId from workspace relation metadata', {
              databaseId,
              viewId: relatedViewId,
            });
            return relatedViewId;
          }
        } catch (error) {
          Log.warn('[useDatabaseIdentity] failed to load workspace relation metadata', {
            workspaceId: currentWorkspaceId,
            databaseId,
            error,
          });
        }
      }

      return null;
    },
    [currentWorkspaceId, loadDatabaseRelations]
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
