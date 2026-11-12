import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { FormFieldTypeIcon } from './FormFieldTypeIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { fieldTypeLabel } from './form-field-type-label';

export function FormQuestionTitle({
  name,
  fieldType,
  required,
  reserveMenu = false,
}: {
  name: string;
  fieldType: FieldType;
  required: boolean;
  reserveMenu?: boolean;
}) {
  const { t } = useTranslation();
  const helper =
    fieldType === FieldType.SingleSelect
      ? 'Respondents can select up to 1'
      : fieldType === FieldType.MultiSelect
      ? 'Respondents can select as many as they like'
      : null;

  return (
    <div className={`flex items-center gap-3 ${reserveMenu ? 'min-h-8 pr-10' : 'min-h-[22px]'}`}>
      <FormFieldTypeIcon type={fieldType} className='h-5 w-5 shrink-0 text-text-secondary' />
      <h2 className='min-w-0 break-words text-base font-bold leading-[22px]'>
        {name || 'Question'} ({fieldTypeLabel(t, fieldType)})
        {required && (
          <span className='text-text-error' aria-label='required'>
            *
          </span>
        )}
        {helper && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label={helper} className='ml-1 inline-flex align-middle text-icon-tertiary'>
                <InfoIcon className='h-5 w-5' />
              </span>
            </TooltipTrigger>
            <TooltipContent>{helper}</TooltipContent>
          </Tooltip>
        )}
      </h2>
    </div>
  );
}
