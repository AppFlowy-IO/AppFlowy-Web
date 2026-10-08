import { readPersistedRepairUpdate } from './indexeddb';
import { REPAIR_TIMEOUT_MS, type RepairRequest, type RepairUpdate } from './types';

export type RepairOutcome = 'sent' | 'unavailable' | 'cancelled' | 'duplicate' | 'limited';
type RepairReader = (request: RepairRequest, signal: AbortSignal) => Promise<RepairUpdate | undefined>;
type Work = { run: () => Promise<void>; cancel: () => void; signal: AbortSignal };

// Shared across workspace/controller replacement: abandoning an old session must not create an
// extra pool of background IndexedDB reads while its cancellation is still unwinding.
const admission = {
  active: 0,
  queue: [] as Work[],
  pump() {
    while (this.active < 2 && this.queue.length) {
      const work = this.queue.shift()!;

      if (work.signal.aborted) {
        work.cancel();
        continue;
      }

      this.active++;
      void work.run().finally(() => {
        this.active--;
        this.pump();
      });
    }
  },
};

/** Bounded donation attempts for one authenticated workspace connection. No live Doc is retained. */
export class BackgroundRepairDonor {
  private readonly requests = new Set<string>();
  private readonly objects = new Set<string>();
  private readonly controllers = new Set<AbortController>();
  private disposed = false;

  constructor(private readonly read: RepairReader = readPersistedRepairUpdate) {}

  submit(request: RepairRequest, publish: (update: RepairUpdate) => Promise<boolean>): Promise<RepairOutcome> {
    if (this.disposed) return Promise.resolve('cancelled');
    if (this.requests.has(request.requestId) || this.objects.has(request.objectId)) return Promise.resolve('duplicate');
    // A connection gets a finite request budget, including misses, so unavailable caches cannot
    // become an unbounded local database scan. A fresh connection receives a fresh budget.
    if (this.requests.size >= 128 || admission.queue.length >= 16) return Promise.resolve('limited');
    this.requests.add(request.requestId);
    this.objects.add(request.objectId);
    const controller = new AbortController();

    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), REPAIR_TIMEOUT_MS);

    return new Promise((resolve) => {
      const finish = (outcome: RepairOutcome) => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abortQueued);
        this.controllers.delete(controller);
        this.objects.delete(request.objectId);
        resolve(outcome);
      };

      const work: Work = {
        signal: controller.signal,
        cancel: () => finish('cancelled'),
        run: async () => {
          try {
            const update = await this.read(request, controller.signal);

            if (this.disposed || controller.signal.aborted) {
              finish('cancelled');
              return;
            }

            finish(update && (await publish(update)) ? 'sent' : 'unavailable');
          } catch {
            finish(controller.signal.aborted || this.disposed ? 'cancelled' : 'unavailable');
          }
        },
      };
      const abortQueued = () => {
        const index = admission.queue.indexOf(work);

        if (index !== -1) {
          admission.queue.splice(index, 1);
          work.cancel();
        }
      };

      controller.signal.addEventListener('abort', abortQueued, { once: true });
      admission.queue.push(work);
      admission.pump();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
