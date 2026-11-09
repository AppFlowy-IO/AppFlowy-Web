import axios, { AxiosError } from 'axios';

import {
  AccessLevel,
  AddSpaceGroupPermissionPayload,
  AddSpaceMemberPayload,
  AddWorkspaceGroupMemberPayload,
  CreateWorkspaceGroupPayload,
  CreateWorkspacePayload,
  FolderView,
  GuestConversionCodeInfo,
  GuestInvitation,
  MentionablePerson,
  MentionSearchOptions,
  MentionSearchRequest,
  MentionSearchResponse,
  Role,
  SpaceMember,
  SpaceMembers,
  Spaces,
  SpacePermissionResponse,
  SpacePermissionSettings,
  StructuredSpace,
  UpdateSpaceMemberPayload,
  UpdateStructuredSpacePayload,
  UpdateWorkspaceGroupPayload,
  UpdateWorkspacePayload,
  UploadPublishNamespacePayload,
  Workspace,
  WorkspaceGroup,
  WorkspaceGroupMember,
  WorkspaceGroupMembers,
  WorkspaceGroupSpacePermission,
  WorkspaceGroups,
  WorkspaceMember,
} from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

const UID_FIELD_REGEX = /"uid"\s*:\s*(\d{16,})/g;

// Runs as an axios `transformResponse`, so it also sees the empty body of a
// `304 Not Modified` before the ETag replay interceptor can hand back the
// cached payload. Leave such bodies untouched instead of throwing
// "Unexpected end of JSON input" and masking the 304.
export function parseResponseWithExactUid(data: unknown) {
  if (typeof data !== 'string' || data.trim() === '') return data;

  return JSON.parse(data.replace(UID_FIELD_REGEX, '"uid":"$1"')) as unknown;
}

function stringifyAddSpaceMemberPayload(payload: AddSpaceMemberPayload) {
  if (!/^\d+$/.test(payload.uid)) {
    throw new Error('Space member uid must be a numeric string');
  }

  return `{"uid":${payload.uid},"role":${JSON.stringify(payload.role)},"access_level":${payload.access_level}}`;
}

function stringifyAddWorkspaceGroupMemberPayload(payload: AddWorkspaceGroupMemberPayload) {
  if (!/^\d+$/.test(payload.uid)) {
    throw new Error('Workspace group member uid must be a numeric string');
  }

  return `{"uid":${payload.uid}}`;
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

export interface DatabaseViewCreationStatus {
  can_create_form: boolean;
  can_create_chart: boolean;
}

/** Includes views outside the visible outline, including private and trashed views. */
export async function getDatabaseViewCreationStatus(workspaceId: string): Promise<DatabaseViewCreationStatus> {
  const status = await executeAPIRequest<DatabaseViewCreationStatus>(() =>
    getAxios()?.get<APIResponse<DatabaseViewCreationStatus>>(
      `/api/workspace/${workspaceId}/database-view-creation-status`
    )
  );

  // An older server or an incomplete response is unavailable, not a free allowance.
  if (typeof status?.can_create_form !== 'boolean' || typeof status?.can_create_chart !== 'boolean') {
    throw new Error('Invalid database view creation status');
  }

  return status;
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
  // Optional for backward compatibility with older servers.
  workspace_id?: string;
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
    workspaceId: folder.workspace_id,
    children: folder.children.map((child: WorkspaceFolder) => {
      return iterateFolder(child);
    }),
  };
}

export async function getWorkspaceFolder(workspaceId: string, depth = 50): Promise<FolderView> {
  const url = `/api/workspace/${workspaceId}/view/${workspaceId}?depth=${depth}`;
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

export async function getMembers(workspaceId: string, includePending = false) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIRequest<WorkspaceMember[]>(() =>
    getAxios()?.get<APIResponse<WorkspaceMember[]>>(url, {
      params: includePending ? { include_pending: true } : undefined,
      transformResponse: [parseResponseWithExactUid],
    })
  );
}

export async function getSpacePermission(workspaceId: string, spaceId: string) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/permission`;

  return executeAPIRequest<SpacePermissionResponse>(() =>
    getAxios()?.get<APIResponse<SpacePermissionResponse>>(url)
  );
}

export async function getSpaces(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/spaces`;

  return executeAPIRequest<Spaces>(() => getAxios()?.get<APIResponse<Spaces>>(url));
}

export async function updateSpacePermission(
  workspaceId: string,
  spaceId: string,
  permission: SpacePermissionSettings
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/permission`;

  return executeAPIRequest<SpacePermissionResponse>(() =>
    getAxios()?.patch<APIResponse<SpacePermissionResponse>>(url, permission)
  );
}

export async function updateStructuredSpace(
  workspaceId: string,
  spaceId: string,
  payload: UpdateStructuredSpacePayload
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}`;

  return executeAPIRequest<StructuredSpace>(() => getAxios()?.patch<APIResponse<StructuredSpace>>(url, payload));
}

export async function getSpaceMembers(workspaceId: string, spaceId: string) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/members`;

  return executeAPIRequest<SpaceMembers>(() =>
    getAxios()?.get<APIResponse<SpaceMembers>>(url, {
      transformResponse: [parseResponseWithExactUid],
    })
  );
}

export async function addSpaceMember(
  workspaceId: string,
  spaceId: string,
  payload: AddSpaceMemberPayload
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/members`;

  return executeAPIRequest<SpaceMember>(() =>
    getAxios()?.post<APIResponse<SpaceMember>>(url, stringifyAddSpaceMemberPayload(payload), {
      transformResponse: [parseResponseWithExactUid],
    })
  );
}

export async function updateSpaceMember(
  workspaceId: string,
  spaceId: string,
  uid: string,
  payload: UpdateSpaceMemberPayload
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/members/${uid}`;

  return executeAPIRequest<SpaceMember>(() =>
    getAxios()?.patch<APIResponse<SpaceMember>>(url, payload, {
      transformResponse: [parseResponseWithExactUid],
    })
  );
}

export async function removeSpaceMember(workspaceId: string, spaceId: string, uid: string) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/members/${uid}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}

export async function addSpaceGroupPermission(
  workspaceId: string,
  spaceId: string,
  groupId: string,
  payload: AddSpaceGroupPermissionPayload
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/group/${groupId}`;

  return executeAPIRequest<WorkspaceGroupSpacePermission>(() =>
    getAxios()?.post<APIResponse<WorkspaceGroupSpacePermission>>(url, payload)
  );
}

export async function updateSpaceGroupPermission(
  workspaceId: string,
  spaceId: string,
  groupId: string,
  payload: UpdateSpaceMemberPayload
) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/group/${groupId}`;

  return executeAPIRequest<WorkspaceGroupSpacePermission>(() =>
    getAxios()?.patch<APIResponse<WorkspaceGroupSpacePermission>>(url, payload)
  );
}

export async function removeSpaceGroupPermission(workspaceId: string, spaceId: string, groupId: string) {
  const url = `/api/workspace/${workspaceId}/spaces/${spaceId}/group/${groupId}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}

export async function getWorkspaceGroups(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/groups`;

  return executeAPIRequest<WorkspaceGroups>(() =>
    getAxios()?.get<APIResponse<WorkspaceGroups>>(url)
  );
}

export async function createWorkspaceGroup(
  workspaceId: string,
  payload: CreateWorkspaceGroupPayload
) {
  const url = `/api/workspace/${workspaceId}/groups`;

  return executeAPIRequest<WorkspaceGroup>(() =>
    getAxios()?.post<APIResponse<WorkspaceGroup>>(url, payload)
  );
}

export async function updateWorkspaceGroup(
  workspaceId: string,
  groupId: string,
  payload: UpdateWorkspaceGroupPayload
) {
  const url = `/api/workspace/${workspaceId}/groups/${groupId}`;

  return executeAPIRequest<WorkspaceGroup>(() =>
    getAxios()?.patch<APIResponse<WorkspaceGroup>>(url, payload)
  );
}

export async function removeWorkspaceGroup(workspaceId: string, groupId: string) {
  const url = `/api/workspace/${workspaceId}/groups/${groupId}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}

export async function getWorkspaceGroupMembers(workspaceId: string, groupId: string) {
  const url = `/api/workspace/${workspaceId}/groups/${groupId}/members`;

  return executeAPIRequest<WorkspaceGroupMembers>(() =>
    getAxios()?.get<APIResponse<WorkspaceGroupMembers>>(url, {
      transformResponse: [parseResponseWithExactUid],
    })
  );
}

export async function addWorkspaceGroupMember(
  workspaceId: string,
  groupId: string,
  payload: AddWorkspaceGroupMemberPayload
) {
  const url = `/api/workspace/${workspaceId}/groups/${groupId}/members`;

  return executeAPIRequest<WorkspaceGroupMember>(() =>
    getAxios()?.post<APIResponse<WorkspaceGroupMember>>(
      url,
      stringifyAddWorkspaceGroupMemberPayload(payload),
      {
        transformResponse: [parseResponseWithExactUid],
      }
    )
  );
}

export async function removeWorkspaceGroupMember(
  workspaceId: string,
  groupId: string,
  uid: string
) {
  const url = `/api/workspace/${workspaceId}/groups/${groupId}/members/${uid}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}

export async function removeMembers(workspaceId: string, emails: string[]) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url, {
      data: emails,
    })
  );
}

export async function getWorkspaceInviteCode(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/invite-code`;

  return executeAPIRequest<{ code: string | null }>(() =>
    getAxios()?.get<APIResponse<{ code: string | null }>>(url)
  );
}

export async function createWorkspaceInviteCode(workspaceId: string, validityPeriodHours?: number | null) {
  const url = `/api/workspace/${workspaceId}/invite-code`;

  return executeAPIRequest<{ code: string | null }>(() =>
    getAxios()?.post<APIResponse<{ code: string | null }>>(url, {
      validity_period_hours: validityPeriodHours ?? null,
    })
  );
}

export async function deleteWorkspaceInviteCode(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/invite-code`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url)
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

  return payload.persons.map((person) => ({
    ...person,
    uid: canonicalizeUserUid(person.uid) ?? person.uid,
  }));
}

// A self-hosted proxy whose CORS allow-list predates the stream headers fails the preflight of a
// mention search that carries them, and the page sees a network error without a response. A
// dropped connection, or a proxy error page without CORS headers, looks the same. So a tab leaves
// the headers out only after separate searches failed that way twice in a row while the same
// searches without them were answered, and only for a while. A same-origin search sends no
// preflight and never falls back.

/** Separate rejections in a row, with no answered search between them, that turn the headers off. */
const MENTION_STREAM_HEADER_REJECTION_LIMIT = 2;

/** How long a tab leaves the stream headers out before it sends them again. */
export const MENTION_STREAM_HEADERS_OFF_MS = 10 * 60_000;

let streamHeaderRejections = 0;
// Counts the outcomes that change `streamHeaderRejections`. A search that was already in flight
// when one was recorded, such as the other request of a pair on one dropped connection, adds no
// evidence of its own.
let streamHeaderOutcomes = 0;
let streamHeadersOffUntil = 0;
let streamHeadersWarned = false;

function mentionStreamHeaders({ streamId, requestTime }: MentionSearchOptions) {
  if (Date.now() < streamHeadersOffUntil) return undefined;

  const headers: Record<string, string> = {};

  if (requestTime !== undefined && Number.isSafeInteger(requestTime) && requestTime >= 0) {
    headers['x-request-time'] = String(requestTime);
  }

  if (streamId) headers['x-request-stream-id'] = streamId;

  return Object.keys(headers).length > 0 ? headers : undefined;
}

// A same-origin request sends no CORS preflight, so its headers cannot be why it failed.
function isCrossOriginRequest(url: string) {
  try {
    return new URL(getAxios()?.getUri({ url }) ?? url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

// A rejected CORS preflight reaches the page as a network error on this request, with no response.
// The URL check leaves out a failure of another request, such as the token refresh that the
// request interceptor runs first.
function mayBeRejectedStreamHeaders(error: unknown, url: string) {
  return (
    axios.isAxiosError(error) &&
    error.code === AxiosError.ERR_NETWORK &&
    !error.response &&
    error.config?.url === url &&
    isCrossOriginRequest(url)
  );
}

function noteStreamHeadersAnswered() {
  streamHeaderRejections = 0;
  streamHeaderOutcomes += 1;
}

function noteStreamHeadersRejected(outcomesAtSend: number) {
  if (outcomesAtSend !== streamHeaderOutcomes) return;

  streamHeaderOutcomes += 1;
  streamHeaderRejections += 1;
  if (streamHeaderRejections < MENTION_STREAM_HEADER_REJECTION_LIMIT) return;

  streamHeaderRejections = 0;
  streamHeadersOffUntil = Date.now() + MENTION_STREAM_HEADERS_OFF_MS;
  if (streamHeadersWarned) return;

  streamHeadersWarned = true;
  console.warn(
    '[mention-search] Mention searches with the x-request-time and x-request-stream-id headers ' +
      'failed twice without a response, while the same searches without them were answered. A CORS ' +
      'preflight probably rejects these headers: a self-hosted proxy needs both in its CORS ' +
      `allow-list. This tab leaves them out of mention searches for ${MENTION_STREAM_HEADERS_OFF_MS / 60_000} ` +
      'minutes at a time.'
  );
}

/** Forgets the header rejections recorded by an earlier test. */
export function resetMentionStreamHeadersForTests() {
  streamHeaderRejections = 0;
  streamHeaderOutcomes = 0;
  streamHeadersOffUntil = 0;
  streamHeadersWarned = false;
}

/**
 * Searches mention targets. `options` carries the request's abort signal and its Search
 * supersession stream (`x-request-stream-id`, `x-request-time`). A cross-origin search with those
 * headers that fails without any response is retried once without them. After two separate such
 * failures in a row whose retries were answered, the tab leaves the headers out for
 * `MENTION_STREAM_HEADERS_OFF_MS`.
 */
export async function searchMentions(
  workspaceId: string,
  payload: MentionSearchRequest,
  options: MentionSearchOptions = {}
): Promise<MentionSearchResponse> {
  const url = `/api/workspace/${workspaceId}/mentions/search`;
  const { signal } = options;
  const post = (headers?: Record<string, string>) =>
    getAxios()?.post<APIResponse<MentionSearchResponse>>(url, payload, {
      ...(headers ? { headers } : {}),
      ...(signal ? { signal } : {}),
    });

  return executeAPIRequest<MentionSearchResponse>(async () => {
    const headers = mentionStreamHeaders(options);

    if (!headers) return post();

    const outcomesAtSend = streamHeaderOutcomes;

    try {
      const response = await post(headers);

      noteStreamHeadersAnswered();
      return response;
    } catch (error) {
      // Any response, an error status included, got past the preflight with the headers.
      if (axios.isAxiosError(error) && error.response) noteStreamHeadersAnswered();
      if (signal?.aborted || !mayBeRejectedStreamHeaders(error, url)) throw error;

      // A real outage fails this retry as well, and counts as no rejection.
      const response = await post();

      noteStreamHeadersRejected(outcomesAtSend);
      return response;
    }
  });
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

export async function reorderWorkspaces(workspaceIds: string[]) {
  const url = `/api/workspace/reorder`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      workspace_ids: workspaceIds,
    })
  );
}
