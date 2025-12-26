import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

import { useRollupData } from './useRollupData';
import { getAvailableRollupCalculations } from './utils';

function getCalculationLabel(t: (key: string, options?: { defaultValue: string }) => string, type: CalculationType) {
  switch (type) {
    case CalculationType.Average:
      return t('grid.calculationTypeLabel.average', { defaultValue: 'Average' });
    case CalculationType.Max:
      return t('grid.calculationTypeLabel.max', { defaultValue: 'Max' });
    case CalculationType.Median:
      return t('grid.calculationTypeLabel.median', { defaultValue: 'Median' });
    case CalculationType.Min:
      return t('grid.calculationTypeLabel.min', { defaultValue: 'Min' });
    case CalculationType.Sum:
      return t('grid.calculationTypeLabel.sum', { defaultValue: 'Sum' });
    case CalculationType.Count:
      return t('grid.calculationTypeLabel.count', { defaultValue: 'Count' });
    case CalculationType.CountEmpty:
      return t('grid.calculationTypeLabel.countEmpty', { defaultValue: 'Count empty' });
    case CalculationType.CountNonEmpty:
      return t('grid.calculationTypeLabel.countNonEmpty', { defaultValue: 'Count non-empty' });
    case CalculationType.DateEarliest:
      return t('grid.calculationTypeLabel.dateEarliest', { defaultValue: 'Earliest date' });
    case CalculationType.DateLatest:
      return t('grid.calculationTypeLabel.dateLatest', { defaultValue: 'Latest date' });
    case CalculationType.DateRange:
      return t('grid.calculationTypeLabel.dateRange', { defaultValue: 'Date range' });
    case CalculationType.NumberRange:
      return t('grid.calculationTypeLabel.numberRange', { defaultValue: 'Number range' });
    case CalculationType.NumberMode:
      return t('grid.calculationTypeLabel.numberMode', { defaultValue: 'Number mode' });
    case CalculationType.CountChecked:
      return t('grid.calculationTypeLabel.countChecked', { defaultValue: 'Count checked' });
    case CalculationType.CountUnchecked:
      return t('grid.calculationTypeLabel.countUnchecked', { defaultValue: 'Count unchecked' });
    case CalculationType.PercentChecked:
      return t('grid.calculationTypeLabel.percentChecked', { defaultValue: 'Percent checked' });
    case CalculationType.PercentUnchecked:
      return t('grid.calculationTypeLabel.percentUnchecked', { defaultValue: 'Percent unchecked' });
    case CalculationType.PercentEmpty:
      return t('grid.calculationTypeLabel.percentEmpty', { defaultValue: 'Percent empty' });
    case CalculationType.PercentNotEmpty:
      return t('grid.calculationTypeLabel.percentNotEmpty', { defaultValue: 'Percent not empty' });
    case CalculationType.CountUnique:
      return t('grid.calculationTypeLabel.countUnique', { defaultValue: 'Count unique' });
    case CalculationType.CountValue:
      return t('grid.calculationTypeLabel.countValue', { defaultValue: 'Count value' });
    default:
      return t('grid.calculationTypeLabel.count', { defaultValue: 'Count' });
  }
}

function getDisplayModeLabel(t: (key: string, options?: { defaultValue: string }) => string, mode: RollupDisplayMode) {
  switch (mode) {
    case RollupDisplayMode.OriginalList:
      return t('grid.rollup.displayModeOriginal', { defaultValue: 'Original list' });
    case RollupDisplayMode.UniqueList:
      return t('grid.rollup.displayModeUnique', { defaultValue: 'Unique list' });
    default:
      return t('grid.rollup.displayModeCalculated', { defaultValue: 'Calculated' });
  }
}

function RollupPropertyMenuContent({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const {
    rollupOption,
    relationFields,
    relatedFields,
    targetField,
    selectOptions,
    loadingRelated,
    updateRollupTypeOption,
  } = useRollupData(fieldId);

  const calculationType = rollupOption.calculation_type as CalculationType;
  const showAs = rollupOption.show_as as RollupDisplayMode;

  const availableCalculations = useMemo(
    () => getAvailableRollupCalculations(targetField?.type),
    [targetField?.type]
  );

  const selectedRelationLabel =
    relationFields.find((item) => item.id === rollupOption.relation_field_id)?.name ||
    t('grid.rollup.selectRelationField', { defaultValue: 'Select relation field' });
  const selectedPropertyLabel =
    targetField?.name ||
    (rollupOption.relation_field_id
      ? t('grid.rollup.selectProperty', { defaultValue: 'Select property' })
      : t('grid.rollup.selectRelationFirst', { defaultValue: 'Select relation first' }));

  const calculationLabel = getCalculationLabel(t, calculationType);
  const displayModeLabel = getDisplayModeLabel(t, showAs);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.rollup.relation', { defaultValue: 'Relation' })}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {loadingRelated ? <Progress variant={'primary'} /> : selectedRelationLabel}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] max-w-[240px] overflow-y-auto'}>
              {relationFields.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t('grid.rollup.noRelationFields', { defaultValue: 'No relation fields' })}
                </DropdownMenuItem>
              ) : (
                relationFields.map((relation) => (
                  <DropdownMenuItem
                    key={relation.id}
                    onSelect={() => {
                      updateRollupTypeOption({
                        relation_field_id: relation.id,
                        target_field_id: '',
                        condition_value: '',
                      });
                    }}
                  >
                    {relation.name}
                    {relation.id === rollupOption.relation_field_id && <DropdownMenuItemTick />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.rollup.property', { defaultValue: 'Property' })}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{selectedPropertyLabel}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] max-w-[240px] overflow-y-auto'}>
              {relatedFields.length === 0 ? (
                <DropdownMenuItem disabled>
                  {rollupOption.relation_field_id
                    ? t('grid.rollup.noRelatedFields', { defaultValue: 'No related fields' })
                    : t('grid.rollup.selectRelationFirst', { defaultValue: 'Select relation first' })}
                </DropdownMenuItem>
              ) : (
                relatedFields.map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    onSelect={() => {
                      updateRollupTypeOption({
                        target_field_id: field.id,
                        condition_value: '',
                      });
                    }}
                  >
                    {field.name}
                    {field.id === rollupOption.target_field_id && <DropdownMenuItemTick />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.rollup.calculation', { defaultValue: 'Calculation' })}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{calculationLabel}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] max-w-[240px] overflow-y-auto'}>
              {availableCalculations.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onSelect={() => {
                    updateRollupTypeOption({
                      calculation_type: type,
                      condition_value: type === CalculationType.CountValue ? rollupOption.condition_value : '',
                    });
                  }}
                >
                  {getCalculationLabel(t, type)}
                  {type === calculationType && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.rollup.showAs', { defaultValue: 'Show as' })}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{displayModeLabel}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] max-w-[240px] overflow-y-auto'}>
              {[RollupDisplayMode.Calculated, RollupDisplayMode.OriginalList, RollupDisplayMode.UniqueList].map(
                (mode) => (
                  <DropdownMenuItem
                    key={mode}
                    onSelect={() => {
                      updateRollupTypeOption({ show_as: mode });
                    }}
                  >
                    {getDisplayModeLabel(t, mode)}
                    {mode === showAs && <DropdownMenuItemTick />}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      {calculationType === CalculationType.CountValue &&
        [FieldType.SingleSelect, FieldType.MultiSelect].includes(targetField?.type as FieldType) && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('grid.rollup.value', { defaultValue: 'Value' })}</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {selectOptions.find((option) => option.id === rollupOption.condition_value)?.name ||
                  t('grid.rollup.selectOption', { defaultValue: 'Select option' })}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] max-w-[240px] overflow-y-auto'}>
                  {selectOptions.length === 0 ? (
                    <DropdownMenuItem disabled>
                      {t('grid.rollup.noOptions', { defaultValue: 'No options' })}
                    </DropdownMenuItem>
                  ) : (
                    selectOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.id}
                        onSelect={() => {
                          updateRollupTypeOption({ condition_value: option.id });
                        }}
                      >
                        {option.name}
                        {option.id === rollupOption.condition_value && <DropdownMenuItemTick />}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        )}
    </>
  );
}

export default RollupPropertyMenuContent;
