import { ViewLayout } from '@/components/chat/types/request';

export const RAG_SOURCE_OWNERS_METADATA_KEY = 'rag_source_owners';

export interface AIChatRagSource {
  ragId: string;
  ownerViewId?: string;
  ownerDatabaseId?: string;
}

export interface RagSourceOwner {
  view_id?: string;
  database_id?: string;
}

export type RagSourceOwners = Record<string, RagSourceOwner>;

export interface RagScopeView {
  view_id: string;
  layout: number;
  extra?: {
    is_space?: boolean;
    database_id?: string;
  } | null;
  children: RagScopeView[];
  has_children?: boolean;
  is_space?: boolean;
}

export interface ScopedRagState {
  selectedRagIds: string[];
  preservedRagIds: string[];
  ragIds: string[];
  sourceOwners: RagSourceOwners;
}

export function isSpaceView(view: Pick<RagScopeView, 'is_space' | 'extra'>): boolean {
  return view.is_space ?? Boolean(view.extra?.is_space);
}

function visitViews(views: RagScopeView[], visit: (view: RagScopeView) => void) {
  const stack = [...views].reverse();

  while (stack.length > 0) {
    const view = stack.pop();

    if (!view) continue;
    visit(view);

    for (let index = view.children.length - 1; index >= 0; index -= 1) {
      stack.push(view.children[index]);
    }
  }
}

/**
 * Return the document IDs that can be selected as RAG sources within a chat's
 * parent subtree. Spaces are containers rather than sources, and a
 * non-document node ends the selectable document branch.
 */
export function collectScopedRagIds(views: RagScopeView[]): string[] {
  const ids: string[] = [];
  const stack = [...views].reverse();

  while (stack.length > 0) {
    const view = stack.pop();

    if (!view || view.layout !== ViewLayout.Document) continue;

    if (!isSpaceView(view)) {
      ids.push(view.view_id);
    }

    for (let index = view.children.length - 1; index >= 0; index -= 1) {
      stack.push(view.children[index]);
    }
  }

  return ids;
}

/** Return every view/database identity that belongs to the raw parent scope. */
export function collectScopedOwnerIds(views: RagScopeView[]): Set<string> {
  const ids = new Set<string>();

  visitViews(views, (view) => {
    ids.add(view.view_id);
    if (view.extra?.database_id) ids.add(view.extra.database_id);
  });

  return ids;
}

export function getRagSourceOwners(metadata: Record<string, unknown> | undefined): RagSourceOwners {
  const value = metadata?.[RAG_SOURCE_OWNERS_METADATA_KEY];

  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<RagSourceOwners>((owners, [ragId, rawOwner]) => {
    if (!rawOwner || typeof rawOwner !== 'object' || Array.isArray(rawOwner)) return owners;

    const owner = rawOwner as Record<string, unknown>;
    const viewId = typeof owner.view_id === 'string' && owner.view_id ? owner.view_id : undefined;
    const databaseId = typeof owner.database_id === 'string' && owner.database_id ? owner.database_id : undefined;

    if (viewId || databaseId) {
      owners[ragId] = {
        ...(viewId ? { view_id: viewId } : {}),
        ...(databaseId ? { database_id: databaseId } : {}),
      };
    }

    return owners;
  }, {});
}

export function isRagSourceOwnerInScope(owner: RagSourceOwner, scopedOwnerIds: Set<string>): boolean {
  return Boolean(
    (owner.view_id && scopedOwnerIds.has(owner.view_id)) || (owner.database_id && scopedOwnerIds.has(owner.database_id))
  );
}

export function createRagSourceOwners(sources: AIChatRagSource[]): RagSourceOwners {
  return sources.reduce<RagSourceOwners>((owners, source) => {
    if (!source.ragId || (!source.ownerViewId && !source.ownerDatabaseId)) return owners;

    owners[source.ragId] = {
      ...(source.ownerViewId ? { view_id: source.ownerViewId } : {}),
      ...(source.ownerDatabaseId ? { database_id: source.ownerDatabaseId } : {}),
    };
    return owners;
  }, {});
}

export function resolveScopedRagState(
  views: RagScopeView[],
  settings: { full_workspace?: boolean; rag_ids?: string[]; metadata?: Record<string, unknown> } | null,
  knownOutsideViewIds: ReadonlySet<string> = new Set()
): ScopedRagState {
  if (!settings) {
    return { selectedRagIds: [], preservedRagIds: [], ragIds: [], sourceOwners: {} };
  }

  const selectableIds = collectScopedRagIds(views);

  if (settings.full_workspace) {
    return {
      selectedRagIds: selectableIds,
      preservedRagIds: [],
      ragIds: selectableIds,
      sourceOwners: {},
    };
  }

  const savedIds = Array.from(new Set((settings.rag_ids || []).filter(Boolean)));
  const savedIdSet = new Set(savedIds);
  const selectableIdSet = new Set(selectableIds);
  const scopedOwnerIds = collectScopedOwnerIds(views);
  const owners = getRagSourceOwners(settings.metadata);
  const selectedRagIds = selectableIds.filter((id) => savedIdSet.has(id));
  const preservedRagIds: string[] = [];

  for (const id of savedIds) {
    if (selectableIdSet.has(id)) continue;

    const owner = owners[id];

    if (owner) {
      if (isRagSourceOwnerInScope(owner, scopedOwnerIds)) preservedRagIds.push(id);
      continue;
    }

    // A known view inside the raw tree is non-selectable (for example, a
    // database view). Known out-of-scope view IDs are supplied by navigation
    // lookups. Unknown IDs are opaque legacy sources and must not be erased.
    if (!scopedOwnerIds.has(id) && !knownOutsideViewIds.has(id)) {
      preservedRagIds.push(id);
    }
  }

  const ragIds = [...selectedRagIds, ...preservedRagIds];
  const ragIdSet = new Set(ragIds);
  const sourceOwners = Object.entries(owners).reduce<RagSourceOwners>((next, [ragId, owner]) => {
    if (ragIdSet.has(ragId)) next[ragId] = owner;
    return next;
  }, {});

  return { selectedRagIds, preservedRagIds, ragIds, sourceOwners };
}

export function resolveScopedRagIds(
  views: RagScopeView[],
  settings: { full_workspace?: boolean; rag_ids?: string[]; metadata?: Record<string, unknown> } | null
): string[] {
  return resolveScopedRagState(views, settings).selectedRagIds;
}

export function areSameRagIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  const leftIds = new Set(left);
  const rightIds = new Set(right);

  if (leftIds.size !== left.length || rightIds.size !== right.length) return false;

  return left.every((id) => rightIds.has(id));
}

export function areSameRagSourceOwners(left: RagSourceOwners, right: RagSourceOwners): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([ragId, owner]) => {
    const other = right[ragId];

    return other?.view_id === owner.view_id && other?.database_id === owner.database_id;
  });
}
