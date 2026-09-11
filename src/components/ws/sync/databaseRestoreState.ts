import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

export interface DatabaseRestoreState {
  database_restore_id: string | null;
  version: string | null;
  /** Durable cache witness captured before reading the server marker. */
  storageEpoch?: string | null;
}

/** Per-tab authority: another tab updating durable caches never updates live documents here. */
export class DatabaseRestoreTracker {
  private readonly markers = new Map<string, string | null>();
  private readonly checks = new Map<string, Promise<boolean>>();
  private readonly revisions = new Map<string, number>();

  constructor(
    private readonly storagePrefix: string,
    private readonly readState: (databaseId: string) => Promise<DatabaseRestoreState>,
    private readonly reset: (databaseId: string, state: DatabaseRestoreState) => Promise<void>,
    private readonly storage: Storage
  ) {
    // Snapshot at tab/workspace creation. Reading localStorage afresh on every
    // check would let a sibling tab's marker bless our obsolete in-memory docs.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (!key?.startsWith(storagePrefix)) continue;
      const value = storage.getItem(key);

      if (value !== null) this.markers.set(key.slice(storagePrefix.length), value === 'null' ? null : value);
    }
  }

  marker(databaseId: string): string | null {
    return this.markers.get(databaseId) ?? null;
  }

  revision(databaseId: string): number {
    return this.revisions.get(databaseId) || 0;
  }

  check(databaseId: string): Promise<boolean> {
    const pending = this.checks.get(databaseId);

    if (pending) return pending;
    const task = this.checkCurrent(databaseId).finally(() => {
      if (this.checks.get(databaseId) === task) this.checks.delete(databaseId);
    });

    this.checks.set(databaseId, task);
    return task;
  }

  private async checkCurrent(databaseId: string): Promise<boolean> {
    let unchanged = true;

    for (;;) {
      const state = await this.readState(databaseId);
      const previous = this.markers.get(databaseId) ?? null;

      if (previous === state.database_restore_id) {
        this.markers.set(databaseId, state.database_restore_id);
        return unchanged;
      }

      unchanged = false;
      this.revisions.set(databaseId, this.revision(databaseId) + 1);
      try {
        await this.reset(databaseId, state);
      } catch (error) {
        // Another tab advanced storage after our marker read. Its opaque UUID
        // cannot be ordered, so read authority again with a fresh cache witness.
        if (error instanceof DatabaseStorageGenerationChangedError) continue;
        throw error;
      }

      this.storage.setItem(this.storagePrefix + databaseId, state.database_restore_id ?? 'null');
      this.markers.set(databaseId, state.database_restore_id);
      // A second restore may commit while reload is awaiting the blob snapshot.
      // Verify again before allowing either old payloads or fresh edits to drain.
    }
  }
}
