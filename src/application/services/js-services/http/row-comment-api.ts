import { APIResponse, executeAPIVoidRequest, getAxios } from './core';

export interface RowCommentNotification {
  comment_id: string;
  content: string;
  parent_comment_id?: string;
  mentioned_user_uuids: string[];
  reply_participant_uuids: string[];
  view_name?: string;
}

/** Same notification endpoint used by Desktop after saving the row collab. */
export async function notifyRowComment(
  workspaceId: string,
  databaseViewId: string,
  rowId: string,
  params: RowCommentNotification
) {
  const url = `/api/workspace/${workspaceId}/database/${databaseViewId}/row/${rowId}/comment/notification`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, params));
}
