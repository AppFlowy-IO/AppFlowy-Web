import { resolveFormDisplayTitle } from '@/application/types/form';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';

import { useFormMetadataDraft } from './useFormMetadataDraft';

/** Respondent-facing title stored in this Form view's collab metadata. */
export function FormRespondentTitle({
  title,
  readOnly,
  onChange,
}: {
  title: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const { draft, handleFocus, handleValueChange, handleBlur } = useFormMetadataDraft({
    value: title,
    readOnly,
    onChange,
  });

  if (readOnly) {
    return (
      <h2 className='min-h-9 whitespace-pre-wrap break-words text-2xl font-bold leading-9'>
        {resolveFormDisplayTitle(title)}
      </h2>
    );
  }

  return (
    <TextareaAutosize
      aria-label='Form title'
      variant='ghost'
      value={draft}
      onFocus={handleFocus}
      onChange={(event) => handleValueChange(event.target.value)}
      onBlur={handleBlur}
      placeholder='Form title'
      minRows={1}
      className='w-full !px-0 !py-0 !text-2xl !font-bold !leading-9'
    />
  );
}
