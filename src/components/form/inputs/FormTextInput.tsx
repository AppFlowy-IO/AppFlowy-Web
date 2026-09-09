import { lazy, Suspense } from 'react';

import { PublicQuestion } from '@/application/types/form';
import { Input } from '@/components/ui/input';

import { loadFormLongTextInput } from './form-input-loaders';

const FormLongTextInput = lazy(loadFormLongTextInput);

/**
 * Renders text-like questions (text/url/email/phone). `long_answer`
 * promotes plain text to an auto-sizing textarea — Notion-parity for
 * the "Long answer" toggle and consistent with Desktop's one-line default.
 *
 * Type-specific input modes are set so mobile keyboards switch
 * accordingly (`url`, `email`, `tel`). Submit-time validation lives in
 * FormBody so both typed and pasted values follow the cloud contract.
 */
export function FormTextInput({
  question,
  value,
  onChange,
}: {
  question: PublicQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  // "Type your answer" — matches desktop `form_preview_inputs.dart`
  // `_TextInput` and respondent-facing copy across both clients.
  const placeholder = 'Type your answer';

  if (question.kind === 'text' && question.long_answer) {
    return (
      <Suspense fallback={<div aria-hidden className='h-32 w-full animate-pulse rounded-md bg-fill-content' />}>
        <FormLongTextInput value={value} onChange={onChange} placeholder={placeholder} />
      </Suspense>
    );
  }

  return (
    <Input
      className='w-full'
      type={inputType(question.kind)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function inputType(kind: PublicQuestion['kind']): string {
  switch (kind) {
    case 'url':
      return 'url';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    default:
      return 'text';
  }
}
