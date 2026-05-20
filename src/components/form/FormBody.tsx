import { useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';

import {
  requestPublicFormUploadUrl,
  submitPublicForm,
  uploadFormFileToPresignedUrl,
} from '@/application/services/js-services/http';
import {
  FormAnswerValue,
  FormFileAttachment,
  FormSubmissionPayload,
  FormSubmitResponse,
  PublicFormSchema,
  PublicQuestion,
} from '@/application/types/form';
import { Button } from '@/components/ui/button';

import { FormQuestion } from './FormQuestion';

/**
 * Renders the actual form (title + question stack + submit button) plus
 * the post-submit confirmation. Owns the answer-map state and the submit
 * round-trip; the per-question input components are dumb and bubble up
 * `(questionId, value)` pairs.
 *
 * Idempotency: a fresh UUID is minted on each mount and reused for every
 * submit attempt during that session. Network retries against the same
 * key are cheap (the cloud replays); a tab reload mints a new key, which
 * the user explicitly asked for by reloading.
 */
export function FormBody({
  token,
  schema,
  previewMode = false,
}: {
  token: string;
  schema: PublicFormSchema;
  /**
   * When true, the submit handler runs client-side validation and then
   * lands on the confirmation screen WITHOUT hitting the cloud submit
   * endpoint. Used by the form-builder Preview dialog where the
   * caller passes a synthetic schema and a sentinel `token='preview'`
   * — the cloud has no such token and would 404 (user-reported in
   * Image #67). Mirrors the desktop preview's `_onSubmit` no-op that
   * just shows a "Submission valid — looks good!" toast.
   */
  previewMode?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>(() => seedAnswers(schema.questions));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<
    { kind: 'idle' } | { kind: 'submitting' } | { kind: 'submitted' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Idempotency contract:
  //   * One key per submission ATTEMPT — same key reused across retries
  //     of the same attempt (network blip + automatic retry) so the
  //     cloud's `(token, idempotency_key)` dedup returns the original
  //     submission_id instead of creating a duplicate row.
  //   * Fresh key on "Submit another response" — the user is explicitly
  //     starting a new attempt; without rotation the cloud would dedup
  //     the second submit against the first and silently drop it
  //     (user-reported: "Submit another response" looked like it
  //     worked but no new row appeared).
  //
  // `useState` lazy init (not `useMemo`) — React explicitly does not
  // guarantee memo retention, so an empty-deps memo can rerun under
  // strict mode. State init is retained for the lifetime of the
  // component except when we explicitly call `setIdempotencyKey` from
  // `handleSubmitAnother`.
  const [idempotencyKey, setIdempotencyKey] = useState(() => uuid());

  const handleChange = useCallback((questionId: string, value: FormAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    // Clear any inline error as the user starts editing the field —
    // standard form pattern; avoids the "red ink lingers while typing"
    // anti-pattern.
    setFieldErrors((prev) => {
      if (!(questionId in prev)) return prev;
      const next = { ...prev };

      delete next[questionId];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    // Client-side required check — runs before the network round-trip so
    // the user sees "Required" instantly. The server re-validates and is
    // the authority; we treat its `field_errors` as the source of truth
    // when it disagrees.
    const localErrors = collectLocalErrors(schema.questions, answers);

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    // Preview short-circuit: validation passed, jump straight to the
    // confirmation screen. The token in preview mode is the sentinel
    // string `'preview'` which has no cloud row and would 404 on the
    // submit endpoint — see the prop docstring for the bug report
    // this guards against.
    if (previewMode) {
      setSubmitState({ kind: 'submitted' });
      return;
    }

    setSubmitState({ kind: 'submitting' });

    try {
      const uploadedAnswers = await uploadPendingFileAnswers(token, answers);

      // Cache the uploaded shape locally so a server-side `kind: 'invalid'`
      // retry skips the re-upload. `uploadedAnswers` is already in the wire
      // shape (`{file_id, name, size}`) — `uploadPendingFile` strips on both
      // its fresh-upload and replay branches — so we can post it directly.
      setAnswers(uploadedAnswers);
      const payload: FormSubmissionPayload = { answers: uploadedAnswers };
      const res: FormSubmitResponse = await submitPublicForm(token, payload, idempotencyKey);

      if (res.kind === 'invalid') {
        setFieldErrors(res.field_errors);
        setSubmitState({ kind: 'idle' });
        return;
      }

      setSubmitState({ kind: 'submitted' });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Submission failed';

      setSubmitState({ kind: 'error', message });
    }
  }, [answers, idempotencyKey, previewMode, schema.questions, token]);

  const handleSubmitAnother = useCallback(() => {
    setAnswers(seedAnswers(schema.questions));
    setFieldErrors({});
    setSubmitState({ kind: 'idle' });
    // Rotate the idempotency key so the cloud treats this as a fresh
    // submission rather than a retry of the previous one.
    setIdempotencyKey(uuid());
  }, [schema.questions]);

  if (submitState.kind === 'submitted') {
    return (
      <ConfirmationScreen
        title={schema.confirmation_title}
        body={schema.confirmation_body}
        allowAnother={schema.allow_another_response}
        onSubmitAnother={handleSubmitAnother}
        redirectUrl={schema.redirect_url}
      />
    );
  }

  return (
    <div data-testid='public-form-body' className='mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10'>
      <header className='flex flex-col gap-2'>
        {schema.icon && (
          <div className='text-3xl' aria-hidden>
            {schema.icon}
          </div>
        )}
        <h1 className='text-3xl font-bold'>{schema.title}</h1>
        {schema.description && <p className='text-text-caption'>{schema.description}</p>}
      </header>

      <div className='flex flex-col gap-6'>
        {schema.questions.map((q) => (
          <FormQuestion
            key={q.id}
            question={q}
            value={answers[q.id]}
            error={fieldErrors[q.id]}
            onChange={handleChange}
          />
        ))}
      </div>

      <div className='flex flex-col items-start gap-2'>
        {submitState.kind === 'error' && <p className='text-sm text-fill-default'>{submitState.message}</p>}
        <Button data-testid='public-form-submit' onClick={handleSubmit} disabled={submitState.kind === 'submitting'}>
          {submitState.kind === 'submitting' ? 'Submitting…' : schema.submit_label}
        </Button>
      </div>

      <p className='pt-6 text-xs text-text-caption'>
        Never submit sensitive personal information, like passwords, through AppFlowy Forms.
      </p>
    </div>
  );
}

async function uploadPendingFileAnswers(
  token: string,
  answers: Record<string, FormAnswerValue>
): Promise<Record<string, FormAnswerValue>> {
  const out: Record<string, FormAnswerValue> = {};

  for (const [questionId, answer] of Object.entries(answers)) {
    if (answer.kind !== 'files') {
      out[questionId] = answer;
      continue;
    }

    // Files within a question are independent — parallelize. `Promise.all`
    // preserves input order, so the form-owner-facing list reads the same
    // as the picker order regardless of upload settle order. Cross-question
    // ordering stays sequential to keep daily-quota errors attached to the
    // earliest question that triggered them.
    const uploadedFiles = await Promise.all(
      answer.files.map((attachment) => uploadPendingFile(token, attachment))
    );

    out[questionId] = { kind: 'files', files: uploadedFiles };
  }

  return out;
}

async function uploadPendingFile(token: string, attachment: FormFileAttachment): Promise<FormFileAttachment> {
  if (attachment.file_id) {
    return submittedFileAttachment(attachment);
  }

  if (!attachment.file) {
    throw new Error(`Attachment "${attachment.name}" is missing local file data`);
  }

  const mint = await requestPublicFormUploadUrl(token, {
    file_name: attachment.name,
    content_length: attachment.file.size,
    content_type: attachment.file.type || undefined,
  });

  await uploadFormFileToPresignedUrl(mint.upload_url, attachment.file);

  return {
    file_id: mint.file_id,
    name: attachment.name,
    size: attachment.file.size,
  };
}

function submittedFileAttachment(attachment: FormFileAttachment): FormFileAttachment {
  if (!attachment.file_id) {
    throw new Error(`Attachment "${attachment.name}" was not uploaded`);
  }

  return {
    file_id: attachment.file_id,
    name: attachment.name,
    size: attachment.size,
  };
}

function seedAnswers(questions: PublicQuestion[]): Record<string, FormAnswerValue> {
  const out: Record<string, FormAnswerValue> = {};

  for (const q of questions) {
    out[q.id] = defaultAnswer(q);
  }

  return out;
}

function defaultAnswer(q: PublicQuestion): FormAnswerValue {
  switch (q.kind) {
    case 'number':
      return { kind: 'number', value: null };
    case 'checkbox':
      return { kind: 'checkbox', value: false };
    case 'single_select':
      return { kind: 'single_select', option_id: null };
    case 'multi_select':
      return { kind: 'multi_select', option_ids: [] };
    case 'date':
      return { kind: 'date', iso: null };
    case 'files':
      return { kind: 'files', files: [] };
    case 'person':
    case 'relation':
      // Still-unsupported respondent kinds — render disabled inputs; the
      // seeded value is a typed text-empty so the answer map always has a
      // value for every question id (simpler than `undefined`).
      return { kind: 'text', value: '' };
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    default:
      return { kind: 'text', value: '' };
  }
}

function collectLocalErrors(
  questions: PublicQuestion[],
  answers: Record<string, FormAnswerValue>
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const q of questions) {
    if (!q.required) continue;
    const v = answers[q.id];

    if (isEmpty(v)) {
      out[q.id] = 'Required';
    }
  }

  return out;
}

function isEmpty(v: FormAnswerValue | undefined): boolean {
  if (!v) return true;
  switch (v.kind) {
    case 'text':
      return v.value.trim().length === 0;
    case 'number':
      return v.value === null || Number.isNaN(v.value);
    case 'checkbox':
      // A checkbox is allowed to be unchecked — `required` on a checkbox
      // typically means the consent-box pattern, where unchecked counts as
      // missing. Notion treats unchecked as missing for required boxes.
      return v.value === false;
    case 'single_select':
      return v.option_id === null;
    case 'multi_select':
      return v.option_ids.length === 0;
    case 'date':
      return v.iso === null;
    case 'files':
      return v.files.length === 0;
  }
}

function ConfirmationScreen({
  title,
  body,
  allowAnother,
  onSubmitAnother,
  redirectUrl,
}: {
  title: string;
  body?: string;
  allowAnother: boolean;
  onSubmitAnother: () => void;
  redirectUrl?: string;
}) {
  return (
    <div
      data-testid='public-form-confirmation'
      className='mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center'
    >
      <h2 className='text-2xl font-semibold'>{title}</h2>
      {body && <p className='text-text-caption'>{body}</p>}
      <div className='flex gap-2'>
        {allowAnother && (
          <Button variant='outline' onClick={onSubmitAnother}>
            Submit another response
          </Button>
        )}
        {redirectUrl && (
          <Button
            onClick={() => {
              window.location.href = redirectUrl;
            }}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
