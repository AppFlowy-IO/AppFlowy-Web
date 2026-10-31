import { Log } from '@/utils/log';

const INITIAL_RETRY_MS = 60_000;
const MAX_RETRY_MS = 5 * 60_000;

/** Retries an unfinished manifest upload without depending on another edit or reconnect. */
export class ManifestRecovery {
  private timer?: ReturnType<typeof setTimeout>;
  private pending = false;
  private disposed = false;
  private canWrite?: boolean;
  private delay = INITIAL_RETRY_MS;

  constructor(private readonly retry: () => void, private readonly isReady: () => boolean) {}

  /** Sending bytes is not completion. Repeated responses share one retry deadline. */
  start(): void {
    if (this.disposed) return;
    this.pending = true;
    this.schedule();
  }

  /** Only authoritative state coverage retires the pending upload. */
  confirm(): void {
    this.pending = false;
    this.delay = INITIAL_RETRY_MS;
    this.clearTimer();
  }

  /** A positive permission transition wakes retained work, without retrying every notification. */
  setWriteAccess(canWrite: boolean): void {
    const changed = this.canWrite !== canWrite;

    this.canWrite = canWrite;
    if (!canWrite) {
      this.clearTimer();
    } else if (changed && this.pending && !this.disposed) {
      this.clearTimer();
      this.run();
    }
  }

  get writeAllowed(): boolean {
    return this.canWrite !== false;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.confirm();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer !== undefined || !this.pending || this.disposed || !this.writeAllowed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run();
    }, this.delay);
  }

  private run(): void {
    if (!this.pending || this.disposed || !this.writeAllowed) return;
    if (this.isReady()) {
      this.delay = Math.min(this.delay * 2, MAX_RETRY_MS);
      try {
        this.retry();
      } catch (error) {
        Log.warn('[sync] manifest recovery send failed; retaining retry', error);
      }
    }

    this.schedule();
  }
}
