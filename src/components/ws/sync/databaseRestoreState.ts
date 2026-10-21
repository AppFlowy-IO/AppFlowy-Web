import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

export const DATABASE_RESTORE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface DatabaseRestoreState {
  database_restore_id: string | null;
  version: string | null;
  /** Durable cache witness captured before reading the server marker. */
  storageEpoch?: string | null;
}

interface DatabaseRestoreHint {
  restoreId?: string;
  rootVersion?: string;
}

/** Per-tab authority: another tab updating durable caches never updates live documents here. */
export class DatabaseRestoreTracker {
  private readonly markers = new Map<string, string | null>();
  private readonly checks = new Map<string, Promise<boolean>>();
  private readonly revisions = new Map<string, number>();
  private readonly hints = new Map<string, DatabaseRestoreHint>();
  private readonly verifiedHints = new Map<string, DatabaseRestoreHint | undefined>();
  private readonly verifiedAt = new Map<string, number>();
  private readonly failures = new Map<string, {
    error: unknown; retryAt: number; hint: DatabaseRestoreHint | undefined;
  }>();
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

  /** Repeated evidence shares verification; a different version or restore invalidates it. */
  observeRestoreHint(databaseId: string, restoreId?: string, rootVersion?: string): void {
    this.observedRestore = true;
    const previous = this.hints.get(databaseId);

    if ((restoreId === undefined && rootVersion === undefined) || !previous ||
        (restoreId !== undefined && previous.restoreId !== restoreId) ||
        (rootVersion !== undefined && previous.rootVersion !== rootVersion)) {
      // Root frames and restore notifications carry different parts of the same
      // evidence. Keep both so alternating sources do not expire each other.
      this.hints.set(databaseId, {
        restoreId: restoreId ?? previous?.restoreId,
        rootVersion: rootVersion ?? previous?.rootVersion,
      });
    }
  }

  /** Includes hints delivered after a check resolved but before its caller resumed. */
  verificationIsCurrent(databaseId: string): boolean {
    return this.verifiedHints.has(databaseId) && this.verifiedHints.get(databaseId) === this.hints.get(databaseId);
  }

  /** Rows join recovery already in progress, but do not start routine authority reads. */
  needsRestoreRecovery(databaseId: string): boolean {
    return this.checks.has(databaseId) || this.failures.has(databaseId) ||
      (this.hints.has(databaseId) && !this.verificationIsCurrent(databaseId));
  }

  /** A newly opened database must verify even if its previous editor closed recently. */
  invalidateVerification(databaseId: string): void {
    this.verifiedAt.delete(databaseId);
  }

  /** Time until the next routine check, shared by every view and row of this database. */
  nextCheckDelay(databaseId: string): number {
    const verifiedAt = this.verifiedAt.get(databaseId);

    if (verifiedAt === undefined || !this.verificationIsCurrent(databaseId)) return 0;
    const age = Date.now() - verifiedAt;

    return age < 0 ? 0 : Math.max(0, DATABASE_RESTORE_CHECK_INTERVAL_MS - age);
  }

  /** Reuse recent authority for ordinary sync; restore hints always require a fresh read. */
  checkIfStale(databaseId: string): Promise<boolean> {
    const pending = this.checks.get(databaseId);

    if (pending) return pending;
    if (this.nextCheckDelay(databaseId) > 0) return Promise.resolve(true);
    const failure = this.failures.get(databaseId);

    // Message traffic must honor the same cooldown as the hook's recovery timer.
    // New restore evidence may supersede the failed read and bypass that cooldown.
    if (failure && failure.hint === this.hints.get(databaseId) && Date.now() < failure.retryAt) {
      return Promise.reject(failure.error);
    }

    return this.check(databaseId);
  }

  check(databaseId: string): Promise<boolean> {
    const pending = this.checks.get(databaseId);

    if (pending) return pending;
    this.verifiedAt.delete(databaseId);
    const task = this.checkCurrent(databaseId).catch((error: unknown) => {
      const retryAfter = (error as { retryAfterSecs?: number } | null)?.retryAfterSecs;
      const delay = typeof retryAfter === 'number' && Number.isFinite(retryAfter)
        ? Math.max(5000, retryAfter * 1000) : 5000;

      this.failures.set(databaseId, { error, retryAt: Date.now() + delay, hint: this.hints.get(databaseId) });
      throw error;
    }).finally(() => {
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
        this.verifiedAt.set(databaseId, Date.now());
        this.failures.delete(databaseId);
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
