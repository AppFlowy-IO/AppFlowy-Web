import { createContext } from 'react';

import { DatabaseRelations, MentionablePerson, UIVariant, View } from '@/application/types';

/**
 * Outline / sidebar state context — changes on folder mutations, not on page navigation.
 *
 * **Provider:** `AppBusinessLayer`
 *
 * **Change frequency:** MEDIUM — updates when the workspace tree is mutated
 * (page created, renamed, moved, deleted, favorited, etc.).
 * Does NOT change on simple page navigation.
 *
 * Contains the full sidebar outline tree, favorites, recents, trash, and
 * workspace-scoped data loaders (mentionable users, database relations).
 *
 * **Hooks:**
 * - `useAppOutline()` — the full workspace outline tree
 * - `useAppView(viewId)` — find a single view in the outline
 * - `useLoadedViewIds()` — set of view IDs whose children have been fetched
 * - `useLoadViewChildren(viewId)` — fetch children of a view
 * - `useLoadViewChildrenBatch(viewIds)` — fetch children of multiple views
 * - `useMarkViewChildrenStale(viewId)` — invalidate cached children
 * - `useAppFavorites()` — memoized `{ loadFavoriteViews, favoriteViews }`
 * - `useAppRecent()` — memoized `{ loadRecentViews, recentViews }`
 * - `useAppTrash()` — memoized `{ loadTrash, trashList }`
 * - `useRefreshOutline()` — force-reload the entire outline
 * - `useLoadViews()` — load views with optional UI variant filter
 * - `useGetMentionUser()` — resolve a user UUID to mentionable person info
 * - `useLoadMentionableUsers()` — load all mentionable users in the workspace
 * - `useLoadDatabaseRelations()` — load cross-database relation metadata
 */
export interface AppOutlineContextType {
  /** The full workspace view tree. Each View has nested `children`. */
  outline?: View[];
  /** List of views the user has favorited. */
  favoriteViews?: View[];
  /** List of recently visited views. */
  recentViews?: View[];
  /** List of soft-deleted views in the trash. */
  trashList?: View[];
  /** Set of view IDs whose children have already been fetched. Used for lazy-loading. */
  loadedViewIds?: Set<string>;
  /** Fetch the children of a single view. Returns the child views. */
  loadViewChildren?: (viewId: string) => Promise<View[]>;
  /** Fetch children of multiple views in one batch request. */
  loadViewChildrenBatch?: (viewIds: string[]) => Promise<View[]>;
  /** Mark a view's cached children as stale so the next access re-fetches them. */
  markViewChildrenStale?: (viewId: string) => void;
  /** Fetch the user's favorite views. */
  loadFavoriteViews?: () => Promise<View[] | undefined>;
  /** Fetch the user's recently visited views. */
  loadRecentViews?: () => Promise<View[] | undefined>;
  /** Fetch the trash list for a given workspace. */
  loadTrash?: (workspaceId: string) => Promise<void>;
  /** Load views with an optional UI variant filter (e.g. mobile vs desktop). */
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  /** Force-reload the entire outline tree from the server. */
  refreshOutline?: () => Promise<void>;
  /** Load cross-database relation metadata for the workspace. */
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
  /** Synchronous reverse lookup: viewId → databaseId. */
  getDatabaseIdForViewId?: (viewId: string) => string | undefined;
  /** Resolve a user UUID to their mentionable-person profile. */
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  /** Load all mentionable users (workspace members) for @-mention autocomplete. */
  loadMentionableUsers?: () => Promise<MentionablePerson[]>;
}

export const AppOutlineContext = createContext<AppOutlineContextType | null>(null);
