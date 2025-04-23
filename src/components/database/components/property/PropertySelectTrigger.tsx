import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field';
import FieldLabel from '@/components/database/components/field/FieldLabel';
import {
  DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const properties = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.DateTime,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.URL,
  FieldType.Checklist,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
  FieldType.Relation,
  FieldType.AISummaries,
  FieldType.AITranslations,
  FieldType.FileMedia,
];

export function PropertySelectTrigger ({ fieldId, disabled }: { fieldId: string; disabled?: boolean }) {
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as unknown as FieldType;
  const { t } = useTranslation();
  const propertyTooltip: {
    [key in FieldType]: string
  } = useMemo(() => {
    return {
      [FieldType.RichText]: t('tooltip.textField'),
      [FieldType.Number]: t('tooltip.numberField'),
      [FieldType.DateTime]: t('tooltip.dateField'),
      [FieldType.SingleSelect]: t('tooltip.singleSelectField'),
      [FieldType.MultiSelect]: t('tooltip.multiSelectField'),
      [FieldType.Checkbox]: t('tooltip.checkboxField'),
      [FieldType.URL]: t('tooltip.urlField'),
      [FieldType.Checklist]: t('tooltip.checklistField'),
      [FieldType.LastEditedTime]: t('tooltip.updatedAtField'),
      [FieldType.CreatedTime]: t('tooltip.createdAtField'),
      [FieldType.Relation]: t('tooltip.relationField'),
      [FieldType.AISummaries]: t('tooltip.AISummaryField'),
      [FieldType.AITranslations]: t('tooltip.AITranslateField'),
      [FieldType.FileMedia]: t('tooltip.mediaField'),
    };
  }, [t]);

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          <FieldTypeIcon type={type} />
          <FieldLabel type={type} />
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            {properties.map((property) => (
              <Tooltip key={property}>
                <TooltipTrigger asChild>
                  <DropdownMenuItem>
                    <FieldTypeIcon type={property} />
                    <FieldLabel type={property} />
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent
                  side={'left'}
                >
                  {propertyTooltip[property]}
                </TooltipContent>
              </Tooltip>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

export default PropertySelectTrigger;
