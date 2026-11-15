import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNewFormQuestionDispatch } from '@/application/database-yjs/dispatch';
import { FORM_QUESTION_FIELD_TYPES } from '@/application/database-yjs/form-field-types';
import { FormFieldTypeIcon } from './FormFieldTypeIcon';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { fieldTypeLabel } from './form-field-type-label';

/** New questions are created atomically with their database fields. */
export function FormQuestionTypePicker() {
  const [open, setOpen] = useState(false);
  const createQuestion = useNewFormQuestionDispatch();
  const { t } = useTranslation();

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button data-testid='form-add-question-button' variant='outline' className='mx-auto h-8 gap-1.5 rounded-md px-3'>
          <PlusIcon className='h-5 w-5 text-icon-primary' />
          Add question
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='top'
        align='center'
        sideOffset={4}
        className='max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] w-[280px] overflow-y-auto'
      >
        {FORM_QUESTION_FIELD_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            data-testid={`form-question-type-option-${type}`}
            onSelect={() => createQuestion(type)}
          >
            <FormFieldTypeIcon type={type} className='h-5 w-5 shrink-0 text-text-secondary' />
            {fieldTypeLabel(t, type)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
