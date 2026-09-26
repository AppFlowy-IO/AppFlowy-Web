import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import { ERROR_CODE } from '@/application/constants';
import type { DatabaseRestoreJob } from '@/application/database-history.type';
import { getDatabaseRestoreJob, startDatabaseRestore } from '@/application/services/domains/database-history';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';

interface PendingRestore {
  version: string;
  idempotencyKey: string;
  jobId?: string;
  /** Persisted before sending so an interrupted enqueue cannot become a new job. */
  enqueueUncertain: boolean;
}

const accessDeniedCodes = new Set<number>([
  ERROR_CODE.NOT_LOGGED_IN, ERROR_CODE.NOT_HAS_PERMISSION, ERROR_CODE.USER_UNAUTHORIZED,
]);
const rejectedRestoreCodes = new Set<number>([
  ERROR_CODE.RECORD_NOT_FOUND, ERROR_CODE.RECORD_DELETED,
  ERROR_CODE.WORKSPACE_NOT_FOUND, ERROR_CODE.FEATURE_NOT_AVAILABLE,
]);

export function databaseHistoryError(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
}

function readPending(key: string): PendingRestore | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as PendingRestore | null;

    return value && typeof value.version === 'string' && typeof value.idempotencyKey === 'string' &&
      (value.jobId === undefined || typeof value.jobId === 'string')
      // Older saved intents may already have reached the server.
      ? { ...value, enqueueUncertain: value.enqueueUncertain !== false } : null;
  } catch {
    return null;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };

    const timer = window.setTimeout(done, ms);

    signal.addEventListener('abort', done, { once: true });
  });
}

/** Closing history cancels observation, never the durable server job. */
export function useDatabaseHistoryRestore({
  open, userId, workspaceId, databaseId, onRestored,
}: {
  open: boolean;
  userId: string;
  workspaceId: string;
  databaseId: string;
  onRestored: (databaseId: string, restoreId: string) => Promise<void>;
}) {
  const storageKey = `af_database_history_restore:v1:${defaultConfig.baseURL}:${userId}:${workspaceId}:${databaseId}`;
  const [pending, setPending] = useState<PendingRestore | null>(() => readPending(storageKey));
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [job, setJob] = useState<DatabaseRestoreJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const onRestoredRef = useRef(onRestored);

  onRestoredRef.current = onRestored;

  useEffect(() => {
    if (loadedStorageKey === storageKey) return;
    setPending(readPending(storageKey));
    setLoadedStorageKey(storageKey);
    setJob(null);
    setError(null);
  }, [storageKey, loadedStorageKey]);

  const start = useCallback((version: string) => {
    if (pending || loadedStorageKey !== storageKey) return;
    const next = { version, idempotencyKey: uuid(), enqueueUncertain: false };

    try {
      // Persist before sending: a lost enqueue response must reuse the same key.
      localStorage.setItem(storageKey, JSON.stringify(next));
      setError(null);
      setPending(next);
    } catch {
      setError('Browser storage is unavailable. Enable it to safely track this restore.');
    }
  }, [pending, storageKey, loadedStorageKey]);

  useEffect(() => {
    if (!open || !pending || !userId || loadedStorageKey !== storageKey) return;
    const controller = new AbortController();
    const { signal } = controller;

    void (async () => {
      const saved = readPending(storageKey);
      const current = saved?.idempotencyKey === pending.idempotencyKey ? saved : { ...pending };
      let backoff = 1_000;

      while (!signal.aborted) {
        const wasEnqueueUncertain = current.enqueueUncertain;

        try {
          if (!current.jobId) {
            current.enqueueUncertain = true;
            localStorage.setItem(storageKey, JSON.stringify(current));
          }

          const nextJob = current.jobId
            ? await getDatabaseRestoreJob(workspaceId, databaseId, current.jobId, signal)
            : await startDatabaseRestore(workspaceId, databaseId, current.version, current.idempotencyKey, signal);

          if (signal.aborted) return;
          if (nextJob.workspace_id !== workspaceId || nextJob.database_id !== databaseId ||
              nextJob.target_version !== current.version) {
            throw new Error('The server returned a restore job for a different database version.');
          }

          current.jobId = nextJob.job_id;
          localStorage.setItem(storageKey, JSON.stringify(current));
          setJob(nextJob);
          setError(null);
          backoff = 1_000;
          if (nextJob.state === 'failed' || nextJob.state === 'cancelled') {
            localStorage.removeItem(storageKey);
            setPending(null);
            setError(nextJob.error || 'The database restore did not complete.');
            return;
          }

          if (nextJob.state === 'succeeded') {
            if (!nextJob.result?.pre_restore_version) {
              setError('The server did not return the required recovery version. Refresh the database before continuing.');
              return;
            }

            await onRestoredRef.current(databaseId, nextJob.job_id);
            if (signal.aborted) return;
            localStorage.removeItem(storageKey);
            setPending(null);
            setCompleted((value) => value + 1);
            return;
          }
        } catch (failure) {
          if (signal.aborted) return;
          setError(databaseHistoryError(failure));
          const details = failure as { code?: number; httpStatus?: number; retryAfterSecs?: number } | null;
          // API envelopes expose a code without an HTTP status. Keep unknown,
          // conflict, timeout, and rate-limit responses uncertain and retryable.
          const status = details?.httpStatus ?? details?.code ?? 0;
          const code = details?.code ?? 0;
          const accessDenied = status === 401 || status === 403 || accessDeniedCodes.has(code);
          const definitivelyRejected = accessDenied || rejectedRestoreCodes.has(code) ||
            (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429);

          // Release an intent only after a definitive first enqueue rejection.
          // Accepted jobs, lost responses, and interrupted enqueues retain their
          // identity even if a later request cannot find/access the job.
          if (definitivelyRejected) {
            if (!current.jobId && !wasEnqueueUncertain) {
              try {
                if (accessDenied) {
                  // Reopen after authentication/permissions recover with this key.
                  current.enqueueUncertain = false;
                  localStorage.setItem(storageKey, JSON.stringify(current));
                } else {
                  localStorage.removeItem(storageKey);
                  setPending(null);
                  setJob(null);
                }
              } catch (storageError) {
                setError(databaseHistoryError(storageError));
              }
            }

            return;
          }

          backoff = details?.retryAfterSecs !== undefined
            ? Math.max(1_000, details.retryAfterSecs * 1_000)
            : Math.min(backoff * 2, 30_000);
        }

        await delay(backoff, signal);
      }
    })();

    return () => controller.abort();
  }, [open, pending, userId, workspaceId, databaseId, storageKey, loadedStorageKey]);

  return { start, job, error, isRestoring: pending !== null, completed };
}
