import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import {
  requestPublicFormUploadUrl,
  submitPublicForm,
  uploadFormFileToPresignedUrl,
} from '@/application/services/js-services/http/form-api';
import {
  FormAnswerValue,
  FormFileAttachment,
  FormSubmissionPayload,
  FormSubmitResponse,
  PUBLIC_FORM_MAX_ANSWER_STRING_AND_KEY_BYTES,
  PUBLIC_FORM_MAX_BYTES_PER_FILE,
  PUBLIC_FORM_MAX_EMAIL_ANSWER_BYTES,
  PUBLIC_FORM_MAX_FILES_PER_QUESTION,
  PUBLIC_FORM_MAX_FILES_PER_SUBMISSION,
  PUBLIC_FORM_MAX_PHONE_ANSWER_BYTES,
  PUBLIC_FORM_MAX_TEXT_ANSWER_BYTES,
  PUBLIC_FORM_MAX_URL_ANSWER_BYTES,
  PUBLIC_FORM_SUBMIT_MAX_BODY_BYTES,
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
 * Idempotency: a key is bound to the exact uploaded payload sent to the
 * cloud. An ambiguous network retry of that payload reuses the key, while
 * an edited response receives a fresh key so a replay cannot silently drop
 * the new answers.
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
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'submitted' }
    | { kind: 'error'; message: string; loginUrl?: string }
  >({ kind: 'idle' });
  const [retryBlocked, setRetryBlocked] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Native controls inside the fieldset are disabled while a submission is
  // in flight, but popover content (for example the date picker calendar) is
  // rendered in a portal outside that fieldset. Keep a synchronous guard as
  // the source of truth so those controls cannot mutate the captured answer
  // set before uploads finish. A ref also closes the same-tick window before
  // React commits the disabled state and prevents duplicate submissions.
  const submittingRef = useRef(false);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    []
  );

  // The server deduplicates solely by `(token, idempotency_key)`. Keep the
  // key in a ref together with the exact uploaded payload it represents:
  // retries after an ambiguous response reuse it, but edits cannot replay a
  // success for different answers. This state does not affect rendering.
  const idempotencyAttemptRef = useRef<{ key: string; payloadFingerprint: string } | null>(null);

  const handleChange = useCallback((questionId: string, value: FormAnswerValue) => {
    if (submittingRef.current) return;

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
    if (submittingRef.current || retryBlocked) return;

    // Client-side required check — runs before the network round-trip so
    // the user sees "Required" instantly. The server re-validates and is
    // the authority; we treat its `field_errors` as the source of truth
    // when it disagrees.
    const localErrors = collectLocalErrors(schema.questions, answers);

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    // Check the aggregate JSON ceiling before minting any upload
    // capabilities. The API repeats this check on the final, uploaded shape,
    // but waiting until then would leave needless pending objects behind.
    if (new Blob([JSON.stringify({ answers })]).size > PUBLIC_FORM_SUBMIT_MAX_BODY_BYTES) {
      setSubmitState({
        kind: 'error',
        message: 'This response is too large. Shorten one or more answers and try again.',
      });
      return;
    }

    if (formAnswerStringAndKeyBytes(answers) > PUBLIC_FORM_MAX_ANSWER_STRING_AND_KEY_BYTES) {
      setSubmitState({
        kind: 'error',
        message: 'This response contains too much text. Shorten one or more answers and try again.',
      });
      return;
    }

    // Preview short-circuit: validation passed, jump straight to the
    // confirmation screen. The token in preview mode is the sentinel
    // string `'preview'` which has no cloud row and would 404 on the
    // submit endpoint — see the prop docstring for the bug report
    // this guards against.
    if (previewMode) {
      submittingRef.current = true;
      setSubmitState({ kind: 'submitted' });
      return;
    }

    submittingRef.current = true;
    setSubmitState({ kind: 'submitting' });

    try {
      const uploadResult = await uploadPendingFileAnswers(token, answers);
      const uploadedAnswers = uploadResult.answers;

      // Cache every successful upload before handling a sibling failure. A
      // retry then skips files whose object-storage PUT already completed,
      // instead of minting duplicate file IDs and uploading the same bytes
      // again. The bounded runner waits for every in-flight upload to settle,
      // so a quick retry cannot race an upload left behind by this attempt.
      setAnswers(uploadedAnswers);

      if (!uploadResult.ok) {
        throw uploadResult.error;
      }

      const payload: FormSubmissionPayload = { answers: uploadedAnswers };
      const payloadFingerprint = JSON.stringify(payload);
      const previousAttempt = idempotencyAttemptRef.current;
      const idempotencyKey =
        previousAttempt?.payloadFingerprint === payloadFingerprint ? previousAttempt.key : uuid();

      idempotencyAttemptRef.current = { key: idempotencyKey, payloadFingerprint };
      const res: FormSubmitResponse = await submitPublicForm(token, payload, idempotencyKey);

      if (res.kind === 'invalid') {
        submittingRef.current = false;
        setFieldErrors(res.field_errors);
        setSubmitState({ kind: 'idle' });
        return;
      }

      if (res.status === 'failed') {
        // This idempotency key now points at a terminal failed reservation;
        // retrying it can only replay the same status. Require a fresh page
        // attempt instead of presenting a false confirmation or spinning.
        submittingRef.current = false;
        setRetryBlocked(true);
        setSubmitState({
          kind: 'error',
          message: 'This response could not be processed. Reload the form to start a new response.',
        });
        return;
      }

      setSubmitState({ kind: 'submitted' });
    } catch (err) {
      const publicError = err as { message?: string; retryAfterSecs?: number; loginUrl?: string };
      const retryAfterSecs = publicError.retryAfterSecs;
      const hasRetryDelay = typeof retryAfterSecs === 'number' && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0;
      const message = `${publicError.message ?? 'Submission failed'}${
        hasRetryDelay ? ` Try again in ${Math.ceil(retryAfterSecs)} seconds.` : ''
      }`;

      if (hasRetryDelay) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        setRetryBlocked(true);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryBlocked(false);
        }, Math.min(retryAfterSecs, 86_400) * 1000);
      }

      submittingRef.current = false;
      setSubmitState({ kind: 'error', message, loginUrl: publicError.loginUrl });
    }
  }, [answers, previewMode, retryBlocked, schema.questions, token]);

  const handleSubmitAnother = useCallback(() => {
    submittingRef.current = false;
    setAnswers(seedAnswers(schema.questions));
    setFieldErrors({});
    setSubmitState({ kind: 'idle' });
    setRetryBlocked(false);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    idempotencyAttemptRef.current = null;
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

      <fieldset
        data-testid='public-form-questions'
        disabled={submitState.kind === 'submitting'}
        aria-busy={submitState.kind === 'submitting'}
        className='m-0 min-w-0 border-0 p-0'
      >
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
      </fieldset>

      <div className='flex flex-col items-start gap-2'>
        {submitState.kind === 'error' && <p className='text-sm text-fill-default'>{submitState.message}</p>}
        {submitState.kind === 'error' && submitState.loginUrl ? (
          <Button
            data-testid='public-form-login'
            onClick={() => {
              window.location.href = submitState.loginUrl!;
            }}
          >
            Log in
          </Button>
        ) : (
          <Button
            data-testid='public-form-submit'
            onClick={handleSubmit}
            disabled={submitState.kind === 'submitting' || retryBlocked}
          >
            {submitState.kind === 'submitting' ? 'Submitting…' : schema.submit_label}
          </Button>
        )}
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
): Promise<UploadPendingFileAnswersResult> {
  const out: Record<string, FormAnswerValue> = {};
  const tasks: Array<() => Promise<void>> = [];

  for (const [questionId, answer] of Object.entries(answers)) {
    if (answer.kind !== 'files') {
      out[questionId] = answer;
      continue;
    }

    const uploadedFiles = [...answer.files];

    out[questionId] = { kind: 'files', files: uploadedFiles };

    answer.files.forEach((attachment, index) => {
      if (attachment.file_id) {
        uploadedFiles[index] = submittedFileAttachment(attachment);
        return;
      }

      tasks.push(async () => {
        uploadedFiles[index] = await uploadPendingFile(token, attachment);
      });
    });
  }

  const results = await settleWithConcurrency(tasks, MAX_CONCURRENT_FILE_UPLOADS);
  const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

  if (firstFailure) {
    return { ok: false, answers: out, error: firstFailure.reason };
  }

  return { ok: true, answers: out };
}

const MAX_CONCURRENT_FILE_UPLOADS = 4;

type UploadPendingFileAnswersResult =
  | { ok: true; answers: Record<string, FormAnswerValue> }
  | { ok: false; answers: Record<string, FormAnswerValue>; error: unknown };

/**
 * Runs independent upload jobs with one shared cap across all questions.
 * Result slots match task order, so callers can surface the first question's
 * failure deterministically even though network work happens concurrently.
 */
async function settleWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(tasks.length);
  let nextTaskIndex = 0;

  const worker = async () => {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;

      nextTaskIndex += 1;

      try {
        await tasks[taskIndex]();
        results[taskIndex] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[taskIndex] = { status: 'rejected', reason };
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);

  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
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

  await uploadFormFileToPresignedUrl(
    mint.upload_url,
    attachment.file,
    mint.upload_content_type,
    mint.upload_if_none_match
  );

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
  let totalFiles = 0;

  for (const q of questions) {
    const v = answers[q.id];

    if (q.required && isEmpty(v)) {
      out[q.id] = 'Required';
    }

    if (v?.kind === 'text') {
      const maxBytes = maxTextAnswerBytes(q.kind);

      if (maxBytes !== undefined && new Blob([v.value]).size > maxBytes) {
        out[q.id] = `Keep this answer under ${formatAnswerLimit(maxBytes)}.`;
      }
    }

    if (q.kind !== 'files' || v?.kind !== 'files') continue;

    const maxFiles = Math.min(q.max_files ?? PUBLIC_FORM_MAX_FILES_PER_QUESTION, PUBLIC_FORM_MAX_FILES_PER_QUESTION);
    const maxBytes = Math.min(q.max_bytes_per_file ?? PUBLIC_FORM_MAX_BYTES_PER_FILE, PUBLIC_FORM_MAX_BYTES_PER_FILE);

    totalFiles += v.files.length;
    if (v.files.length > maxFiles) {
      out[q.id] = `Attach no more than ${maxFiles} files.`;
    } else if (v.files.some((file) => file.size <= 0 || file.size > maxBytes)) {
      out[q.id] = 'Remove empty or oversized files before submitting.';
    }
  }

  if (totalFiles > PUBLIC_FORM_MAX_FILES_PER_SUBMISSION) {
    for (const q of questions) {
      if (q.kind === 'files' && answers[q.id]?.kind === 'files') {
        out[q.id] = `Attach no more than ${PUBLIC_FORM_MAX_FILES_PER_SUBMISSION} files per response.`;
      }
    }
  }

  return out;
}

function maxTextAnswerBytes(kind: PublicQuestion['kind']): number | undefined {
  switch (kind) {
    case 'text':
      return PUBLIC_FORM_MAX_TEXT_ANSWER_BYTES;
    case 'url':
      return PUBLIC_FORM_MAX_URL_ANSWER_BYTES;
    case 'email':
      return PUBLIC_FORM_MAX_EMAIL_ANSWER_BYTES;
    case 'phone':
      return PUBLIC_FORM_MAX_PHONE_ANSWER_BYTES;
    default:
      return undefined;
  }
}

function formatAnswerLimit(bytes: number): string {
  return bytes >= 1024 ? `${bytes / 1024} KB` : `${bytes} bytes`;
}

function formAnswerStringAndKeyBytes(answers: Record<string, FormAnswerValue>): number {
  let total = 0;

  for (const [questionId, answer] of Object.entries(answers)) {
    total += utf8Bytes(questionId) + nestedStringAndKeyBytes(answer);
  }

  return total;
}

function nestedStringAndKeyBytes(value: unknown): number {
  if (typeof value === 'string') return utf8Bytes(value);
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + nestedStringAndKeyBytes(item), 0);
  }

  if (!value || typeof value !== 'object') return 0;

  return Object.entries(value).reduce(
    (total, [key, nested]) => total + utf8Bytes(key) + nestedStringAndKeyBytes(nested),
    0
  );
}

function utf8Bytes(value: string): number {
  return new Blob([value]).size;
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
