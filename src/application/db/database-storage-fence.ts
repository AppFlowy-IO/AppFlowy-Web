import type { YDoc } from '@/application/types';

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
  epoch: string | null;
  cacheEpoch: string | null | undefined;
  /** Ordinary reads retain their legacy fallback until a restore epoch exists. */
  nonDurable?: boolean;
};

const CACHE_EPOCH_PREFIX = 'af_database_blob_epoch:';
const applyingFences = new WeakMap<YDoc, DatabaseStorageFence>();

export function databaseStorageFenceObjectId(databaseId: string): string {
  return `database-blob-epoch:${databaseId}`;
}

export function readDatabaseCacheEpoch(databaseId: string): string | null | undefined {
  try {
    return localStorage.getItem(`${CACHE_EPOCH_PREFIX}${databaseId}`);
  } catch {
    // Synchronous seed readers must fail closed when cross-tab fencing is unavailable.
    return undefined;
  }
}

export function publishDatabaseCacheEpoch(databaseId: string, epoch: string): void {
  localStorage.setItem(`${CACHE_EPOCH_PREFIX}${databaseId}`, epoch);
}

export function isDatabaseStorageFenceCurrent(fence: DatabaseStorageFence): boolean {
  return (
    (fence.cacheEpoch !== undefined || fence.nonDurable === true) &&
    readDatabaseCacheEpoch(fence.databaseId) === fence.cacheEpoch
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
