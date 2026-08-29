import axios from 'axios';
import { validate as isUuid } from 'uuid';

import {
  CreateOnlyPublicFormUploadUrlResponse,
  FormSubmissionPayload,
  FormSubmitResponse,
  PUBLIC_FORM_MAX_BYTES_PER_FILE,
  PUBLIC_FORM_SUBMIT_MAX_BODY_BYTES,
  PublicFormResponse,
  PublicFormUploadUrlRequest,
} from '@/application/types/form';

import { APIError, getAxios, handleAPIError } from './core';

/**
 * Public form HTTP surface — mirror of the actix scope
 * `public_form_scope` in `appflowy-cloud/src/api/workspace/public_form.rs`.
 *
 * **Auth posture:** these endpoints accept anonymous traffic. The cloud
 * uses `OptionalUserUuid`, so the shared axios instance can carry a
 * bearer token (workspace-tier forms still need it) or not (public-tier
 * accepts no auth). No special http client is needed — passing the
 * existing instance is correct.
 */

// nudge: form-api wire-shape fix
const PUBLIC_FORM_BASE = '/api/workspace/public-form';

const SUBMISSION_STATUSES = new Set(['queued', 'processing', 'accepted', 'failed'] as const);

const PUBLIC_FORM_ERROR_MESSAGES: Record<string, string> = {
  auth_required: 'Log in to continue.',
  not_a_workspace_member: 'This form is only available to workspace members.',
  form_closed: 'This form is no longer accepting responses.',
  public_sharing_disabled_by_admin: 'Public form sharing was disabled by a workspace administrator.',
  rate_limited: 'Too many form requests were sent. Please try again later.',
  token_rate_limited: 'Too many responses were submitted. Please try again later.',
  workspace_rate_limited: 'This workspace has reached its response limit. Please try again later.',
  upload_rate_limited: 'This form has reached its upload limit. Please try again later.',
  upload_capacity_reached: 'File uploads are temporarily at capacity. Please try again later.',
  workspace_upload_limit_reached: 'This workspace has reached its upload storage limit.',
  server_busy: 'The form service is busy. Please try again shortly.',
  submission_queue_full: 'The form service is busy processing responses. Please try again shortly.',
  form_schema_unavailable: 'This form is temporarily unavailable. Please try again shortly.',
  create_only_upload_protocol_required:
    'This version of the form uploader is no longer supported. Reload the app and try again.',
  no_upload_capable_question: 'This form no longer accepts file uploads.',
  unsupported_media_type: 'This file type is not supported.',
  file_too_large: 'This file exceeds the form upload limit.',
  empty_file_name: 'The selected file does not have a valid name.',
  invalid_file_name: 'The selected file name contains unsupported characters.',
  daily_limit_reached: 'This form has reached its daily upload limit.',
  invalid_answers: 'One or more answers are invalid. Review the form and try again.',
  invalid_payload: 'The form response is too large or has an invalid shape.',
  body_too_large: 'The form response is too large.',
  malformed_json: 'The form response could not be read. Please try again.',
  unsupported_content_encoding: 'Compressed form requests are not supported.',
  request_body_timeout: 'The form response took too long to upload. Please try again.',
};

/** Public endpoints use a direct JSON error body instead of `AppResponse`. */
export interface PublicFormAPIError extends APIError {
  publicCode?: string;
  loginUrl?: string;
}

/**
 * `GET /api/workspace/public-form/{token}` — fetch respondent-safe form schema.
 *
 * The response is a tagged union — the caller switches on `kind`:
 *   - `active`   → render the form
 *   - `closed`   → render "no longer accepting responses" page
 *   - `auth_required` → workspace-tier hit by anonymous client; redirect to `login_url`
 *
 * Wire HTTP status semantics (from the cloud handler):
 *   - 200 with one of the three `kind` variants for the happy-path cases.
 *   - 410 Gone for revoked/expired tokens (surfaces as `APIError`).
 *   - 404 Not Found for unknown tokens (surfaces as `APIError`).
 *
 * We don't auto-unwrap the kind here — callers need to render different
 * UI per variant, and the wire shape is the natural switch key.
 */
export async function getPublicFormSchema(token: string): Promise<PublicFormResponse> {
  // The cloud's public-form endpoints return the schema body directly
  // (not wrapped in the workspace-API `{code, data}` envelope), so we
  // can't route through `executeAPIRequest`. Validate-and-throw here,
  // but normalize axios failures via `handleAPIError` so callers see an
  // `APIError` with the real HTTP status — FormView depends on `code`
  // being 404/410 to render the NotFound/Gone branch.
  const client = getAxios();

  if (!client) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }

  if (!isUuid(token)) return Promise.reject(invalidPublicFormTokenError());

  try {
    const response = await client.get<PublicFormResponse>(`${PUBLIC_FORM_BASE}/${token}`);

    if (!isValidPublicFormResponse(response?.data)) {
      return Promise.reject({ code: -1, message: 'Malformed form schema response' });
    }

    if (response.data.kind === 'active' && response.data.form_id.toLowerCase() !== token.toLowerCase()) {
      return Promise.reject({ code: -1, message: 'Form schema token mismatch' });
    }

    return response.data;
  } catch (err) {
    return Promise.reject(handlePublicFormAPIError(err));
  }
}

/**
 * `POST /api/workspace/public-form/{token}/submit` — submit answers.
 *
 * Idempotency: pass an `Idempotency-Key` header (a UUID) to make retries
 * safe. The cloud's submit handler keys dedup off `(token, idempotency_key)`,
 * so a network retry with the same key replays the existing row instead
 * of creating a duplicate. The caller is responsible for generating the
 * key (typically once per form-page mount, so a tab reload doesn't dedup
 * against the previous attempt).
 */
export async function submitPublicForm(
  token: string,
  payload: FormSubmissionPayload,
  idempotencyKey: string
): Promise<FormSubmitResponse> {
  // The cloud's `/public-form/{token}/submit` endpoint emits two distinct
  // shapes the caller has to disambiguate:
  //
  //   * 200 → `{ submission_id, status }` (no `kind` field on the wire) —
  //     map onto the typed-union's `submitted` variant.
  //   * 400 → `{ error: 'missing_required_answers', question_ids: [...] }`
  //     — translate into `{kind: 'invalid', field_errors}` so the UI can
  //     surface per-question "Required" markers without a second request.
  //   * Any other non-2xx → reject with `handleAPIError` (preserves
  //     retry-after on 429, status on 404/410, etc.).
  //
  // The 400 path is the reason this can't route through `executeAPIRequest`:
  // a 400 must NOT propagate as an error; the answer is in the body.
  const client = getAxios();

  if (!client) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }

  if (!isUuid(token)) return Promise.reject(invalidPublicFormTokenError());

  // The server treats a malformed header as absent and mints a random key.
  // Reject locally so every retry is guaranteed to address the same durable
  // `(token, idempotency_key)` reservation.
  if (!isUuid(idempotencyKey)) {
    return Promise.reject({
      code: -1,
      message: 'A valid UUID idempotency key is required for form submission retries.',
    } satisfies PublicFormAPIError);
  }

  if (jsonSizeInBytes(payload) > PUBLIC_FORM_SUBMIT_MAX_BODY_BYTES) {
    return Promise.reject({
      code: 413,
      httpStatus: 413,
      publicCode: 'invalid_payload',
      message: PUBLIC_FORM_ERROR_MESSAGES.invalid_payload,
    } satisfies PublicFormAPIError);
  }

  try {
    const response = await client.post<{ submission_id?: string; status?: string }>(
      `${PUBLIC_FORM_BASE}/${token}/submit`,
      payload,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      }
    );

    if (!response?.data || typeof response.data !== 'object') {
      return Promise.reject({ code: -1, message: 'Malformed submit response' });
    }

    const { submission_id, status } = response.data;

    if (
      typeof submission_id !== 'string' ||
      !isUuid(submission_id) ||
      typeof status !== 'string' ||
      !isSubmissionStatus(status)
    ) {
      return Promise.reject({ code: -1, message: 'Malformed submit response' });
    }

    return { kind: 'submitted', submission_id, status };
  } catch (err) {
    const invalid = tryParseInvalidPayloadError(err);

    if (invalid) return invalid;
    return Promise.reject(handlePublicFormAPIError(err));
  }
}

/**
 * Recognize the cloud's `400 missing_required_answers` response and turn
 * it into a typed `invalid` variant. Returns `null` for anything else so
 * the caller can fall through to the generic `handleAPIError` path.
 *
 * The cloud body is `{ error: 'missing_required_answers', question_ids: [...] }`;
 * we surface a generic per-question "Required" message because that's all
 * the server tells us today. Richer messages can flow through later if
 * the wire grows them.
 */
function tryParseInvalidPayloadError(err: unknown): FormSubmitResponse | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 400) return null;
  const body = err.response.data as { error?: string; question_ids?: unknown } | undefined;

  if (body?.error !== 'missing_required_answers') return null;
  const ids = Array.isArray(body.question_ids) ? body.question_ids : [];
  const field_errors: Record<string, string> = {};

  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) {
      field_errors[id] = 'Required';
    }
  }

  return { kind: 'invalid', field_errors };
}

/**
 * `POST /api/workspace/public-form/{token}/upload-url` — mint a presigned PUT
 * URL for a single file attachment.
 *
 * The respondent uploads the body directly to `upload_url` (bypassing this
 * server), then echoes `file_id` back in the matching `files`-kind answer at
 * submit time so the server can link the upload to the new submission.
 *
 * Error surface (mapped from HTTP status):
 *   - 400 → APIError with the body's `error` code (e.g. `file_too_large`)
 *   - 401 → APIError surfaced to caller; workspace-tier forms only
 *   - 403/404/410 → APIError; caller should redirect to the form's closed page
 *   - 429 → APIError; caller should surface a "daily upload cap" message
 */
export async function requestPublicFormUploadUrl(
  token: string,
  request: PublicFormUploadUrlRequest
): Promise<CreateOnlyPublicFormUploadUrlResponse> {
  const client = getAxios();

  if (!client) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }

  if (!isUuid(token)) return Promise.reject(invalidPublicFormTokenError());

  if (
    !Number.isSafeInteger(request.content_length) ||
    request.content_length <= 0 ||
    request.content_length > PUBLIC_FORM_MAX_BYTES_PER_FILE
  ) {
    return Promise.reject({
      code: 400,
      httpStatus: 400,
      publicCode: 'file_too_large',
      message: PUBLIC_FORM_ERROR_MESSAGES.file_too_large,
    } satisfies PublicFormAPIError);
  }

  if (!request.file_name.trim()) {
    return Promise.reject({
      code: 400,
      httpStatus: 400,
      publicCode: 'empty_file_name',
      message: PUBLIC_FORM_ERROR_MESSAGES.empty_file_name,
    } satisfies PublicFormAPIError);
  }

  try {
    const response = await client.post<CreateOnlyPublicFormUploadUrlResponse>(
      `${PUBLIC_FORM_BASE}/${token}/upload-url`,
      {
        ...request,
        // Never silently fall back to legacy_v1. Its presigned PUT can be
        // replayed to replace the pending object until it expires.
        upload_protocol: 'create_only_v2',
      } satisfies PublicFormUploadUrlRequest
    );

    if (!response?.data || typeof response.data !== 'object') {
      return Promise.reject({ code: -1, message: 'Malformed upload-url response' });
    }

    if (!isValidCreateOnlyUploadResponse(response.data)) {
      return Promise.reject({
        code: -1,
        message: 'Malformed create-only upload-url response',
      });
    }

    return response.data;
  } catch (err) {
    return Promise.reject(handlePublicFormAPIError(err));
  }
}

/**
 * Upload a file's bytes to a presigned PUT URL produced by
 * `requestPublicFormUploadUrl`. Goes direct to object storage — no API token
 * needed on this request. The presigned URL embeds method (PUT), expiry, and
 * the exact `content-length` / `content-type` the server signed with, so they
 * must match here exactly or the storage backend rejects the upload.
 */
export async function uploadFormFileToPresignedUrl(
  upload_url: string,
  file: File,
  upload_content_type: string,
  upload_if_none_match: string
): Promise<void> {
  if (upload_if_none_match !== '*') {
    return Promise.reject({
      code: -1,
      message: 'Malformed create-only upload precondition',
    });
  }

  // Use plain fetch — the shared axios instance carries auth headers we don't
  // want on a third-party (or differently-scoped) S3 endpoint.
  const response = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: {
      // This value can differ from `File.type` when the browser reports an
      // empty or non-allowlisted MIME. Object storage verifies the header as
      // part of the signature, so use the server-selected value verbatim.
      'Content-Type': upload_content_type,
      // The create_only_v2 capability signs this precondition. Omitting it
      // would either fail the signature or make a replay overwrite possible.
      'If-None-Match': upload_if_none_match,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    return Promise.reject({
      code: response.status,
      message: `Upload failed (${response.status}): ${detail.slice(0, 200)}`,
    });
  }
}

function invalidPublicFormTokenError(): PublicFormAPIError {
  return {
    code: 404,
    httpStatus: 404,
    message: 'Form not found',
  };
}

function isValidPublicFormResponse(value: unknown): value is PublicFormResponse {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;

  const response = value as Record<string, unknown>;

  switch (response.kind) {
    case 'closed':
      return typeof response.message === 'string';
    case 'auth_required':
      return typeof response.login_url === 'string' && response.login_url.length > 0;
    case 'active':
      return (
        typeof response.form_id === 'string' &&
        isUuid(response.form_id) &&
        (response.tier === 'workspace' || response.tier === 'public') &&
        typeof response.anonymous === 'boolean' &&
        typeof response.title === 'string' &&
        Array.isArray(response.questions) &&
        typeof response.submit_label === 'string' &&
        typeof response.submit_color === 'string' &&
        typeof response.confirmation_title === 'string' &&
        typeof response.allow_another_response === 'boolean' &&
        typeof response.hide_branding === 'boolean'
      );
    default:
      return false;
  }
}

function isSubmissionStatus(value: string): value is 'queued' | 'processing' | 'accepted' | 'failed' {
  return SUBMISSION_STATUSES.has(value as 'queued' | 'processing' | 'accepted' | 'failed');
}

function isValidCreateOnlyUploadResponse(value: CreateOnlyPublicFormUploadUrlResponse): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    !isUuid(value.file_id) ||
    typeof value.upload_url !== 'string' ||
    typeof value.upload_content_type !== 'string' ||
    value.upload_content_type.length === 0 ||
    value.upload_protocol !== 'create_only_v2' ||
    value.upload_if_none_match !== '*' ||
    !Number.isSafeInteger(value.expires_in_secs) ||
    value.expires_in_secs <= 0
  ) {
    return false;
  }

  try {
    const uploadUrl = new URL(value.upload_url);

    return uploadUrl.protocol === 'https:' || uploadUrl.protocol === 'http:';
  } catch {
    return false;
  }
}

function handlePublicFormAPIError(error: unknown): PublicFormAPIError {
  const normalized = handleAPIError(error);

  if (!axios.isAxiosError(error) || !error.response) return normalized;

  const body = error.response.data as
    | {
        error?: unknown;
        login_url?: unknown;
        retry_after_seconds?: unknown;
      }
    | undefined;
  const publicCode = typeof body?.error === 'string' ? body.error : undefined;
  const bodyRetryAfter =
    typeof body?.retry_after_seconds === 'number' &&
    Number.isFinite(body.retry_after_seconds) &&
    body.retry_after_seconds >= 0
      ? body.retry_after_seconds
      : undefined;

  return {
    ...normalized,
    message: (publicCode && PUBLIC_FORM_ERROR_MESSAGES[publicCode]) || normalized.message,
    publicCode,
    loginUrl: typeof body?.login_url === 'string' ? body.login_url : undefined,
    retryAfterSecs: normalized.retryAfterSecs ?? bodyRetryAfter,
  };
}

function jsonSizeInBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}
