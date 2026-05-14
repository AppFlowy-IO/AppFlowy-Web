import { useCallback, useEffect, useRef, useState } from 'react';

import { checkImage, CheckImageErrorKind, CheckImageResult } from '@/utils/image';
import { Log } from '@/utils/log';

/**
 * Polling state machine. Note: this tracks the *fetch* lifecycle, not the
 * rendered `<img>`'s decode lifecycle — the `<img>`'s native onLoad is what
 * flips `isImageReady` independently.
 */
export type LoadPhase = 'loading' | 'pending' | 'failed';

/**
 * Backoff schedules (ms). Total wall-clock budget is ~5 minutes — long
 * enough to outlast a slow upload pipeline, short enough that the user
 * notices when something is actually broken.
 */
const FAST_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const SLOW_BACKOFF_MS = [2000, 5000, 10000, 20000, 40000, 80000];
const MAX_BUDGET_MS = 5 * 60 * 1000;

/**
 * After this elapsed time without success, the UI promotes "loading"
 * to "pending" — a softer state that says "we're still waiting" rather
 * than "this failed." Prevents users from interpreting a slow optimistic
 * upload as a broken image.
 */
const PENDING_AFTER_MS = 10_000;

function backoffSchedule(kind: CheckImageErrorKind | undefined): number[] {
  switch (kind) {
    case 'not-ready':
    case 'no-auth':
    case 'auth-rejected':
      return FAST_BACKOFF_MS;
    case 'forbidden':
      return []; // terminal — don't retry
    case 'not-found':
    case 'server-error':
    case 'network':
    case 'format':
    default:
      return SLOW_BACKOFF_MS;
  }
}

function jitter(ms: number): number {
  // ±20% jitter so a hundred clients don't synchronize retries on the same
  // edge cache miss / origin warm-up.
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

/**
 * Holds the latest value of `value` in a ref. Lets event handlers and async
 * loops read the current value without subscribing — keeping their identity
 * stable across renders. Equivalent to Vercel's `advanced-use-latest` pattern.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export interface UseImageWithRetryResult {
  /** URL to put on the rendered `<img src>`. Empty until the fetch succeeds. */
  src: string;
  /** Fetch-loop phase (independent of `<img>` decode). */
  phase: LoadPhase;
  /** True once the `<img>` has actually painted. Use to gate visibility. */
  isImageReady: boolean;
  /** Last error result, useful for distinguishing forbidden vs. generic failure. */
  lastError: CheckImageResult | null;
  /** Force a re-fetch (e.g. from a manual "Retry" button). */
  retry: () => void;
  /** Attach to the rendered `<img>`'s onLoad. */
  onImageLoaded: () => void;
  /** Attach to the rendered `<img>`'s onError. */
  onImageError: () => void;
}

/**
 * Fetch an image URL with status-aware exponential backoff, surface a state
 * machine the renderer can consume, and clean up after itself on unmount /
 * URL change / manual retry.
 *
 * Why this is a hook, not inline in `Img.tsx`:
 *   - The state machine is non-trivial (3 phases × abort controllers ×
 *     timers × refs to dodge stale closures). Keeping it outside the
 *     render function makes both the orchestration and the JSX readable
 *     in isolation.
 *   - Unit-testable with React Testing Library + a `fetch` mock; the JSX
 *     stays focused on accessibility / styling.
 */
export function useImageWithRetry(
  url: string,
  onReady?: () => void
): UseImageWithRetryResult {
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [src, setSrc] = useState('');
  const [lastError, setLastError] = useState<CheckImageResult | null>(null);
  const [isImageReady, setIsImageReady] = useState(false);

  // Refs let event handlers and async loops read the latest values without
  // subscribing — keeps `runCheck`'s identity stable so its useEffect
  // doesn't tear down on every parent render.
  const onReadyRef = useLatest(onReady);
  const urlRef = useLatest(url);
  const phaseRef = useLatest(phase);
  // The blob URL we're currently rendering. Tracked separately from `src`
  // state because we need ref-stable access from the async loop in order
  // to revoke it correctly on swap/unmount.
  const currentBlobUrlRef = useRef<string>('');
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const timersRef = useRef<Set<number>>(new Set());

  const scheduleTimer = useCallback((cb: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      cb();
    }, ms);

    timersRef.current.add(id);
    return id;
  }, []);

  const cancelAllInflight = useCallback(() => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current.clear();
  }, []);

  const revokePreviousBlob = useCallback(() => {
    if (currentBlobUrlRef.current && currentBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = '';
    }
  }, []);

  const runCheck = useCallback(
    async (targetUrl: string) => {
      cancelAllInflight();
      setIsImageReady(false);

      if (!targetUrl) {
        setPhase('loading');
        setLastError(null);
        return;
      }

      const controller = new AbortController();

      controllersRef.current.add(controller);

      const startedAt = Date.now();
      let attempt = 0;
      // Tracks whether this run has completed (success or terminal failure).
      // The pending-promotion timer checks this so we don't briefly flash the
      // "still uploading…" UI between fetch success and <img> decode.
      let settled = false;

      setPhase('loading');
      setLastError(null);

      // Promote loading → pending if we cross the threshold without success.
      scheduleTimer(() => {
        if (controller.signal.aborted || settled) return;
        setPhase((p) => (p === 'loading' ? 'pending' : p));
      }, PENDING_AFTER_MS);

      // Cancellable delay between retries. Resolves early if aborted so we
      // don't block on a 60-second sleep after the user navigates away.
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          const onAbort = () => {
            window.clearTimeout(id);
            timersRef.current.delete(id);
            resolve();
          };

          const id = scheduleTimer(() => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          }, ms);

          controller.signal.addEventListener('abort', onAbort, { once: true });
        });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (controller.signal.aborted) return;

        let result: CheckImageResult;

        try {
          result = await checkImage(targetUrl, {
            retry: attempt > 0,
            signal: controller.signal,
          });
        } catch (err) {
          Log.warn('[useImageWithRetry] checkImage threw', err);
          result = {
            ok: false,
            status: 0,
            statusText: 'Exception',
            errorKind: 'network',
          };
        }

        if (controller.signal.aborted) {
          if (result.ok && result.validatedUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(result.validatedUrl);
          }

          return;
        }

        if (result.ok) {
          const newUrl = result.validatedUrl || '';

          if (
            currentBlobUrlRef.current &&
            currentBlobUrlRef.current !== newUrl &&
            currentBlobUrlRef.current.startsWith('blob:')
          ) {
            URL.revokeObjectURL(currentBlobUrlRef.current);
          }

          currentBlobUrlRef.current = newUrl;
          setSrc(newUrl);
          setLastError(null);
          // Stay in 'loading' until <img> fires onLoad and we flip
          // isImageReady. That keeps the spinner up across the decode.
          setPhase('loading');
          settled = true;
          controllersRef.current.delete(controller);
          return;
        }

        setLastError(result);

        const schedule = backoffSchedule(result.errorKind);
        const exhausted = attempt >= schedule.length;
        const elapsed = Date.now() - startedAt;

        if (exhausted || elapsed > MAX_BUDGET_MS) {
          setPhase('failed');
          settled = true;
          controllersRef.current.delete(controller);
          return;
        }

        await sleep(jitter(schedule[attempt]));
        attempt += 1;
      }
    },
    [cancelAllInflight, scheduleTimer]
  );

  // Kick off (or restart) the check whenever the URL changes.
  useEffect(() => {
    void runCheck(url);

    return () => {
      cancelAllInflight();
      revokePreviousBlob();
    };
  }, [url, runCheck, cancelAllInflight, revokePreviousBlob]);

  // Re-check when the tab regains focus and we're currently failed/pending.
  // Attached ONCE; reads via refs so we don't churn listeners on every state change.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (phaseRef.current === 'failed' || phaseRef.current === 'pending') {
        void runCheck(urlRef.current);
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // Refs have stable identity, including them just satisfies the linter.
  }, [runCheck, phaseRef, urlRef]);

  const retry = useCallback(() => {
    void runCheck(urlRef.current);
  }, [runCheck, urlRef]);

  const onImageLoaded = useCallback(() => {
    if (!currentBlobUrlRef.current) return;
    setIsImageReady(true);
    setLastError(null);
    // Notify the parent once the bytes are visible, not just downloaded.
    onReadyRef.current?.();
  }, [onReadyRef]);

  const onImageError = useCallback(() => {
    // The browser couldn't decode the bytes we gave it (rare — corrupted
    // blob, format mismatch). Treat as a format error and stop retrying.
    setIsImageReady(false);
    setLastError({
      ok: false,
      status: 0,
      statusText: 'Decode failed',
      errorKind: 'format',
    });
    setPhase('failed');
  }, []);

  return {
    src,
    phase,
    isImageReady,
    lastError,
    retry,
    onImageLoaded,
    onImageError,
  };
}
