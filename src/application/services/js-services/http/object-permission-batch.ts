import { isTokenSessionCurrent, type TokenSessionWitness } from '@/application/session/token';
import { type CollabObjectPermission, Types } from '@/application/types';

import { APIResponse, executeAPIRequest, getAxios, handleAPIError, withRetry } from './core';

interface PendingPermission {
  workspaceId: string;
  objectId: string;
  collabType: Types;
  session: TokenSessionWitness;
  isCurrent(): boolean;
  resolve(permission: CollabObjectPermission): void;
  reject(error: unknown): void;
}

interface PermissionBatchResult {
  object_id: string;
  collab_type: Types;
  permission?: CollabObjectPermission;
  error?: string;
  error_code?: number;
  retry_after_secs?: number;
}

const MAX_BATCH_OBJECTS = 200;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_QUEUED_OBJECTS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;
const queued = new Map<string, PendingPermission[]>();
let queuedObjects = 0;
let activeRequests = 0;
let flushScheduled = false;

/** Same-turn batching only; callers own deduplication, invalidation and response freshness. */
export function enqueueObjectPermission(
  input: Omit<PendingPermission, 'resolve' | 'reject'>
): Promise<CollabObjectPermission> {
  if (queuedObjects >= MAX_QUEUED_OBJECTS) {
    return Promise.reject(
      handleAPIError({ code: -1, message: 'Object permission queue is full', sourceDomain: 'client' })
    );
  }

  return new Promise((resolve, reject) => {
    const key = JSON.stringify([input.session.generation, input.session.userId, input.workspaceId]);
    const cohort = queued.get(key) ?? [];

    cohort.push({ ...input, resolve, reject });
    queued.set(key, cohort);
    queuedObjects += 1;
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  });
}

function flush() {
  flushScheduled = false;
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queued.size > 0) {
    const [key, cohort] = queued.entries().next().value as [string, PendingPermission[]];
    const batch = cohort.splice(0, MAX_BATCH_OBJECTS);

    queuedObjects -= batch.length;
    // Rotate remaining work behind other workspaces instead of draining one large open first.
    queued.delete(key);
    if (cohort.length > 0) queued.set(key, cohort);
    const current = batch.filter((item) => {
      if (item.isCurrent() && isTokenSessionCurrent(item.session)) return true;
      item.reject(new Error('Object permission request was superseded before sending'));
      return false;
    });

    if (current.length === 0) continue;
    activeRequests += 1;
    void dispatch(current).finally(() => {
      activeRequests -= 1;
      flush();
    });
  }
}

async function dispatch(batch: PendingPermission[]): Promise<void> {
  try {
    const first = batch[0];

    // Singleton reads retain conditional GET behavior and the server's response cache.
    if (batch.length === 1) {
      const permission = await executeAPIRequest<CollabObjectPermission>(() =>
        getAxios()?.get<APIResponse<CollabObjectPermission>>(
          `/api/workspace/${first.workspaceId}/collab/${first.objectId}/permission`,
          { params: { collab_type: first.collabType }, timeout: REQUEST_TIMEOUT_MS }
        )
      );

      first.resolve(permission);
      return;
    }

    const response = await withRetry(
      () => {
        // POST reads bypass the GET retry interceptor. Preserve its bounded transport retry
        // policy while retaining this scheduler slot, and never retry a superseded cohort.
        if (!batch.some((item) => item.isCurrent() && isTokenSessionCurrent(item.session))) {
          return Promise.reject(new Error('Object permission request was superseded before retry'));
        }

        return executeAPIRequest<{ results: PermissionBatchResult[] }>(() =>
          getAxios()?.post<APIResponse<{ results: PermissionBatchResult[] }>>(
            `/api/workspace/${first.workspaceId}/permissions`,
            { objects: batch.map((item) => ({ object_id: item.objectId, collab_type: item.collabType })) },
            { timeout: REQUEST_TIMEOUT_MS }
          )
        );
      },
      { delays: [1000, 2000, 4000] }
    );

    // Validate the entire envelope before settling any item. A mismatched identity must never
    // turn an unrelated object's allow/deny verdict into this caller's authorization decision.
    if (
      !Array.isArray(response?.results) ||
      response.results.length !== batch.length ||
      response.results.some((result, index) => !validResult(result, batch[index]))
    ) {
      throw handleAPIError({ code: -1, message: 'Invalid object permission batch response', sourceDomain: 'client' });
    }

    response.results.forEach((result, index) => {
      if (result.permission) {
        batch[index].resolve(result.permission);
      } else {
        batch[index].reject(
          handleAPIError({
            code: result.error_code!,
            message: result.error!,
            sourceDomain: 'appflowy.server',
            ...(result.retry_after_secs === undefined ? {} : { retryAfterSecs: result.retry_after_secs }),
          })
        );
      }
    });
  } catch (error) {
    batch.forEach((item) => item.reject(error));
  }
}

function validResult(result: PermissionBatchResult | null, item: PendingPermission): boolean {
  if (!result || result.object_id !== item.objectId || result.collab_type !== item.collabType) return false;
  if (result.permission) {
    const permission = result.permission;

    return (
      result.error === undefined &&
      permission.object_id === item.objectId &&
      permission.collab_type === item.collabType &&
      typeof permission.governing_view_id === 'string' &&
      [permission.can_read, permission.can_write, permission.can_comment, permission.can_share].every(
        (value) => typeof value === 'boolean'
      )
    );
  }

  return (
    typeof result.error === 'string' &&
    typeof result.error_code === 'number' &&
    Number.isInteger(result.error_code) &&
    result.error_code !== 0 &&
    (result.retry_after_secs === undefined ||
      (Number.isInteger(result.retry_after_secs) && result.retry_after_secs >= 0))
  );
}
