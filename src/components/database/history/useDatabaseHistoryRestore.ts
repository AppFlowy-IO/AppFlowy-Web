import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import type { DatabaseRestoreJob } from '@/application/database-history.type';
import { getDatabaseRestoreJob, startDatabaseRestore } from '@/application/services/domains/database-history';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';

interface PendingRestore {
  version: string;
  idempotencyKey: string;
  jobId?: string;
}

export function databaseHistoryError(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
}

function readPending(key: string): PendingRestore | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as PendingRestore | null;

    return value && typeof value.version === 'string' && typeof value.idempotencyKey === 'string' &&
      (value.jobId === undefined || typeof value.jobId === 'string') ? value : null;
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
    const next = { version, idempotencyKey: uuid() };

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
        try {
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
          const details = failure as { httpStatus?: number; retryAfterSecs?: number };

          // Keep the saved job/key for an explicit reopen after authentication or
          // permissions recover. Do not turn an inaccessible job into a new restore.
          if (details.httpStatus && details.httpStatus >= 400 && details.httpStatus < 500 &&
              details.httpStatus !== 408 && details.httpStatus !== 409 && details.httpStatus !== 429) return;
          backoff = details.retryAfterSecs !== undefined
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
