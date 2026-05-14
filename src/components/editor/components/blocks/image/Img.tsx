import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorOutline } from '@/assets/icons/error.svg';
import LoadingDots from '@/components/_shared/LoadingDots';
import { checkImage, CheckImageErrorKind, CheckImageResult } from '@/utils/image';
import { Log } from '@/utils/log';

// Polling state machine. Note: this tracks the *fetch* lifecycle, not the
// rendered `<img>`'s decode lifecycle — the `<img>`'s native onLoad is what
// flips `isImageReady` independently.
type LoadPhase = 'loading' | 'pending' | 'failed';

// Backoff schedules (ms). Total wall-clock budget is ~5 minutes — long
// enough to outlast a slow upload pipeline, short enough that the user
// notices when something is actually broken.
const FAST_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const SLOW_BACKOFF_MS = [2000, 5000, 10000, 20000, 40000, 80000];
const MAX_BUDGET_MS = 5 * 60 * 1000;

// After this elapsed time without success, switch the UI from "loading" to
// "pending" — a softer state that says "we're still waiting" rather than
// "this failed." Prevents users from interpreting a slow optimistic upload
// as a broken image.
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

function Img({
  onLoad,
  imgRef,
  url,
  width,
}: {
  url: string;
  imgRef?: React.RefObject<HTMLImageElement>;
  onLoad?: () => void;
  width: number | string;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [localUrl, setLocalUrl] = useState('');
  const [lastError, setLastError] = useState<CheckImageResult | null>(null);
  // `<img>`-decode state. Independent of `phase` (which is about *fetching*).
  // Visibility is gated on this so the spinner stays up until the browser
  // has actually painted the image.
  const [isImageReady, setIsImageReady] = useState(false);

  // Refs to keep `runCheck`'s identity stable and to let listeners read the
  // latest values without subscribing. See review bugs #2 and #3.
  const onLoadRef = useRef(onLoad);
  const urlRef = useRef(url);
  const phaseRef = useRef(phase);
  const previousBlobUrlRef = useRef<string>('');
  // In-flight cleanup tracking so we can cancel imperatively on unmount,
  // URL change, or manual retry. See review bugs #4 and #5.
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const timersRef = useRef<Set<number>>(new Set());

  // Mirror props/state into refs every commit. Cheap and lets event handlers
  // and async loops read the current value without re-creating closures.
  useEffect(() => {
    onLoadRef.current = onLoad;
  });
  useEffect(() => {
    urlRef.current = url;
  });
  useEffect(() => {
    phaseRef.current = phase;
  });

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
    if (previousBlobUrlRef.current && previousBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previousBlobUrlRef.current);
      previousBlobUrlRef.current = '';
    }
  }, []);

  // Stable. Reads everything it needs through refs so it never has to be
  // re-created when props change.
  const runCheck = useCallback(
    async (targetUrl: string) => {
      // Anything left over from a previous run is now stale — abort and
      // clear timers up front.
      cancelAllInflight();
      setIsImageReady(false);

      if (!targetUrl) {
        // No URL yet (YJS sync still in flight). Sit in `loading` until a
        // real URL arrives and re-triggers the URL-change effect.
        setPhase('loading');
        setLastError(null);
        return;
      }

      const controller = new AbortController();

      controllersRef.current.add(controller);

      const startedAt = Date.now();
      let attempt = 0;

      setPhase('loading');
      setLastError(null);

      // Promote loading → pending if we cross the threshold without success.
      scheduleTimer(() => {
        if (controller.signal.aborted) return;
        setPhase((p) => (p === 'loading' ? 'pending' : p));
      }, PENDING_AFTER_MS);

      // Cancellable delay between retries. Resolves early if aborted.
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
          Log.warn('[Img] checkImage threw', err);
          result = {
            ok: false,
            status: 0,
            statusText: 'Exception',
            errorKind: 'network',
          };
        }

        if (controller.signal.aborted) {
          // Revoke any blob URL that arrived after cancellation.
          if (result.ok && result.validatedUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(result.validatedUrl);
          }

          return;
        }

        if (result.ok) {
          const newUrl = result.validatedUrl || '';

          if (
            previousBlobUrlRef.current &&
            previousBlobUrlRef.current !== newUrl &&
            previousBlobUrlRef.current.startsWith('blob:')
          ) {
            URL.revokeObjectURL(previousBlobUrlRef.current);
          }

          previousBlobUrlRef.current = newUrl;
          setLocalUrl(newUrl);
          setLastError(null);
          // Stay in 'loading' until <img> fires onLoad and we flip
          // isImageReady. That keeps the spinner up across the decode.
          setPhase('loading');

          controllersRef.current.delete(controller);
          return;
        }

        setLastError(result);

        const schedule = backoffSchedule(result.errorKind);
        const exhausted = attempt >= schedule.length;
        const elapsed = Date.now() - startedAt;

        if (exhausted || elapsed > MAX_BUDGET_MS) {
          setPhase('failed');
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

  // Re-check on tab focus / visibility return — listeners attached ONCE.
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
  }, [runCheck]);

  const handleManualRetry = useCallback(() => {
    void runCheck(urlRef.current);
  }, [runCheck]);

  const handleImageLoaded = useCallback(() => {
    if (!previousBlobUrlRef.current) return;
    setIsImageReady(true);
    setLastError(null);
    // Notify the parent once the image is actually painted, not just fetched.
    onLoadRef.current?.();
  }, []);

  const handleImageError = useCallback(() => {
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

  const showLoading = phase === 'loading' && !isImageReady;
  const showPending = phase === 'pending';
  const showFailed = phase === 'failed';

  return (
    <>
      <img
        ref={imgRef}
        src={localUrl}
        alt={''}
        onLoad={handleImageLoaded}
        onError={handleImageError}
        loading={'lazy'}
        decoding={'async'}
        draggable={false}
        style={{
          visibility: isImageReady ? 'visible' : 'hidden',
          width,
        }}
        className={'h-full bg-cover bg-center object-cover'}
      />
      {showLoading && (
        <div
          className={
            'absolute inset-0 flex h-full w-full items-center justify-center bg-background-primary'
          }
        >
          <LoadingDots />
        </div>
      )}
      {showPending && (
        <div
          className={
            'absolute inset-0 flex h-full w-full items-center justify-center gap-2 bg-background-primary text-text-caption'
          }
        >
          <LoadingDots />
          <div>{t('editor.imageStillUploading', 'Waiting for upload to finish…')}</div>
        </div>
      )}
      {showFailed && (
        <button
          onClick={handleManualRetry}
          className={
            'flex h-[48px] w-full items-center justify-center gap-2 rounded border border-function-error bg-red-50 hover:bg-red-100'
          }
        >
          <ErrorOutline className={'text-function-error'} />
          <div className={'text-function-error'}>
            {lastError?.errorKind === 'forbidden'
              ? t('editor.imageNoAccess', 'You do not have access to this image')
              : t('editor.imageLoadFailed')}
          </div>
          <span className={'text-text-action underline'}>
            {t('button.retry', 'Retry')}
          </span>
        </button>
      )}
    </>
  );
}

export default Img;
