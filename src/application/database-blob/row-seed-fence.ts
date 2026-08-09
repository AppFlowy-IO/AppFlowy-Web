export type DatabaseRowDocSeed = {
  bytes: Uint8Array;
  encoderVersion: number;
  rowId?: string;
  generation?: number;
};

const rowSeedGenerations = new Map<string, number>();

export function createDatabaseRowDocSeed(
  rowId: string,
  state: Pick<DatabaseRowDocSeed, 'bytes' | 'encoderVersion'>
): DatabaseRowDocSeed {
  return {
    ...state,
    rowId,
    generation: rowSeedGenerations.get(rowId) ?? 0,
  };
}

export function invalidateDatabaseRowDocSeedGeneration(rowId: string) {
  rowSeedGenerations.set(rowId, (rowSeedGenerations.get(rowId) ?? 0) + 1);
}

/** Unfenced seeds remain valid for callers outside the blob prefetch path. */
export function isDatabaseRowDocSeedCurrent(seed: DatabaseRowDocSeed) {
  if (!seed.rowId || seed.generation === undefined) return true;
  return seed.generation === (rowSeedGenerations.get(seed.rowId) ?? 0);
}
