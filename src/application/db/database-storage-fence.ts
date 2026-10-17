import type { YDoc } from '@/application/types';

import { captureCollabStorageScope, type CollabStorageScope, collabStorageKey } from './collab-storage-scope';

/** A newer tab changed storage while this tab was checking the server's restore head. */
export class DatabaseStorageGenerationChangedError extends Error {
  constructor() {
    super('Database storage generation changed while checking the restore state');
    this.name = 'DatabaseStorageGenerationChangedError';
  }
}

/** Captured before a database blob request, never refreshed for its response. */
export type DatabaseStorageFence = {
  databaseId: string;
  scopeKey?: string;
  scopeGeneration?: number;
  epoch: string | null;
  cacheEpoch: string | null | undefined;
  /** Ordinary reads retain their legacy fallback until a restore epoch exists. */
  nonDurable?: boolean;
};

export const DATABASE_CACHE_EPOCH_PREFIX = 'af_database_blob_epoch:';
export const DATABASE_RESTORE_MARKER_PREFIX = 'af_database_restore:';
const applyingFences = new WeakMap<YDoc, DatabaseStorageFence>();

export function databaseStorageFenceObjectId(databaseId: string): string {
  return collabStorageKey(`database-blob-epoch:${databaseId}`);
}

/** A `scope` passed in must have been captured in the same synchronous step. */
export function readDatabaseCacheEpoch(databaseId: string, scope?: CollabStorageScope): string | null | undefined {
  try {
    const storageKey = (scope ?? captureCollabStorageScope()).storageKey(databaseId);

    return localStorage.getItem(`${DATABASE_CACHE_EPOCH_PREFIX}${storageKey}`);
  } catch {
    // Synchronous seed readers must fail closed when cross-tab fencing is unavailable.
    return undefined;
  }
}

export function publishDatabaseCacheEpoch(databaseId: string, epoch: string): void {
  localStorage.setItem(`${DATABASE_CACHE_EPOCH_PREFIX}${collabStorageKey(databaseId)}`, epoch);
}

/**
 * The scope is captured once for the whole check. A caller that already captured it in the same
 * synchronous step can pass it in, so the stored token is not read again.
 */
export function isDatabaseStorageFenceCurrent(
  fence: DatabaseStorageFence,
  scope: CollabStorageScope = captureCollabStorageScope()
): boolean {
  return (
    (fence.scopeGeneration === undefined || fence.scopeGeneration === scope.generation) &&
    (fence.scopeKey === undefined || fence.scopeKey === scope.key) &&
    (fence.cacheEpoch !== undefined || fence.nonDurable === true) &&
    readDatabaseCacheEpoch(fence.databaseId, scope) === fence.cacheEpoch
  );
}

/** Keep the remote Yjs origin while tagging exactly the resulting persistence work. */
export function withDatabaseStorageFence<T>(doc: YDoc, fence: DatabaseStorageFence | undefined, apply: () => T): T {
  if (!fence) return apply();
  const previous = applyingFences.get(doc);

  applyingFences.set(doc, fence);
  try {
    return apply();
  } finally {
    if (previous) applyingFences.set(doc, previous);
    else applyingFences.delete(doc);
  }
}

export function getApplyingDatabaseStorageFence(doc: YDoc): DatabaseStorageFence | undefined {
  return applyingFences.get(doc);
}
