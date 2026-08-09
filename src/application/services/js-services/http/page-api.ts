import { omit } from 'lodash-es';

import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CopyPageToWorkspacePayload,
  CrossWorkspaceCopyResult,
  CrossWorkspaceCopyTaskState,
  DuplicatePageOptions,
  CreatePagePayload,
  CreatePageResponse,
  CreateSpacePayload,
  CreateSpaceWithInitialPagePayload,
  CreateSpaceWithInitialPageResponse,
  UpdatePagePayload,
  UpdateSpacePayload,
  ViewIconType,
} from '@/application/types';
import { Log } from '@/utils/log';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function addAppPage(
  workspaceId: string,
  parentViewId: string,
  { layout, name, prev_view_id }: CreatePagePayload
) {
  const url = `/api/workspace/${workspaceId}/page-view`;

  Log.debug('[addAppPage] request', { url, workspaceId, parentViewId, layout, name, prev_view_id });

  const response = await executeAPIRequest<CreatePageResponse>(() =>
    getAxios()?.post<APIResponse<CreatePageResponse>>(url, {
      parent_view_id: parentViewId,
      layout,
      name,
      prev_view_id,
    })
  );

  Log.debug('[addAppPage] response', { view_id: response.view_id, database_id: response.database_id });

  return response;
}

export async function updatePage(workspaceId: string, viewId: string, data: UpdatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;

  return executeAPIVoidRequest(() => getAxios()?.patch<APIResponse>(url, data));
}

export async function favoritePageView(
  workspaceId: string,
  viewId: string,
  isFavorite: boolean,
  isPinned: boolean = true
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/favorite`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { is_favorite: isFavorite, is_pinned: isPinned })
  );
}

export async function updatePageIcon(
  workspaceId: string,
  viewId: string,
  icon: {
    ty: ViewIconType;
    value: string;
  }
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-icon`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, { icon }));
}

export async function updatePageName(workspaceId: string, viewId: string, name: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-name`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, { name }));
}

export async function duplicatePage(workspaceId: string, viewId: string, options: DuplicatePageOptions = {}) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/duplicate`;
  const payload: Record<string, unknown> = {};

  if (options.openAfterDuplicate !== undefined) payload.open_after_duplicate = options.openAfterDuplicate;
  if (options.includeChildren !== undefined) payload.include_children = options.includeChildren;
  if (options.parentViewId) payload.parent_view_id = options.parentViewId;
  if (options.suffix) payload.suffix = options.suffix;
  if (options.source !== undefined) payload.source = options.source;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, payload));
}

export async function deleteTrash(workspaceId: string, viewId?: string) {
  if (viewId) {
    const url = `/api/workspace/${workspaceId}/trash/${viewId}`;

    return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
  } else {
    const url = `/api/workspace/${workspaceId}/delete-all-pages-from-trash`;

    return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
  }
}

export async function moveToTrash(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}

export async function restorePage(workspaceId: string, viewId?: string) {
  const url = viewId
    ? `/api/workspace/${workspaceId}/page-view/${viewId}/restore-from-trash`
    : `/api/workspace/${workspaceId}/restore-all-pages-from-trash`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}

export async function movePageTo(workspaceId: string, viewId: string, parentViewId: string, prevViewId?: string | null) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      new_parent_view_id: parentViewId,
      prev_view_id: prevViewId,
    })
  );
}

/**
 * Starts a Notion-compatible cross-workspace copy. The source is retained and
 * an omitted destination parent asks the server to use the actor's Private
 * section. The caller must reuse the idempotency key when retrying one action.
 */
export async function copyPageToWorkspace(
  workspaceId: string,
  viewId: string,
  payload: CopyPageToWorkspacePayload
): Promise<CrossWorkspaceCopyTaskState> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/copy-to-workspace/v2`;

  return executeAPIRequest<CrossWorkspaceCopyTaskState>(() =>
    getAxios()?.post<APIResponse<CrossWorkspaceCopyTaskState>>(url, {
      ...payload,
      wait_for_completion: false,
    })
  );
}

export async function getCrossWorkspaceCopyTask(
  workspaceId: string,
  viewId: string,
  taskId: string
): Promise<CrossWorkspaceCopyTaskState> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/copy-to-workspace/v2/${taskId}`;

  return executeAPIRequest<CrossWorkspaceCopyTaskState>(() =>
    getAxios()?.get<APIResponse<CrossWorkspaceCopyTaskState>>(url)
  );
}

function completedCrossWorkspaceCopyResult(state: CrossWorkspaceCopyTaskState): CrossWorkspaceCopyResult {
  const result = state.result;

  if (!result) {
    throw new Error('Copy task completed without a result');
  }

  if (result.operation !== 'cross_workspace_copy' || result.source_retained !== true) {
    throw new Error('Copy task returned an incompatible result');
  }

  return result;
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export type CrossWorkspaceCopyTerminalStatus = 'Failed' | 'Expired' | 'Cancelled';

/** A durable copy task reached a server-confirmed terminal failure state. */
export class CrossWorkspaceCopyTerminalError extends Error {
  readonly status: CrossWorkspaceCopyTerminalStatus;

  constructor(status: CrossWorkspaceCopyTerminalStatus, message: string) {
    super(message);
    this.name = 'CrossWorkspaceCopyTerminalError';
    this.status = status;
  }
}

const MAX_TRANSIENT_COPY_TASK_POLL_FAILURES = 5;

function isTransientCopyTaskPollError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const { code, httpStatus } = error as { code?: number; httpStatus?: number };
  const status = httpStatus ?? (typeof code === 'number' && code >= 100 && code <= 599 ? code : undefined);

  return code === -1 || status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
}

/** Wait for a source-retaining cross-workspace copy to reach a terminal state. */
export async function waitForCrossWorkspaceCopyTask(
  workspaceId: string,
  viewId: string,
  initialState: CrossWorkspaceCopyTaskState,
  timeoutMs = 60 * 60 * 1000
): Promise<CrossWorkspaceCopyResult> {
  const deadline = Date.now() + timeoutMs;
  let state = initialState;
  let consecutivePollFailures = 0;

  for (;;) {
    switch (state.status) {
      case 'Completed':
        return completedCrossWorkspaceCopyResult(state);
      case 'Failed':
        throw new CrossWorkspaceCopyTerminalError('Failed', state.error || 'Copy task failed');
      case 'Expired':
        throw new CrossWorkspaceCopyTerminalError('Expired', 'Copy task expired');
      case 'Cancelled':
        throw new CrossWorkspaceCopyTerminalError('Cancelled', 'Copy task was cancelled');
      default:
        break;
    }

    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the copy task to finish');
    }

    const delayMs = Math.max(1, Math.min(state.retry_after_secs || 1, 10)) * 1000;

    await waitForDelay(delayMs);
    try {
      state = await getCrossWorkspaceCopyTask(workspaceId, viewId, state.job_id);
      consecutivePollFailures = 0;
    } catch (error) {
      if (!isTransientCopyTaskPollError(error)) throw error;

      consecutivePollFailures += 1;
      if (consecutivePollFailures > MAX_TRANSIENT_COPY_TASK_POLL_FAILURES) throw error;
    }
  }
}

export async function createSpace(workspaceId: string, payload: CreateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space`;

  return executeAPIRequest<{ view_id: string }>(() =>
    getAxios()?.post<APIResponse<{ view_id: string }>>(url, payload)
  ).then((data) => data.view_id);
}

export async function createSpaceWithInitialPage(workspaceId: string, payload: CreateSpaceWithInitialPagePayload) {
  const url = `/api/workspace/${workspaceId}/v2/space`;

  return executeAPIRequest<CreateSpaceWithInitialPageResponse>(() =>
    getAxios()?.post<APIResponse<CreateSpaceWithInitialPageResponse>>(url, payload)
  );
}

export async function updateSpace(workspaceId: string, payload: UpdateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space/${payload.view_id}`;
  const data = omit(payload, ['view_id']);

  return executeAPIVoidRequest(() => getAxios()?.patch<APIResponse>(url, data));
}

export async function createDatabaseView(workspaceId: string, viewId: string, payload: CreateDatabaseViewPayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/database-view`;

  Log.debug('[createDatabaseView]', { url, workspaceId, viewId, payload });

  return executeAPIRequest<CreateDatabaseViewResponse>(() =>
    getAxios()?.post<APIResponse<CreateDatabaseViewResponse>>(url, {
      parent_view_id: payload.parent_view_id,
      prev_view_id: payload.prev_view_id,
      database_id: payload.database_id,
      layout: payload.layout,
      name: payload.name,
      embedded: payload.embedded ?? false,
    })
  );
}
