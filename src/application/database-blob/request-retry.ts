import type { APIError } from '@/application/services/js-services/http/core';
import { Log } from '@/utils/log';

const BACKPRESSURE_RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_SERVER_RETRY_AFTER_SECS = 30;

/** Admission rejection is not a corrupt blob and must not fan out into row sync. */
export function isDatabaseBlobBackpressure(error: unknown): error is APIError {
  if (!error || typeof error !== 'object') return false;
  const value = error as Partial<APIError>;

  return value.code === 1079 || value.code === 429 || value.httpStatus === 429;
}

export function throwIfDatabaseBlobAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('The database prefetch was cancelled', 'AbortError');
}

export function waitForDatabaseBlobRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfDatabaseBlobAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The database prefetch was cancelled', 'AbortError'));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Retry the same page; its cursor and watermark remain owned by the page walk. */
export async function withDatabaseBlobBackpressureRetry<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    throwIfDatabaseBlobAborted(signal);
    try {
      const result = await request();

      throwIfDatabaseBlobAborted(signal);
      return result;
    } catch (error) {
      throwIfDatabaseBlobAborted(signal);
      if (!isDatabaseBlobBackpressure(error) || attempt >= BACKPRESSURE_RETRY_DELAYS_MS.length) throw error;
      const retryAfterSecs =
        Number.isFinite(error.retryAfterSecs) && (error.retryAfterSecs ?? 0) > 0 ? error.retryAfterSecs : undefined;

      // Do not retry earlier than a long server cooldown, or retain an abandoned
      // page walk for minutes. Surface the retry action instead.
      if (retryAfterSecs && retryAfterSecs > MAX_SERVER_RETRY_AFTER_SECS) throw error;
      const baseMs = Math.max(BACKPRESSURE_RETRY_DELAYS_MS[attempt], (retryAfterSecs ?? 0) * 1000);
      const delayMs = Math.round(baseMs * (1 + Math.random()));

      Log.debug('[Database] blob admission busy; retrying unchanged page', { attempt: attempt + 1, delayMs });
      await waitForDatabaseBlobRetry(delayMs, signal);
    }
  }
}
