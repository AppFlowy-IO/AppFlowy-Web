/**
 * Public-form wire types — mirror of `appflowy_entity::dto::form_dto`
 * (`AppFlowy-Cloud-Premium/libs/appflowy-entity/src/shared/dto/form_dto.rs`).
 *
 * The cloud serializes these with serde's `snake_case` rename — we keep
 * the wire shape on the type and adapt at the boundary (no runtime
 * camelCase translation; this is the friction point that's easiest to
 * regress on, and the snake_case is contained to this module + the
 * service layer that consumes it).
 *
 * Privacy invariant: nothing here exposes `workspace_id`, `database_id`,
 * `view_id`, `field_id`, or `created_by`. Form IDs are opaque tokens; the
 * `id` on `PublicQuestion` is a per-token nonce (not the underlying
 * database field id).
 */

/** Tagged-union response from `GET /api/workspace/public-form/{token}`. */
export type PublicFormResponse =
  | ({ kind: 'active' } & PublicFormSchema)
  | { kind: 'closed'; message: string }
  | { kind: 'auth_required'; login_url: string };

/**
 * Legacy respondent-title fallback used only at display boundaries. Form
 * authoring keeps an empty title as an empty string so the builder can show its
 * `Form title` placeholder without silently persisting fallback copy.
 */
export const LEGACY_FORM_TITLE = 'Untitled form';

export function resolveFormDisplayTitle(title: string): string {
  const normalized = title.trim();

  return normalized.length > 0 ? normalized : LEGACY_FORM_TITLE;
}

export interface PublicFormSchema {
  /** Same as the URL token — surfaced so the client correlates without re-parsing. */
  form_id: string;
  tier: PublicTier;
  anonymous: boolean;

  // Copy
  title: string;
  description?: string;
  cover_url?: string;
  icon?: string;

  // Questions (already filtered to respondent-visible types server-side).
  questions: PublicQuestion[];

  // Submit screen
  submit_label: string;
  submit_color: string;
  confirmation_title: string;
  confirmation_body?: string;
  allow_another_response: boolean;
  redirect_url?: string;

  hide_branding: boolean;
}

export type PublicTier = 'workspace' | 'public';

export interface PublicQuestion {
  /** Opaque per-token id. Stable across reloads; never equals the underlying field_id. */
  id: string;
  label: string;
  description?: string;
  kind: PublicQuestionKind;
  required: boolean;
  long_answer: boolean;
  max_selections?: number;
  options?: PublicOption[];
  input_style: PublicInputStyle;
  /**
   * Per-file size cap for `kind: 'files'` questions. Surfaced server-side so
   * the client can short-circuit oversize files before round-tripping to S3.
   */
  max_bytes_per_file?: number;
  /** Max attachments the respondent can submit for this question. */
  max_files?: number;
}

export type PublicQuestionKind =
  | 'text'
  | 'number'
  | 'url'
  | 'email'
  | 'phone'
  | 'checkbox'
  | 'single_select'
  | 'multi_select'
  | 'date'
  // Phase-2 types — server may emit them but Phase-1 web renders a disabled
  // "Not yet supported" placeholder. Keep them in the union so a future
  // backend bump doesn't break the type compile.
  | 'files'
  | 'person'
  | 'relation';

export type PublicInputStyle = 'auto' | 'list' | 'dropdown';

export interface PublicOption {
  id: string;
  label: string;
  color?: string;
}

// ── Submit ────────────────────────────────────────────────────────────

/**
 * `POST /api/workspace/public-form/{token}/submit` payload.
 * Keyed by `PublicQuestion.id` (the opaque per-token nonce).
 */
export interface FormSubmissionPayload {
  answers: Record<string, FormAnswerValue>;
}

/**
 * Discriminated union of answer values. Server-side `FormSubmissionPayload`
 * uses a typed enum; the web normalizes to typed properties so the form
 * renderer doesn't have to remember the variant tag.
 */
export type FormAnswerValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'single_select'; option_id: string | null }
  | { kind: 'multi_select'; option_ids: string[] }
  | { kind: 'date'; iso: string | null }
  | { kind: 'files'; files: FormFileAttachment[] };

/**
 * One attachment in a `kind: 'files'` answer. Before submit, Web keeps the
 * local `File` object here; after submit-time upload, `file_id` is the opaque
 * handle returned by the upload-url endpoint.
 */
export interface FormFileAttachment {
  file_id?: string;
  local_id?: string;
  name: string;
  size: number;
  content_type?: string;
  file?: File;
}

// ── Upload (Phase-2) ──────────────────────────────────────────────────

export interface PublicFormUploadUrlRequest {
  file_name: string;
  content_length: number;
  content_type?: string;
  /**
   * The current Web client always requests the replay-resistant contract.
   * Kept on the wire DTO because the server rejects legacy clients with 426
   * once the compatibility window is closed.
   */
  upload_protocol?: PublicFormUploadProtocol;
}

export type PublicFormUploadProtocol = 'legacy_v1' | 'create_only_v2';

interface PublicFormUploadUrlResponseBase {
  file_id: string;
  upload_url: string;
  /** Exact Content-Type value included in the presigned PUT signature. */
  upload_content_type: string;
  download_url?: string;
  expires_in_secs: number;
}

/**
 * The selected object-store PUT contract. `upload_if_none_match` is required
 * for create-only capabilities and absent from legacy responses.
 */
export type PublicFormUploadUrlResponse =
  | (PublicFormUploadUrlResponseBase & {
      upload_protocol: 'create_only_v2';
      upload_if_none_match: string;
    })
  | (PublicFormUploadUrlResponseBase & {
      upload_protocol: 'legacy_v1';
      upload_if_none_match?: never;
    });

/** Response refined by `requestPublicFormUploadUrl` after wire validation. */
export type CreateOnlyPublicFormUploadUrlResponse = Extract<
  PublicFormUploadUrlResponse,
  { upload_protocol: 'create_only_v2' }
>;

/**
 * Submit-response from `submitPublicForm`. Two variants:
 *
 *   * `submitted` — the cloud accepted the row (HTTP 200). `status` is the
 *     processing state of the async worker handoff (`queued` /
 *     `processing` / `accepted` / `failed`).
 *   * `invalid` — the cloud rejected the payload with `400` and a
 *     `missing_required_answers` body. The HTTP layer parses the
 *     server's `question_ids` array into per-question error strings.
 *
 * Other HTTP errors (410 revoked, 429 rate-limited, 503 busy, …)
 * bubble out as `APIError`.
 */
export type FormSubmitResponse =
  | {
      kind: 'submitted';
      submission_id: string;
      status: 'queued' | 'processing' | 'accepted' | 'failed';
    }
  | { kind: 'invalid'; field_errors: Record<string, string> };

/** Transport ceilings mirrored from the public-form server contract. */
export const PUBLIC_FORM_SUBMIT_MAX_BODY_BYTES = 256 * 1024;
export const PUBLIC_FORM_MAX_ANSWER_STRING_AND_KEY_BYTES = 128 * 1024;
export const PUBLIC_FORM_MAX_TEXT_ANSWER_BYTES = 32 * 1024;
export const PUBLIC_FORM_MAX_URL_ANSWER_BYTES = 2 * 1024;
export const PUBLIC_FORM_MAX_EMAIL_ANSWER_BYTES = 320;
export const PUBLIC_FORM_MAX_PHONE_ANSWER_BYTES = 64;
export const PUBLIC_FORM_MAX_BYTES_PER_FILE = 5 * 1024 * 1024;
export const PUBLIC_FORM_MAX_FILE_NAME_BYTES = 255;
export const PUBLIC_FORM_MAX_FILES_PER_QUESTION = 10;
export const PUBLIC_FORM_MAX_FILES_PER_SUBMISSION = 20;
