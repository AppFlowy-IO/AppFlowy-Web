import { PublicQuestion } from '@/application/types/form';
import { Input } from '@/components/ui/input';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';

/**
 * Renders text-like questions (text/url/email/phone). `long_answer`
 * promotes the input to an auto-sizing textarea — Notion-parity for
 * the "Long answer" toggle.
 *
 * Type-specific input modes are set so mobile keyboards switch
 * accordingly (`url`, `email`, `tel`). Validation is left to the server
 * — we don't want to reject locally and miss a typo the cloud would
 * have allowed.
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

  // Plain-text questions render as a multi-line textarea so respondents
  // get room to write; the `long_answer` flag now only influences the
  // initial row count. Typed fields (url/email/phone) stay single-line
  // because their values are inherently short and the typed `<input>` lets
  // mobile keyboards switch layouts.
  if (question.kind === 'text') {
    return (
      <TextareaAutosize
        className='w-full py-2'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        minRows={question.long_answer ? 5 : 3}
      />
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
