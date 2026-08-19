import { db } from '@/application/db';
import { WorkspaceDatabaseCatalogRecord } from '@/application/db/tables/workspace_database_catalog';
import { getTokenParsed } from '@/application/session/token';
import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { View } from '@/application/types';
import { Log } from '@/utils/log';

import { listWorkspaceDatabases } from './http/view-api';

const ANONYMOUS_CATALOG_SCOPE = 'anonymous';
const refreshRequests = new Map<string, Promise<WorkspaceDatabaseWithViews[]>>();

function currentUserId(): string | undefined {
  return getTokenParsed()?.user?.id;
}

function requestKey(userId: string | undefined, workspaceId: string): string {
  return `${userId ?? ANONYMOUS_CATALOG_SCOPE}:${workspaceId}`;
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
  databases: WorkspaceDatabaseWithViews[]
): Promise<void> {
  const records = catalogRecords(userId, workspaceId, databases);

  await db.transaction('rw', db.workspace_database_catalog, async () => {
    await db.workspace_database_catalog.where('[user_id+workspace_id]').equals([userId, workspaceId]).delete();

    if (records.length > 0) {
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
  const pending = refreshRequests.get(key);

  if (pending) return pending;

  const request = (async () => {
    const databases = await listWorkspaceDatabases(workspaceId);

    if (userId) {
      try {
        await replaceCachedCatalog(userId, workspaceId, databases);
      } catch (error) {
        // IndexedDB is an optimization. Browser storage failures must not hide
        // a successful authoritative response from the caller.
        Log.warn('[WorkspaceDatabaseCatalog] failed to persist the server catalog', {
          userId,
          workspaceId,
          error,
        });
      }
    }

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

/** Resolve a database ID locally first, refreshing the server catalog on miss. */
export async function getDatabaseIdFromWorkspaceCatalog(workspaceId: string, viewId: string): Promise<string | null> {
  const cached = await cachedViewRecord(currentUserId(), workspaceId, viewId);

  if (cached) return cached.database_id;

  const databases = await refreshWorkspaceDatabaseCatalog(workspaceId);

  return databases.find((database) => database.views.some((view) => view.view_id === viewId))?.database_id ?? null;
}

/** Resolve the primary, non-container view used to open a database. */
export async function getViewIdFromWorkspaceCatalog(workspaceId: string, databaseId: string): Promise<string | null> {
  const cached = await cachedDatabaseRecords(currentUserId(), workspaceId, databaseId);

  if (cached.length > 0) {
    const cachedDatabase: WorkspaceDatabaseWithViews = {
      database_id: databaseId,
      views: cached.sort((left, right) => left.view_order - right.view_order).map((record) => record.view),
    };
    const cachedView = getDatabasePrimaryView(cachedDatabase);

    if (cachedView) return cachedView.view_id;
  }

  const databases = await refreshWorkspaceDatabaseCatalog(workspaceId);
  const database = databases.find((entry) => entry.database_id === databaseId);

  return database ? getDatabasePrimaryView(database)?.view_id ?? null : null;
}
