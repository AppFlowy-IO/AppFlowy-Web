import { createContext, useContext, useEffect, useMemo, useRef } from 'react';

// The context module itself: the package barrel would weigh down the lazily loaded menu chunk.
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { YDoc } from '@/application/types';
import { Log } from '@/utils/log';

import {
  DashboardSourceRegistryContext,
  useDashboardContextOptional,
  useDashboardLayout,
  useDashboardSources,
} from '../DashboardContext';

/** Stands in for the registry context where a test replaces the dashboard context module. */
const NO_REGISTRY = createContext<{ registerSourceDoc: (databaseId: string, doc: YDoc | null) => void } | null>(null);

/**
 * The source databases the filter menu lists but no widget has opened yet (a
 * widget waiting for a load slot, or deferred below the fold): while the menu
 * is mounted their documents are opened on demand and registered with the
 * dashboard like a widget's doc, so the menu lists every source's properties
 * (fix B6). Only the document is read: no rows, and no load slot is taken.
 * A registered doc stays registered (the view loader keeps it open anyway):
 * the widget that starts later registers the same doc, and its unmount gives
 * it back. Nothing happens on a surface without the dashboard's registry or
 * the database's `loadView` (a picker rendered on its own).
 *
 * The menu opens from the tab bar's toolbar, outside the grid's UI and host
 * contexts: it reads the dashboard-level contexts only.
 */
export function useFilterMenuSourceDocs() {
  const hostDatabaseId = useDashboardContextOptional()?.hostDatabaseId;
  const { rows } = useDashboardLayout();
  const { sourceDocs } = useDashboardSources();
  const registerSourceDoc = useContext(DashboardSourceRegistryContext ?? NO_REGISTRY)?.registerSourceDoc;
  const loadView = useDatabaseContextOptional()?.loadView;
  // One view per source database, in widget order: the document is opened through it.
  const anchorsKey = useMemo(() => {
    const anchors = new Map<string, string>();

    rows.forEach((row) =>
      row.widgets.forEach((widget) => {
        if (widget.databaseId !== hostDatabaseId && !anchors.has(widget.databaseId)) {
          anchors.set(widget.databaseId, widget.viewId);
        }
      })
    );
    return Array.from(anchors, ([databaseId, viewId]) => `${databaseId}\t${viewId}`).join('\n');
  }, [hostDatabaseId, rows]);
  // Read when the menu mounts: a doc this hook registers is not missing on the next render.
  const sourceDocsRef = useRef(sourceDocs);

  sourceDocsRef.current = sourceDocs;

  useEffect(() => {
    if (!loadView || !registerSourceDoc || !anchorsKey) return;
    const missing = anchorsKey
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([databaseId]) => !sourceDocsRef.current[databaseId]);

    if (missing.length === 0) return;
    let cancelled = false;

    missing.forEach(([databaseId, viewId]) => {
      // Through a promise of its own: a load that throws (or answers nothing) is a debug line, never an error of the menu.
      Promise.resolve()
        .then(() => loadView(viewId, false, false, { databaseId }))
        .then((doc) => {
          // A widget that started meanwhile registered the doc itself.
          if (cancelled || !doc || sourceDocsRef.current[databaseId]) return;
          registerSourceDoc(databaseId, doc);
        })
        .catch((error) => {
          Log.debug('[Dashboard] the filter menu could not open a source database', { databaseId, error });
        });
    });
    return () => {
      cancelled = true;
    };
  }, [anchorsKey, loadView, registerSourceDoc]);
}
