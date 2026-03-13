import { omit } from 'lodash-es';

import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateSpacePayload,
  UpdatePagePayload,
  UpdateSpacePayload,
  ViewIconType,
} from '@/application/types';
import { Log } from '@/utils/log';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function addAppPage(workspaceId: string, parentViewId: string, { layout, name }: CreatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view`;

  Log.debug('[addAppPage] request', { url, workspaceId, parentViewId, layout, name });

  const response = await executeAPIRequest<CreatePageResponse>(() =>
    getAxios()?.post<APIResponse<CreatePageResponse>>(url, {
      parent_view_id: parentViewId,
      layout,
      name,
    })
  );

  Log.debug('[addAppPage] response', { view_id: response.view_id, database_id: response.database_id });

  return response;
}

export async function updatePage(workspaceId: string, viewId: string, data: UpdatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.patch<APIResponse>(url, data)
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

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { icon })
  );
}

export async function updatePageName(workspaceId: string, viewId: string, name: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-name`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { name })
  );
}

export async function duplicatePage(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/duplicate`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {})
  );
}

export async function deleteTrash(workspaceId: string, viewId?: string) {
  if (viewId) {
    const url = `/api/workspace/${workspaceId}/trash/${viewId}`;

    return executeAPIVoidRequest(() =>
      getAxios()?.delete<APIResponse>(url)
    );
  } else {
    const url = `/api/workspace/${workspaceId}/delete-all-pages-from-trash`;

    return executeAPIVoidRequest(() =>
      getAxios()?.post<APIResponse>(url)
    );
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

export async function movePageTo(workspaceId: string, viewId: string, parentViewId: string, prevViewId?: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      new_parent_view_id: parentViewId,
      prev_view_id: prevViewId,
    })
  );
}

export async function createSpace(workspaceId: string, payload: CreateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space`;

  return executeAPIRequest<{ view_id: string }>(() =>
    getAxios()?.post<APIResponse<{ view_id: string }>>(url, payload)
  ).then((data) => data.view_id);
}

export async function updateSpace(workspaceId: string, payload: UpdateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space/${payload.view_id}`;
  const data = omit(payload, ['view_id']);

  return executeAPIVoidRequest(() =>
    getAxios()?.patch<APIResponse>(url, data)
  );
}

export async function createDatabaseView(
  workspaceId: string,
  viewId: string,
  payload: CreateDatabaseViewPayload
) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/database-view`;

  Log.debug('[createDatabaseView]', { url, workspaceId, viewId, payload });

  return executeAPIRequest<CreateDatabaseViewResponse>(() =>
    getAxios()?.post<APIResponse<CreateDatabaseViewResponse>>(url, {
      parent_view_id: payload.parent_view_id,
      database_id: payload.database_id,
      layout: payload.layout,
      name: payload.name,
      embedded: payload.embedded ?? false,
    })
  );
}
