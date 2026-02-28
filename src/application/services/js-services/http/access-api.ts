import {
  AccessLevel,
  AFWebUser,
  GetRequestAccessInfoResponse,
  Invitation,
  IPeopleWithAccessType,
  RequestAccessInfoStatus,
  Role,
  View,
  Workspace,
} from '@/application/types';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

interface AFWorkspace {
  workspace_id: string;
  owner_uid: number;
  owner_name: string;
  workspace_name: string;
  icon: string;
  created_at: string;
  member_count: number;
  database_storage_id: string;
  role?: Role;
}

function afWorkspace2Workspace(workspace: AFWorkspace): Workspace {
  return {
    id: workspace.workspace_id,
    owner: {
      uid: workspace.owner_uid,
      name: workspace.owner_name,
    },
    name: workspace.workspace_name,
    icon: workspace.icon,
    memberCount: workspace.member_count,
    databaseStorageId: workspace.database_storage_id,
    createdAt: workspace.created_at,
    role: workspace.role,
  };
}

export async function getInvitation(invitationId: string) {
  const url = `/api/workspace/invite/${invitationId}`;

  return executeAPIRequest<Invitation>(() =>
    getAxios()?.get<APIResponse<Invitation>>(url)
  );
}

export async function acceptInvitation(invitationId: string) {
  const url = `/api/workspace/accept-invite/${invitationId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url)
  );
}

export async function getRequestAccessInfo(requestId: string): Promise<GetRequestAccessInfoResponse> {
  const url = `/api/access-request/${requestId}`;

  const data = await executeAPIRequest<{
    request_id: string;
    workspace: AFWorkspace;
    requester: AFWebUser & {
      email: string;
    };
    view: View;
    status: RequestAccessInfoStatus;
  }>(() =>
    getAxios()?.get<APIResponse<{
      request_id: string;
      workspace: AFWorkspace;
      requester: AFWebUser & {
        email: string;
      };
      view: View;
      status: RequestAccessInfoStatus;
    }>>(url)
  );

  return {
    ...data,
    workspace: afWorkspace2Workspace(data.workspace),
  };
}

export async function approveRequestAccess(requestId: string) {
  const url = `/api/access-request/${requestId}/approve`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      is_approved: true,
    })
  );
}

export async function sendRequestAccess(workspaceId: string, viewId: string) {
  const url = `/api/access-request`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      view_id: viewId,
    })
  );
}

export async function getShareDetail(workspaceId: string, viewId: string, ancestorViewIds: string[]) {
  const url = `api/sharing/workspace/${workspaceId}/view/${viewId}/access-details`;

  return executeAPIRequest<{
    view_id: string;
    shared_with: IPeopleWithAccessType[];
  }>(() =>
    getAxios()?.post<APIResponse<{
      view_id: string;
      shared_with: IPeopleWithAccessType[];
    }>>(url, {
      ancestor_view_ids: ancestorViewIds,
    })
  );
}

export async function sharePageTo(workspaceId: string, viewId: string, emails: string[], accessLevel?: AccessLevel) {
  const url = `/api/sharing/workspace/${workspaceId}/view`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      view_id: viewId,
      emails,
      access_level: accessLevel || AccessLevel.ReadOnly,
    })
  );
}

export async function revokeAccess(workspaceId: string, viewId: string, emails: string[]) {
  const url = `/api/sharing/workspace/${workspaceId}/view/${viewId}/revoke-access`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { emails })
  );
}

export async function turnIntoMember(workspaceId: string, email: string) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      email,
      role: Role.Member,
    })
  );
}

export async function getShareWithMe(workspaceId: string): Promise<View> {
  const url = `/api/sharing/workspace/${workspaceId}/view/${workspaceId}?depth=50`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  );
}
