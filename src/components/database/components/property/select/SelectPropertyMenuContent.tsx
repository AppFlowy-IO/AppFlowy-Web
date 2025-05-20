import { useSelectFieldOptions } from '@/application/database-yjs';
import { useAddSelectOption } from '@/application/database-yjs/dispatch';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import AddAnOption from '@/components/database/components/property/select/AddAnOption';
import Options from '@/components/database/components/property/select/Options';
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import React from 'react';
import { useTranslation } from 'react-i18next';

function SelectPropertyMenuContent ({ fieldId }: {
  fieldId: string
}) {
  const { t } = useTranslation();

  const onAdd = useAddSelectOption(fieldId);

  const options = useSelectFieldOptions(fieldId);

  return (
    <>
      <PropertySelectTrigger fieldId={fieldId} />
      <DropdownMenuSeparator />
      <DropdownMenuGroup
        className={'max-w-[240px] py-0.5 overflow-hidden'}
      >
        <DropdownMenuLabel>{t('grid.field.optionTitle')}</DropdownMenuLabel>
        <AddAnOption onAdd={onAdd} />
      </DropdownMenuGroup>
      <DropdownMenuGroup>
        <Options
          fieldId={fieldId}
          options={options}
        />
      </DropdownMenuGroup>

    </>
  );
}

export default SelectPropertyMenuContent;