import { useCallback, useSyncExternalStore } from 'react';

import {
  batchPageVerification,
  getPageVerification,
} from '@/application/services/js-services/http/page-verification-api';

import { PageVerification, verificationStatus } from './types';

interface Snapshot {
  data?: PageVerification;
  error?: string;
  loading: boolean;
}
interface Entry {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  fetchedAt: number;
  subscriptionEpoch: number;
  claimVersion: symbol;
}
const EMPTY: Snapshot = Object.freeze({ loading: true });

/** An authenticated workspace owns one cache. Row/document aliases publish into the same state. */
export class VerificationStore {
  private entries = new Map<string, Entry>();
  private pending = new Set<string>();
  private inFlight = new Map<string, { entry: Entry; epoch: number; revision: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private queued = false;
  private flushing = false;
  private mutationRevision = 0;
  private onFocus = () => this.invalidate();

  constructor(readonly workspaceId: string) {}

  private entry(id: string): Entry {
    let entry = this.entries.get(id);

    if (!entry) {
      entry = { snapshot: EMPTY, listeners: new Set(), fetchedAt: 0, subscriptionEpoch: 0, claimVersion: Symbol() };
      this.entries.set(id, entry);
    }

    return entry;
  }

  snapshot(id: string): Snapshot {
    return this.entry(id).snapshot;
  }

  claimVersion(id: string): symbol {
    return this.entry(id).claimVersion;
  }

  /** A response cannot supersede a claim changed by another control while it was pending. */
  acceptMutation(data: PageVerification, alias: string, expectedVersion: symbol): boolean {
    if (this.entries.get(alias)?.claimVersion !== expectedVersion) return false;
    this.accept(data, alias);
    return true;
  }

  subscribe(id: string, listener: () => void): () => void {
    this.entry(id).listeners.add(listener);
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 1_000);
      window.addEventListener('focus', this.onFocus);
    }

    this.queue(id);
    return () => {
      const entry = this.entry(id);

      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        // A closed view cannot keep permission-sensitive claims authorized.
        // Fence in-flight reads so reopening starts from a fresh Cloud response.
        entry.subscriptionEpoch++;
        entry.claimVersion = Symbol();
        entry.snapshot = EMPTY;
        entry.fetchedAt = 0;
        this.pending.delete(id);
      }

      if (![...this.entries.values()].some((entry) => entry.listeners.size)) {
        clearInterval(this.timer);
        this.timer = undefined;
        window.removeEventListener('focus', this.onFocus);
      }

      // Bound inactive cache retention when scrolling large databases/search result sets.
      if (this.entries.size > 1_000) {
        for (const [key, entry] of this.entries) {
          if (!entry.listeners.size) this.entries.delete(key);
          if (this.entries.size <= 1_000) break;
        }
      }
    };
  }

  private publish(entry: Entry, snapshot: Snapshot) {
    const previous = entry.snapshot.data;
    const current = snapshot.data;

    // Polling an unchanged claim or ticking its expiry must not cancel a pending
    // renewal. Claim replacement and authorization invalidation must cancel it.
    if (
      previous?.target_id !== current?.target_id ||
      previous?.database_id !== current?.database_id ||
      previous?.property?.id !== current?.property?.id ||
      previous?.verification?.id !== current?.verification?.id ||
      previous?.verification?.verified_at !== current?.verification?.verified_at ||
      previous?.verification?.expires_at !== current?.verification?.expires_at
    ) entry.claimVersion = Symbol();
    entry.snapshot = snapshot;
    entry.listeners.forEach((listener) => listener());
  }

  accept(data: PageVerification, alias = data.target_id, fromBatch = false) {
    if (!fromBatch) this.mutationRevision++;
    this.entry(alias);
    for (const [id, entry] of this.entries) {
      if (fromBatch && id !== alias && !entry.listeners.size) continue;
      if (id === alias || id === data.target_id || entry.snapshot.data?.target_id === data.target_id) {
        if (!fromBatch) entry.claimVersion = Symbol();
        entry.fetchedAt = Date.now();
        this.publish(entry, { data: { ...data, status: verificationStatus(data.verification) }, loading: false });
      }
    }
  }

  async refresh(id: string): Promise<PageVerification> {
    const revision = this.mutationRevision;
    const entry = this.entry(id);
    const epoch = entry.subscriptionEpoch;
    const data = await getPageVerification(this.workspaceId, id);

    // A read is not a mutation: unrelated concurrent reads may both publish.
    if (revision === this.mutationRevision && this.entries.get(id) === entry && epoch === entry.subscriptionEpoch) {
      this.accept(data, id, true);
    }

    return data;
  }

  invalidateDatabase(databaseId: string, deleted = false) {
    this.mutationRevision++;
    for (const [id, entry] of this.entries) {
      if (entry.snapshot.data?.database_id !== databaseId) continue;
      if (deleted)
        this.publish(entry, {
          loading: false,
          data: { ...entry.snapshot.data, property: null, verification: null, status: 'unverified' },
        });
      else this.publish(entry, EMPTY);
      entry.fetchedAt = 0;
      if (entry.listeners.size) this.queue(id);
    }
  }

  invalidate(clear = false) {
    this.mutationRevision++;
    for (const [id, entry] of this.entries) {
      entry.fetchedAt = 0;
      if (clear) this.publish(entry, EMPTY);
      if (entry.listeners.size) this.queue(id);
    }
  }

  private tick() {
    for (const [id, entry] of this.entries) {
      if (!entry.listeners.size) continue;
      const data = entry.snapshot.data;

      if (data && data.status !== verificationStatus(data.verification)) {
        this.publish(entry, { ...entry.snapshot, data: { ...data, status: verificationStatus(data.verification) } });
      }

      if (Date.now() - entry.fetchedAt > 30_000) this.queue(id);
    }
  }

  private queue(id: string) {
    const entry = this.entry(id);
    const request = this.inFlight.get(id);

    if (Date.now() - entry.fetchedAt < 30_000) return;
    // Share the current read, but allow a fresh read after invalidation or a
    // close/reopen cycle even while an obsolete request is still finishing.
    if (request?.entry === entry && request.epoch === entry.subscriptionEpoch && request.revision === this.mutationRevision) return;
    this.pending.add(id);
    if (this.queued || this.flushing) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      void this.flush();
    });
  }

  private async flush() {
    this.flushing = true;
    while (this.pending.size) {
      const ids: string[] = [];

      for (const id of this.pending) {
        this.pending.delete(id);
        const entry = this.entries.get(id);

        if (entry?.listeners.size && Date.now() - entry.fetchedAt >= 30_000) ids.push(id);
        if (ids.length === 200) break;
      }

      if (!ids.length) continue;

      const revision = this.mutationRevision;
      const epochs = new Map(ids.map((id) => [id, this.entry(id).subscriptionEpoch]));
      const entries = new Map(ids.map((id) => [id, this.entry(id)]));

      ids.forEach((id) => this.inFlight.set(id, { entry: this.entry(id), epoch: this.entry(id).subscriptionEpoch, revision }));
      try {
        const result = await batchPageVerification(this.workspaceId, ids);

        if (revision !== this.mutationRevision) {
          ids.forEach((id) => {
            if (this.entry(id).listeners.size) this.pending.add(id);
          });
          continue;
        }

        const items = new Map(result.items.map((item) => [item.target_id, item]));

        for (const id of ids) {
          const entry = this.entries.get(id);

          if (!entry?.listeners.size || entry !== entries.get(id) || entry.subscriptionEpoch !== epochs.get(id)) continue;
          const data = items.get(result.targets[id]);

          this.entry(id).fetchedAt = Date.now();
          if (data) this.accept(data, id, true);
          else this.publish(this.entry(id), { loading: false });
        }
      } catch (error) {
        // An obsolete failure must not erase a newer Verify/Unverify response
        // or permission invalidation, just as an obsolete success must not.
        if (revision !== this.mutationRevision) {
          ids.forEach((id) => {
            if (this.entry(id).listeners.size && this.entry(id).fetchedAt === 0) this.pending.add(id);
          });
          continue;
        }

        for (const id of ids) {
          const entry = this.entry(id);

          if (!entry.listeners.size || entry !== entries.get(id) || entry.subscriptionEpoch !== epochs.get(id)) continue;
          entry.fetchedAt = Date.now();
          this.publish(entry, {
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load verification',
          });
        }
      } finally {
        ids.forEach((id) => this.inFlight.delete(id));
      }
    }

    this.flushing = false;
  }
}

const stores = new Map<string, VerificationStore>();

export function verificationStore(workspaceId: string, userId: string): VerificationStore {
  const key = `${userId}:${workspaceId}`;
  let store = stores.get(key);

  if (!store) {
    store = new VerificationStore(workspaceId);
    stores.set(key, store);
  }

  return store;
}

export function useVerification(store: VerificationStore | undefined, targetId: string | undefined) {
  const subscribe = useCallback(
    (listener: () => void) => (store && targetId ? store.subscribe(targetId, listener) : () => undefined),
    [store, targetId]
  );
  const snapshot = useCallback(() => (store && targetId ? store.snapshot(targetId) : EMPTY), [store, targetId]);

  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function invalidateActiveVerifications() {
  stores.forEach((store) => store.invalidate(true));
}
