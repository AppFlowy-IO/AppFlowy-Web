import { listSavedDecks } from './presentation-client';

import type { PresentationScope } from './server-contract';
import type { SavedDeck } from './types';

/**
 * Listing reads every catalog deck's artifact and scene (up to 61 requests), and the Share panel's
 * tab content unmounts whenever another tab is selected. Visits within this window reuse the list;
 * after it, decks saved elsewhere appear on the next visit.
 */
const SAVED_DECKS_TTL_MS = 60 * 1000;
const savedDecks = new Map<string, { decks: SavedDeck[]; savedAt: number }>();
const cacheKey = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;

/** The workspace catalog this user listed within the last minute, if any. */
export function cachedSavedDecks(workspaceId: string, userId: string): SavedDeck[] | undefined {
  const key = cacheKey(workspaceId, userId);
  const entry = savedDecks.get(key);

  if (entry && Date.now() - entry.savedAt < SAVED_DECKS_TTL_MS) return entry.decks;
  // An expired list is not kept in memory.
  savedDecks.delete(key);
}

/** Lists the workspace catalog and keeps it for this user's next visits. */
export async function listCachedSavedDecks(
  scope: PresentationScope,
  userId: string,
  signal?: AbortSignal
): Promise<SavedDeck[]> {
  const decks = await listSavedDecks(scope, signal);

  savedDecks.set(cacheKey(scope.workspaceId, userId), { decks, savedAt: Date.now() });
  return decks;
}

/** Drops this user's cached catalog, so the next visit lists it again. */
export function forgetSavedDecks(workspaceId: string, userId: string) {
  savedDecks.delete(cacheKey(workspaceId, userId));
}
