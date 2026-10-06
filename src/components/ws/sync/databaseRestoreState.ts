import { ERROR_CODE } from '@/application/constants';
import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

export interface DatabaseRestoreState {
  database_restore_id: string | null;
  version: string | null;
  /** Durable cache witness captured before reading the server marker. */
  storageEpoch?: string | null;
}

type VerificationError = { code?: number; httpStatus?: number; message?: string; retryAfterSecs?: number };

export function isPermanentDatabaseRestoreError(error: unknown): boolean {
  const detail = error as VerificationError | null;
  const permanentCodes: number[] = [401, 403, 404, ERROR_CODE.NOT_LOGGED_IN, ERROR_CODE.NOT_HAS_PERMISSION,
    ERROR_CODE.USER_UNAUTHORIZED, ERROR_CODE.RECORD_NOT_FOUND, ERROR_CODE.RECORD_DELETED,
    ERROR_CODE.WORKSPACE_NOT_FOUND, ERROR_CODE.FEATURE_NOT_AVAILABLE];

  return permanentCodes.includes(detail?.code ?? 0) || [401, 403, 404].includes(detail?.httpStatus ?? 0);
}

/** A failed authority check remains a failure until the server's retry deadline. */
export class DatabaseRestoreVerificationDeferredError extends Error {
  readonly code?: number;
  readonly httpStatus?: number;

  constructor(detail: VerificationError, readonly retryAtMs: number) {
    super(detail.message || 'Database restore verification is deferred');
    this.code = detail.code;
    this.httpStatus = detail.httpStatus;
  }

  get retryAfterSecs(): number {
    return Math.max(0, Math.ceil((this.retryAtMs - Date.now()) / 1000));
  }
}

function deferVerification(error: unknown): DatabaseRestoreVerificationDeferredError | undefined {
  const detail = error as VerificationError | null;
  const status = detail?.httpStatus ?? detail?.code;
  const retryableCodes: number[] = [-1, ERROR_CODE.RETRY_LATER, ERROR_CODE.TOO_MANY_REQUESTS,
    ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE, ERROR_CODE.REQUEST_TIMEOUT];

  if (!detail || isPermanentDatabaseRestoreError(error)) return;
  if (!retryableCodes.includes(detail.code ?? 0) && status !== 408 && status !== 429 &&
      !(status !== undefined && status >= 500 && status <= 599)) return;
  const fallbackSecs = status === 429 || detail.code === ERROR_CODE.TOO_MANY_REQUESTS ? 30 : 5;
  const delaySecs = typeof detail.retryAfterSecs === 'number' && Number.isFinite(detail.retryAfterSecs) &&
    detail.retryAfterSecs > 0 ? detail.retryAfterSecs : fallbackSecs;

  // Keep even malformed, enormous delays finite; timers wait in bounded chunks.
  const retryAtMs = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + delaySecs * 1000);

  return new DatabaseRestoreVerificationDeferredError(detail, retryAtMs);
}

/** Per-tab authority: another tab updating durable caches never updates live documents here. */
export class DatabaseRestoreTracker {
  private readonly markers = new Map<string, string | null>();
  private readonly checks = new Map<string, Promise<boolean>>();
  private readonly deferred = new Map<string, DatabaseRestoreVerificationDeferredError>();
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
    const deferred = this.deferred.get(databaseId);

    if (deferred && deferred.retryAtMs > Date.now()) return Promise.reject(deferred);
    this.deferred.delete(databaseId);
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
        const deferred = deferVerification(error);

        // New hints still require a fresh read, but cannot make a busy server
        // accept it sooner. All open, send, focus, and timer callers share this deadline.
        if (deferred) {
          this.deferred.set(databaseId, deferred);
          throw deferred;
        }

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
