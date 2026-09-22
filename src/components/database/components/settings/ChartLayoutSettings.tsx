import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useChartLayoutSetting, usePropertiesSelector, useReadOnly } from '@/application/database-yjs';
import {
  ChartAggregationType,
  ChartNumberFormat,
  ChartType,
  DEFAULT_CHART_NUMBER_FORMAT,
  isDateGroupableFieldType,
  isGroupableFieldType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { BillingService } from '@/application/services/domains';
import type { Subscription } from '@/application/types';
import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { CHART_AGGREGATION_LABELS } from '@/components/database/chart/widgets/numberChartUtils';
import { FieldDisplay } from '@/components/database/components/field';
import {
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
import { Switch } from '@/components/ui/switch';

const CHART_TYPES = [
  { type: ChartType.Bar, labelKey: 'chart.barChart', fallback: 'Bar', testId: 'chart-type-bar' },
  {
    type: ChartType.HorizontalBar,
    labelKey: 'chart.horizontalBarChart',
    fallback: 'Horizontal Bar',
    testId: 'chart-type-horizontal-bar',
  },
  { type: ChartType.Line, labelKey: 'chart.lineChart', fallback: 'Line', testId: 'chart-type-line' },
  { type: ChartType.Donut, labelKey: 'chart.donutChart', fallback: 'Donut', testId: 'chart-type-donut' },
  { type: ChartType.Number, labelKey: 'chart.numberChart', fallback: 'Number', testId: 'chart-type-number' },
];

/**
 * Mirrors desktop's `_isPremiumChartType`: only the basic Bar chart is free.
 * On AppFlowy-hosted instances without a Pro plan, all other types are gated
 * behind an upgrade prompt. Self-hosted instances have all chart types free
 * (handled by `useSubscriptionPlan` returning `isPro = true` for non-official
 * hosts).
 */
function isPremiumChartType(type: ChartType): boolean {
  return (
    type === ChartType.HorizontalBar || type === ChartType.Line || type === ChartType.Donut || type === ChartType.Number
  );
}

// Order matches desktop's `_buildAggregationItems` in chart_layout_setting.dart.
const AGGREGATION_TYPES = CHART_AGGREGATION_LABELS;

const NUMBER_FORMATS: ReadonlyArray<{ value: ChartNumberFormat; labelKey: string; fallback: string }> = [
  { value: 'auto', labelKey: 'chart.number.formatAuto', fallback: 'Auto' },
  { value: 'compact', labelKey: 'chart.number.formatCompact', fallback: 'Compact' },
  { value: 'percent', labelKey: 'chart.number.formatPercent', fallback: 'Percent' },
];

/**
 * Title input for the Number chart. Keeps a local draft and commits on blur or
 * Enter so every keystroke doesn't create a Yjs transaction / undo step.
 * Key events are stopped so the dropdown's typeahead doesn't steal focus.
 */
function NumberChartTitleInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);

  // Follow a new stored title (a save, undo, a collaborator) during render,
  // keeping the same input (and its focus). An unsaved draft is kept.
  if (value !== previousValue) {
    setPreviousValue(value);
    if (draft === previousValue) setDraft(value);
  }

  const commit = useCallback(() => {
    if (draft !== value) onCommit(draft);
  }, [draft, value, onCommit]);

  return (
    <div className='px-2 pb-1'>
      <Input
        data-testid='chart-number-title-input'
        value={draft}
        placeholder={t('chart.number.titlePlaceholder', { defaultValue: 'Default title' })}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();

          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
          }
        }}
        className='w-full'
      />
    </div>
  );
}

const DATE_CONDITIONS = [
  { value: DateGroupCondition.Day, labelKey: 'chart.dateGrouping.day', fallback: 'Day' },
  { value: DateGroupCondition.Week, labelKey: 'chart.dateGrouping.week', fallback: 'Week' },
  { value: DateGroupCondition.Month, labelKey: 'chart.dateGrouping.month', fallback: 'Month' },
  { value: DateGroupCondition.Year, labelKey: 'chart.dateGrouping.year', fallback: 'Year' },
  { value: DateGroupCondition.Relative, labelKey: 'chart.dateGrouping.relative', fallback: 'Relative' },
];

function ChartLayoutSettings() {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const chartSetting = useChartLayoutSetting();
  const updateChartSetting = useUpdateChartSetting();

  // Pro-plan gating: lock premium chart types for free-tier hosted users.
  // `useSubscriptionPlan` returns `isPro = true` for self-hosted instances.
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentWorkspaceId = userWorkspaceInfo?.selectedWorkspace.id;
  const getSubscriptions = useCallback(async (): Promise<Subscription[] | undefined> => {
    if (!currentWorkspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(currentWorkspaceId);
  }, [currentWorkspaceId]);
  // Skip the subscription fetch entirely in publish / read-only mode — the
  // settings menu is hidden anyway, so the network call would be wasted.
  const { isPro } = useSubscriptionPlan(readOnly ? undefined : getSubscriptions);

  // Reuse the canonical in-app upgrade entry point: setting `?action=change_plan`
  // is observed by `UpgradePlan` (mounted in `Workspaces`) which auto-opens the
  // upgrade modal so the user can compare Pro/Team and pick interval. Same
  // pattern as `HomePageSetting` and `InviteMember`.
  const [, setSearch] = useSearchParams();
  const handleUpgradePrompt = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const { properties: allProperties } = usePropertiesSelector(false);

  const groupableFields = useMemo(() => {
    return allProperties.filter((property) => isGroupableFieldType(property.type));
  }, [allProperties]);

  // Y-axis candidates: Number / Checkbox / DateTime (matches desktop's
  // `_filterYAxisFields`). Used for any aggregation other than Count.
  const yFieldCandidates = useMemo(() => {
    return allProperties.filter(
      (property) =>
        property.type === FieldType.Number ||
        property.type === FieldType.Checkbox ||
        property.type === FieldType.DateTime
    );
  }, [allProperties]);

  const currentChartType = chartSetting?.chartType ?? ChartType.Bar;
  const currentXFieldId = chartSetting?.xFieldId || '';
  const currentAggregation = chartSetting?.aggregationType ?? ChartAggregationType.Count;
  const currentYFieldId = chartSetting?.yFieldId || '';
  const currentShowEmpty = chartSetting?.showEmptyValues ?? true;
  const currentCumulative = chartSetting?.cumulative ?? false;
  const currentDateCondition = chartSetting?.dateCondition ?? DateGroupCondition.Month;
  const currentNumberFormat = chartSetting?.numberFormat ?? DEFAULT_CHART_NUMBER_FORMAT;
  const currentTitleText = chartSetting?.titleText ?? '';
  const isNumberChart = currentChartType === ChartType.Number;

  const xField = useMemo(
    () => groupableFields.find((p) => p.id === currentXFieldId),
    [groupableFields, currentXFieldId]
  );
  const xIsDate = xField ? isDateGroupableFieldType(xField.type) : false;
  // Match desktop: only Count does NOT need a Y-axis field. CountValues
  // counts distinct values *of* the Y-axis field, so it needs one too.
  const aggregationNeedsY = currentAggregation !== ChartAggregationType.Count;

  // Selecting an aggregation also adjusts yFieldId so the chart actually
  // updates. Mirrors desktop's `_onAggregationTypeSelected`:
  // - switching to Count clears yFieldId
  // - switching to anything else auto-picks the first y-field candidate when
  //   no yFieldId is set yet
  const handleAggregationSelect = useCallback(
    (type: ChartAggregationType) => {
      if (type === ChartAggregationType.Count) {
        updateChartSetting({ aggregationType: type, yFieldId: '' });
        return;
      }

      if (!currentYFieldId && yFieldCandidates.length > 0) {
        updateChartSetting({ aggregationType: type, yFieldId: yFieldCandidates[0].id });
        return;
      }

      updateChartSetting({ aggregationType: type });
    },
    [currentYFieldId, yFieldCandidates, updateChartSetting]
  );

  const handleTitleCommit = useCallback(
    (titleText: string) => {
      updateChartSetting({ titleText });
    },
    [updateChartSetting]
  );

  if (readOnly) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ChartIcon className='h-4 w-4' />
        {t('grid.settings.chartSettings', 'Chart settings')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[260px] overflow-y-auto'}>
          {isNumberChart ? (
            <>
              {/* Number chart: one value over all rows — no x-axis / grouping */}
              <DropdownMenuLabel>{t('chart.number.calculate', { defaultValue: 'Calculate' })}</DropdownMenuLabel>
              {AGGREGATION_TYPES.map(({ type, labelKey, fallback }) => (
                <DropdownMenuItem
                  key={type}
                  className={'w-full'}
                  data-testid={`chart-number-aggregation-${type}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    handleAggregationSelect(type);
                  }}
                >
                  <span>
                    {type === ChartAggregationType.Count
                      ? t('chart.number.countAll', { defaultValue: 'Count all' })
                      : t(labelKey, fallback)}
                  </span>
                  {currentAggregation === type && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}

              {aggregationNeedsY && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('chart.number.property', { defaultValue: 'Property' })}</DropdownMenuLabel>
                  {yFieldCandidates.length === 0 ? (
                    <div className='px-2 py-2 text-xs text-text-secondary'>
                      {t('chart.noNumberFields', 'No number fields available')}
                    </div>
                  ) : (
                    yFieldCandidates.map((property) => (
                      <DropdownMenuItem
                        key={property.id}
                        className={'w-full'}
                        data-testid={`chart-number-property-${property.id}`}
                        onSelect={(e) => {
                          e.preventDefault();
                          updateChartSetting({ yFieldId: property.id });
                        }}
                      >
                        <FieldDisplay fieldId={property.id} />
                        {currentYFieldId === property.id && <DropdownMenuItemTick />}
                      </DropdownMenuItem>
                    ))
                  )}
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('chart.number.format', { defaultValue: 'Format' })}</DropdownMenuLabel>
              {NUMBER_FORMATS.map(({ value, labelKey, fallback }) => (
                <DropdownMenuItem
                  key={value}
                  className={'w-full'}
                  data-testid={`chart-number-format-${value}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    updateChartSetting({ numberFormat: value });
                  }}
                >
                  <span>{t(labelKey, { defaultValue: fallback })}</span>
                  {currentNumberFormat === value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('chart.number.title', { defaultValue: 'Title' })}</DropdownMenuLabel>
              <NumberChartTitleInput value={currentTitleText} onCommit={handleTitleCommit} />

              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              {/* X-Axis (matches desktop's first section) */}
              <DropdownMenuLabel>{t('chart.xAxis', 'X-Axis')}</DropdownMenuLabel>
              {groupableFields.length === 0 ? (
                <div className='px-2 py-2 text-xs text-text-secondary'>
                  {t('chart.noGroupableFields', 'No groupable fields available')}
                </div>
              ) : (
                groupableFields.map((property) => (
                  <DropdownMenuItem
                    key={property.id}
                    className={'w-full'}
                    onSelect={(e) => {
                      e.preventDefault();
                      updateChartSetting({ xFieldId: property.id });
                    }}
                  >
                    <FieldDisplay fieldId={property.id} />
                    {currentXFieldId === property.id && <DropdownMenuItemTick />}
                  </DropdownMenuItem>
                ))
              )}

              {/* Date grouping (only when X is a date field) */}
              {xIsDate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('chart.dateCondition', 'Date grouping')}</DropdownMenuLabel>
                  {DATE_CONDITIONS.map(({ value, labelKey, fallback }) => (
                    <DropdownMenuItem
                      key={value}
                      className={'w-full'}
                      onSelect={(e) => {
                        e.preventDefault();
                        updateChartSetting({ dateCondition: value });
                      }}
                    >
                      <span>{t(labelKey, fallback)}</span>
                      {currentDateCondition === value && <DropdownMenuItemTick />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />

              {/* Aggregation (matches desktop's second section) */}
              <DropdownMenuLabel>{t('chart.aggregation', 'Aggregation')}</DropdownMenuLabel>
              {AGGREGATION_TYPES.map(({ type, labelKey, fallback }) => (
                <DropdownMenuItem
                  key={type}
                  className={'w-full'}
                  onSelect={(e) => {
                    e.preventDefault();
                    handleAggregationSelect(type);
                  }}
                >
                  <span>{t(labelKey, fallback)}</span>
                  {currentAggregation === type && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}

              {/* Y-Axis (only when aggregation needs a numeric field) */}
              {aggregationNeedsY && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('chart.yAxis', 'Y-Axis')}</DropdownMenuLabel>
                  {yFieldCandidates.length === 0 ? (
                    <div className='px-2 py-2 text-xs text-text-secondary'>
                      {t('chart.noNumberFields', 'No number fields available')}
                    </div>
                  ) : (
                    yFieldCandidates.map((property) => (
                      <DropdownMenuItem
                        key={property.id}
                        className={'w-full'}
                        onSelect={(e) => {
                          e.preventDefault();
                          updateChartSetting({ yFieldId: property.id });
                        }}
                      >
                        <FieldDisplay fieldId={property.id} />
                        {currentYFieldId === property.id && <DropdownMenuItemTick />}
                      </DropdownMenuItem>
                    ))
                  )}
                </>
              )}

              <DropdownMenuSeparator />

              {/* Toggles */}
              <DropdownMenuItem
                className={'w-full'}
                onSelect={(e) => {
                  e.preventDefault();
                  updateChartSetting({ showEmptyValues: !currentShowEmpty });
                }}
              >
                {t('chart.showEmptyValues', 'Show empty values')}
                <Switch className={'ml-auto'} checked={currentShowEmpty} />
              </DropdownMenuItem>

              <DropdownMenuItem
                className={'w-full'}
                onSelect={(e) => {
                  e.preventDefault();
                  updateChartSetting({ cumulative: !currentCumulative });
                }}
              >
                {t('chart.cumulative', 'Cumulative')}
                <Switch className={'ml-auto'} checked={currentCumulative} />
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          {/* Chart type — placed at the bottom as a flat section since the
             desktop "Chart settings" menu doesn't include it (chart type
             lives in the chart toolbar on desktop). Keep it accessible here
             until a toolbar-level chart-type picker is added. */}
          <DropdownMenuLabel>{t('chart.chartType', 'Chart type')}</DropdownMenuLabel>
          {CHART_TYPES.map(({ type, labelKey, fallback, testId }) => {
            const locked = !isPro && isPremiumChartType(type);
            const label = t(labelKey, fallback);

            return (
              <DropdownMenuItem
                key={type}
                className={'w-full'}
                data-testid={testId}
                aria-label={locked ? `${label} (${t('chart.upgradeRequired', 'Upgrade Required')})` : undefined}
                onSelect={(e) => {
                  e.preventDefault();

                  if (locked) {
                    handleUpgradePrompt();
                    return;
                  }

                  updateChartSetting({ chartType: type });
                }}
              >
                <span>{label}</span>
                {locked && (
                  <CrownIcon
                    className='ml-auto h-4 w-4 text-icon-warning-thick'
                    aria-label={t('chart.upgradeRequired', 'Upgrade Required')}
                  />
                )}
                {!locked && currentChartType === type && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default ChartLayoutSettings;
