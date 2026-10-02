import { useContext, useEffect, useState } from 'react';

import { isDatabaseContainer } from '@/application/view-utils';

import { DashboardSourcesContext } from '../DashboardContext';
import { DashboardHostContext } from '../DashboardUiContext';

// Database names looked up for the breadcrumb tooltip, per workspace: every
// widget of a database, and every hover, reuses one lookup.
const namesByWorkspace = new Map<string, Map<string, Promise<string | null>>>();

/**
 * Display name of a widget's source database, for the title's breadcrumb
 * tooltip. The dashboard's source registry knows most names already; any
 * other is looked up once `enabled` (the tooltip opened): the database's
 * container page when it has one, else the page of its first view. `null`
 * while unknown, in which case the tooltip shows the view line alone.
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
    let names = namesByWorkspace.get(workspaceId);

    if (!names) {
      names = new Map();
      namesByWorkspace.set(workspaceId, names);
    }

    let lookup = names.get(databaseId);

    if (!lookup) {
      lookup = (async () => {
        const viewId = await getViewIdFromDatabaseId(databaseId);

        if (!viewId) return null;
        const view = await loadViewMeta(viewId);
        const parentId = view?.parent_view_id;
        const parent = parentId ? await loadViewMeta(parentId).catch(() => null) : null;

        return (isDatabaseContainer(parent) ? parent.name : view?.name)?.trim() || null;
      })().catch(() => null);
      names.set(databaseId, lookup);
    }

    void lookup.then((name) => {
      if (!cancelled) setLoaded({ databaseId, name });
    });
    return () => {
      cancelled = true;
    };
  }, [databaseId, enabled, getViewIdFromDatabaseId, loadViewMeta, registered, workspaceId]);

  return registered ?? (loaded?.databaseId === databaseId ? loaded.name : null);
}
