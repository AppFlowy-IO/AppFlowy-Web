import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

/**
 * Authoring side of the form share token — mirror of the actix scope
 * `form_share_scope` in `appflowy-cloud/src/api/workspace/form_share.rs`.
 *
 * The respondent endpoints (`/api/workspace/public-form/{token}`) live
 * in `form-api.ts` and are auth-bypassed. These endpoints require the
 * caller to be a workspace member.
 */

export type FormShareTier = 'workspace' | 'public' | 'closed';
/** No respondent-facing submission read path exists yet. */
export type FormSubmissionAccess = 'none';

export interface FormShareInfo {
  token: string;
  tier: FormShareTier;
  anonymous: boolean;
  /// Server defaults to `none` for legacy rows (pre-migration). Public
  /// tier or anonymous=true forces this to `none` server-side.
  submission_access: FormSubmissionAccess;
  /// Cloud-composed respondent URL — `APPFLOWY_WEB_URL/form/{token}`.
  /// Older or misconfigured deployments may omit it. Consumers must validate
  /// that it is an absolute HTTP(S) URL before exposing a copy action.
  share_url?: string;
  expires_at?: string;
  created_at: string;
}

export interface FormShareMintRequest {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
  expires_at?: string;
}

export interface FormShareUpdateRequest {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
  /** Omit to preserve, set an ISO timestamp to update, or null to clear. */
  expires_at?: string | null;
}

/**
 * Reset fields are sparse: omitted values are preserved atomically from the
 * active token; `expires_at: null` explicitly clears expiry.
 */
export interface FormShareResetRequest {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
  expires_at?: string | null;
}

function shareUrl(workspaceId: string, databaseId: string, viewId: string): string {
  return `/api/workspace/${workspaceId}/database/${databaseId}/view/${viewId}/form/share`;
}

/** `GET .../form/share` — read the active token. A successful null means none is active. */
export async function getFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string
): Promise<FormShareInfo | null> {
  // Use a custom catch so the "no token yet" case doesn't bubble up
  // as an exception — it's a common state worth distinguishing from a
  // real error.
  return executeAPIRequest<FormShareInfo | null>(
    () => getAxios()?.get<APIResponse<FormShareInfo | null>>(shareUrl(workspaceId, databaseId, viewId)),
    { suppressResponseDataLogging: true }
  );
}

/** `POST .../form/share` — mint the first token with privacy-by-default. */
export async function mintFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: FormShareMintRequest = {}
): Promise<FormShareInfo> {
  return executeAPIRequest<FormShareInfo>(
    () => getAxios()?.post<APIResponse<FormShareInfo>>(shareUrl(workspaceId, databaseId, viewId), request),
    { suppressResponseDataLogging: true }
  );
}

/** `PATCH .../form/share` — toggle tier / anonymous / submission_access. */
export async function patchFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: FormShareUpdateRequest
): Promise<FormShareInfo | null> {
  return executeAPIRequest<FormShareInfo | null>(
    () => getAxios()?.patch<APIResponse<FormShareInfo | null>>(shareUrl(workspaceId, databaseId, viewId), request),
    { suppressResponseDataLogging: true }
  );
}

/** `DELETE .../form/share` — permanently revoke the active token. */
export async function deleteFormShare(workspaceId: string, databaseId: string, viewId: string): Promise<void> {
  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(shareUrl(workspaceId, databaseId, viewId)));
}

/** `POST .../form/share/reset` — revoke and atomically mint a fresh token. */
export async function resetFormShare(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: FormShareResetRequest = {}
): Promise<FormShareInfo> {
  return executeAPIRequest<FormShareInfo>(
    () => getAxios()?.post<APIResponse<FormShareInfo>>(`${shareUrl(workspaceId, databaseId, viewId)}/reset`, request),
    { suppressResponseDataLogging: true }
  );
}
