/** Cancellation belongs to a consumer; the transport belongs to all consumers. */
export interface SharedRequest<T> {
  readonly signal: AbortSignal;
  readonly promise: Promise<T>;
  join: (signal?: AbortSignal) => Promise<T>;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The request was cancelled', 'AbortError');
}

export function createSharedRequest<T>(start: (signal: AbortSignal) => Promise<T>): SharedRequest<T> {
  const controller = new AbortController();
  let consumers = 0;
  let settled = false;
  const promise = Promise.resolve().then(() => {
    throwIfAborted(controller.signal);
    return start(controller.signal);
  });
  const markSettled = () => {
    settled = true;
  };

  void promise.then(markSettled, markSettled);
  return {
    signal: controller.signal,
    promise,
    join(signal) {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted && consumers === 0 && !settled) controller.abort();
        throwIfAborted(signal);
        throwIfAborted(controller.signal);
        consumers += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          signal?.removeEventListener('abort', abort);
          consumers -= 1;
        };

        const abort = () => {
          release();
          if (!settled && consumers === 0) controller.abort();
          reject(signal?.reason ?? new DOMException('The request was cancelled', 'AbortError'));
        };

        signal?.addEventListener('abort', abort, { once: true });
        void promise.then(
          (result) => {
            release();
            resolve(result);
          },
          (error: unknown) => {
            release();
            reject(error);
          }
        );
      });
    },
  };
}

/** Backoff must end with its owner, without retaining a timer or starting a retry. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('The request was cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', abort, { once: true });
  });
}
