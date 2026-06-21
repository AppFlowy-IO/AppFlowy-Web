import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, isAIFieldType, useFieldSelector } from '@/application/database-yjs';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { useAIEnabled } from '@/components/app/app.hooks';
import { FieldTypeIcon } from '@/components/database/components/field';
import FieldLabel from '@/components/database/components/field/FieldLabel';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const properties = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.DateTime,
  FieldType.Media,
  FieldType.URL,
  FieldType.Checkbox,
  FieldType.Checklist,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
  FieldType.Relation,
  FieldType.Rollup,
  FieldType.Summary,
  FieldType.Translate,
  FieldType.Person,
  FieldType.Time,
];

// Field types that are not yet supported on web
const unsupportedFieldTypes: FieldType[] = [];

export function PropertySelectTrigger({
  fieldId,
  disabled,
  onRequestRelation,
}: {
  fieldId: string;
  disabled?: boolean;
  onRequestRelation?: () => void;
}) {
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as unknown as FieldType;
  const { t } = useTranslation();
  const switchType = useSwitchPropertyType();
  const aiEnabled = useAIEnabled();
  const selectableProperties = useMemo(
    () => (aiEnabled ? properties : properties.filter((property) => !isAIFieldType(property))),
    [aiEnabled]
  );

  const handleSelect = (property: FieldType) => {
    if (disabled) return;
    if (!aiEnabled && isAIFieldType(property)) return;
    switchType(fieldId, property);
  };

  const propertyTooltip: {
    [key in FieldType]: string;
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
      [FieldType.Rollup]: t('tooltip.rollupField', { defaultValue: 'Rollup' }),
      [FieldType.Summary]: t('tooltip.AISummaryField'),
      [FieldType.Translate]: t('tooltip.AITranslateField'),
      [FieldType.Media]: t('tooltip.mediaField'),
      [FieldType.Person]: t('tooltip.personField'),
      [FieldType.Time]: t('tooltip.timeField'), // Added FieldType.Time tooltip
    };
  }, [t]);

  const [open, setOpen] = useState(false);

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub open={open} onOpenChange={setOpen}>
        <DropdownMenuSubTrigger data-testid="property-type-trigger" disabled={disabled}>
          <FieldTypeIcon type={type} />
          <FieldLabel type={type} />
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="appflowy-scroller max-h-[450px] overflow-y-auto">
            {selectableProperties.map((property) => {
              const isUnsupported = unsupportedFieldTypes.includes(property);

              return (
                <Tooltip key={property}>
                  <TooltipTrigger asChild>
                    {isUnsupported ? (
                      <div>
                        <DropdownMenuItem disabled>
                          <FieldTypeIcon type={property} />
                          <FieldLabel type={property} />
                        </DropdownMenuItem>
                      </div>
                    ) : (
                      <DropdownMenuItem
                        data-testid={`property-type-option-${property}`}
                        onSelect={(e) => {
                          if (property === FieldType.Relation) {
                            e.preventDefault();
                            setOpen(false);
                            onRequestRelation?.();
                            return;
                          }

                          handleSelect(property);
                          if ([FieldType.Translate].includes(property)) {
                            e.preventDefault();
                            setOpen(false);
                          }
                        }}
                      >
                        <FieldTypeIcon type={property} />
                        <FieldLabel type={property} />
                      </DropdownMenuItem>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side={'left'} className='whitespace-pre-wrap break-words'>
                    {isUnsupported ? t('common.desktopOnly') : propertyTooltip[property]}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

export default PropertySelectTrigger;
