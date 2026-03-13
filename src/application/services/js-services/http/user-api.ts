import { ERROR_CODE } from '@/application/constants';
import { WorkspaceMemberProfileUpdate } from '@/application/services/services.type';
import { invalidToken } from '@/application/session/token';
import {
  MentionablePerson,
  Role,
  User,
  Workspace,
} from '@/application/types';

import { APIError, APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function getCurrentUser(workspaceId?: string): Promise<User> {
  const url = '/api/user/profile';

  try {
    const payload = await executeAPIRequest<{
      uid: number;
      uuid: string;
      email: string;
      name: string;
      metadata: Record<string, unknown>;
      encryption_sign: null;
      latest_workspace_id: string;
      updated_at: number;
    }>(() =>
      getAxios()?.get<APIResponse<{
        uid: number;
        uuid: string;
        email: string;
        name: string;
        metadata: Record<string, unknown>;
        encryption_sign: null;
        latest_workspace_id: string;
        updated_at: number;
      }>>(url, {
        params: workspaceId ? { workspace_id: workspaceId } : {},
      })
    );

    const { uid, uuid, email, name, metadata } = payload;

    return {
      uid: String(uid),
      uuid,
      email,
      name,
      avatar: (metadata?.icon_url as string) || null,
      latestWorkspaceId: payload.latest_workspace_id,
      metadata: metadata || {},
    };
  } catch (error) {
    const apiError = error as APIError;

    if (apiError?.code === ERROR_CODE.USER_UNAUTHORIZED) {
      invalidToken();
      return Promise.reject(new Error('User unauthorized'));
    }

    return Promise.reject(apiError);
  }
}

export async function updateUserProfile(metadata: Record<string, unknown>): Promise<void> {
  const url = 'api/user/update';

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      metadata,
    })
  );
}

export async function getWorkspaceMemberProfile(workspaceId: string): Promise<MentionablePerson> {
  const url = `/api/workspace/${workspaceId}/workspace-profile`;

  return executeAPIRequest<MentionablePerson>(() =>
    getAxios()?.get<APIResponse<MentionablePerson>>(url)
  );
}

export async function updateWorkspaceMemberProfile(
  workspaceId: string,
  profile: WorkspaceMemberProfileUpdate
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/update-member-profile`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, profile)
  );
}

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

export function afWorkspace2Workspace(workspace: AFWorkspace): Workspace {
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

export async function getUserWorkspaceInfo(): Promise<{
  user_id: string;
  selected_workspace: Workspace;
  workspaces: Workspace[];
}> {
  const url = '/api/user/workspace';

  return executeAPIRequest<{
    user_profile: { uuid: string };
    visiting_workspace: AFWorkspace;
    workspaces: AFWorkspace[];
  }>(() =>
    getAxios()?.get<APIResponse<{
      user_profile: { uuid: string };
      visiting_workspace: AFWorkspace;
      workspaces: AFWorkspace[];
    }>>(url)
  ).then((payload) => ({
    user_id: payload.user_profile.uuid,
    selected_workspace: afWorkspace2Workspace(payload.visiting_workspace),
    workspaces: payload.workspaces.map(afWorkspace2Workspace),
  }));
}
