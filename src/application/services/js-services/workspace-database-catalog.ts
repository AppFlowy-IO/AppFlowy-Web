import { db } from '@/application/db';
import { WorkspaceDatabaseCatalogRecord } from '@/application/db/tables/workspace_database_catalog';
import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { EventType, on } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';
import { View } from '@/application/types';
import { Log } from '@/utils/log';

import { listWorkspaceDatabases } from './http/view-api';

const ANONYMOUS_CATALOG_SCOPE = 'anonymous';
const refreshRequests = new Map<string, Promise<WorkspaceDatabaseWithViews[]>>();
const successfulRefreshes = new Map<string, WorkspaceDatabaseWithViews[]>();
const catalogGenerations = new Map<string, number>();
const invalidatedCatalogs = new Set<string>();
let sessionGeneration = 0;

on(EventType.SESSION_INVALID, () => {
  sessionGeneration += 1;
  refreshRequests.clear();
  successfulRefreshes.clear();
  catalogGenerations.clear();
  invalidatedCatalogs.clear();
});

function currentUserId(): string | undefined {
  return getTokenParsed()?.user?.id;
}

function requestKey(userId: string | undefined, workspaceId: string): string {
  return `${userId ?? ANONYMOUS_CATALOG_SCOPE}:${workspaceId}`;
}

function getSuccessfulRefresh(userId: string | undefined, workspaceId: string) {
  return successfulRefreshes.get(requestKey(userId, workspaceId));
}

function sessionChangedError(): DOMException {
  return new DOMException('The workspace database catalog request was superseded by a session change', 'AbortError');
}

function isSameSession(requestSessionGeneration: number, userId: string | undefined): boolean {
  return sessionGeneration === requestSessionGeneration && currentUserId() === userId;
}

/** Mark the shared snapshot stale after a remote or local catalog mutation. */
export function invalidateWorkspaceDatabaseCatalog(workspaceId: string): void {
  const key = requestKey(currentUserId(), workspaceId);

  catalogGenerations.set(key, (catalogGenerations.get(key) ?? 0) + 1);
  invalidatedCatalogs.add(key);
  successfulRefreshes.delete(key);
  // A response started before the invalidation must not be shared by the next
  // reader. Its captured generation also prevents it from repopulating the
  // memory or IndexedDB snapshots when it eventually settles.
  refreshRequests.delete(key);
}

function catalogRecords(
  userId: string,
  workspaceId: string,
  databases: WorkspaceDatabaseWithViews[]
): WorkspaceDatabaseCatalogRecord[] {
  const updatedAt = Date.now();

  return databases.flatMap((database, databaseOrder) =>
    database.views.map((view, viewOrder) => ({
      user_id: userId,
      workspace_id: workspaceId,
      database_id: database.database_id,
      view_id: view.view_id,
      database_order: databaseOrder,
      view_order: viewOrder,
      view,
      updated_at: updatedAt,
    }))
  );
}

async function replaceCachedCatalog(
  userId: string,
  workspaceId: string,
  databases: WorkspaceDatabaseWithViews[],
  isCurrent: () => boolean
): Promise<void> {
  const records = catalogRecords(userId, workspaceId, databases);

  await db.transaction('rw', db.workspace_database_catalog, async () => {
    if (!isCurrent()) return;

    await db.workspace_database_catalog.where('[user_id+workspace_id]').equals([userId, workspaceId]).delete();

    if (records.length > 0 && isCurrent()) {
      await db.workspace_database_catalog.bulkPut(records);
    }
  });
}

async function cachedViewRecord(
  userId: string | undefined,
  workspaceId: string,
  viewId: string
): Promise<WorkspaceDatabaseCatalogRecord | undefined> {
  if (!userId) return undefined;

  try {
    return await db.workspace_database_catalog.get([userId, workspaceId, viewId]);
  } catch (error) {
    Log.warn('[WorkspaceDatabaseCatalog] failed to read a view mapping from IndexedDB', {
      userId,
      workspaceId,
      viewId,
      error,
    });
    return undefined;
  }
}

async function cachedDatabaseRecords(
  userId: string | undefined,
  workspaceId: string,
  databaseId: string
): Promise<WorkspaceDatabaseCatalogRecord[]> {
  if (!userId) return [];

  try {
    return await db.workspace_database_catalog
      .where('[user_id+workspace_id+database_id]')
      .equals([userId, workspaceId, databaseId])
      .toArray();
  } catch (error) {
    Log.warn('[WorkspaceDatabaseCatalog] failed to read database mappings from IndexedDB', {
      userId,
      workspaceId,
      databaseId,
      error,
    });
    return [];
  }
}

export function getDatabaseContainerView(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return database.views.find((view) => view.is_container);
}

export function getDatabasePrimaryView(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return (
    database.views.find((view) => !view.is_container && !view.embedded) ??
    database.views.find((view) => !view.is_container)
  );
}

export interface DatabaseContainerCatalogEntry {
  databaseId: string;
  container: WorkspaceDatabaseViewItem;
  primaryView: WorkspaceDatabaseViewItem;
}

/** Return exactly one selectable container for each complete database. */
export function getDatabaseContainerEntries(databases: WorkspaceDatabaseWithViews[]): DatabaseContainerCatalogEntry[] {
  return databases.flatMap((database) => {
    const container = getDatabaseContainerView(database);
    const primaryView = getDatabasePrimaryView(database);

    return container && primaryView ? [{ databaseId: database.database_id, container, primaryView }] : [];
  });
}

export function databaseCatalogViewToView(databaseId: string, view: WorkspaceDatabaseViewItem): View {
  return {
    view_id: view.view_id,
    name: view.name,
    icon: view.icon,
    layout: view.layout,
    extra: {
      database_id: databaseId,
      embedded: view.embedded,
      is_database_container: view.is_container,
      is_space: false,
    },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id: view.parent_view_id ?? undefined,
  };
}

/**
 * Refresh the complete server catalog and atomically replace its IndexedDB
 * snapshot. Web has no offline database creation, so the server response is
 * authoritative; local data is only a lookup cache and is never merged into it.
 */
export async function refreshWorkspaceDatabaseCatalog(workspaceId: string): Promise<WorkspaceDatabaseWithViews[]> {
  const userId = currentUserId();
  const key = requestKey(userId, workspaceId);
  const requestSessionGeneration = sessionGeneration;
  const requestCatalogGeneration = catalogGenerations.get(key) ?? 0;
  const pending = refreshRequests.get(key);

  if (pending) return pending;

  const request = (async () => {
    const isSessionCurrent = () => isSameSession(requestSessionGeneration, userId);
    const isCurrent = () =>
      isSessionCurrent() && (catalogGenerations.get(key) ?? 0) === requestCatalogGeneration;
    const useReplacementCatalog = () => {
      // Catalog invalidations within the same signed-in session may join the
      // replacement request. A session transition belongs to a different
      // principal, so the old caller must terminate instead of starting or
      // receiving a request under the new session.
      if (!isSessionCurrent()) throw sessionChangedError();
      return getWorkspaceDatabaseCatalog(workspaceId);
    };

    let databases: WorkspaceDatabaseWithViews[];

    try {
      databases = await listWorkspaceDatabases(workspaceId);
    } catch (error) {
      if (!isCurrent()) return useReplacementCatalog();
      throw error;
    }

    if (!isCurrent()) return useReplacementCatalog();

    if (userId) {
      try {
        await replaceCachedCatalog(userId, workspaceId, databases, isCurrent);
      } catch (error) {
        if (!isCurrent()) return useReplacementCatalog();
        // IndexedDB is an optimization. Browser storage failures must not hide
        // a successful authoritative response from the caller.
        Log.warn('[WorkspaceDatabaseCatalog] failed to persist the server catalog', {
          userId,
          workspaceId,
          error,
        });
      }
    }

    // Persistence is asynchronous; re-check after it settles so an
    // invalidation that arrived mid-transaction cannot publish the old list.
    if (!isCurrent()) return useReplacementCatalog();

    // Keep the complete successful response so every workspace consumer shares
    // positive and negative lookup results. IndexedDB stores positive view
    // mappings, but cannot represent that a database or view was absent from a
    // catalog snapshot. Explicit refreshes replace this object atomically.
    successfulRefreshes.set(key, databases);
    invalidatedCatalogs.delete(key);

    return databases;
  })();

  refreshRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (refreshRequests.get(key) === request) {
      refreshRequests.delete(key);
    }
  }
}

/**
 * Return the shared workspace catalog snapshot, refreshing it only when no
 * successful snapshot exists. Every consumer receives the same array object,
 * so relation cells, property menus, and linked-database pickers do not independently
 * request the workspace-wide list. Call `refreshWorkspaceDatabaseCatalog`
 * explicitly after a catalog-changing mutation or permission change.
 */
export async function getWorkspaceDatabaseCatalog(workspaceId: string): Promise<WorkspaceDatabaseWithViews[]> {
  return getSuccessfulRefresh(currentUserId(), workspaceId) ?? refreshWorkspaceDatabaseCatalog(workspaceId);
}

/** Resolve a database ID from the shared snapshot or its positive disk cache. */
export async function getDatabaseIdFromWorkspaceCatalog(workspaceId: string, viewId: string): Promise<string | null> {
  const userId = currentUserId();
  const key = requestKey(userId, workspaceId);
  const requestSessionGeneration = sessionGeneration;
  const requestCatalogGeneration = catalogGenerations.get(key) ?? 0;
  const catalogSnapshot = getSuccessfulRefresh(userId, workspaceId);

  if (catalogSnapshot) {
    return (
      catalogSnapshot.find((database) => database.views.some((view) => view.view_id === viewId))?.database_id ?? null
    );
  }

  const cached = invalidatedCatalogs.has(key) ? undefined : await cachedViewRecord(userId, workspaceId, viewId);

  if (!isSameSession(requestSessionGeneration, userId)) throw sessionChangedError();

  const cachedMappingIsCurrent =
    !invalidatedCatalogs.has(key) && (catalogGenerations.get(key) ?? 0) === requestCatalogGeneration;

  if (cached && cachedMappingIsCurrent) return cached.database_id;

  const databases = await getWorkspaceDatabaseCatalog(workspaceId);

  if (!isSameSession(requestSessionGeneration, userId)) throw sessionChangedError();

  return databases.find((database) => database.views.some((view) => view.view_id === viewId))?.database_id ?? null;
}

/** Resolve the primary, non-container view used to open a database. */
export async function getViewIdFromWorkspaceCatalog(workspaceId: string, databaseId: string): Promise<string | null> {
  const userId = currentUserId();
  const key = requestKey(userId, workspaceId);
  const requestSessionGeneration = sessionGeneration;
  const requestCatalogGeneration = catalogGenerations.get(key) ?? 0;
  const catalogSnapshot = getSuccessfulRefresh(userId, workspaceId);

  if (catalogSnapshot) {
    const database = catalogSnapshot.find((entry) => entry.database_id === databaseId);

    return database ? getDatabasePrimaryView(database)?.view_id ?? null : null;
  }

  const cached = invalidatedCatalogs.has(key) ? [] : await cachedDatabaseRecords(userId, workspaceId, databaseId);

  if (!isSameSession(requestSessionGeneration, userId)) throw sessionChangedError();

  const cachedMappingIsCurrent =
    !invalidatedCatalogs.has(key) && (catalogGenerations.get(key) ?? 0) === requestCatalogGeneration;

  if (cached.length > 0 && cachedMappingIsCurrent) {
    const cachedDatabase: WorkspaceDatabaseWithViews = {
      database_id: databaseId,
      views: cached.sort((left, right) => left.view_order - right.view_order).map((record) => record.view),
    };
    const cachedView = getDatabasePrimaryView(cachedDatabase);

    if (cachedView) return cachedView.view_id;
  }

  const databases = await getWorkspaceDatabaseCatalog(workspaceId);

  if (!isSameSession(requestSessionGeneration, userId)) throw sessionChangedError();
  const database = databases.find((entry) => entry.database_id === databaseId);

  return database ? getDatabasePrimaryView(database)?.view_id ?? null : null;
}
