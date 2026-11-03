interface SchedulerOptions {
  concurrency: number;
  canRun: (objectId: string) => boolean;
  run: (objectId: string) => Promise<void>;
  onError: (objectId: string, error: unknown) => void;
}

/** Stores object IDs, not captured updates; only bounded workers read payloads from IndexedDB. */
export class OutboxDrainScheduler {
  private queued = new Set<string>();
  private active = new Set<string>();
  private wakePending = false;

  constructor(private readonly options: SchedulerOptions) {}

  enqueue(objectId: string): void {
    this.queued.add(objectId);
    this.wake();
  }

  hasWork(objectId: string): boolean {
    return this.queued.has(objectId) || this.active.has(objectId);
  }

  cancel(objectId: string): void {
    this.queued.delete(objectId);
  }

  clear(): void {
    this.queued.clear();
  }

  wake(): void {
    if (this.wakePending) return;
    this.wakePending = true;
    void Promise.resolve().then(() => {
      this.wakePending = false;
      this.pump();
    });
  }

  private pump(): void {
    for (const objectId of this.queued) {
      if (this.active.size >= this.options.concurrency) break;
      if (this.active.has(objectId) || !this.options.canRun(objectId)) continue;
      this.queued.delete(objectId);
      this.active.add(objectId);
      // The owner installs its active promise synchronously for purge/discard to join.
      this.options.run(objectId).catch((error) => this.options.onError(objectId, error)).finally(() => {
        this.active.delete(objectId);
        this.wake();
      });
    }
  }
}
