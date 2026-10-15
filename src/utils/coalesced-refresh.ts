/**
 * Run one read at a time, retaining only the latest requested follow-up.
 *
 * Callers invalidate their authority synchronously before enqueueing and check their own scope
 * before starting or publishing a read. All callers share the final queued result (or error).
 * A slow read must settle before the next starts; this bounds concurrency, not request duration.
 */
export function createCoalescedRefresh<T>() {
  let pending: (() => Promise<T>) | undefined;
  let running: Promise<T | undefined> | undefined;

  return (read: () => Promise<T>): Promise<T | undefined> => {
    pending = read;
    if (!running) {
      running = Promise.resolve().then(async () => {
        let result: T | undefined;
        let failure: { error: unknown } | undefined;

        try {
          while (pending) {
            const next = pending;

            pending = undefined;
            failure = undefined;
            try {
              result = await next();
            } catch (error) {
              failure = { error };
            }
          }

          if (failure) throw failure.error;
          return result;
        } finally {
          running = undefined;
        }
      });
    }

    return running;
  };
}
