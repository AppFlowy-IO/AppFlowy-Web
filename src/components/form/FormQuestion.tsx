import { lazy, memo, Suspense } from 'react';

import {
  FormAnswerValue,
  PUBLIC_FORM_MAX_BYTES_PER_FILE,
  PUBLIC_FORM_MAX_FILES_PER_QUESTION,
  PublicQuestion,
} from '@/application/types/form';
import { cn } from '@/lib/utils';

import { loadFormLongTextInput } from './inputs/form-input-loaders';
import { FormCheckboxInput } from './inputs/FormCheckboxInput';
import { FormNumberInput } from './inputs/FormNumberInput';
import { FormSelectInput } from './inputs/FormSelectInput';
import { FormUnsupportedInput } from './inputs/FormUnsupportedInput';

let formTextInputModule: Promise<typeof import('./inputs/FormTextInput')> | undefined;
let formTextInputComponent: Promise<{ default: typeof import('./inputs/FormTextInput').FormTextInput }> | undefined;
let formDateInputComponent: Promise<{ default: typeof import('./inputs/FormDateInput').FormDateInput }> | undefined;
let formMediaInputComponent: Promise<{ default: typeof import('./inputs/FormMediaInput').FormMediaInput }> | undefined;

const loadFormTextInputModule = () => {
  formTextInputModule ??= import('./inputs/FormTextInput');
  return formTextInputModule;
};

const loadFormTextInput = () => {
  formTextInputComponent ??= loadFormTextInputModule().then(({ FormTextInput }) => ({ default: FormTextInput }));
  return formTextInputComponent;
};

const loadFormDateInput = () => {
  formDateInputComponent ??= import('./inputs/FormDateInput').then(({ FormDateInput }) => ({ default: FormDateInput }));
  return formDateInputComponent;
};

const loadFormMediaInput = () => {
  formMediaInputComponent ??= import('./inputs/FormMediaInput').then(({ FormMediaInput }) => ({
    default: FormMediaInput,
  }));
  return formMediaInputComponent;
};

const FormTextInput = lazy(loadFormTextInput);
const FormDateInput = lazy(loadFormDateInput);
const FormMediaInput = lazy(loadFormMediaInput);

/** Load only the controls required by a projected respondent schema. */
export async function preloadFormQuestionInputs(questions: PublicQuestion[]): Promise<void> {
  const needsText = questions.some((question) =>
    ['text', 'url', 'email', 'phone'].includes(question.kind)
  );
  const needsLongText = questions.some((question) => question.kind === 'text' && question.long_answer);
  const needsDate = questions.some((question) => question.kind === 'date');
  const needsMedia = questions.some((question) => question.kind === 'files');
  const loaders: Promise<unknown>[] = [];

  if (needsText) {
    loaders.push(loadFormTextInput());
  }

  if (needsLongText) loaders.push(loadFormLongTextInput());

  if (needsDate) loaders.push(loadFormDateInput());

  if (needsMedia) loaders.push(loadFormMediaInput());

  await Promise.all(loaders);
}

/**
 * One question card. Renders title + required asterisk + optional
 * description + the per-type answer input. Inputs are dumb — they invoke
 * `onChange(questionId, value)` and the parent owns the answer map.
 *
 * Inline error rendering: the parent passes an optional `error` (server
 * validation or client-side "Required"). When present, the error message
 * surfaces below the input.
 */
// Memoized so typing in one question doesn't re-render every other
// question card. Parent passes a stable `onChange` and primitive
// `value` / `error`, so referential equality is sufficient.
export const FormQuestion = memo(_FormQuestion);

function _FormQuestion({
  question,
  value,
  error,
  onChange,
}: {
  question: PublicQuestion;
  value: FormAnswerValue | undefined;
  error: string | undefined;
  onChange: (questionId: string, value: FormAnswerValue) => void;
}) {
  return (
    <div
      data-testid={`public-form-question-${question.id}`}
      data-question-kind={question.kind}
      className='flex flex-col gap-2'
    >
      <div className='flex flex-col gap-1'>
        <h2 className='text-base font-semibold'>
          {question.label}
          {question.required && (
            <span className='ml-0.5 text-fill-default' aria-label='required'>
              *
            </span>
          )}
        </h2>
        {question.description && <p className='text-sm text-text-caption'>{question.description}</p>}
      </div>
      <div className={cn(error && 'ring-fill-default/40 rounded-md ring-1')}>
        <Suspense fallback={<QuestionInputLoading />}>
          <QuestionInput question={question} value={value} onChange={(v) => onChange(question.id, v)} />
        </Suspense>
      </div>
      {error && <p className='text-xs text-fill-default'>{error}</p>}
    </div>
  );
}

function QuestionInputLoading() {
  return <div aria-hidden className='h-10 w-full animate-pulse rounded-md bg-fill-content' />;
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: PublicQuestion;
  value: FormAnswerValue | undefined;
  onChange: (value: FormAnswerValue) => void;
}) {
  switch (question.kind) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return (
        <FormTextInput
          question={question}
          value={value?.kind === 'text' ? value.value : ''}
          onChange={(v) => onChange({ kind: 'text', value: v })}
        />
      );
    case 'number':
      return (
        <FormNumberInput
          value={value?.kind === 'number' ? value.value : null}
          onChange={(v) => onChange({ kind: 'number', value: v })}
        />
      );
    case 'checkbox':
      return (
        <FormCheckboxInput
          value={value?.kind === 'checkbox' ? value.value : false}
          onChange={(v) => onChange({ kind: 'checkbox', value: v })}
        />
      );
    case 'date':
      return (
        <FormDateInput
          value={value?.kind === 'date' ? value.iso : null}
          onChange={(iso) => onChange({ kind: 'date', iso })}
        />
      );
    case 'single_select':
      return (
        <FormSelectInput
          question={question}
          mode='single'
          value={value?.kind === 'single_select' ? value.option_id : null}
          onChange={(option_id) => onChange({ kind: 'single_select', option_id })}
        />
      );
    case 'multi_select':
      return (
        <FormSelectInput
          question={question}
          mode='multi'
          value={value?.kind === 'multi_select' ? value.option_ids : []}
          onChange={(option_ids) => onChange({ kind: 'multi_select', option_ids })}
        />
      );
    case 'files':
      return (
        <FormMediaInput
          value={value?.kind === 'files' ? value.files : []}
          onChange={(files) => onChange({ kind: 'files', files })}
          max_files={Math.min(
            question.max_files ?? PUBLIC_FORM_MAX_FILES_PER_QUESTION,
            PUBLIC_FORM_MAX_FILES_PER_QUESTION
          )}
          max_bytes_per_file={Math.min(
            question.max_bytes_per_file ?? PUBLIC_FORM_MAX_BYTES_PER_FILE,
            PUBLIC_FORM_MAX_BYTES_PER_FILE
          )}
        />
      );
    case 'person':
    case 'relation':
      return <FormUnsupportedInput kind={question.kind} />;
  }
}
