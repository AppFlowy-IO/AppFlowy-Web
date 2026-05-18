import { memo } from 'react';

import { FormAnswerValue, PublicQuestion } from '@/application/types/form';
import { cn } from '@/lib/utils';

import { FormCheckboxInput } from './inputs/FormCheckboxInput';
import { FormDateInput } from './inputs/FormDateInput';
import { FormMediaInput } from './inputs/FormMediaInput';
import { FormNumberInput } from './inputs/FormNumberInput';
import { FormSelectInput } from './inputs/FormSelectInput';
import { FormTextInput } from './inputs/FormTextInput';
import { FormUnsupportedInput } from './inputs/FormUnsupportedInput';

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
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-base font-semibold'>
          {question.label}
          {question.required && (
            <span className='ml-0.5 text-fill-default' aria-label='required'>
              *
            </span>
          )}
        </h2>
        {question.description && (
          <p className='text-sm text-text-caption'>{question.description}</p>
        )}
      </div>
      <div className={cn(error && 'rounded-md ring-1 ring-fill-default/40')}>
        <QuestionInput
          question={question}
          value={value}
          onChange={(v) => onChange(question.id, v)}
        />
      </div>
      {error && <p className='text-xs text-fill-default'>{error}</p>}
    </div>
  );
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
          onChange={(option_id) =>
            onChange({ kind: 'single_select', option_id })
          }
        />
      );
    case 'multi_select':
      return (
        <FormSelectInput
          question={question}
          mode='multi'
          value={value?.kind === 'multi_select' ? value.option_ids : []}
          onChange={(option_ids) =>
            onChange({ kind: 'multi_select', option_ids })
          }
        />
      );
    case 'files':
      // F1 stub — upload pipeline lands in F2. Render the Notion-style
      // shell (button + size-limit caption) instead of a generic
      // "unsupported" tile so the question still looks like the desktop
      // version and the form layout doesn't shift when F2 ships.
      return <FormMediaInput />;
    case 'person':
    case 'relation':
      return <FormUnsupportedInput kind={question.kind} />;
  }
}
