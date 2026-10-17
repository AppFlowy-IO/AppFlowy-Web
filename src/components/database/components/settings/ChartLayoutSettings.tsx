import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartLayoutSetting, usePropertiesSelector, useReadOnly } from '@/application/database-yjs';
import {
  ChartAggregationType,
  ChartLayoutSettings as ChartLayoutSettingsValue,
  ChartType,
  isDateGroupableFieldType,
  isGroupableFieldType,
  isYAxisFieldType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { ChartDateFieldItem } from '@/components/database/components/settings/chart/ChartDateFieldItem';
import { AGGREGATION_OPTIONS } from '@/components/database/components/settings/chart/chartSettingsOptions';
import {
  ChartFieldItem,
  ChartOmitZeroValuesItem,
  ChartOptionItem,
  ChartSectionHeader,
  ChartSettingsHint,
} from '@/components/database/components/settings/chart/ChartSettingsRows';
import { ChartTypeGrid } from '@/components/database/components/settings/chart/ChartTypeGrid';
import { useChartTypeAccess } from '@/components/database/components/settings/chart/useChartTypeAccess';
import { DropdownMenuGroup, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

/**
 * Chart settings rendered inline in the database settings popover, mirroring
 * desktop's embedded `ChartLayoutSetting` (PR #1461): chart type grid, X-axis
 * fields (date fields open a grouping submenu), the mobile "Omit zero values"
 * toggle, aggregation and, for any aggregation but Count, the Y-axis fields.
 */
function ChartLayoutSettings() {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const chartSetting = useChartLayoutSetting();
  const updateChartSetting = useUpdateChartSetting();
  const { isHosted, planState, showUpgradePrompt } = useChartTypeAccess();
  const { properties } = usePropertiesSelector(false);
  const chartTypeLabelId = useId();
  const xAxisLabelId = useId();
  const aggregationLabelId = useId();
  const yAxisLabelId = useId();

  const groupableFields = useMemo(
    () => properties.filter((property) => isGroupableFieldType(property.type)),
    [properties]
  );
  // Number / Checkbox / DateTime, like desktop's `_filterYAxisFields`.
  const yAxisFields = useMemo(() => properties.filter((property) => isYAxisFieldType(property.type)), [properties]);

  const chartType = chartSetting?.chartType ?? ChartType.Bar;
  const aggregationType = chartSetting?.aggregationType ?? ChartAggregationType.Count;
  const yFieldId = chartSetting?.yFieldId || '';
  const dateCondition = chartSetting?.dateCondition ?? DateGroupCondition.Month;
  const omitEmptyValues = chartSetting?.omitEmptyValues ?? false;
  const storedXFieldId = chartSetting?.xFieldId || '';
  // The X field the chart actually renders: the stored one while it is still
  // groupable, else the first groupable field (same rule as `useChartData`).
  const effectiveXFieldId = groupableFields.some((field) => field.id === storedXFieldId)
    ? storedXFieldId
    : groupableFields[0]?.id ?? '';
  // Only Count works without a Y-axis field; CountValues counts the distinct
  // values *of* the Y-axis field.
  const needsYAxisField = aggregationType !== ChartAggregationType.Count;

  // Like desktop's `_saveSettings`, every write carries the X field: the stored
  // one, so a stale field comes back once it is groupable again, else the first
  // groupable field, so a view that never picked one persists what it shows.
  const persistedXFieldId = storedXFieldId || groupableFields[0]?.id || '';
  const saveSettings = useCallback(
    (patch: Partial<ChartLayoutSettingsValue>) => {
      updateChartSetting({ xFieldId: persistedXFieldId, ...patch });
    },
    [persistedXFieldId, updateChartSetting]
  );

  // Desktop `_onAggregationTypeSelected`: Count clears the Y field; any other
  // aggregation auto-picks the first Y-axis field when none is set.
  const handleAggregationSelect = useCallback(
    (type: ChartAggregationType) => {
      if (type === ChartAggregationType.Count) {
        saveSettings({ aggregationType: type, yFieldId: '' });
        return;
      }

      if (!yFieldId && yAxisFields.length > 0) {
        saveSettings({ aggregationType: type, yFieldId: yAxisFields[0].id });
        return;
      }

      saveSettings({ aggregationType: type });
    },
    [saveSettings, yAxisFields, yFieldId]
  );

  if (readOnly) {
    return null;
  }

  return (
    <div data-testid='chart-layout-settings'>
      <DropdownMenuSeparator />

      <ChartSectionHeader id={chartTypeLabelId}>{t('chart.chartType', 'Chart type')}</ChartSectionHeader>
      <ChartTypeGrid
        isHosted={isHosted}
        labelledBy={chartTypeLabelId}
        planState={planState}
        selectedType={chartType}
        onTypeSelect={(type) => saveSettings({ chartType: type })}
        onUpgradePrompt={showUpgradePrompt}
      />

      <ChartSectionHeader id={xAxisLabelId}>{t('chart.xAxis', 'X-Axis')}</ChartSectionHeader>
      <DropdownMenuGroup aria-labelledby={xAxisLabelId}>
        {groupableFields.length === 0 ? (
          <ChartSettingsHint>
            {t('chart.noGroupableFields', 'Add a Single Select, Multi Select, or Checkbox field to create a chart')}
          </ChartSettingsHint>
        ) : (
          groupableFields.map((field) =>
            isDateGroupableFieldType(field.type) ? (
              <ChartDateFieldItem
                key={field.id}
                dateCondition={dateCondition}
                fieldId={field.id}
                fieldType={field.type}
                name={field.name}
                selected={field.id === effectiveXFieldId}
                onDateConditionSelect={(condition) => saveSettings({ xFieldId: field.id, dateCondition: condition })}
                onFieldSelect={() => saveSettings({ xFieldId: field.id })}
              />
            ) : (
              <ChartFieldItem
                key={field.id}
                fieldType={field.type}
                name={field.name}
                selected={field.id === effectiveXFieldId}
                testId={`chart-x-axis-field-${field.id}`}
                onSelect={() => saveSettings({ xFieldId: field.id })}
              />
            )
          )
        )}
        <ChartOmitZeroValuesItem
          checked={omitEmptyValues}
          onToggle={() => saveSettings({ omitEmptyValues: !omitEmptyValues })}
        />
      </DropdownMenuGroup>

      <ChartSectionHeader id={aggregationLabelId}>{t('chart.aggregation', 'Aggregation')}</ChartSectionHeader>
      <DropdownMenuGroup aria-labelledby={aggregationLabelId}>
        {AGGREGATION_OPTIONS.map((option) => (
          <ChartOptionItem
            key={option.type}
            label={t(option.labelKey, option.fallback)}
            selected={aggregationType === option.type}
            testId={`chart-aggregation-${option.slug}`}
            onSelect={() => handleAggregationSelect(option.type)}
          />
        ))}
      </DropdownMenuGroup>

      {needsYAxisField ? (
        <>
          <ChartSectionHeader id={yAxisLabelId}>{t('chart.yAxis', 'Y-Axis')}</ChartSectionHeader>
          <DropdownMenuGroup aria-labelledby={yAxisLabelId}>
            {yAxisFields.length === 0 ? (
              <ChartSettingsHint>{t('chart.noYAxisFields', 'No suitable fields for Y-axis')}</ChartSettingsHint>
            ) : (
              yAxisFields.map((field) => (
                <ChartFieldItem
                  key={field.id}
                  fieldType={field.type}
                  name={field.name}
                  selected={field.id === yFieldId}
                  testId={`chart-y-axis-field-${field.id}`}
                  onSelect={() => saveSettings({ yFieldId: field.id })}
                />
              ))
            )}
          </DropdownMenuGroup>
        </>
      ) : null}

      <div aria-hidden='true' className='h-1.5' data-chart-settings-bottom-spacer='' />
    </div>
  );
}

export default ChartLayoutSettings;
