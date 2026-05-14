import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorOutline } from '@/assets/icons/error.svg';
import LoadingDots from '@/components/_shared/LoadingDots';
import { checkImage, CheckImageErrorKind, CheckImageResult } from '@/utils/image';
import { Log } from '@/utils/log';

type LoadPhase = 'loading' | 'pending' | 'failed';

// Backoff schedule (ms). The polling stops once we either succeed or hit the
// last entry. Total wall-clock budget is ~5 minutes — long enough to outlast
// a slow upload pipeline, short enough that the user notices when something
// is actually broken.
const FAST_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const SLOW_BACKOFF_MS = [2000, 5000, 10000, 20000, 40000, 80000];
// After this elapsed time without success, switch the UI from "loading" to
// "pending" — a softer state that says "we're still waiting" rather than
// "this failed." This prevents users from interpreting a slow optimistic
// upload as a broken image.
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
  // ±20% jitter so a hundred clients don't synchronize their retries on the
  // same edge cache miss / origin warm-up.
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

  const previousBlobUrlRef = useRef<string>('');
  const isMountedRef = useRef(true);
  // Bumped on every restart to invalidate in-flight retry chains (focus
  // re-checks, manual retries, URL changes). Any pending setTimeout callback
  // that observes a stale generation just bails.
  const runGenerationRef = useRef(0);

  const revokePreviousBlob = useCallback(() => {
    if (previousBlobUrlRef.current && previousBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previousBlobUrlRef.current);
      previousBlobUrlRef.current = '';
    }
  }, []);

  const runCheck = useCallback(
    async (targetUrl: string) => {
      if (!targetUrl) {
        // Empty URL means the block hasn't received a `data.url` yet (YJS
        // sync in flight, or new image block). Don't waste retry attempts;
        // just sit in `loading` until a real URL arrives and re-triggers
        // this effect.
        setPhase('loading');
        setLastError(null);
        return;
      }

      const generation = ++runGenerationRef.current;
      const startedAt = Date.now();
      let attempt = 0;

      setPhase('loading');
      setLastError(null);

      // Promote loading → pending if we cross the threshold without success.
      const pendingTimer = window.setTimeout(() => {
        if (!isMountedRef.current) return;
        if (runGenerationRef.current !== generation) return;
        setPhase((p) => (p === 'loading' ? 'pending' : p));
      }, PENDING_AFTER_MS);

      const cleanup = () => window.clearTimeout(pendingTimer);

      // Loop until success, until we exhaust the schedule, or until cancelled.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!isMountedRef.current || runGenerationRef.current !== generation) {
          cleanup();
          return;
        }

        let result: CheckImageResult;

        try {
          result = await checkImage(targetUrl);
        } catch (err) {
          Log.warn('[Img] checkImage threw', err);
          result = {
            ok: false,
            status: 0,
            statusText: 'Exception',
            errorKind: 'network',
          };
        }

        if (!isMountedRef.current || runGenerationRef.current !== generation) {
          // We were cancelled mid-fetch; revoke any blob URL that arrived too late.
          if (result.ok && result.validatedUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(result.validatedUrl);
          }

          cleanup();
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
          setPhase('loading'); // <img>'s onLoad will resolve this fully

          cleanup();
          // Defer the onLoad callback so the consumer's effects observe the
          // src change first, mirroring the previous behavior.
          window.setTimeout(() => {
            if (isMountedRef.current && runGenerationRef.current === generation) {
              onLoad?.();
            }
          }, 100);
          return;
        }

        setLastError(result);

        const schedule = backoffSchedule(result.errorKind);
        const exhausted = attempt >= schedule.length;
        const elapsed = Date.now() - startedAt;

        // Hard wall-clock cap — even if backoff would happily continue.
        if (exhausted || elapsed > 5 * 60 * 1000) {
          setPhase('failed');
          cleanup();
          return;
        }

        const delayMs = jitter(schedule[attempt]);

        attempt += 1;

        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    },
    [onLoad]
  );

  useEffect(() => {
    isMountedRef.current = true;
    void runCheck(url);

    return () => {
      isMountedRef.current = false;
      // Invalidate any in-flight retry loop bound to this URL.
      runGenerationRef.current += 1;
      revokePreviousBlob();
    };
  }, [url, runCheck, revokePreviousBlob]);

  // Re-check when the tab regains focus and we're currently failed/pending.
  // Matches the user's mental model: "I came back to the tab and it appears."
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (phase === 'failed' || phase === 'pending') {
        void runCheck(url);
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [phase, url, runCheck]);

  const handleManualRetry = useCallback(() => {
    void runCheck(url);
  }, [runCheck, url]);

  const showLoading = phase === 'loading';
  const showPending = phase === 'pending';
  const showFailed = phase === 'failed';
  const hideImage = showLoading || showPending || showFailed;

  return (
    <>
      <img
        ref={imgRef}
        src={localUrl}
        alt={''}
        onLoad={() => {
          if (localUrl) {
            setPhase('loading'); // ensures hideImage flips off
            setLastError(null);
          }
        }}
        draggable={false}
        style={{
          visibility: hideImage ? 'hidden' : 'visible',
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
