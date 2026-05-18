import { memo } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';

import { FormQuestionPlaceholder } from './FormQuestionPlaceholder';

/**
 * Read-only question card for the M1 web form-builder (no-editor mode
 * — e.g. opened by a respondent with view-only access to the database).
 * The editable variant (`FormQuestionCard`) handles the same visual
 * layout plus the 3-dot menu.
 */
export const FormQuestionCardReadOnly = memo(_FormQuestionCardReadOnly);

function _FormQuestionCardReadOnly({
  name,
  fieldType,
  required,
  description,
  longAnswer,
}: {
  name: string;
  fieldType: string | number;
  required: boolean;
  description: string;
  longAnswer: boolean;
}) {
  const ty = (typeof fieldType === 'number' ? fieldType : Number(fieldType)) as FieldType;

  return (
    <div className='rounded-md border border-line-divider px-5 py-4'>
      <div className='flex items-center gap-1.5'>
        <FieldTypeIcon
          type={ty}
          className='h-4 w-4 shrink-0 text-text-tertiary'
        />
        <h2 className='text-base font-semibold'>{name}</h2>
        {required && (
          <span className='ml-0.5 text-fill-default' aria-label='required'>
            *
          </span>
        )}
      </div>
      {description && (
        <p className='mt-1 text-sm italic text-text-caption'>{description}</p>
      )}
      <div className='mt-3'>
        <FormQuestionPlaceholder fieldType={fieldType} longAnswer={longAnswer} />
      </div>
    </div>
  );
}
