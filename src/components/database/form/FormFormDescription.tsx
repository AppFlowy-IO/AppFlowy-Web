import { TextareaAutosize } from '@/components/ui/textarea-autosize';

import { useFormMetadataDraft } from './useFormMetadataDraft';

/**
 * Inline form-level description editor — the "Description
 * (optional)" line under the form title. Auto-sizing textarea so a
 * long blurb wraps naturally.
 *
 * Owns a local draft so each keystroke doesn't trigger a Y.js write;
 * instead we debounce-flush on blur OR after 500ms of idle typing.
 * Mirrors the desktop's `FormQuestionOverridesService` debounce
 * window.
 */
export function FormFormDescription({
  description,
  readOnly,
  onChange,
}: {
  description: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const { draft, handleFocus, handleValueChange, handleBlur } = useFormMetadataDraft({
    value: description,
    readOnly,
    onChange,
  });

  if (readOnly) {
    if (!description) return null;
    return <p className='whitespace-pre-wrap break-words text-sm text-text-primary'>{description}</p>;
  }

  return (
    <TextareaAutosize
      value={draft}
      onFocus={handleFocus}
      onChange={(event) => handleValueChange(event.target.value)}
      onBlur={handleBlur}
      placeholder='Description (Optional)'
      variant='ghost'
      className='w-full !px-0 !py-0 text-sm text-text-primary placeholder:text-text-tertiary'
      minRows={1}
    />
  );
}
