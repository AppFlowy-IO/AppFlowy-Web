import { useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';

import { submitPublicForm } from '@/application/services/js-services/http';
import {
  FormAnswerValue,
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
}: {
  token: string;
  schema: PublicFormSchema;
}) {
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>(
    () => seedAnswers(schema.questions),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'submitted' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // `useState` lazy init (not `useMemo`) — React explicitly does not
  // guarantee memo retention, so an empty-deps memo can rerun under
  // strict mode or future React releases. State init is retained for
  // the lifetime of the component, which is the actual guarantee we
  // need for submit idempotency.
  const [idempotencyKey] = useState(() => uuid());

  const handleChange = useCallback(
    (questionId: string, value: FormAnswerValue) => {
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
    },
    [],
  );

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

    setSubmitState({ kind: 'submitting' });
    const payload: FormSubmissionPayload = { answers };

    try {
      const res: FormSubmitResponse = await submitPublicForm(
        token,
        payload,
        idempotencyKey,
      );

      if (res.kind === 'invalid') {
        setFieldErrors(res.field_errors);
        setSubmitState({ kind: 'idle' });
        return;
      }

      setSubmitState({ kind: 'submitted' });
    } catch (err) {
      const message =
        (err as { message?: string })?.message ?? 'Submission failed';

      setSubmitState({ kind: 'error', message });
    }
  }, [answers, idempotencyKey, schema.questions, token]);

  const handleSubmitAnother = useCallback(() => {
    setAnswers(seedAnswers(schema.questions));
    setFieldErrors({});
    setSubmitState({ kind: 'idle' });
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
    <div
      data-testid='public-form-body'
      className='mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10'
    >
      <header className='flex flex-col gap-2'>
        {schema.icon && (
          <div className='text-3xl' aria-hidden>
            {schema.icon}
          </div>
        )}
        <h1 className='text-3xl font-bold'>{schema.title}</h1>
        {schema.description && (
          <p className='text-text-caption'>{schema.description}</p>
        )}
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
        {submitState.kind === 'error' && (
          <p className='text-sm text-fill-default'>{submitState.message}</p>
        )}
        <Button
          data-testid='public-form-submit'
          onClick={handleSubmit}
          disabled={submitState.kind === 'submitting'}
        >
          {submitState.kind === 'submitting' ? 'Submitting…' : schema.submit_label}
        </Button>
      </div>

      {/*
        Safety footer — disclaimer + abuse-report link, mirrored on the
        desktop preview (`form_preview_page.dart::_SafetyFooter`). Always
        rendered, regardless of `hide_branding`, since `hide_branding`
        toggles the "Built with AppFlowy" pill, not the abuse policy.
      */}
      <SafetyFooter />

      {!schema.hide_branding && (
        <p className='pt-2 text-center text-xs text-text-caption'>
          Built with AppFlowy
        </p>
      )}
    </div>
  );
}

function SafetyFooter() {
  return (
    <div className='flex flex-col items-start gap-1 pt-6 text-xs text-text-caption'>
      <p>
        Never submit sensitive personal information, like passwords, through
        AppFlowy Forms.
      </p>
      <a
        href='https://appflowy.com/report-abuse'
        target='_blank'
        rel='noopener noreferrer'
        className='underline hover:text-text-primary'
      >
        Report abuse
      </a>
    </div>
  );
}

function seedAnswers(
  questions: PublicQuestion[],
): Record<string, FormAnswerValue> {
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
    case 'person':
    case 'relation':
      // Phase-2 types render disabled inputs; the seeded value is a
      // typed text-empty so the answer map always has a value for every
      // question id (simpler than `undefined`).
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
  answers: Record<string, FormAnswerValue>,
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
