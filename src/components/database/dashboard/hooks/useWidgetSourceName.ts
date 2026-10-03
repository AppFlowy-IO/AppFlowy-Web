import { useContext, useEffect, useState } from 'react';

import { isDatabaseContainer } from '@/application/view-utils';

import { DashboardSourcesContext } from '../DashboardContext';
import { DashboardHostContext, DashboardHostServices } from '../DashboardUiContext';

// The page each database is named after, per workspace: every widget of a
// database, and every hover, reuses one lookup. Only lookups that led to a
// name stay cached; the name itself is read from the page again every time,
// so a renamed database shows its new name on the next hover.
const namePagesByWorkspace = new Map<string, Map<string, Promise<string | null>>>();

type NameServices = Required<Pick<DashboardHostServices, 'loadViewMeta' | 'getViewIdFromDatabaseId'>>;

function namePagesOf(workspaceId: string) {
  let pages = namePagesByWorkspace.get(workspaceId);

  if (!pages) {
    pages = new Map();
    namePagesByWorkspace.set(workspaceId, pages);
  }

  return pages;
}

/**
 * The database's name: its container page's when it has one, else the page
 * of its first view. `null` when it cannot be told. A lookup that failed or
 * found no name is forgotten, so the next request tries again.
 */
async function lookupSourceName(workspaceId: string, databaseId: string, services: NameServices) {
  const pages = namePagesOf(workspaceId);
  const cached = pages.get(databaseId);
  const page = cached ?? services.getViewIdFromDatabaseId(databaseId);

  if (!cached) pages.set(databaseId, page);
  const forget = () => {
    if (pages.get(databaseId) === page) pages.delete(databaseId);
  };

  try {
    const viewId = await page;
    const view = viewId ? await services.loadViewMeta(viewId) : null;
    const parentId = view?.parent_view_id;
    const parent = parentId ? await services.loadViewMeta(parentId).catch(() => null) : null;
    const name = (isDatabaseContainer(parent) ? parent.name : view?.name)?.trim() || null;

    if (!name) forget();
    return name;
  } catch {
    forget();
    return null;
  }
}

/**
 * Display name of a widget's source database, for the title's breadcrumb
 * tooltip and the Source row of the settings host. The dashboard's source
 * registry knows most names already; any other is looked up whenever
 * `enabled` turns on (the tooltip or the host opened). `null` while unknown,
 * in which case the tooltip shows the view line alone.
 */
export function useWidgetSourceName(databaseId: string, enabled: boolean) {
  const sources = useContext(DashboardSourcesContext);
  const host = useContext(DashboardHostContext);
  const registered = sources?.sourceNames[databaseId] ?? null;
  const [loaded, setLoaded] = useState<{ databaseId: string; name: string | null } | null>(null);
  const workspaceId = host?.workspaceId ?? '';
  const loadViewMeta = host?.loadViewMeta;
  const getViewIdFromDatabaseId = host?.getViewIdFromDatabaseId;

  useEffect(() => {
    if (!enabled || registered || !databaseId || !loadViewMeta || !getViewIdFromDatabaseId) return;
    let cancelled = false;

    void lookupSourceName(workspaceId, databaseId, { loadViewMeta, getViewIdFromDatabaseId }).then((name) => {
      if (!cancelled) setLoaded({ databaseId, name });
    });
    return () => {
      cancelled = true;
    };
  }, [databaseId, enabled, getViewIdFromDatabaseId, loadViewMeta, registered, workspaceId]);

  return registered ?? (loaded?.databaseId === databaseId ? loaded.name : null);
}
