import { captureCollabStorageScope, ScopedCollabMap } from '@/application/db/collab-storage-scope';
import { type DatabaseStorageFence, isDatabaseStorageFenceCurrent } from '@/application/db/database-storage-fence';

export type DatabaseRowDocSeed = {
  bytes: Uint8Array;
  encoderVersion: number;
  rowId?: string;
  scopeKey?: string;
  scopeGeneration?: number;
  generation?: number;
  storageFence?: DatabaseStorageFence;
  /** A captured seed must not outlive the login session that downloaded it. */
  isOwnerCurrent?: () => boolean;
};

const rowSeedGenerations = new ScopedCollabMap<number>();

export function createDatabaseRowDocSeed(
  rowId: string,
  state: Pick<DatabaseRowDocSeed, 'bytes' | 'encoderVersion' | 'storageFence' | 'isOwnerCurrent'>
): DatabaseRowDocSeed {
  const scope = captureCollabStorageScope();

  return {
    ...state,
    rowId,
    scopeKey: scope.key,
    scopeGeneration: scope.generation,
    generation: rowSeedGenerations.get(rowId) ?? 0,
  };
}

export function invalidateDatabaseRowDocSeedGeneration(rowId: string) {
  rowSeedGenerations.set(rowId, (rowSeedGenerations.get(rowId) ?? 0) + 1);
}

/** Unfenced seeds remain valid for callers outside the blob prefetch path. */
export function isDatabaseRowDocSeedCurrent(seed: DatabaseRowDocSeed) {
  // One capture serves every check below: the scope cannot change within this synchronous call.
  const scope = captureCollabStorageScope();

  if (seed.scopeGeneration !== undefined && seed.scopeGeneration !== scope.generation) return false;
  if (seed.scopeKey !== undefined && seed.scopeKey !== scope.key) return false;
  if (seed.isOwnerCurrent && !seed.isOwnerCurrent()) return false;
  if (seed.storageFence && !isDatabaseStorageFenceCurrent(seed.storageFence, scope)) return false;
  if (!seed.rowId || seed.generation === undefined) return true;
  return seed.generation === (rowSeedGenerations.get(seed.rowId) ?? 0);
}
