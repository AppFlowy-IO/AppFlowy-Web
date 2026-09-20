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
import { Log } from '@/utils/log';

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
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.Relation,
  FieldType.Rollup,
  FieldType.Formula,
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
  onRequestFormula,
}: {
  fieldId: string;
  disabled?: boolean;
  onRequestRelation?: () => void;
  /** Called after a switch to Formula so the host can open the editor right away. */
  onRequestFormula?: () => void;
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

  /** Resolves to whether the field switched to `property`. */
  const handleSelect = async (property: FieldType): Promise<boolean> => {
    if (disabled) return false;
    if (!aiEnabled && isAIFieldType(property)) return false;

    try {
      await switchType(fieldId, property);
      return true;
    } catch (error) {
      Log.warn('[PropertySelectTrigger] Failed to switch field type', { fieldId, property, error });
      return false;
    }
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
      [FieldType.CreatedBy]: t('tooltip.createdByField'),
      [FieldType.LastEditedBy]: t('tooltip.lastEditedByField'),
      [FieldType.Relation]: t('tooltip.relationField'),
      [FieldType.Rollup]: t('tooltip.rollupField', { defaultValue: 'Rollup' }),
      [FieldType.Formula]: t('tooltip.formulaField', {
        defaultValue: 'Compute a value from other properties with a formula',
      }),
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

                          if (property === FieldType.Formula && onRequestFormula && type !== FieldType.Formula) {
                            e.preventDefault();
                            setOpen(false);
                            // Only open the editor on a field that actually became a formula.
                            void handleSelect(property).then((switched) => {
                              if (switched) onRequestFormula();
                            });
                            return;
                          }

                          void handleSelect(property);
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
