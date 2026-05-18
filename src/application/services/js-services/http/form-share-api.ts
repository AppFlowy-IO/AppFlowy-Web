import { APIResponse, executeAPIRequest, getAxios } from './core';

/**
 * Authoring side of the form share token — mirror of the actix scope
 * `form_share_scope` in `appflowy-cloud/src/api/workspace/form_share.rs`.
 *
 * The respondent endpoints (`/api/workspace/public-form/{token}`) live
 * in `form-api.ts` and are auth-bypassed. These endpoints require the
 * caller to be a workspace member.
 */

export type FormShareTier = 'workspace' | 'public' | 'closed';
export type FormSubmissionAccess = 'none' | 'view';

export interface FormShareInfo {
  token: string;
  tier: FormShareTier;
  anonymous: boolean;
  /// Server defaults to `none` for legacy rows (pre-migration). Public
  /// tier or anonymous=true forces this to `none` server-side.
  submission_access: FormSubmissionAccess;
  /// Cloud-composed respondent URL — `APPFLOWY_WEB_URL/form/{token}`.
  /// Empty when the deployment hasn't set `APPFLOWY_WEB_URL`; the UI
  /// should treat empty as "share not configured" and surface a copy
  /// error rather than copying a host-less link.
  share_url: string;
  expires_at?: string;
  created_at: string;
}

export interface FormShareMintRequest {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
}

export interface FormShareUpdateRequest {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
}

function shareUrl(
  workspaceId: string,
  databaseId: string,
  viewId: string,
): string {
  return `/api/workspace/${workspaceId}/database/${databaseId}/view/${viewId}/form/share`;
}

/** `GET .../form/share` — read the active token. 404 = none minted yet. */
export async function getFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
): Promise<FormShareInfo | null> {
  // Use a custom catch so the "no token yet" case doesn't bubble up
  // as an exception — it's a common state worth distinguishing from a
  // real error.
  return executeAPIRequest<FormShareInfo | null>(() =>
    getAxios()?.get<APIResponse<FormShareInfo | null>>(
      shareUrl(workspaceId, databaseId, viewId),
    ),
  );
}

/** `POST .../form/share` — mint the first token with privacy-by-default. */
export async function mintFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: FormShareMintRequest = {},
): Promise<FormShareInfo> {
  return executeAPIRequest<FormShareInfo>(() =>
    getAxios()?.post<APIResponse<FormShareInfo>>(
      shareUrl(workspaceId, databaseId, viewId),
      request,
    ),
  );
}

/** `PATCH .../form/share` — toggle tier / anonymous / submission_access. */
export async function patchFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: FormShareUpdateRequest,
): Promise<FormShareInfo> {
  return executeAPIRequest<FormShareInfo>(() =>
    getAxios()?.patch<APIResponse<FormShareInfo>>(
      shareUrl(workspaceId, databaseId, viewId),
      request,
    ),
  );
}
