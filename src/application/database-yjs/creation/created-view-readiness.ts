import { ERROR_CODE } from '@/application/constants';

import { assertNotAborted } from './source-readiness';

function retryableRead(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: unknown; transportFailure?: unknown; httpStatus?: unknown };

  return failure.code === ERROR_CODE.RETRY_LATER || failure.code === ERROR_CODE.TOO_MANY_REQUESTS ||
    failure.code === ERROR_CODE.RECORD_NOT_FOUND || failure.transportFailure === 'timeout' ||
    failure.transportFailure === 'network' || [502, 503, 504].includes(Number(failure.httpStatus));
}

/** Only current reads retry after an acknowledged commit. Identity/access failures are final. */
export async function waitForCreatedDatabaseView<T>(options: {
  read: () => Promise<T | undefined>;
  assertCurrent: () => void;
  signal: AbortSignal;
  deadline: number;
}): Promise<T> {
  let delayMs = 250;

  while (!options.signal.aborted) {
    assertNotAborted(options.signal);
    options.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('Created Database view is not readable yet');
    let waitMs = delayMs;

    try {
      const result = await options.read();

      assertNotAborted(options.signal);
      options.assertCurrent();
      if (Date.now() >= options.deadline) throw new Error('Created Database view hydration expired');
      if (result !== undefined) return result;
    } catch (error) {
      assertNotAborted(options.signal);
      options.assertCurrent();
      if (!retryableRead(error)) throw error;
      const retryAfter = (error as { retryAfterSecs?: unknown }).retryAfterSecs;

      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        waitMs = Math.max(waitMs, retryAfter * 1_000);
      }
    }

    await new Promise<void>((resolve, reject) => {
      const finish = () => { options.signal.removeEventListener('abort', abort); resolve(); };

      const timer = setTimeout(finish, Math.min(waitMs, Math.max(0, options.deadline - Date.now())));
      const abort = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); reject(options.signal.reason); };

      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
    });
    delayMs = Math.min(delayMs * 2, 2_000);
  }

  assertNotAborted(options.signal);
  throw new Error('Created Database view hydration cancelled');
}
