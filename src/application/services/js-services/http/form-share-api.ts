import { validate as isUuid } from 'uuid';

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

export interface FormSubmissionInfo {
  id: string;
  row_id: string;
  /** PostgreSQL BIGINT encoded as a decimal string to avoid JS precision loss. */
  submitter_uid?: string;
  submitted_at: string;
}

export interface FormSubmissionCursor {
  submitted_at: string;
  submission_id: string;
}

export interface ListFormSubmissionsResponse {
  submissions: FormSubmissionInfo[];
  next_cursor?: FormSubmissionCursor;
}

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

/**
 * Read the owner-only audit page. The timestamp and submission ID are one
 * lossless cursor and are therefore accepted/emitted only as a pair.
 */
export async function listFormSubmissions(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  options: { cursor?: FormSubmissionCursor; limit?: number } = {}
): Promise<ListFormSubmissionsResponse> {
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || !Number.isSafeInteger(options.limit))) {
    return Promise.reject({ code: -1, message: 'Form submission page limit must be an integer.' });
  }

  if (
    options.cursor &&
    (!isUuid(options.cursor.submission_id) ||
      !RFC3339_TIMESTAMP.test(options.cursor.submitted_at) ||
      Number.isNaN(Date.parse(options.cursor.submitted_at)))
  ) {
    return Promise.reject({ code: -1, message: 'Malformed form submission cursor.' });
  }

  const limit = options.limit === undefined ? undefined : Math.min(200, Math.max(1, Math.trunc(options.limit)));
  const params = options.cursor
    ? {
        before: options.cursor.submitted_at,
        before_id: options.cursor.submission_id,
        ...(limit === undefined ? {} : { limit }),
      }
    : limit === undefined
    ? undefined
    : { limit };

  return executeAPIRequest<ListFormSubmissionsResponse>(
    () =>
      getAxios()?.get<APIResponse<ListFormSubmissionsResponse>>(
        `/api/workspace/${workspaceId}/database/${databaseId}/view/${viewId}/form/submissions`,
        { params }
      ),
    { suppressResponseDataLogging: true }
  );
}
