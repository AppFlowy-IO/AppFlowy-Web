import { GlobalComment, Reaction } from '@/application/comment.type';
import { blobToBytes } from '@/application/services/js-services/http/utils';
import {
  DatabaseId,
  PublishViewPayload,
  RowId,
  UpdatePublishConfigPayload,
  View,
  ViewId,
  ViewInfo,
  ViewLayout,
} from '@/application/types';

import { APIError, APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios, handleAPIError } from './core';

export async function publishView(workspaceId: string, viewId: string, payload?: PublishViewPayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/publish`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, payload)
  );
}

export async function unpublishView(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/unpublish`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url)
  );
}

export async function getPublishViewMeta(namespace: string, publishName: string) {
  const url = `/api/workspace/v1/published/${namespace}/${publishName}`;

  return executeAPIRequest<{
    view: ViewInfo;
    child_views: ViewInfo[];
    ancestor_views: ViewInfo[];
  }>(() =>
    getAxios()?.get<APIResponse<{
      view: ViewInfo;
      child_views: ViewInfo[];
      ancestor_views: ViewInfo[];
    }>>(url)
  );
}

export async function getPublishViewBlob(namespace: string, publishName: string) {
  const url = `/api/workspace/published/${namespace}/${publishName}/blob`;

  try {
    const response = await getAxios()?.get(url, {
      responseType: 'blob',
      validateStatus: (status) => status < 400, // Only accept success status codes
    });

    if (!response?.data) {
      console.error('[getPublishViewBlob] No response data received', response);
      const error: APIError = {
        code: -1,
        message: 'No response data received',
      };

      throw error;
    }

    return await blobToBytes(response.data);
  } catch (error) {
    throw handleAPIError(error);
  }
}

export async function getPublishView(publishNamespace: string, publishName: string) {
  const meta = await getPublishViewMeta(publishNamespace, publishName);
  const blob = await getPublishViewBlob(publishNamespace, publishName);

  if (meta.view.layout === ViewLayout.Document) {
    return {
      data: blob,
      meta,
    };
  }

  try {
    const decoder = new TextDecoder('utf-8');

    const jsonStr = decoder.decode(blob);

    const res = JSON.parse(jsonStr) as {
      database_collab: Uint8Array;
      database_row_collabs: Record<RowId, number[]>;
      database_row_document_collabs: Record<string, number[]>;
      visible_database_view_ids: ViewId[];
      database_relations: Record<DatabaseId, ViewId>;
    };

    return {
      data: new Uint8Array(res.database_collab),
      rows: res.database_row_collabs,
      visibleViewIds: res.visible_database_view_ids,
      relations: res.database_relations,
      subDocuments: res.database_row_document_collabs,
      meta,
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function updatePublishConfig(workspaceId: string, payload: UpdatePublishConfigPayload) {
  const url = `/api/workspace/${workspaceId}/publish`;

  return executeAPIVoidRequest(() => getAxios()?.patch<APIResponse>(url, [payload]));
}

export async function getPublishInfoWithViewId(viewId: string) {
  const url = `/api/workspace/v1/published-info/${viewId}`;

  return executeAPIRequest<{
    namespace: string;
    publish_name: string;
    publisher_email: string;
    view_id: string;
    publish_timestamp: string;
    comments_enabled: boolean;
    duplicate_enabled: boolean;
  }>(() =>
    getAxios()?.get<APIResponse<{
      namespace: string;
      publish_name: string;
      publisher_email: string;
      view_id: string;
      publish_timestamp: string;
      comments_enabled: boolean;
      duplicate_enabled: boolean;
    }>>(url)
  );
}

export async function getPublishNamespace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-namespace`;

  return executeAPIRequest<string>(() =>
    getAxios()?.get<APIResponse<string>>(url)
  );
}

export async function getPublishHomepage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIRequest<{
    namespace: string;
    publish_name: string;
    publisher_email: string;
    view_id: string;
  }>(() =>
    getAxios()?.get<APIResponse<{
      namespace: string;
      publish_name: string;
      publisher_email: string;
      view_id: string;
    }>>(url)
  );
}

export async function updatePublishHomepage(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      view_id: viewId,
    })
  );
}

export async function removePublishHomepage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url)
  );
}

export async function getPublishOutline(publishNamespace: string) {
  const url = `/api/workspace/published-outline/${publishNamespace}`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  ).then((data) => data.children);
}

export async function getPublishViewComments(viewId: string): Promise<GlobalComment[]> {
  const url = `/api/workspace/published-info/${viewId}/comment`;
  const payload = await executeAPIRequest<{
    comments: {
      comment_id: string;
      user: {
        uuid: string;
        name: string;
        avatar_url: string | null;
      };
      content: string;
      created_at: string;
      last_updated_at: string;
      reply_comment_id: string | null;
      is_deleted: boolean;
      can_be_deleted: boolean;
    }[];
  }>(() =>
    getAxios()?.get<APIResponse<{
      comments: {
        comment_id: string;
        user: {
          uuid: string;
          name: string;
          avatar_url: string | null;
        };
        content: string;
        created_at: string;
        last_updated_at: string;
        reply_comment_id: string | null;
        is_deleted: boolean;
        can_be_deleted: boolean;
      }[];
    }>>(url)
  );

  return payload.comments.map((comment) => ({
    commentId: comment.comment_id,
    user: {
      uuid: comment.user?.uuid || '',
      name: comment.user?.name || '',
      avatarUrl: comment.user?.avatar_url || null,
    },
    content: comment.content,
    createdAt: comment.created_at,
    lastUpdatedAt: comment.last_updated_at,
    replyCommentId: comment.reply_comment_id,
    isDeleted: comment.is_deleted,
    canDeleted: comment.can_be_deleted,
  }));
}

export async function getReactions(viewId: string, commentId?: string): Promise<Record<string, Reaction[]>> {
  let url = `/api/workspace/published-info/${viewId}/reaction`;

  if (commentId) {
    url += `?comment_id=${commentId}`;
  }

  const payload = await executeAPIRequest<{
    reactions: {
      reaction_type: string;
      react_users: {
        uuid: string;
        name: string;
        avatar_url: string | null;
      }[];
      comment_id: string;
    }[];
  }>(() =>
    getAxios()?.get<APIResponse<{
      reactions: {
        reaction_type: string;
        react_users: {
          uuid: string;
          name: string;
          avatar_url: string | null;
        }[];
        comment_id: string;
      }[];
    }>>(url)
  );

  const reactionsMap: Record<string, Reaction[]> = {};

  for (const reaction of payload.reactions) {
    if (!reactionsMap[reaction.comment_id]) {
      reactionsMap[reaction.comment_id] = [];
    }

    reactionsMap[reaction.comment_id].push({
      reactionType: reaction.reaction_type,
      commentId: reaction.comment_id,
      reactUsers: reaction.react_users.map((user) => ({
        uuid: user.uuid,
        name: user.name,
        avatarUrl: user.avatar_url,
      })),
    });
  }

  return reactionsMap;
}

export async function createGlobalCommentOnPublishView(viewId: string, content: string, replyCommentId?: string) {
  const url = `/api/workspace/published-info/${viewId}/comment`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      content,
      reply_comment_id: replyCommentId,
    })
  );
}

export async function deleteGlobalCommentOnPublishView(viewId: string, commentId: string) {
  const url = `/api/workspace/published-info/${viewId}/comment`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url, {
      data: {
        comment_id: commentId,
      },
    })
  );
}

export async function addReaction(viewId: string, commentId: string, reactionType: string) {
  const url = `/api/workspace/published-info/${viewId}/reaction`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      comment_id: commentId,
      reaction_type: reactionType,
    })
  );
}

export async function removeReaction(viewId: string, commentId: string, reactionType: string) {
  const url = `/api/workspace/published-info/${viewId}/reaction`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url, {
      data: {
        comment_id: commentId,
        reaction_type: reactionType,
      },
    })
  );
}

export interface DuplicatePublishViewPayload {
  published_collab_type: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  published_view_id: string;
  dest_view_id: string;
}

export interface DuplicatePublishViewResponse {
  view_id: string;
  /** Mapping of database_id -> list of view_ids for databases created during duplication */
  database_mappings: Record<string, string[]>;
}

export async function duplicatePublishView(workspaceId: string, payload: DuplicatePublishViewPayload): Promise<DuplicatePublishViewResponse> {
  const url = `/api/workspace/${workspaceId}/published-duplicate`;

  return executeAPIRequest<DuplicatePublishViewResponse>(() =>
    getAxios()?.post<APIResponse<DuplicatePublishViewResponse>>(url, payload)
  );
}
