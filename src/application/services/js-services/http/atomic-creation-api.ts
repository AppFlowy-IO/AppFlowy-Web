import axios, { AxiosRequestConfig } from 'axios';

import { assertAtomicCreationAvailable, type AtomicCreationOwner } from '@/application/atomic-creation/owner';
import type { AtomicCreationKind, AtomicCreationReceipt } from '@/application/atomic-creation/types';

import { APIResponse, executeAPIRequest, getAxios } from './core';

const paths: Record<AtomicCreationKind, string> = {
  document: 'document/default',
  database: 'database/default',
  'database-view': 'database-view/default',
  'row-document': 'row-document',
};

const MAX_CREATION_ATTEMPTS = 16;
const CREATION_TIMEOUT_MS = 30_000;

function waitForCreationDependency(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new axios.CanceledError('Atomic creation cancelled'));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Stop waiting at the workflow deadline without cancelling a shared token refresh.
 * The request also carries this signal, so a late refresh cannot send it afterward.
 */
export function awaitAtomicRequest<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(new axios.CanceledError('Atomic creation cancelled'));
    };

    if (signal.aborted) {
      void request.catch(() => undefined);
      cancel();
      return;
    }

    signal.addEventListener('abort', cancel, { once: true });
    request.then((value) => {
      signal.removeEventListener('abort', cancel);
      resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
  });
}

/** Wrap the actual adapter, after every asynchronous request interceptor and token refresh. */
export function ownedRequestConfig(owner: AtomicCreationOwner, signal?: AbortSignal): AxiosRequestConfig {
  const client = getAxios();

  if (!client) throw new Error('API service not initialized');
  const adapter = axios.getAdapter(client.defaults.adapter);

  return {
    atomicCreationOwner: owner,
    skipResponseCache: true,
    timeout: 30_000,
    signal,
    adapter(config) {
      owner.assertCurrent();
      return adapter(config);
    },
  };
}

/** Retry only the server's explicit RetryLater admission result, never an ambiguous transport outcome. */
export async function postAtomicCreation<K extends AtomicCreationKind>(
  owner: AtomicCreationOwner,
  kind: K,
  requestJson: string,
  signal?: AbortSignal
): Promise<AtomicCreationReceipt<K>> {
  const controller = new AbortController();
  const deadline = Date.now() + CREATION_TIMEOUT_MS;
  const submissionOwner: AtomicCreationOwner = {
    ...owner,
    // Token refresh can await between admission and transport dispatch.
    assertCurrent: () => {
      if (Date.now() >= deadline) controller.abort();
      if (controller.signal.aborted) throw new axios.CanceledError('Atomic creation cancelled');
      assertAtomicCreationAvailable(owner);
    },
  };
  const cancel = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => controller.abort(), CREATION_TIMEOUT_MS);

  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    for (let attempt = 0; ; attempt += 1) {
      submissionOwner.assertCurrent();
      try {
        return await awaitAtomicRequest(executeAPIRequest<AtomicCreationReceipt<K>>(
          () =>
            getAxios()?.post<APIResponse<AtomicCreationReceipt<K>>>(
              `/api/workspace/${owner.workspaceId}/v2/page-view/${paths[kind]}`,
              requestJson,
              { ...ownedRequestConfig(submissionOwner, controller.signal), timeout: Math.max(1, deadline - Date.now()),
                transformRequest: [(data: string) => data] }
            ),
          { suppressResponseDataLogging: true }
        ), controller.signal);
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== -5 ||
          attempt + 1 >= MAX_CREATION_ATTEMPTS) throw error;
        // A newly synced Row can be readable from realtime cache before its
        // durable source exists. Keep the same journaled request while it settles.
        submissionOwner.assertCurrent();
        await waitForCreationDependency(Math.min(100 * 2 ** attempt, 2_000), controller.signal);
      }
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Uncached current-authority read. Callers validate the returned schema before publishing it. */
export async function atomicRead<T>(
  owner: AtomicCreationOwner,
  url: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  owner.assertCurrent();
  const result = await awaitAtomicRequest(executeAPIRequest<T>(
    () =>
      getAxios()?.get<APIResponse<T>>(url, {
        ...ownedRequestConfig(owner, signal),
        params,
        headers: { 'Cache-Control': 'no-cache' },
      }),
    { suppressResponseDataLogging: true }
  ), signal);

  owner.assertCurrent();
  return result;
}
