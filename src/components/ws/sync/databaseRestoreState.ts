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
  private readonly hints = new Map<string, { restoreId?: string }>();
  private readonly verifiedHints = new Map<string, { restoreId?: string } | undefined>();
  private observedRestore = false;

  constructor(
    private readonly storagePrefix: string,
    private readonly readState: (databaseId: string) => Promise<DatabaseRestoreState>,
    private readonly reset: (
      databaseId: string, state: DatabaseRestoreState, isInitialHydration: boolean
    ) => Promise<void>,
    private readonly storage: Storage
  ) {
    // Snapshot at tab/workspace creation. Reading localStorage afresh on every
    // check would let a sibling tab's marker bless our obsolete in-memory docs.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (!key?.startsWith(storagePrefix)) continue;
      const value = storage.getItem(key);

      if (value !== null) {
        this.markers.set(key.slice(storagePrefix.length), value === 'null' ? null : value);
        if (value !== 'null') this.observedRestore = true;
      }
    }
  }

  marker(databaseId: string): string | null {
    return this.markers.get(databaseId) ?? null;
  }

  revision(databaseId: string): number {
    return this.revisions.get(databaseId) || 0;
  }

  /** Legacy sessions without restore evidence need no row-identity lookup for sync. */
  hasRestoreEvidence(): boolean {
    return this.observedRestore;
  }

  /** A root version boundary has no restore ID but still invalidates earlier authority reads. */
  observeRestoreHint(databaseId: string, restoreId?: string): void {
    this.observedRestore = true;
    if (restoreId === undefined || this.hints.get(databaseId)?.restoreId !== restoreId) {
      this.hints.set(databaseId, { restoreId });
    }
  }

  /** Includes hints delivered after a check resolved but before its caller resumed. */
  verificationIsCurrent(databaseId: string): boolean {
    return this.verifiedHints.has(databaseId) && this.verifiedHints.get(databaseId) === this.hints.get(databaseId);
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
      const hint = this.hints.get(databaseId);
      let state: DatabaseRestoreState;

      try {
        state = await this.readState(databaseId);
      } catch (error) {
        if (hint !== this.hints.get(databaseId)) continue;
        throw error;
      }

      if (hint !== this.hints.get(databaseId)) continue;
      if (state.database_restore_id !== null) this.observedRestore = true;
      const previous = this.markers.get(databaseId) ?? null;

      if (previous === state.database_restore_id) {
        this.markers.set(databaseId, state.database_restore_id);
        this.verifiedHints.set(databaseId, hint);
        return unchanged;
      }

      unchanged = false;
      this.revisions.set(databaseId, this.revision(databaseId) + 1);
      try {
        // A first authority read can discover a restore that predates opening
        // the editor. A verified null marker is a known original generation;
        // an absent marker remains initial hydration across failed reloads.
        await this.reset(databaseId, state, !this.markers.has(databaseId));
      } catch (error) {
        if (hint !== this.hints.get(databaseId)) continue;
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
