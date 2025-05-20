import { useUpdateDateTimeFieldFormat } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { useFieldTypeOption } from '@/components/database/components/cell/Cell.hooks';
import DateTimeFormatGroup from '@/components/database/components/property/date/DateTimeFormatGroup';
import { Switch } from '@/components/ui/switch';
import React from 'react';
import {
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuItem, DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';

function DataTimePropertyMenuContent ({ fieldId, enableInclusivitiesTime }: {
  fieldId: string;
  enableInclusivitiesTime?: boolean;
}) {
  const { t } = useTranslation();

  const typeOption = useFieldTypeOption(fieldId);
  const includeTime = Boolean(typeOption.get(YjsDatabaseKey.include_time));

  const updateFormat = useUpdateDateTimeFieldFormat(fieldId);

  return (
    <>
      <PropertySelectTrigger fieldId={fieldId} />
      <DropdownMenuSeparator />
      <DateTimeFormatGroup fieldId={fieldId} />
      <DropdownMenuGroup
        className={'max-w-[240px] overflow-hidden'}
      >
        {enableInclusivitiesTime && (
          <DropdownMenuItem
            onSelect={e => {
              e.preventDefault();
              updateFormat({
                includeTime: !includeTime,
              });
            }}
          >
            {t('grid.field.includeTime')}
            <DropdownMenuShortcut
              className={'flex items-center'}
            >
              <Switch
                checked={includeTime}
              />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
    </>
  );
}

export default DataTimePropertyMenuContent;