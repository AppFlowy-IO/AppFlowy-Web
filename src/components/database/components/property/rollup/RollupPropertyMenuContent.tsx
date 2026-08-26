import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { RollupShowAsType, RollupVisualizationOption } from '@/application/database-yjs/fields/rollup/rollup.type';
import { ReactComponent as FormulaIcon } from '@/assets/icons/formula.svg';
import { ReactComponent as RelationIcon } from '@/assets/icons/relation.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
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
import { Input } from '@/components/ui/input';

import { RollupVisualizationSettings } from './RollupVisualizationSettings';
import { useRollupData } from './useRollupData';
import { getAvailableRollupDisplayModes, getRollupCalculationGroups, type RollupCalculationGroupKey } from './utils';

type Translation = (key: string, options?: { defaultValue: string }) => string;
type RollupEditorVariant = 'field' | 'cell';

const defaultVisualization: RollupVisualizationOption = {
  type: RollupShowAsType.Number,
  color: 'fill-default',
  divisor: 0,
  showNumber: false,
};

export function getRollupCalculationLabel(t: Translation, type: CalculationType) {
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
      return t('grid.calculationTypeLabel.count', { defaultValue: 'Count all' });
    case CalculationType.CountEmpty:
      return t('grid.calculationTypeLabel.countEmpty', { defaultValue: 'Count empty' });
    case CalculationType.CountNonEmpty:
      return t('grid.calculationTypeLabel.countNonEmpty', { defaultValue: 'Count not empty' });
    case CalculationType.DateEarliest:
      return t('grid.calculationTypeLabel.dateEarliest', { defaultValue: 'Earliest date' });
    case CalculationType.DateLatest:
      return t('grid.calculationTypeLabel.dateLatest', { defaultValue: 'Latest date' });
    case CalculationType.DateRange:
      return t('grid.calculationTypeLabel.dateRange', { defaultValue: 'Date range' });
    case CalculationType.NumberRange:
      return t('grid.calculationTypeLabel.numberRange', { defaultValue: 'Range' });
    case CalculationType.NumberMode:
      return t('grid.calculationTypeLabel.numberMode', { defaultValue: 'Mode' });
    case CalculationType.CountChecked:
      return t('grid.calculationTypeLabel.countChecked', { defaultValue: 'Checked' });
    case CalculationType.CountUnchecked:
      return t('grid.calculationTypeLabel.countUnchecked', { defaultValue: 'Unchecked' });
    case CalculationType.PercentChecked:
      return t('grid.calculationTypeLabel.percentChecked', { defaultValue: 'Percent checked' });
    case CalculationType.PercentUnchecked:
      return t('grid.calculationTypeLabel.percentUnchecked', { defaultValue: 'Percent unchecked' });
    case CalculationType.PercentEmpty:
      return t('grid.calculationTypeLabel.percentEmpty', { defaultValue: 'Percent empty' });
    case CalculationType.PercentNotEmpty:
      return t('grid.calculationTypeLabel.percentNotEmpty', { defaultValue: 'Percent not empty' });
    case CalculationType.CountUnique:
      return t('grid.calculationTypeLabel.countUnique', { defaultValue: 'Count unique values' });
    case CalculationType.CountValue:
      return t('grid.calculationTypeLabel.countValue', { defaultValue: 'Count values' });
    default:
      return t('grid.calculationTypeLabel.count', { defaultValue: 'Count all' });
  }
}

function getDisplayModeLabel(t: Translation, mode: RollupDisplayMode) {
  switch (mode) {
    case RollupDisplayMode.OriginalList:
      return t('grid.rollup.displayModeOriginal', { defaultValue: 'Show original' });
    case RollupDisplayMode.UniqueList:
      return t('grid.rollup.displayModeUnique', { defaultValue: 'Show unique' });
    default:
      return t('grid.rollup.displayModeCalculated', { defaultValue: 'Calculated' });
  }
}

function getDisplayModeMenuLabel(t: Translation, mode: RollupDisplayMode) {
  return mode === RollupDisplayMode.UniqueList
    ? t('grid.rollup.showUnique', { defaultValue: 'Show unique values' })
    : t('grid.rollup.showOriginal', { defaultValue: 'Show original' });
}

function getCalculationGroupLabel(t: Translation, key: RollupCalculationGroupKey) {
  switch (key) {
    case 'count':
      return t('grid.rollup.count', { defaultValue: 'Count' });
    case 'percent':
      return t('grid.rollup.percent', { defaultValue: 'Percent' });
    case 'moreOptions':
      return t('grid.rollup.moreOptions', { defaultValue: 'More options' });
    case 'date':
      return t('grid.rollup.date', { defaultValue: 'Date' });
  }
}

function getCalculationTooltip(t: Translation, type: CalculationType) {
  switch (type) {
    case CalculationType.Count:
      return t('grid.rollup.countAllTooltip', {
        defaultValue: 'Counts the total number of pages, including blank pages.',
      });
    case CalculationType.CountValue:
      return t('grid.rollup.countValuesTooltip', {
        defaultValue: 'Counts the selected value across related pages.',
      });
    case CalculationType.CountUnique:
      return t('grid.rollup.countUniqueValuesTooltip', {
        defaultValue: 'Counts the unique values across related pages.',
      });
    case CalculationType.CountEmpty:
      return t('grid.rollup.countEmptyTooltip', {
        defaultValue: 'Counts pages with an empty value for this property.',
      });
    case CalculationType.CountNonEmpty:
      return t('grid.rollup.countNotEmptyTooltip', {
        defaultValue: 'Counts pages with a non-empty value for this property.',
      });
    case CalculationType.CountChecked:
      return t('grid.rollup.checkedTooltip', { defaultValue: 'Counts pages with a checked checkbox.' });
    case CalculationType.CountUnchecked:
      return t('grid.rollup.uncheckedTooltip', { defaultValue: 'Counts pages with an unchecked checkbox.' });
    case CalculationType.PercentEmpty:
      return t('grid.rollup.percentEmptyTooltip', {
        defaultValue: 'Shows the percentage of pages with an empty value.',
      });
    case CalculationType.PercentNotEmpty:
      return t('grid.rollup.percentNotEmptyTooltip', {
        defaultValue: 'Shows the percentage of pages with a non-empty value.',
      });
    case CalculationType.PercentChecked:
      return t('grid.rollup.percentCheckedTooltip', {
        defaultValue: 'Shows the percentage of pages with a checked checkbox.',
      });
    case CalculationType.PercentUnchecked:
      return t('grid.rollup.percentUncheckedTooltip', {
        defaultValue: 'Shows the percentage of pages with an unchecked checkbox.',
      });
    default:
      return undefined;
  }
}

function EditorTrigger({
  variant,
  title,
  value,
  icon,
  disabled,
  testId,
}: {
  variant: RollupEditorVariant;
  title: string;
  value: string;
  icon: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <DropdownMenuSubTrigger className={'w-full'} disabled={disabled} data-testid={testId}>
      <span className={'flex h-5 w-5 shrink-0 items-center justify-center'}>{icon}</span>
      <span className={'truncate'}>{variant === 'cell' ? value : title}</span>
      {variant === 'field' ? (
        <span className={'ml-auto max-w-[116px] truncate text-xs text-text-secondary'}>{value}</span>
      ) : null}
    </DropdownMenuSubTrigger>
  );
}

function CompactSectionLabel({ children, variant }: { children: React.ReactNode; variant: RollupEditorVariant }) {
  return variant === 'cell' ? <DropdownMenuLabel className={'px-2'}>{children}</DropdownMenuLabel> : null;
}

function RollupPropertyMenuContent({ fieldId, variant = 'field' }: { fieldId: string; variant?: RollupEditorVariant }) {
  const { t } = useTranslation();
  const [propertySearch, setPropertySearch] = useState('');
  const {
    rollupOption,
    relationFields,
    relatedFields,
    targetField,
    selectOptions,
    loadingRelated,
    selectRelationField,
    selectTargetField,
    updateRollupTypeOption,
  } = useRollupData(fieldId);

  const calculationType = rollupOption.calculation_type as CalculationType;
  const showAs = rollupOption.show_as as RollupDisplayMode;
  const visualization = rollupOption.visualization ?? defaultVisualization;
  const calculationGroups = getRollupCalculationGroups(targetField?.type);
  const displayModes = getAvailableRollupDisplayModes(targetField?.type);
  const normalizedSearch = propertySearch.trim().toLocaleLowerCase();
  const filteredRelatedFields = normalizedSearch
    ? relatedFields.filter((relatedField) => relatedField.name.toLocaleLowerCase().includes(normalizedSearch))
    : relatedFields;

  const selectedRelationLabel =
    relationFields.find((item) => item.id === rollupOption.relation_field_id)?.name ||
    t('grid.rollup.selectRelationField', { defaultValue: 'Select a relation field' });
  const selectedPropertyLabel =
    targetField?.name ||
    (rollupOption.relation_field_id
      ? t('grid.rollup.selectProperty', { defaultValue: 'Select a property' })
      : t('grid.rollup.selectRelationFirst', { defaultValue: 'Select a relation first' }));
  const calculateLabel =
    showAs === RollupDisplayMode.Calculated
      ? getRollupCalculationLabel(t, calculationType)
      : getDisplayModeLabel(t, showAs);

  return (
    <>
      {variant === 'field' ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className={'px-2 text-sm font-medium text-text-primary'}>
            {t('grid.rollup.title', { defaultValue: 'Rollup properties' })}
          </DropdownMenuLabel>
        </>
      ) : null}

      <DropdownMenuGroup className={'px-1'}>
        <CompactSectionLabel variant={variant}>
          {t('grid.rollup.relation', { defaultValue: 'Relation' })}
        </CompactSectionLabel>
        <DropdownMenuSub>
          <EditorTrigger
            variant={variant}
            title={t('grid.rollup.relation', { defaultValue: 'Relation' })}
            value={loadingRelated ? t('grid.rollup.loading', { defaultValue: 'Loading...' }) : selectedRelationLabel}
            icon={<RelationIcon className={'h-5 w-5'} />}
          />
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] w-[240px] overflow-y-auto'}>
              {relationFields.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t('grid.rollup.noRelationFields', { defaultValue: 'No relation fields' })}
                </DropdownMenuItem>
              ) : (
                relationFields.map((relation) => (
                  <DropdownMenuItem key={relation.id} onSelect={() => void selectRelationField(relation)}>
                    <RelationIcon className={'h-5 w-5'} />
                    <span className={'truncate'}>{relation.name}</span>
                    {relation.id === rollupOption.relation_field_id ? <DropdownMenuItemTick /> : null}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuGroup className={'px-1'}>
        <CompactSectionLabel variant={variant}>
          {t('grid.rollup.targetProperty', { defaultValue: 'Target property' })}
        </CompactSectionLabel>
        <DropdownMenuSub>
          <EditorTrigger
            variant={variant}
            title={t('grid.rollup.property', { defaultValue: 'Property' })}
            value={selectedPropertyLabel}
            disabled={!rollupOption.relation_field_id || loadingRelated}
            icon={
              targetField ? (
                <FieldTypeIcon type={targetField.type} className={'h-5 w-5'} />
              ) : (
                <span className={'text-xs'}>T</span>
              )
            }
          />
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'w-[280px] p-1'}>
              <div className={'relative p-1'}>
                <SearchIcon className={'pointer-events-none absolute left-3 top-3 h-4 w-4 text-icon-tertiary'} />
                <Input
                  autoFocus
                  aria-label={t('grid.rollup.searchProperty', { defaultValue: 'Search for a property...' })}
                  className={'w-full pl-8'}
                  placeholder={t('grid.rollup.searchProperty', { defaultValue: 'Search for a property...' })}
                  value={propertySearch}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') event.stopPropagation();
                  }}
                  onChange={(event) => setPropertySearch(event.target.value)}
                />
              </div>
              <div className={'appflowy-scroller max-h-[312px] overflow-y-auto'}>
                {filteredRelatedFields.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {normalizedSearch
                      ? t('grid.rollup.noResult', { defaultValue: 'No result' })
                      : t('grid.rollup.noRelatedFields', { defaultValue: 'No related fields' })}
                  </DropdownMenuItem>
                ) : (
                  filteredRelatedFields.map((relatedField) => (
                    <DropdownMenuItem
                      key={relatedField.id}
                      onSelect={() => {
                        setPropertySearch('');
                        selectTargetField(relatedField);
                      }}
                    >
                      <FieldTypeIcon type={relatedField.type} className={'h-5 w-5'} />
                      <span className={'truncate'}>{relatedField.name}</span>
                      {relatedField.id === rollupOption.target_field_id ? <DropdownMenuItemTick /> : null}
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuGroup className={'px-1'}>
        <CompactSectionLabel variant={variant}>
          {t('grid.rollup.calculate', { defaultValue: 'Calculate' })}
        </CompactSectionLabel>
        <DropdownMenuSub>
          <EditorTrigger
            variant={variant}
            title={t('grid.rollup.calculate', { defaultValue: 'Calculate' })}
            value={calculateLabel}
            disabled={!targetField || loadingRelated}
            testId={'rollup-calculate-trigger'}
            icon={<FormulaIcon className={'h-5 w-5'} />}
          />
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] w-[240px] overflow-y-auto'}>
              {displayModes.map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  data-testid={`rollup-display-mode-${mode}`}
                  onSelect={() => updateRollupTypeOption({ show_as: mode })}
                >
                  {getDisplayModeMenuLabel(t, mode)}
                  {mode === showAs ? <DropdownMenuItemTick /> : null}
                </DropdownMenuItem>
              ))}
              {calculationGroups.map((group) => (
                <DropdownMenuSub key={group.key}>
                  <DropdownMenuSubTrigger data-testid={`rollup-calculation-group-${group.key}`}>
                    {getCalculationGroupLabel(t, group.key)}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {group.calculations.map((type) => (
                        <DropdownMenuItem
                          key={type}
                          data-testid={`rollup-calculation-${type}`}
                          title={getCalculationTooltip(t, type)}
                          onSelect={() =>
                            updateRollupTypeOption({
                              calculation_type: type,
                              show_as: RollupDisplayMode.Calculated,
                              condition_value: type === CalculationType.CountValue ? rollupOption.condition_value : '',
                            })
                          }
                        >
                          {getRollupCalculationLabel(t, type)}
                          {type === calculationType && showAs === RollupDisplayMode.Calculated ? (
                            <DropdownMenuItemTick />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      {variant === 'field' && targetField?.type === FieldType.Number ? (
        <RollupVisualizationSettings
          option={visualization}
          calculationType={calculationType}
          onChange={(updates) =>
            updateRollupTypeOption({
              ...(updates.type !== undefined ? { visualization_type: updates.type } : {}),
              ...(updates.color !== undefined ? { visualization_color: updates.color } : {}),
              ...(updates.divisor !== undefined ? { visualization_divisor: updates.divisor } : {}),
              ...(updates.showNumber !== undefined ? { visualization_show_number: updates.showNumber } : {}),
            })
          }
        />
      ) : null}

      {showAs === RollupDisplayMode.Calculated &&
      calculationType === CalculationType.CountValue &&
      targetField &&
      [FieldType.SingleSelect, FieldType.MultiSelect].includes(targetField.type) ? (
        <DropdownMenuGroup className={'px-1'}>
          <CompactSectionLabel variant={variant}>
            {t('grid.rollup.value', { defaultValue: 'Value' })}
          </CompactSectionLabel>
          <DropdownMenuSub>
            <EditorTrigger
              variant={variant}
              title={t('grid.rollup.value', { defaultValue: 'Value' })}
              value={
                selectOptions.find((option) => option.id === rollupOption.condition_value)?.name ||
                t('grid.rollup.selectOption', { defaultValue: 'Select an option' })
              }
              icon={<span className={'text-xs'}>#</span>}
            />
            <DropdownMenuPortal>
              <DropdownMenuSubContent className={'appflowy-scroller max-h-[360px] w-[240px] overflow-y-auto'}>
                {selectOptions.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t('grid.rollup.noOptions', { defaultValue: 'No options' })}
                  </DropdownMenuItem>
                ) : (
                  selectOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      onSelect={() => updateRollupTypeOption({ condition_value: option.id })}
                    >
                      {option.name}
                      {option.id === rollupOption.condition_value ? <DropdownMenuItemTick /> : null}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      ) : null}
    </>
  );
}

export default RollupPropertyMenuContent;
