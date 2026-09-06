import { resolveFormDisplayTitle } from '@/application/types/form';
import { Input } from '@/components/ui/input';

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
    return <h2 className='min-h-9 text-3xl font-bold'>{resolveFormDisplayTitle(title)}</h2>;
  }

  return (
    <Input
      aria-label='Form title'
      variant='ghost'
      value={draft}
      onFocus={handleFocus}
      onChange={(event) => handleValueChange(event.target.value)}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder='Form title'
      className='!h-auto !px-0 !text-3xl !font-bold'
    />
  );
}
