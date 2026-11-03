import { DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { Log } from '@/utils/log';

/** How long an unreferenced owned view waits before it is deleted (WP05 §1.5). */
export const OWNED_VIEW_DELETION_DELAY_MS = 60_000;

export interface OwnedViewDeletionQueueDeps {
  /** The dashboard whose owned views this queue deletes. */
  dashboardViewId: string;
  /** Whether the dashboard's current rows reference the view, read at flush time. */
  isReferenced: (viewId: string) => boolean;
  /**
   * The view's owner as known right now (the collab mirrors, the catalog, the
   * outline), `null` when not owned or unknown. Decides what is queued.
   */
  ownerOfNow: (viewId: string, databaseId: string) => string | null;
  /** The authoritative owner, read at flush time (the folder marker, else the collab mirror). */
  resolveOwner: (viewId: string, databaseId: string) => Promise<string | null>;
  /** Delete the view the normal way (folder trash, then the collab view). */
  deleteView: (viewId: string, databaseId: string) => Promise<void>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  delayMs?: number;
}

interface QueuedView {
  viewId: string;
  databaseId: string;
  deadline: number;
  /** Deleted at its deadline only, never by an early flush (the open-time sweep). */
  deadlineOnly: boolean;
}

export interface EnqueueOptions {
  /**
   * Leave the view to its deadline: Done and close do not delete it. For the
   * views a writer's open sweeps up (a collaborator's add may be about to
   * insert one).
   */
  deadlineOnly?: boolean;
}

/**
 * Deletes the views a dashboard owns once no widget shows them any more
 * (WP05 §1.5). Every rows change made by this client (a write, an undo, a
 * redo) is reconciled: a view whose last widget went away is queued, a view
 * a widget shows again leaves the queue. The queue is flushed when editing
 * ends (Done), when the dashboard closes and at each item's 60 s deadline
 * (one timer, on the earliest one). A flush deletes a view only while no
 * widget references it and this dashboard still owns it; failures (gone, no
 * access, offline) are logged and the item dropped. Remote changes and
 * readers never queue anything.
 */
export class OwnedViewDeletionQueue {
  private readonly items = new Map<string, QueuedView>();

  private timer: unknown = null;

  private timerDeadline = Number.POSITIVE_INFINITY;

  private disposed = false;

  constructor(private readonly deps: OwnedViewDeletionQueueDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private get delay() {
    return this.deps.delayMs ?? OWNED_VIEW_DELETION_DELAY_MS;
  }

  /** The queued view ids, in queue order. */
  get viewIds(): string[] {
    return Array.from(this.items.keys());
  }

  has(viewId: string) {
    return this.items.has(viewId);
  }

  /** Queue an owned, unreferenced view; a view already queued keeps its deadline. */
  enqueue(viewId: string, databaseId: string, options: EnqueueOptions = {}) {
    const queued = this.items.get(viewId);

    if (this.disposed) return;
    if (queued) {
      // An explicit enqueue (a removed widget) also allows an early flush.
      if (!options.deadlineOnly) queued.deadlineOnly = false;
      return;
    }

    this.items.set(viewId, {
      viewId,
      databaseId,
      deadline: this.now() + this.delay,
      deadlineOnly: options.deadlineOnly ?? false,
    });
    this.schedule();
  }

  dequeue(viewId: string) {
    if (!this.items.delete(viewId)) return;
    this.schedule();
  }

  /**
   * One local rows change: every view shown before but not after that this
   * dashboard owns is queued; every view shown after leaves the queue.
   */
  reconcile(before: readonly DashboardWidget[], after: readonly DashboardWidget[]) {
    const shown = new Set(after.map((widget) => widget.viewId));

    shown.forEach((viewId) => this.dequeue(viewId));
    const seen = new Set<string>();

    before.forEach((widget) => {
      if (shown.has(widget.viewId) || seen.has(widget.viewId)) return;
      seen.add(widget.viewId);
      if (this.deps.ownerOfNow(widget.viewId, widget.databaseId) === this.deps.dashboardViewId) {
        this.enqueue(widget.viewId, widget.databaseId);
      }
    });
  }

  /**
   * Delete every queued view that is still unreferenced and still owned by
   * this dashboard (sweep items wait for their deadline).
   */
  async flush(): Promise<void> {
    const now = this.now();
    const due = Array.from(this.items.values()).filter((item) => !item.deadlineOnly || item.deadline <= now);

    due.forEach((item) => this.items.delete(item.viewId));
    this.schedule();
    await this.process(due);
  }

  /** Stop the timer without deleting anything (the caller flushed already, or gives up). */
  dispose() {
    this.disposed = true;
    this.items.clear();
    this.clearTimer();
  }

  private async process(items: QueuedView[]) {
    for (const item of items) {
      if (this.deps.isReferenced(item.viewId)) continue;

      try {
        const owner = await this.deps.resolveOwner(item.viewId, item.databaseId);

        // A widget may have come back while the owner was read.
        if (owner !== this.deps.dashboardViewId || this.deps.isReferenced(item.viewId)) continue;
        await this.deps.deleteView(item.viewId, item.databaseId);
      } catch (error) {
        Log.warn('[Dashboard] could not delete an owned widget view', { viewId: item.viewId, error });
      }
    }
  }

  private clearTimer() {
    if (this.timer !== null) {
      (this.deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    }

    this.timer = null;
    this.timerDeadline = Number.POSITIVE_INFINITY;
  }

  /** One timer, on the earliest deadline. */
  private schedule() {
    if (this.disposed) return;
    let earliest = Number.POSITIVE_INFINITY;

    this.items.forEach((item) => {
      earliest = Math.min(earliest, item.deadline);
    });
    if (earliest === this.timerDeadline) return;
    this.clearTimer();
    if (earliest === Number.POSITIVE_INFINITY) return;
    this.timerDeadline = earliest;
    const setTimer = this.deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));

    this.timer = setTimer(() => {
      this.timer = null;
      this.timerDeadline = Number.POSITIVE_INFINITY;
      void this.flushDue();
    }, Math.max(0, earliest - this.now()));
  }

  private async flushDue() {
    const now = this.now();
    const due = Array.from(this.items.values()).filter((item) => item.deadline <= now);

    due.forEach((item) => this.items.delete(item.viewId));
    this.schedule();
    await this.process(due);
  }
}
