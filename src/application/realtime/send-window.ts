import type { collab, messages } from '@/proto/messages';

const UPDATE_WINDOW = 32;
const MANIFEST_WINDOW = 16;
const UPDATE_BYTES_WINDOW = 8 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 30_000;
const NIL_RESTORE_ID = '00000000-0000-0000-0000-000000000000';

export class RealtimeBackpressureError extends Error {
  constructor() {
    super('Realtime send window is full; retain the update in the durable outbox');
    this.name = 'RealtimeBackpressureError';
  }
}

interface WindowOptions {
  send: (message: messages.IMessage, keep: boolean) => void;
  onUpdateStalled: () => void;
  onManifestTimeout: (objectId: string) => void;
  maxUpdates?: number;
  maxManifests?: number;
  maxUpdateBytes?: number;
  responseTimeoutMs?: number;
}

interface Attempt {
  deadline: number;
  restoreId: string;
  bytes: number;
}

/**
 * Bounds traffic on one workspace socket, including messages relayed by sibling tabs.
 * Updates are never buffered here: a refusal leaves ownership with the persistent outbox.
 * Manifest requests coalesce by object and release their read slot on a server state vector.
 */
export class CollabSendWindow {
  private ready = false;
  private updateAckSupported = false;
  private stalled = false;
  private sentUntrackedUpdate = false;
  private disposed = false;
  private updates = new Map<string, Attempt>();
  private manifests = new Map<string, Attempt>();
  private waitingUpdateBytes = new Map<string, number>();
  private updateBytes = 0;
  private pendingManifests = new Map<string, { message: messages.IMessage; keep: boolean }>();
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: WindowOptions) {}

  setConnection(ready: boolean, updateAckSupported: boolean): void {
    if (this.disposed) return;
    if (!ready) {
      if (this.ready) this.disconnect();
      return;
    }

    // Negotiate at the connection boundary: an old ACK must not retire a new tracked send
    // when server-info finishes loading partway through an already active legacy connection.
    if (!this.ready || (updateAckSupported && !this.sentUntrackedUpdate)) {
      this.updateAckSupported = updateAckSupported;
    }

    this.ready = true;
    this.flushManifests();
    this.notifyReady();
  }

  canSendUpdate(objectId?: string): boolean {
    return !this.disposed && this.ready && !this.stalled && (!this.updateAckSupported || (
      this.updates.size < (this.options.maxUpdates ?? UPDATE_WINDOW) &&
      (objectId === undefined || !this.updates.has(objectId)) &&
      this.hasByteCapacity(objectId === undefined ? 0 : this.waitingUpdateBytes.get(objectId) ?? 0)
    ));
  }

  subscribeReady(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  send(message: messages.IMessage, keep = true): void {
    if (this.disposed) throw new RealtimeBackpressureError();
    const payload = message.collabMessage;
    const objectId = payload?.objectId;

    if (objectId && payload.syncRequest) {
      this.pendingManifests.set(objectId, { message, keep });
      this.flushManifests();
      return;
    }

    const update = payload?.update;

    if (update && (update.flags ?? 0) === 0 && update.payload?.length === 2 &&
        update.payload[0] === 0 && update.payload[1] === 0) return;

    if (!objectId || !update || !this.updateAckSupported) {
      this.options.send(message, keep);
      if (update) this.sentUntrackedUpdate = true;
      return;
    }

    const bytes = update.payload?.length ?? 0;

    if (!this.canSendUpdate(objectId) || !this.hasByteCapacity(bytes)) {
      this.waitingUpdateBytes.set(objectId, bytes);
      throw new RealtimeBackpressureError();
    }

    this.waitingUpdateBytes.delete(objectId);
    this.updates.set(objectId, this.attempt(update.databaseRestoreId, bytes));
    this.updateBytes += bytes;
    try {
      this.options.send(message, keep);
    } catch (error) {
      this.retireUpdate(objectId);
      throw error;
    } finally {
      this.armDeadline();
    }
  }

  receive(message: collab.ICollabMessage): void {
    if (!this.ready || this.disposed || !message.objectId) return;
    const objectId = message.objectId;
    let updateRetired = false;

    if (message.updateAck) {
      const current = this.updates.get(objectId);

      if (current && current.restoreId === (message.updateAck.databaseRestoreId || NIL_RESTORE_ID)) {
        updateRetired = this.retireUpdate(objectId);
      }
    }

    if (message.syncRequest) this.manifests.delete(objectId);
    if (message.accessChanged && (message.accessChanged.canRead === false || message.accessChanged.canWrite === false)) {
      updateRetired = this.retireUpdate(objectId) || updateRetired;
      this.manifests.delete(objectId);
      this.pendingManifests.delete(objectId);
    }

    this.flushManifests();
    this.armDeadline();
    if (updateRetired) this.notifyReady();
  }

  disconnect(): void {
    this.ready = false;
    this.stalled = false;
    this.sentUntrackedUpdate = false;
    this.updates.clear();
    this.waitingUpdateBytes.clear();
    this.updateBytes = 0;
    this.manifests.clear();
    this.pendingManifests.clear();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.notifyReady();
  }

  dispose(): void {
    this.disconnect();
    this.disposed = true;
    this.listeners.clear();
  }

  private attempt(restoreId?: string | null, bytes = 0): Attempt {
    return { deadline: Date.now() + (this.options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS),
      restoreId: restoreId || NIL_RESTORE_ID, bytes };
  }

  private hasByteCapacity(bytes: number): boolean {
    // One individually valid frame may exceed this soft pacing budget; let it run alone.
    const limit = this.options.maxUpdateBytes ?? UPDATE_BYTES_WINDOW;

    return this.updates.size === 0 || (bytes === 0 ? this.updateBytes < limit : this.updateBytes + bytes <= limit);
  }

  private retireUpdate(objectId: string): boolean {
    const attempt = this.updates.get(objectId);

    if (!attempt) return false;
    this.updateBytes -= attempt.bytes;
    return this.updates.delete(objectId);
  }

  private flushManifests(): void {
    if (!this.ready || this.disposed || this.stalled) return;
    for (const [objectId, pending] of this.pendingManifests) {
      if (this.manifests.size >= (this.options.maxManifests ?? MANIFEST_WINDOW)) break;
      if (this.manifests.has(objectId)) continue;
      this.pendingManifests.delete(objectId);
      this.manifests.set(objectId, this.attempt());
      try {
        this.options.send(pending.message, pending.keep);
      } catch (error) {
        this.manifests.delete(objectId);
        this.pendingManifests.set(objectId, pending);
        this.armDeadline();
        throw error;
      }
    }

    this.armDeadline();
  }

  private armDeadline(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || !this.ready || this.stalled) return;
    const deadlines = [...this.updates.values(), ...this.manifests.values()].map((a) => a.deadline);

    if (deadlines.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const now = Date.now();

      if ([...this.updates.values()].some((a) => a.deadline <= now)) {
        // No ACK is a recovery condition, not permission to send a causal successor.
        this.stalled = true;
        this.options.onUpdateStalled();
        return;
      }

      for (const [objectId, attempt] of this.manifests) {
        if (attempt.deadline > now) continue;
        this.manifests.delete(objectId);
        this.options.onManifestTimeout(objectId);
      }

      this.flushManifests();
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
  }

  private notifyReady(): void {
    for (const listener of this.listeners) listener();
  }
}
