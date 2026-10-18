import axios from 'axios';

import { assertAtomicCreationAvailable, type AtomicCreationOwner } from '@/application/atomic-creation/owner';
import type { CreatedRowReceipt, DefaultRowRequest } from '@/application/database-yjs/creation/row-creation-types';
import { ClientValidationError } from '@/application/errors/client-validation-error';
import { isUnsupportedRouteError } from '@/utils/errors';

import { awaitAtomicRequest, ownedRequestConfig } from './atomic-creation-api';
import { APIResponse, executeAPIRequest, getAxios } from './core';

/** Retries retain the exact command only for this awaited user action; no background journal. */
export async function postRowCreation<T>(
  owner: AtomicCreationOwner,
  path: string,
  request: unknown,
  signal: AbortSignal,
  deadline: number
): Promise<T> {
  const requestJson = JSON.stringify(request);

  for (let attempt = 0; ; attempt++) {
    assertAtomicCreationAvailable(owner);
    if (signal.aborted || Date.now() >= deadline) throw signal.reason ?? new Error('Row creation timed out');
    let retryLater = false;
    let ambiguous = false;

    try {
      const result = await awaitAtomicRequest(
        executeAPIRequest<T>(
          async () => {
            try {
              const response = await getAxios()?.post<APIResponse<T>>(
                `/api/workspace/${owner.workspaceId}/v2/${path}`,
                requestJson,
                {
                  ...ownedRequestConfig(owner, signal),
                  timeout: Math.max(1, deadline - Date.now()),
                  headers: { 'Content-Type': 'application/json' },
                  transformRequest: [(data: string) => data],
                }
              );

              retryLater = response?.data?.code === -5;
              return response;
            } catch (error) {
              ambiguous = axios.isAxiosError(error) && !error.response && !axios.isCancel(error);
              retryLater = axios.isAxiosError<APIResponse>(error) && error.response?.data?.code === -5;
              throw error;
            }
          },
          { suppressResponseDataLogging: true }
        ),
        signal
      );

      owner.assertCurrent();
      return result;
    } catch (error) {
      if (isUnsupportedRouteError(error)) throw new ClientValidationError('ATOMIC_CREATION_SERVER_UPGRADE');
      if ((!retryLater && !ambiguous) || attempt >= 7 || signal.aborted) throw error;
      assertAtomicCreationAvailable(owner);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };

        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, Math.min(100 * 2 ** attempt, 1_000));

        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
}

export function postDefaultRowCreation(
  owner: AtomicCreationOwner,
  databaseId: string,
  request: DefaultRowRequest,
  signal: AbortSignal,
  deadline: number
): Promise<CreatedRowReceipt> {
  return postRowCreation(owner, `database/${databaseId}/row/default`, request, signal, deadline);
}
