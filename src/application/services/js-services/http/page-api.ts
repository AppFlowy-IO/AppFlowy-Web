import { omit } from 'lodash-es';

import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
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

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios, handleAPIError } from './core';

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

const DUPLICATE_TASK_ID_HEADER = 'x-appflowy-duplicate-task-id';

/** Wire format: serde serializes the Rust enum as its variant name. */
export type DuplicateTaskStatus = 'Pending' | 'Completed' | 'Failed' | 'Expired' | 'Cancelled' | 'Running';

export interface DuplicatePageTaskResult {
  duplicated_view_id: string;
  /** Present when the page landed in a different workspace than the source. */
  dest_workspace_id?: string;
  /** Subtree branches skipped because the requester could not read them. */
  skipped_view_ids?: string[];
  /**
   * Move tasks only: false means the copy committed but trashing the source
   * failed, so the page exists in both workspaces.
   */
  source_removed?: boolean;
}

export interface DuplicatePageTaskState {
  job_id: string;
  status: DuplicateTaskStatus;
  retry_after_secs: number;
  error?: string | null;
  result?: DuplicatePageTaskResult | null;
}

/**
 * Moves a page (and its children) into another workspace. The server runs
 * this as an async duplicate task with move semantics: deep-copy into the
 * destination, then trash the source. Returns the task id (from the
 * `x-appflowy-duplicate-task-id` response header) to poll with
 * {@link getDuplicatePageTask}, scoped by the SOURCE workspace and view.
 */
export async function movePageToWorkspace(
  workspaceId: string,
  viewId: string,
  destWorkspaceId: string,
  destParentViewId: string
): Promise<string> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-workspace`;

  Log.debug('[movePageToWorkspace] request', { url, destWorkspaceId, destParentViewId });

  try {
    const response = await getAxios()?.post<APIResponse>(url, {
      dest_workspace_id: destWorkspaceId,
      dest_parent_view_id: destParentViewId,
      wait_for_completion: false,
    });

    if (!response) {
      return Promise.reject({ code: -1, message: 'API service not initialized' });
    }

    if (response.data.code !== 0) {
      return Promise.reject({
        code: response.data.code,
        message: response.data.message || 'Request failed',
        retryAfterSecs: response.data.retry_after_secs,
      });
    }

    const taskId = response.headers[DUPLICATE_TASK_ID_HEADER];

    if (typeof taskId !== 'string' || !taskId) {
      return Promise.reject({ code: -1, message: 'Move task id missing from response' });
    }

    return taskId;
  } catch (error) {
    return Promise.reject(handleAPIError(error));
  }
}

export async function getDuplicatePageTask(
  workspaceId: string,
  viewId: string,
  taskId: string
): Promise<DuplicatePageTaskState> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/duplicate/${taskId}`;

  return executeAPIRequest<DuplicatePageTaskState>(() =>
    getAxios()?.get<APIResponse<DuplicatePageTaskState>>(url)
  );
}

/**
 * Polls a duplicate/move task until it reaches a terminal state and returns
 * its result. Rejects on Failed/Expired/Cancelled or when `timeoutMs` passes.
 */
export async function waitForDuplicatePageTask(
  workspaceId: string,
  viewId: string,
  taskId: string,
  timeoutMs = 180_000
): Promise<DuplicatePageTaskResult> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 1000;

  for (;;) {
    const state = await getDuplicatePageTask(workspaceId, viewId, taskId);

    switch (state.status) {
      case 'Completed': {
        if (!state.result) {
          throw new Error('Move task completed without a result');
        }

        return state.result;
      }

      case 'Failed':
        throw new Error(state.error || 'Move task failed');
      case 'Expired':
        throw new Error('Move task expired');
      case 'Cancelled':
        throw new Error('Move task was cancelled');
      default:
        break;
    }

    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the move task to finish');
    }

    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    // Back off gently; the server's retry_after_secs is advisory (~10s) and
    // this endpoint is cheap, so short polls keep the UX responsive.
    delayMs = Math.min(delayMs + 1000, 3000);
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
