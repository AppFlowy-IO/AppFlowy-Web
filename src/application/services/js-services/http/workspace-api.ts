import {
  AccessLevel,
  CreateWorkspacePayload,
  FolderView,
  GuestConversionCodeInfo,
  GuestInvitation,
  MentionablePerson,
  Role,
  UpdateWorkspacePayload,
  UploadPublishNamespacePayload,
  Workspace,
  WorkspaceMember,
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

export async function openWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/open`;

  return executeAPIVoidRequest(() => getAxios()?.put<APIResponse>(url));
}

export async function updateWorkspace(workspaceId: string, payload: UpdateWorkspacePayload) {
  const url = `/api/workspace`;

  return executeAPIVoidRequest(() =>
    getAxios()?.patch<APIResponse>(url, {
      workspace_id: workspaceId,
      ...payload,
    })
  );
}

export async function createWorkspace(payload: CreateWorkspacePayload) {
  const url = '/api/workspace';

  return executeAPIRequest<{ workspace_id: string }>(() =>
    getAxios()?.post<APIResponse<{ workspace_id: string }>>(url, payload)
  ).then((data) => data.workspace_id);
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const query = new URLSearchParams({
    include_member_count: 'true',
  });

  const url = `/api/workspace?${query.toString()}`;
  const payload = await executeAPIRequest<AFWorkspace[]>(() =>
    getAxios()?.get<APIResponse<AFWorkspace[]>>(url)
  );

  return payload.map(afWorkspace2Workspace);
}

export interface WorkspaceFolder {
  view_id: string;
  icon: string | null;
  name: string;
  is_space: boolean;
  is_private: boolean;
  access_level?: AccessLevel;
  extra: {
    is_space: boolean;
    space_created_at: number;
    space_icon: string;
    space_icon_color: string;
    space_permission: number;
  };

  children: WorkspaceFolder[];
}

function iterateFolder(folder: WorkspaceFolder): FolderView {
  return {
    id: folder.view_id,
    name: folder.name,
    icon: folder.icon,
    // `/view/{id}` payloads expose space flag in `extra.is_space`.
    // Keep backward compatibility with old `is_space` top-level field.
    isSpace: folder.is_space ?? folder.extra?.is_space ?? false,
    extra: folder.extra ? JSON.stringify(folder.extra) : null,
    isPrivate: folder.is_private,
    accessLevel: folder.access_level,
    children: folder.children.map((child: WorkspaceFolder) => {
      return iterateFolder(child);
    }),
  };
}

export async function getWorkspaceFolder(workspaceId: string): Promise<FolderView> {
  const url = `/api/workspace/${workspaceId}/view/${workspaceId}?depth=50`;
  const payload = await executeAPIRequest<WorkspaceFolder>(() =>
    getAxios()?.get<APIResponse<WorkspaceFolder>>(url)
  );

  return iterateFolder(payload);
}

export async function deleteWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}

export async function leaveWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/leave`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}

export async function inviteMembers(workspaceId: string, emails: string[]) {
  const url = `/api/workspace/${workspaceId}/invite`;

  const payload = emails.map((e) => ({
    email: e,
    role: Role.Member,
  }));

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, payload)
  );
}

export async function getMembers(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIRequest<WorkspaceMember[]>(() =>
    getAxios()?.get<APIResponse<WorkspaceMember[]>>(url)
  );
}

export async function joinWorkspaceByInvitationCode(code: string) {
  const url = `/api/workspace/join-by-invite-code`;

  return executeAPIRequest<{ workspace_id: string }>(() =>
    getAxios()?.post<APIResponse<{ workspace_id: string }>>(url, { code })
  ).then((data) => data.workspace_id);
}

export async function getWorkspaceInfoByInvitationCode(code: string) {
  const url = `/api/invite-code-info`;

  return executeAPIRequest<{
    workspace_id: string;
    workspace_name: string;
    workspace_icon_url: string;
    owner_name: string;
    owner_avatar: string;
    is_member: boolean;
    member_count: number;
  }>(() =>
    getAxios()?.get<APIResponse<{
      workspace_id: string;
      workspace_name: string;
      workspace_icon_url: string;
      owner_name: string;
      owner_avatar: string;
      is_member: boolean;
      member_count: number;
    }>>(url, {
      params: { code },
    })
  );
}

export async function getGuestInvitation(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/guest-invite-code-info`;

  return executeAPIRequest<GuestInvitation>(() =>
    getAxios()?.get<APIResponse<GuestInvitation>>(url, {
      params: { code },
    })
  );
}

export async function acceptGuestInvitation(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/join-by-guest-invite-code`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { code })
  );
}

export async function getGuestToMemberConversionInfo(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/guest-conversion-code-info`;

  return executeAPIRequest<GuestConversionCodeInfo>(() =>
    getAxios()?.get<APIResponse<GuestConversionCodeInfo>>(url, { params: { code } })
  );
}

export async function approveTurnGuestToMember(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/approve-guest-conversion`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { code })
  );
}

export async function getMentionableUsers(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/mentionable-person`;
  const payload = await executeAPIRequest<{
    persons: MentionablePerson[];
  }>(() =>
    getAxios()?.get<APIResponse<{ persons: MentionablePerson[] }>>(url)
  );

  return payload.persons;
}

export interface PageMentionUpdate {
  person_id: string;
  block_id?: string | null;
  row_id?: string | null;
  require_notification: boolean;
  view_name: string;
  ancestors?: string[] | null;
  view_layout?: number | null;
  is_row_document?: boolean;
}

export async function updatePageMention(workspaceId: string, viewId: string, data: PageMentionUpdate) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/page-mention`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, data)
  );
}

export async function addRecentPages(workspaceId: string, viewIds: string[]) {
  const url = `/api/workspace/${workspaceId}/add-recent-pages`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      recent_view_ids: viewIds,
    })
  );
}

export async function updatePublishNamespace(workspaceId: string, payload: UploadPublishNamespacePayload) {
  const url = `/api/workspace/${workspaceId}/publish-namespace`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, payload)
  );
}
