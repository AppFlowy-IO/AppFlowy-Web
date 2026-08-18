import { WorkspaceDatabaseViewItem, WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { getMultiple as getViews, listDatabases } from '@/application/services/domains/view';
import { DatabaseRelations, LoadViewMeta, View } from '@/application/types';
import { isDatabaseContainer, isDatabaseLayout } from '@/application/view-utils';

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
  loadDatabaseRelations?: (options?: { refresh?: boolean }) => Promise<DatabaseRelations | undefined>;
  loadViews?: () => Promise<View[] | undefined>;
  loadViewMeta?: LoadViewMeta;
}

export interface RelationDatabaseCandidatesResult {
  candidates: RelationDatabaseCandidate[];
  relations: DatabaseRelations;
  outline: View[];
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

function remoteViewToView(databaseId: string, view: WorkspaceDatabaseViewItem): View {
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

function registeredRemoteView(database: WorkspaceDatabaseWithViews): WorkspaceDatabaseViewItem | undefined {
  return (
    database.views.find((view) => !view.is_container && !view.embedded) ??
    database.views.find((view) => !view.is_container)
  );
}

function candidatePath(entry: IndexedView | undefined, registeredViewId: string, parent?: View): string[] {
  if (entry) {
    const path = entry.view.view_id === registeredViewId ? entry.ancestry.slice(0, -1) : entry.ancestry;

    if (path.length > 0) return path.map((view) => view.name).filter(Boolean);
  }

  return parent?.name ? [parent.name] : [];
}

function candidatesFromRemote(
  databases: WorkspaceDatabaseWithViews[],
  localViewIndex: Map<string, IndexedView>
): RelationDatabaseCandidate[] {
  return databases.flatMap((database) => {
    const registered = registeredRemoteView(database);

    if (!registered) return [];

    const remoteParent =
      database.views.find((view) => view.is_container && view.view_id === registered.parent_view_id) ??
      database.views.find((view) => view.is_container);
    const registeredView =
      localViewIndex.get(registered.view_id)?.view ?? remoteViewToView(database.database_id, registered);
    const displayView = remoteParent
      ? localViewIndex.get(remoteParent.view_id)?.view ?? remoteViewToView(database.database_id, remoteParent)
      : registeredView;
    const pathEntry = localViewIndex.get(registered.view_id) ?? localViewIndex.get(displayView.view_id);

    return [
      {
        databaseId: database.database_id,
        viewId: registered.view_id,
        displayView,
        path: candidatePath(pathEntry, registered.view_id, remoteParent ? displayView : undefined),
      },
    ];
  });
}

function candidatesFromLocalViews(
  viewIndex: Map<string, IndexedView>,
  relations: DatabaseRelations
): RelationDatabaseCandidate[] {
  const viewsByDatabaseId = new Map<string, IndexedView[]>();

  for (const entry of viewIndex.values()) {
    const databaseId = entry.view.extra?.database_id;

    if (!databaseId || (!isDatabaseContainer(entry.view) && !isDatabaseLayout(entry.view.layout))) continue;

    const views = viewsByDatabaseId.get(databaseId) ?? [];

    views.push(entry);
    viewsByDatabaseId.set(databaseId, views);
  }

  for (const [databaseId, viewId] of Object.entries(relations)) {
    const entry = viewIndex.get(viewId);

    if (!entry) continue;

    const views = viewsByDatabaseId.get(databaseId) ?? [];

    if (!views.some(({ view }) => view.view_id === viewId)) views.unshift(entry);
    viewsByDatabaseId.set(databaseId, views);
  }

  return Array.from(viewsByDatabaseId.entries()).flatMap(([databaseId, entries]) => {
    const relationViewId = relations[databaseId];
    const registeredEntry =
      entries.find(({ view }) => view.view_id === relationViewId && !isDatabaseContainer(view)) ??
      entries.find(({ view }) => !isDatabaseContainer(view) && view.extra?.embedded !== true) ??
      entries.find(({ view }) => !isDatabaseContainer(view)) ??
      // A newly-created local database can briefly expose its container before
      // the first inner view reaches the outline. Selecting a relation only
      // persists database_id, so the container is a safe temporary identity.
      entries.find(({ view }) => isDatabaseContainer(view));

    if (!registeredEntry) return [];

    const parent = registeredEntry.view.parent_view_id
      ? viewIndex.get(registeredEntry.view.parent_view_id)?.view
      : undefined;
    const container =
      (isDatabaseContainer(parent) ? parent : undefined) ?? entries.find(({ view }) => isDatabaseContainer(view))?.view;
    const displayView = container ?? registeredEntry.view;

    return [
      {
        databaseId,
        viewId: registeredEntry.view.view_id,
        displayView,
        path: candidatePath(registeredEntry, registeredEntry.view.view_id, container),
      },
    ];
  });
}

function flattenViews(views: View[]): View[] {
  const flattened: View[] = [];
  const pending = [...views];

  while (pending.length > 0) {
    const view = pending.shift();

    if (!view) continue;
    flattened.push(view);
    pending.unshift(...(view.children ?? []));
  }

  return flattened;
}

async function loadViewsById(workspaceId: string, viewIds: string[], loadViewMeta?: LoadViewMeta): Promise<View[]> {
  const uniqueViewIds = Array.from(new Set(viewIds.filter(Boolean)));

  if (uniqueViewIds.length === 0) return [];

  try {
    return flattenViews(await getViews(workspaceId, uniqueViewIds, 0));
  } catch {
    if (!loadViewMeta) return [];

    const views = await Promise.all(
      uniqueViewIds.map(async (viewId) => {
        try {
          return await loadViewMeta(viewId);
        } catch {
          return null;
        }
      })
    );

    return views.filter((view): view is View => Boolean(view));
  }
}

/**
 * Merge the server's authoritative database listing with locally visible
 * folder metadata. The local overlay intentionally wins for matching IDs so a
 * just-created or renamed database remains selectable while server indexing is
 * catching up; the server still contributes databases absent from the shallow
 * local outline.
 */
export async function loadRelationDatabaseCandidates({
  workspaceId,
  loadDatabaseRelations,
  loadViews,
  loadViewMeta,
}: LoadRelationDatabaseCandidatesOptions): Promise<RelationDatabaseCandidatesResult> {
  const [remoteResult, relationResult, outlineResult] = await Promise.allSettled([
    listDatabases(workspaceId),
    loadDatabaseRelations?.() ?? Promise.resolve(undefined),
    loadViews?.() ?? Promise.resolve(undefined),
  ]);
  const remoteDatabases = remoteResult.status === 'fulfilled' ? remoteResult.value : [];
  const remoteListAvailable = remoteResult.status === 'fulfilled';
  const localRelations = relationResult.status === 'fulfilled' ? relationResult.value ?? {} : {};
  const outline = outlineResult.status === 'fulfilled' ? outlineResult.value ?? [] : [];
  const remoteViewIds = new Set(remoteDatabases.flatMap((database) => database.views.map((view) => view.view_id)));
  let viewIndex = indexViews(outline);
  // Only hydrate legacy-only entries when the new endpoint is unavailable.
  // When it succeeds, fetching every ID from the old workspace collab would
  // reintroduce databases the authoritative list intentionally filtered (for
  // example, databases under a trashed parent).
  const unresolvedViewIds = remoteListAvailable
    ? []
    : Object.values(localRelations).filter((viewId) => viewId && !remoteViewIds.has(viewId) && !viewIndex.has(viewId));
  const supplementalViews = await loadViewsById(workspaceId, unresolvedViewIds, loadViewMeta);
  const supplementalParentIds = supplementalViews
    .map((view) => view.parent_view_id)
    .filter((viewId): viewId is string => typeof viewId === 'string' && !viewIndex.has(viewId));
  const supplementalParents = await loadViewsById(workspaceId, supplementalParentIds, loadViewMeta);

  if (supplementalViews.length > 0 || supplementalParents.length > 0) {
    viewIndex = indexViews([...outline, ...supplementalViews, ...supplementalParents]);
  }

  const remoteCandidates = candidatesFromRemote(remoteDatabases, viewIndex);
  const localCandidates = candidatesFromLocalViews(viewIndex, localRelations);
  const candidatesByDatabaseId = new Map<string, RelationDatabaseCandidate>();

  for (const candidate of remoteCandidates) candidatesByDatabaseId.set(candidate.databaseId, candidate);
  // Local metadata is the immediate source of truth during offline/reconnect windows.
  for (const candidate of localCandidates) {
    const remoteCandidate = candidatesByDatabaseId.get(candidate.databaseId);
    const isEmbeddedOnly = !isDatabaseContainer(candidate.displayView) && candidate.displayView.extra?.embedded === true;

    if (!remoteCandidate || !isEmbeddedOnly) {
      candidatesByDatabaseId.set(candidate.databaseId, candidate);
    }
  }

  const relations: DatabaseRelations = {};

  for (const candidate of remoteCandidates) relations[candidate.databaseId] = candidate.viewId;
  for (const candidate of localCandidates) relations[candidate.databaseId] = candidate.viewId;
  Object.assign(relations, localRelations);

  return {
    candidates: Array.from(candidatesByDatabaseId.values()),
    relations,
    outline,
  };
}
