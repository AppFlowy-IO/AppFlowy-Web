import { useTranslation } from 'react-i18next';

import { useSelectFieldOptions } from '@/application/database-yjs';
import { useAddSelectOption } from '@/application/database-yjs/dispatch';
import AddAnOption from '@/components/database/components/property/select/AddAnOption';
import Options from '@/components/database/components/property/select/Options';
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

function SelectPropertyMenuContent({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();

  const onAdd = useAddSelectOption(fieldId);

  const options = useSelectFieldOptions(fieldId);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup className={'max-w-[240px] overflow-hidden py-0.5'}>
        <DropdownMenuLabel>{t('grid.field.optionTitle')}</DropdownMenuLabel>
        <AddAnOption options={options} onAdd={onAdd} />
      </DropdownMenuGroup>
      <DropdownMenuGroup>
        <Options fieldId={fieldId} options={options} />
      </DropdownMenuGroup>
    </>
  );
}

export default SelectPropertyMenuContent;
