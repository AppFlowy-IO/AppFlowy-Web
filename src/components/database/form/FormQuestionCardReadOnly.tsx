import { memo } from 'react';

import type { YDatabaseField } from '@/application/types';
import { FormSelectOptionsEditor } from './FormSelectOptionsEditor';
import { FieldType } from '@/application/database-yjs/database.type';

import { FormQuestionTitle } from './FormQuestionTitle';
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
  selectField,
}: {
  name: string;
  fieldType: FieldType;
  required: boolean;
  description: string;
  longAnswer: boolean;
  selectField?: YDatabaseField;
}) {
  return (
    <div className='rounded-xl border border-border-primary px-4 py-3'>
      <FormQuestionTitle name={name} fieldType={fieldType} required={required} reserveMenu />
      {description && <p className='mt-1 text-sm italic text-text-caption'>{description}</p>}
      <div className='mt-4'>
        {selectField ? (
          <FormSelectOptionsEditor fieldId='' field={selectField} addOption={ignoreOption} readOnly />
        ) : (
          <FormQuestionPlaceholder fieldType={fieldType} longAnswer={longAnswer} />
        )}
      </div>
    </div>
  );
}

const ignoreOption = () => undefined;
