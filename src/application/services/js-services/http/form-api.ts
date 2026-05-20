import {
  FormSubmissionPayload,
  FormSubmitResponse,
  PublicFormResponse,
  PublicFormUploadUrlRequest,
  PublicFormUploadUrlResponse,
} from '@/application/types/form';

import { getAxios } from './core';

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
  // can't route through `executeAPIRequest`. Validate-and-throw here.
  const axios = getAxios();

  if (!axios) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }
  const response = await axios.get<PublicFormResponse>(
    `${PUBLIC_FORM_BASE}/${token}`,
  );

  if (!response?.data || typeof response.data !== 'object') {
    return Promise.reject({ code: -1, message: 'Malformed form schema response' });
  }
  return response.data;
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
  // Same wire-shape mismatch as `getPublicFormSchema` — body returns the
  // tagged-union response directly, not the workspace-API envelope.
  const axios = getAxios();

  if (!axios) {
    return Promise.reject({ code: -1, message: 'API service not initialized' });
  }
  const response = await axios.post<FormSubmitResponse>(
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
  return response.data;
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
  const response = await axios.post<PublicFormUploadUrlResponse>(
    `${PUBLIC_FORM_BASE}/${token}/upload-url`,
    request,
  );

  if (!response?.data || typeof response.data !== 'object') {
    return Promise.reject({ code: -1, message: 'Malformed upload-url response' });
  }
  return response.data;
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
