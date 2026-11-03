import { useCallback, useContext, useRef } from 'react';

import { readDashboardOwner } from '@/application/database-yjs/dashboard-owned-views';
import { getDatabaseFromDoc } from '@/application/database-yjs/database-view-doc-ops';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { YDoc, YjsDatabaseKey } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { AppOutlineReaderContext } from '@/components/app/contexts/AppOutlineContext';

export interface DashboardOwnerSources {
  /** The host database's doc. */
  hostDoc: YDoc;
  /** Source docs the mounted widgets expose, by database id (read at call time). */
  sourceDocs?: { readonly current: Readonly<Record<string, YDoc>> };
  /** The workspace catalog (read at call time); its items carry `dashboard_owner` once the server projects it. */
  catalog?: { readonly current: readonly WorkspaceDatabaseWithViews[] };
}

function collabOwner(doc: YDoc | undefined, viewId: string): string | null {
  return readDashboardOwner(null, getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views)?.get(viewId));
}

/**
 * `ownerOf(viewId, databaseId?)`: the dashboard that owns a view, as known
 * right now without a request, `null` when not owned or unknown. Read in
 * order: the host collab mirror, the mirror in the view's source doc (or any
 * registered source doc), the catalog's `dashboard_owner`, the outline's
 * folder `extra.dashboard_owner`. Stable; every source is read at call time,
 * the outline included: a subscription to it would re-render the dashboard
 * provider (and an open picker) on every folder change.
 */
export function useDashboardOwnerLookup({ hostDoc, sourceDocs, catalog }: DashboardOwnerSources) {
  const readOutline = useContext(AppOutlineReaderContext);
  const latest = useRef({ hostDoc, sourceDocs, catalog, readOutline });

  latest.current = { hostDoc, sourceDocs, catalog, readOutline };

  return useCallback((viewId: string, databaseId?: string): string | null => {
    const current = latest.current;
    const fromHost = collabOwner(current.hostDoc, viewId);

    if (fromHost) return fromHost;
    const docs = current.sourceDocs?.current ?? {};
    const own = databaseId ? collabOwner(docs[databaseId], viewId) : null;

    if (own) return own;
    for (const doc of Object.values(docs)) {
      const owner = collabOwner(doc, viewId);

      if (owner) return owner;
    }

    for (const database of current.catalog?.current ?? []) {
      const item = database.views.find((view) => view.view_id === viewId);
      const owner = item ? readDashboardOwner({ extra: { dashboard_owner: item.dashboard_owner } }) : null;

      if (owner) return owner;
    }

    const outline = current.readOutline?.();

    return outline ? readDashboardOwner(findView(outline, viewId)) : null;
  }, []);
}
