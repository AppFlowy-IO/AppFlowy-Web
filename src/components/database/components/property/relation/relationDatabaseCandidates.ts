import {
  databaseCatalogViewToView,
  DatabaseContainerCatalogEntry,
  getDatabaseContainerEntries,
  getWorkspaceDatabaseCatalog,
  refreshWorkspaceDatabaseCatalog,
} from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { DatabaseRelations, View } from '@/application/types';

/** A database that a relation field can point at. */
export interface RelationDatabaseCandidate {
  databaseId: string;
  viewId: string;
  displayView: View;
  path: string[];
}

interface IndexedView {
  view: View;
  ancestry: View[];
}

interface LoadRelationDatabaseCandidatesOptions {
  workspaceId: string;
  loadViews?: () => Promise<View[] | undefined>;
  refreshCatalog?: boolean;
}

export interface RelationDatabaseCandidatesResult {
  candidates: RelationDatabaseCandidate[];
  relations: DatabaseRelations;
  outline: View[];
  databases: WorkspaceDatabaseWithViews[];
}

function indexViews(views: View[]): Map<string, IndexedView> {
  const index = new Map<string, IndexedView>();
  const ancestry: View[] = [];

  const walk = (items: View[]) => {
    for (const view of items) {
      ancestry.push(view);

      if (!index.has(view.view_id)) {
        index.set(view.view_id, { view, ancestry: ancestry.slice() });
      }

      if (view.children?.length) walk(view.children);
      ancestry.pop();
    }
  };

  walk(views);
  return index;
}

function candidatePath(entry: IndexedView | undefined, primaryViewId: string, container: View): string[] {
  if (entry) {
    const path = entry.view.view_id === primaryViewId ? entry.ancestry.slice(0, -1) : entry.ancestry;

    if (path.length > 0) return path.map((view) => view.name).filter(Boolean);
  }

  return container.name ? [container.name] : [];
}

function candidateFromDatabase(
  database: DatabaseContainerCatalogEntry,
  viewIndex: Map<string, IndexedView>
): RelationDatabaseCandidate {
  const catalogDisplayView = databaseCatalogViewToView(database.databaseId, database.container);
  const outlineContainer = viewIndex.get(database.container.view_id)?.view;
  // The catalog determines which databases are selectable, but folder events
  // are the live source of page metadata. In particular, the database-list
  // response can still contain the previous container name immediately after
  // a rename.
  const displayView = outlineContainer
    ? {
        ...outlineContainer,
        extra: {
          ...(outlineContainer.extra ?? {}),
          ...(catalogDisplayView.extra ?? {}),
          is_space: catalogDisplayView.extra?.is_space ?? outlineContainer.extra?.is_space ?? false,
        },
      }
    : catalogDisplayView;
  const pathEntry = viewIndex.get(database.primaryView.view_id) ?? viewIndex.get(database.container.view_id);

  return {
    databaseId: database.databaseId,
    viewId: database.primaryView.view_id,
    displayView,
    path: candidatePath(pathEntry, database.primaryView.view_id, displayView),
  };
}

/** Pure recompute for when a fresh outline arrives without a catalog change. */
export function buildRelationDatabaseCandidates(
  databases: WorkspaceDatabaseWithViews[],
  outline: View[]
): RelationDatabaseCandidatesResult {
  const viewIndex = indexViews(outline);
  const candidates = getDatabaseContainerEntries(databases).map((database) =>
    candidateFromDatabase(database, viewIndex)
  );
  const relations = Object.fromEntries(candidates.map((candidate) => [candidate.databaseId, candidate.viewId]));

  return { candidates, relations, outline, databases };
}

/**
 * Load server-authoritative relation targets and use the outline only to
 * decorate them with a path. Unlike desktop, web has no offline-created
 * databases to merge into the catalog.
 */
export async function loadRelationDatabaseCandidates({
  workspaceId,
  loadViews,
  refreshCatalog = false,
}: LoadRelationDatabaseCandidatesOptions): Promise<RelationDatabaseCandidatesResult> {
  const outlinePromise = (loadViews?.() ?? Promise.resolve(undefined)).catch(() => undefined);
  const catalogPromise = refreshCatalog
    ? refreshWorkspaceDatabaseCatalog(workspaceId)
    : getWorkspaceDatabaseCatalog(workspaceId);
  const [databases, loadedOutline] = await Promise.all([catalogPromise, outlinePromise]);

  return buildRelationDatabaseCandidates(databases, loadedOutline ?? []);
}
