import axios from 'axios';

import {
  FormSubmissionPayload,
  FormSubmitResponse,
  PublicFormResponse,
  PublicFormUploadUrlRequest,
  PublicFormUploadUrlResponse,
} from '@/application/types/form';

import { getAxios, handleAPIError } from './core';

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
export async function getPublicFormSchema(
  token: string,
): Promise<PublicFormResponse> {
  // The cloud's public-form endpoints return the schema body directly
  // (not wrapped in the workspace-API `{code, data}` envelope), so we
  // can't route through `executeAPIRequest`. Validate-and-throw here,
  // but normalize axios failures via `handleAPIError` so callers see an
  // `APIError` with the real HTTP status — FormView depends on `code`
  // being 404/410 to render the NotFound/Gone branch.
  const axios = getAxios();

  if (!axios) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }

  try {
    const response = await axios.get<PublicFormResponse>(
      `${PUBLIC_FORM_BASE}/${token}`,
    );

    if (!response?.data || typeof response.data !== 'object') {
      return Promise.reject({ code: -1, message: 'Malformed form schema response' });
    }

    return response.data;
  } catch (err) {
    return Promise.reject(handleAPIError(err));
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
  idempotencyKey: string,
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

  try {
    const response = await client.post<{ submission_id?: string; status?: string }>(
      `${PUBLIC_FORM_BASE}/${token}/submit`,
      payload,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );

    if (!response?.data || typeof response.data !== 'object') {
      return Promise.reject({ code: -1, message: 'Malformed submit response' });
    }

    const { submission_id, status } = response.data;

    if (typeof submission_id !== 'string' || typeof status !== 'string') {
      return Promise.reject({ code: -1, message: 'Malformed submit response' });
    }

    return { kind: 'submitted', submission_id, status };
  } catch (err) {
    const invalid = tryParseInvalidPayloadError(err);

    if (invalid) return invalid;
    return Promise.reject(handleAPIError(err));
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
  const body = err.response.data as
    | { error?: string; question_ids?: unknown }
    | undefined;

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
  request: PublicFormUploadUrlRequest,
): Promise<PublicFormUploadUrlResponse> {
  const axios = getAxios();

  if (!axios) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }

  try {
    const response = await axios.post<PublicFormUploadUrlResponse>(
      `${PUBLIC_FORM_BASE}/${token}/upload-url`,
      request,
    );

    if (!response?.data || typeof response.data !== 'object') {
      return Promise.reject({ code: -1, message: 'Malformed upload-url response' });
    }

    return response.data;
  } catch (err) {
    return Promise.reject(handleAPIError(err));
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
): Promise<void> {
  // Use plain fetch — the shared axios instance carries auth headers we don't
  // want on a third-party (or differently-scoped) S3 endpoint.
  const response = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
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
