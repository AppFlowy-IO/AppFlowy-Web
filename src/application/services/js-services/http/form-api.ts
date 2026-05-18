import {
  FormSubmissionPayload,
  FormSubmitResponse,
  PublicFormResponse,
} from '@/application/types/form';

import { APIResponse, executeAPIRequest, getAxios } from './core';

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
  return executeAPIRequest<PublicFormResponse>(() =>
    getAxios()?.get<APIResponse<PublicFormResponse>>(
      `${PUBLIC_FORM_BASE}/${token}`,
    ),
  );
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
  return executeAPIRequest<FormSubmitResponse>(() =>
    getAxios()?.post<APIResponse<FormSubmitResponse>>(
      `${PUBLIC_FORM_BASE}/${token}/submit`,
      payload,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    ),
  );
}
