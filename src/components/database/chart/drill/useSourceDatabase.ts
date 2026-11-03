import { useCallback, useContext, useEffect, useState } from 'react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { View, YjsDatabaseKey } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { DashboardSourcesContext } from '@/components/database/dashboard/DashboardContext';

export interface SourceDatabasePage {
  /** The page "Open {database}" navigates to: the database container, else its first view. */
  viewId: string;
  name: string | null;
}

type LookupServices = {
  getViewIdFromDatabaseId: (databaseId: string) => Promise<string | null>;
  loadViewMeta: (viewId: string) => Promise<View | null>;
};

// One lookup per database: every drill-down of a database reuses it. A lookup
// that failed or found nothing is forgotten, so the next open tries again.
const sourcePages = new Map<string, Promise<SourceDatabasePage | null>>();

async function lookupSourcePage(databaseId: string, services: LookupServices): Promise<SourceDatabasePage | null> {
  const viewId = await services.getViewIdFromDatabaseId(databaseId);

  if (!viewId) return null;
  const view = await services.loadViewMeta(viewId).catch(() => null);
  const parentId = view?.parent_view_id;
  const parent = parentId ? await services.loadViewMeta(parentId).catch(() => null) : null;

  if (isDatabaseContainer(parent)) return { viewId: parent.view_id, name: parent.name?.trim() || null };
  if (isDatabaseContainer(view)) return { viewId: view.view_id, name: view.name?.trim() || null };
  return { viewId, name: view?.name?.trim() || null };
}

function cachedSourcePage(databaseId: string, services: LookupServices) {
  const cached = sourcePages.get(databaseId);

  if (cached) return cached;
  const page = lookupSourcePage(databaseId, services).catch(() => null);

  sourcePages.set(databaseId, page);
  void page.then((result) => {
    if (!result && sourcePages.get(databaseId) === page) sourcePages.delete(databaseId);
  });
  return page;
}

/** For tests: forget every looked-up page. */
export function resetSourceDatabaseCache() {
  sourcePages.clear();
}

/**
 * The drill's source database for "Open {database}" (WP13 §3.7): its name
 * (the dashboard's registered source name, else the container page's) and an
 * opener that navigates to its container view. `fallbackName` (the widget or
 * view name) labels the item while the name is unresolved.
 */
export function useSourceDatabase(fallbackName: string) {
  const database = useDatabase();
  const { getViewIdFromDatabaseId, loadViewMeta, navigateToView } = useDatabaseContext();
  const databaseId = String(database?.get(YjsDatabaseKey.id) ?? '');
  const registered = useContext(DashboardSourcesContext)?.sourceNames[databaseId] || null;
  const [page, setPage] = useState<{ databaseId: string; page: SourceDatabasePage | null } | null>(null);

  useEffect(() => {
    if (!databaseId || !getViewIdFromDatabaseId || !loadViewMeta) return;
    let cancelled = false;

    void cachedSourcePage(databaseId, { getViewIdFromDatabaseId, loadViewMeta }).then((result) => {
      if (!cancelled) setPage({ databaseId, page: result });
    });
    return () => {
      cancelled = true;
    };
  }, [databaseId, getViewIdFromDatabaseId, loadViewMeta]);

  const resolved = page?.databaseId === databaseId ? page.page : null;
  const open = useCallback(async () => {
    if (!databaseId || !navigateToView) return;
    const target =
      resolved ??
      (getViewIdFromDatabaseId && loadViewMeta
        ? await cachedSourcePage(databaseId, { getViewIdFromDatabaseId, loadViewMeta })
        : null);

    if (target) await navigateToView(target.viewId);
  }, [databaseId, getViewIdFromDatabaseId, loadViewMeta, navigateToView, resolved]);

  return {
    databaseId,
    /** The container view once looked up: the parent of a view saved from the drill-down. */
    containerViewId: resolved?.viewId ?? null,
    name: registered || resolved?.name || fallbackName,
    canOpen: Boolean(databaseId && navigateToView && getViewIdFromDatabaseId),
    open,
  };
}
